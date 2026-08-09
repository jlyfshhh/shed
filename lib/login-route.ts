import { accessCookie, hashAccessCode } from "./access-code.ts";
import { capabilitiesForRole, type HouseholdRole } from "./capabilities.ts";
import {
  accessCodeFingerprint,
  sourceKeyFromRequest,
  type LoginThrottle,
  type ThrottleDecision,
  type ThrottleKeys,
  type TrustedProxyIpHeader,
} from "./login-throttle.ts";

const noStore = { "Cache-Control": "no-store" };

export type LoginMember = {
  id: string;
  displayName: string;
  role: HouseholdRole;
};

export type LoginStore = {
  findActiveMember(accessCodeHash: string): Promise<LoginMember | null>;
  markLogin(memberId: string, timestamp: string): Promise<void>;
};

export type LoginRouteDependencies = {
  throttle: Pick<LoginThrottle, "check" | "fail" | "succeed">;
  openStore(): Promise<LoginStore>;
  trustedProxyHeader?: TrustedProxyIpHeader;
  now?: () => Date;
  reportError?: (error: unknown) => void;
};

/**
 * The HTTP login boundary with its stateful dependencies injected.
 *
 * The production route supplies D1 and the process-local throttle; tests supply
 * an in-memory member store and exercise real Request/Response objects. Keeping
 * this outside the Workers route module means those tests do not need to fake a
 * `cloudflare:workers` runtime.
 */
export async function handleLoginRequest(
  request: Request,
  dependencies: LoginRouteDependencies,
): Promise<Response> {
  try {
    // Direct LAN mode passes no trusted header, so spoofed forwarding headers
    // cannot manufacture source identities. Per-code and global checks remain.
    const source = sourceKeyFromRequest(request, dependencies.trustedProxyHeader);
    const earlyGate = dependencies.throttle.check({ source });
    if (!earlyGate.allowed) return tooManyAttempts(earlyGate);

    const payload = await request.json() as { accessCode?: string };
    const accessCode = payload.accessCode?.trim();
    if (!accessCode) {
      return Response.json({ error: "Access code is required" }, { status: 400, headers: noStore });
    }

    // Everything below is identical until after the D1 lookup, including the
    // fingerprint and throttle decision, whether a submitted string exists or not.
    const keys: ThrottleKeys = {
      source,
      codeFingerprint: await accessCodeFingerprint(accessCode),
    };
    const gate = dependencies.throttle.check(keys);
    if (!gate.allowed) return tooManyAttempts(gate);

    const store = await dependencies.openStore();
    const member = await store.findActiveMember(await hashAccessCode(accessCode));
    if (!member) {
      const afterFailure = dependencies.throttle.fail(keys);
      if (!afterFailure.allowed) return tooManyAttempts(afterFailure);
      return Response.json(
        { error: "That Shed invitation is invalid or inactive" },
        { status: 401, headers: noStore },
      );
    }

    dependencies.throttle.succeed(keys);
    const timestamp = (dependencies.now?.() ?? new Date()).toISOString();
    await store.markLogin(member.id, timestamp);
    return Response.json(
      {
        capabilities: capabilitiesForRole(member.role),
        member: { id: member.id, displayName: member.displayName, role: member.role },
      },
      { headers: { "Set-Cookie": accessCookie(accessCode, request), ...noStore } },
    );
  } catch (error) {
    dependencies.reportError?.(error);
    return Response.json({ error: "Unable to sign in" }, { status: 500, headers: noStore });
  }
}

function tooManyAttempts(decision: ThrottleDecision): Response {
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
  return Response.json(
    { error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds), ...noStore } },
  );
}
