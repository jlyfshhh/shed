// Task earnings ("allowance") — added by Claude 2026-07-21 while Codex was out.
import { ensureDatabase } from "@/db/runtime";
import { requireHouseholdMember } from "@/lib/household-auth";
import { getDefaultRewardCents, MAX_REWARD_CENTS, setDefaultRewardCents } from "@/lib/rewards";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const auth = await requireHouseholdMember(request, db, ["Owner"]);
  if (auth.response) return auth.response;
  return Response.json({ defaultRewardCents: await getDefaultRewardCents(db) }, { headers: noStore });
}

export async function PATCH(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as { defaultRewardCents?: number };
    const cents = Math.round(Number(payload.defaultRewardCents));
    if (!Number.isFinite(cents) || cents < 0 || cents > MAX_REWARD_CENTS) {
      return Response.json({ error: "Enter a per-task amount between $0.00 and $1000.00." }, { status: 400, headers: noStore });
    }
    return Response.json({ defaultRewardCents: await setDefaultRewardCents(db, cents) }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update the default reward" }, { status: 500, headers: noStore });
  }
}
