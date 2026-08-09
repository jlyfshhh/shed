import { ensureDatabase } from "@/db/runtime";
import { capabilitiesForContext, expiredAccessCookie, householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const member = await memberFromRequest(request, db);
  const authRequired = householdAuthRequired();
  const capabilities = capabilitiesForContext({ authRequired, role: member?.role ?? null });
  const memberCount = await db.prepare("SELECT COUNT(*) AS count FROM household_members").first<{ count: number }>();
  return Response.json(
    {
      authenticated: Boolean(member),
      authRequired,
      setupRequired: (memberCount?.count ?? 0) === 0,
      capabilities,
      member: member ? { id: member.id, displayName: member.displayName, role: member.role } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  return Response.json(
    { signedOut: true },
    { headers: { "Set-Cookie": expiredAccessCookie(), "Cache-Control": "no-store" } },
  );
}
