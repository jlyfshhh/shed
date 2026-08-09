import { binding } from "./env.ts";
import { attributedTo } from "./attribution.ts";
import {
  authorize,
  capabilitiesForContext,
  capabilitiesForRole,
  type Capability,
  type HouseholdRole,
} from "./capabilities.ts";
import {
  ACCESS_COOKIE,
  accessCodeFromCookie,
  accessCookie,
  createAccessCode,
  expiredAccessCookie,
  hashAccessCode,
} from "./access-code.ts";

export {
  ACCESS_COOKIE,
  accessCookie,
  capabilitiesForContext,
  capabilitiesForRole,
  createAccessCode,
  expiredAccessCookie,
  hashAccessCode,
};
export type { Capability, HouseholdRole };

export type HouseholdMember = {
  id: string;
  displayName: string;
  role: HouseholdRole;
  active: number | boolean;
  earningEnabled?: number | boolean;
};

export function householdAuthRequired(): boolean {
  return binding("SHED_AUTH_REQUIRED")?.toLowerCase() === "true";
}

export async function memberFromRequest(request: Request, db: D1Database): Promise<HouseholdMember | null> {
  const code = accessCodeFromCookie(request.headers.get("Cookie"));
  if (!code) return null;
  const accessCodeHash = await hashAccessCode(code);
  return db.prepare(
    "SELECT id, display_name AS displayName, role, active, earning_enabled AS earningEnabled FROM household_members WHERE access_code_hash = ? AND active = 1",
  ).bind(accessCodeHash).first<HouseholdMember>();
}

export type AuthResult = {
  member: HouseholdMember | null;
  capabilities: Capability[];
  response: Response | null;
};

/**
 * Gate a route on one named capability from the shared matrix in
 * `capabilities.ts`. Routes name what they are doing rather than restating a
 * role list, so the policy lives in one place and the UI can be handed the same
 * names the server enforces.
 *
 * `member` is nullable even on success — an install running with
 * `SHED_AUTH_REQUIRED` off has no accounts at all. Use `attributedTo(auth.member)`
 * for the "who did this" columns.
 */
export async function requireCapability(
  request: Request,
  db: D1Database,
  capability: Capability,
): Promise<AuthResult> {
  const member = await memberFromRequest(request, db);
  const context = { authRequired: householdAuthRequired(), role: member?.role ?? null };
  const capabilities = capabilitiesForContext(context);
  const denial = authorize(capability, context);
  if (!denial) return { member, capabilities, response: null };
  return {
    member,
    capabilities,
    // Never cached: a 401 held in a shared cache outlives the sign-in that fixes it.
    response: Response.json({ error: denial.error }, { status: denial.status, headers: { "Cache-Control": "no-store" } }),
  };
}

// Re-exported so routes have a single import site for auth concerns.
export { attributedTo };
