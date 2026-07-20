import { ensureDatabase } from "@/db/runtime";
import { accessCookie, createAccessCode, hashAccessCode } from "@/lib/household-auth";
import { binding, voiceRequestIsAuthorized } from "@/lib/voice-auth";

export async function POST(request: Request) {
  try {
    const bootstrapToken = binding("SHED_BOOTSTRAP_TOKEN");
    if (!bootstrapToken) {
      return Response.json({ error: "Owner bootstrap is not enabled" }, { status: 503 });
    }
    if (!(await voiceRequestIsAuthorized(request, bootstrapToken))) {
      return Response.json({ error: "Invalid bootstrap token" }, { status: 401 });
    }
    const db = await ensureDatabase();
    const existing = await db.prepare("SELECT COUNT(*) AS count FROM household_members").first<{ count: number }>();
    if ((existing?.count ?? 0) > 0) {
      return Response.json({ error: "The Shed household already has an owner" }, { status: 409 });
    }
    const payload = await request.json() as { displayName?: string };
    const displayName = cleanDisplayName(payload.displayName);
    if (!displayName) return Response.json({ error: "Display name is required" }, { status: 400 });

    const id = crypto.randomUUID();
    const accessCode = createAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO household_members (id, display_name, role, access_code_hash, active, created_at, updated_at, last_login_at) VALUES (?, ?, 'Owner', ?, 1, ?, ?, ?)",
    ).bind(id, displayName, accessCodeHash, now, now, now).run();

    return Response.json(
      { member: { id, displayName, role: "Owner" }, accessCode },
      { status: 201, headers: { "Set-Cookie": accessCookie(accessCode, request), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create the owner" }, { status: 500 });
  }
}

function cleanDisplayName(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= 40 ? cleaned : null;
}
