import { ensureDatabase } from "@/db/runtime";
import { accessCookie, capabilitiesForRole, createAccessCode, hashAccessCode } from "@/lib/household-auth";
import { createInitialOwner } from "@/lib/bootstrap-owner";
import { reissueOwnerAccessCode } from "@/lib/recover-owner";
import { binding, sharedSecretIsAuthorized } from "@/lib/env";
import { loginThrottle, sourceKeyFromRequest, trustedProxyIpHeader } from "@/lib/login-throttle";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const bootstrapToken = binding("SHED_BOOTSTRAP_TOKEN");
    if (!bootstrapToken) {
      return Response.json({ error: "Head Keeper setup is not enabled" }, { status: 503, headers: noStore });
    }
    // Both setup and recovery accept this one secret, and recovery keeps it
    // useful for the life of the install rather than only until the first Head
    // Keeper exists. Rate-limit the token itself so it cannot be ground down on
    // an install that is reachable from further away than the keeper assumes.
    // Setup was never throttled at all before recovery existed.
    const throttleKeys = {
      source: sourceKeyFromRequest(request, trustedProxyIpHeader(binding("SHED_TRUSTED_PROXY_IP_HEADER"))),
      codeFingerprint: "bootstrap-token",
    };
    const decision = loginThrottle.check(throttleKeys);
    if (!decision.allowed) {
      return Response.json(
        { error: "Too many attempts. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds), ...noStore } },
      );
    }
    if (!(await sharedSecretIsAuthorized(request, bootstrapToken, "X-Shed-Bootstrap-Token"))) {
      const failed = loginThrottle.fail(throttleKeys);
      return Response.json(
        { error: "Invalid setup token" },
        { status: 401, headers: { "Retry-After": String(failed.retryAfterSeconds), ...noStore } },
      );
    }
    loginThrottle.succeed(throttleKeys);

    let payload: { displayName?: unknown; recover?: unknown };
    try {
      const value = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
      payload = value as { displayName?: unknown; recover?: unknown };
    } catch {
      return Response.json({ error: "A valid setup request is required" }, { status: 400, headers: noStore });
    }

    // Recovery. The Head Keeper access code is shown once and stored only as a
    // hash, and every other way back into a household runs through the Head
    // Keeper, so losing it meant editing the database by hand. Two separate
    // keepers hit exactly that.
    //
    // The setup token is the right credential for this: it already creates the
    // Head Keeper, it lives in the install's own .env, and anyone who can read
    // it can already reach the database directly. Throttled all the same, so
    // the token cannot be guessed against an exposed install.
    if (payload.recover === true) {
      const db = await ensureDatabase();
      const recovered = await reissueOwnerAccessCode({
        findOwner: () => db.prepare(
          "SELECT id, display_name AS displayName FROM household_members WHERE role = 'Owner'",
        ).first<{ id: string; displayName: string }>(),
        // Reactivate as well as re-key: an Owner somehow left inactive would
        // otherwise be handed a code that cannot sign in.
        reissue: async (id, accessCodeHash, timestamp) => {
          await db.prepare(
            "UPDATE household_members SET access_code_hash = ?, active = 1, updated_at = ? WHERE id = ?",
          ).bind(accessCodeHash, timestamp, id).run();
        },
      });
      if (!recovered) {
        return Response.json({ error: "This household has no Head Keeper yet" }, { status: 409, headers: noStore });
      }
      return Response.json(
        {
          capabilities: capabilitiesForRole("Owner"),
          member: { id: recovered.owner.id, displayName: recovered.owner.displayName, role: "Owner" },
          accessCode: recovered.accessCode,
        },
        { status: 200, headers: { "Set-Cookie": accessCookie(recovered.accessCode, request), ...noStore } },
      );
    }
    const displayName = cleanDisplayName(payload.displayName);
    if (!displayName) {
      return Response.json({ error: "Display name is required" }, { status: 400, headers: noStore });
    }

    const id = crypto.randomUUID();
    const accessCode = createAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    const created = await createInitialOwner(db, { id, displayName, accessCodeHash, timestamp: now });
    if (!created) {
      return Response.json(
        { error: "The Shed household already has an owner" },
        { status: 409, headers: noStore },
      );
    }

    return Response.json(
      {
        capabilities: capabilitiesForRole("Owner"),
        member: { id, displayName, role: "Owner" },
        accessCode,
      },
      { status: 201, headers: { "Set-Cookie": accessCookie(accessCode, request), ...noStore } },
    );
  } catch (error) {
    console.error("Head Keeper setup failed", error);
    return Response.json({ error: "Unable to create the owner" }, { status: 500, headers: noStore });
  }
}

function cleanDisplayName(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return cleaned && cleaned.length <= 40 ? cleaned : null;
}
