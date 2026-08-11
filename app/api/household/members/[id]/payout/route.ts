// Task earnings ("allowance") — added by Claude 2026-07-21 while Codex was out.
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { attributedTo, requireCapability } from "@/lib/household-auth";
import { MAX_REWARD_CENTS, memberBalance } from "@/lib/rewards";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "household.manage");
    if (auth.response) return auth.response;
    const actor = attributedTo(auth.member);
    const { id } = await context.params;

    const member = await db.prepare("SELECT id, display_name AS displayName FROM household_members WHERE id = ?").bind(id).first<{ id: string; displayName: string }>();
    if (!member) return Response.json({ error: "Household member not found" }, { status: 404, headers: noStore });

    const payload = await request.json().catch(() => ({})) as { amountCents?: number; note?: string };
    const balance = await memberBalance(db, id);
    if (balance.balanceCents <= 0) {
      return Response.json({ error: "There is nothing to pay out." }, { status: 400, headers: noStore });
    }

    // Default to paying the full balance; otherwise validate the partial amount.
    const requested = payload.amountCents === undefined ? balance.balanceCents : Math.round(Number(payload.amountCents));
    if (!Number.isFinite(requested) || requested <= 0 || requested > MAX_REWARD_CENTS) {
      return Response.json({ error: "Enter a valid payout amount." }, { status: 400, headers: noStore });
    }
    if (requested > balance.balanceCents) {
      return Response.json({ error: "That is more than the current balance." }, { status: 400, headers: noStore });
    }

    const note = payload.note?.trim().slice(0, 200) || null;
    await db.prepare(
      "INSERT INTO reward_payouts (id, member_id, amount_cents, note, paid_at, paid_by_member_id, paid_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), id, requested, note, new Date().toISOString(), actor.id, actor.name).run();

    const updated = await memberBalance(db, id);
    return Response.json(
      { saved: true, paidCents: requested, member: { id: member.id, displayName: member.displayName, balanceCents: updated.balanceCents, earnedCents: updated.earnedCents, paidCents: updated.paidCents } },
      { headers: noStore },
    );
  } catch (error) {
    return internalErrorResponse(error, { context: "Household payout failed", message: "Unable to record the payout", headers: noStore });
  }
}

const noStore = { "Cache-Control": "no-store" };
