import { ensureDatabase } from "@/db/runtime";
import { expiredAccessCookie, householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const member = await memberFromRequest(request, db);
  return Response.json(
    { authenticated: Boolean(member), authRequired: householdAuthRequired(), member: member ? { id: member.id, displayName: member.displayName, role: member.role } : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  return Response.json(
    { signedOut: true },
    { headers: { "Set-Cookie": expiredAccessCookie(), "Cache-Control": "no-store" } },
  );
}
