import { binding } from "./env.ts";
import { attributedTo } from "./attribution.ts";
import {
  ACCESS_COOKIE,
  accessCodeFromCookie,
  accessCookie,
  createAccessCode,
  expiredAccessCookie,
  hashAccessCode,
} from "./access-code.ts";

export { ACCESS_COOKIE, accessCookie, createAccessCode, expiredAccessCookie, hashAccessCode };

export type HouseholdRole = "Owner" | "Zookeeper";

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

/**
 * Gate a route on household membership.
 *
 * When `SHED_AUTH_REQUIRED` is off there are no sign-ins to check, so every
 * caller is allowed through with a null member. Without this, an install
 * configured the way `.env.example` ships it — auth off — could read its
 * dashboard but could not manage a single record, because every write route
 * 401'd against a login the install had deliberately disabled.
 *
 * Callers must therefore treat `member` as nullable even on success. Use
 * `attributedTo(auth.member)` for the "who did this" columns.
 */
export async function requireHouseholdMember(
  request: Request,
  db: D1Database,
  allowedRoles: HouseholdRole[] = ["Owner", "Zookeeper"],
): Promise<{ member: HouseholdMember | null; response: Response | null }> {
  const member = await memberFromRequest(request, db);
  if (!householdAuthRequired()) {
    // Open install: no accounts exist to check a role against.
    return { member, response: null };
  }
  if (!member) {
    return { member: null, response: Response.json({ error: "Sign in to Shed first" }, { status: 401 }) };
  }
  if (!allowedRoles.includes(member.role)) {
    return { member, response: Response.json({ error: "Owner access required" }, { status: 403 }) };
  }
  return { member, response: null };
}

// Re-exported so routes have a single import site for auth concerns.
export { attributedTo };
