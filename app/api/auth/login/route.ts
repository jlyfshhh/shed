import { ensureDatabase } from "@/db/runtime";
import { accessCookie, hashAccessCode, type HouseholdMember } from "@/lib/household-auth";
import { loginThrottle } from "@/lib/login-throttle";

export async function POST(request: Request) {
  try {
    const throttle = loginThrottle.check();
    if (!throttle.allowed) return Response.json(
      { error: `Too many sign-in attempts. Try again in ${Math.ceil(throttle.retryAfterSeconds / 60)} minutes.` },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
    const payload = await request.json() as { accessCode?: string };
    if (!payload.accessCode?.trim()) return Response.json({ error: "Access code is required" }, { status: 400 });
    const db = await ensureDatabase();
    const accessCodeHash = await hashAccessCode(payload.accessCode);
    const member = await db.prepare(
      "SELECT id, display_name AS displayName, role, active FROM household_members WHERE access_code_hash = ? AND active = 1",
    ).bind(accessCodeHash).first<HouseholdMember>();
    if (!member) {
      const afterFailure = loginThrottle.fail();
      if (!afterFailure.allowed) return Response.json(
        { error: `Too many sign-in attempts. Try again in ${Math.ceil(afterFailure.retryAfterSeconds / 60)} minutes.` },
        { status: 429, headers: { "Retry-After": String(afterFailure.retryAfterSeconds), "Cache-Control": "no-store" } },
      );
      return Response.json({ error: "That Shed invitation is invalid or inactive" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    loginThrottle.success();
    await db.prepare("UPDATE household_members SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), new Date().toISOString(), member.id).run();
    return Response.json(
      { member: { id: member.id, displayName: member.displayName, role: member.role } },
      { headers: { "Set-Cookie": accessCookie(payload.accessCode.trim(), request), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to sign in" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
