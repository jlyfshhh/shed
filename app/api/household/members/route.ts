import { ensureDatabase } from "@/db/runtime";
import { createAccessCode, hashAccessCode, requireHouseholdMember } from "@/lib/household-auth";
import { balancesByMember, getDefaultRewardCents } from "@/lib/rewards";

type MemberRow = {
  id: string;
  displayName: string;
  role: string;
  active: number;
  earningEnabled: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const auth = await requireHouseholdMember(request, db, ["Owner"]);
  if (auth.response) return auth.response;
  const [members, balances, defaultRewardCents] = await Promise.all([
    db.prepare(
      "SELECT id, display_name AS displayName, role, active, earning_enabled AS earningEnabled, created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt FROM household_members ORDER BY CASE role WHEN 'Owner' THEN 0 ELSE 1 END, display_name",
    ).all<MemberRow>(),
    balancesByMember(db),
    getDefaultRewardCents(db),
  ]);
  return Response.json(
    { members: members.results.map((member) => publicMember(member, balances.get(member.id))), defaultRewardCents },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as { displayName?: string };
    const displayName = payload.displayName?.trim().replace(/\s+/g, " ");
    if (!displayName || displayName.length > 40) {
      return Response.json({ error: "A display name of 1–40 characters is required" }, { status: 400 });
    }
    const id = crypto.randomUUID();
    const accessCode = createAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO household_members (id, display_name, role, access_code_hash, active, created_at, updated_at) VALUES (?, ?, 'Zookeeper', ?, 1, ?, ?)",
    ).bind(id, displayName, accessCodeHash, now, now).run();
    return Response.json(
      { member: { id, displayName, role: "Zookeeper", active: true, earningEnabled: false, createdAt: now, updatedAt: now, lastLoginAt: null, balanceCents: 0, earnedCents: 0, paidCents: 0 }, accessCode },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create the Zookeeper" }, { status: 500 });
  }
}

function publicMember(member: MemberRow, balance?: { earnedCents: number; paidCents: number; balanceCents: number }) {
  return {
    ...member,
    active: Boolean(member.active),
    earningEnabled: Boolean(member.earningEnabled),
    earnedCents: balance?.earnedCents ?? 0,
    paidCents: balance?.paidCents ?? 0,
    balanceCents: balance?.balanceCents ?? 0,
  };
}
