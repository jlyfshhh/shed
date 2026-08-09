import { ensureDatabase } from "@/db/runtime";
import { createAccessCode, hashAccessCode, requireCapability } from "@/lib/household-auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "household.manage");
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const payload = await request.json() as { displayName?: string; active?: boolean; reissueAccessCode?: boolean; earningEnabled?: boolean };
    const existing = await db.prepare("SELECT id, role FROM household_members WHERE id = ?").bind(id).first<{ id: string; role: string }>();
    if (!existing) return Response.json({ error: "Household member not found" }, { status: 404 });
    if (existing.role === "Owner" && payload.active === false) {
      return Response.json({ error: "The Head Keeper profile cannot be deactivated" }, { status: 400 });
    }
    const displayName = payload.displayName?.trim().replace(/\s+/g, " ");
    if (payload.displayName !== undefined && (!displayName || displayName.length > 40)) {
      return Response.json({ error: "A display name of 1–40 characters is required" }, { status: 400 });
    }
    const accessCode = payload.reissueAccessCode ? createAccessCode() : null;
    const accessCodeHash = accessCode ? await hashAccessCode(accessCode) : null;
    const now = new Date().toISOString();
    await db.prepare(
      "UPDATE household_members SET display_name = COALESCE(?, display_name), active = COALESCE(?, active), earning_enabled = COALESCE(?, earning_enabled), access_code_hash = COALESCE(?, access_code_hash), updated_at = ? WHERE id = ?",
    ).bind(displayName ?? null, payload.active === undefined ? null : Number(payload.active), payload.earningEnabled === undefined ? null : Number(payload.earningEnabled), accessCodeHash, now, id).run();
    const member = await db.prepare(
      "SELECT id, display_name AS displayName, role, active, earning_enabled AS earningEnabled, created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt FROM household_members WHERE id = ?",
    ).bind(id).first<{ active?: number; earningEnabled?: number }>();
    return Response.json({ member: { ...member, active: Boolean(member?.active), earningEnabled: Boolean(member?.earningEnabled) }, accessCode }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update the household member" }, { status: 500 });
  }
}
