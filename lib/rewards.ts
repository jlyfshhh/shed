// Task earnings ("allowance") — added by Claude 2026-07-21 while Codex was out.
// Balances are derived, never stored: a member's balance is the sum of the
// reward snapshot on each of their non-voided completions, minus payouts.

export const DEFAULT_REWARD_CENTS = 25;
export const MAX_REWARD_CENTS = 100_000; // $1,000 sanity ceiling per task/setting

/** Reward captured on a completion event at the moment it is marked done. */
export function rewardForCompletion(
  earningEnabled: boolean,
  scheduleRewardCents: number | null | undefined,
  defaultRewardCents: number,
): number {
  if (!earningEnabled) return 0;
  const perPlan = scheduleRewardCents;
  const cents = perPlan === null || perPlan === undefined ? defaultRewardCents : perPlan;
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
}

/** Current owed balance for display. Never negative even if data drifts. */
export function netBalanceCents(earnedCents: number, paidCents: number): number {
  return Math.max(0, Math.round(earnedCents) - Math.round(paidCents));
}

/** Parse the stored app_settings string into a clamped cents integer. */
export function parseRewardCents(value: unknown, fallback = DEFAULT_REWARD_CENTS): number {
  // Empty/missing settings fall back to the default (Number("") is 0, not NaN).
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const cents = Math.round(Number(value));
  if (!Number.isFinite(cents) || cents < 0) return fallback;
  return Math.min(cents, MAX_REWARD_CENTS);
}

// ── DB-backed helpers (require D1) ────────────────────────────────────────────

export async function getDefaultRewardCents(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'default_reward_cents'").first<{ value: string }>();
  return parseRewardCents(row?.value);
}

export async function setDefaultRewardCents(db: D1Database, cents: number): Promise<number> {
  const clean = parseRewardCents(cents);
  await db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('default_reward_cents', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(String(clean)).run();
  return clean;
}

export type MemberBalance = { earnedCents: number; paidCents: number; balanceCents: number };

/** Balances for every member, keyed by member id. */
export async function balancesByMember(db: D1Database): Promise<Map<string, MemberBalance>> {
  const [earned, paid] = await Promise.all([
    db.prepare(
      "SELECT completed_by_member_id AS memberId, SUM(reward_cents) AS cents FROM husbandry_events WHERE voided_at IS NULL AND reward_cents > 0 AND completed_by_member_id IS NOT NULL GROUP BY completed_by_member_id",
    ).all<{ memberId: string; cents: number }>(),
    db.prepare(
      "SELECT member_id AS memberId, SUM(amount_cents) AS cents FROM reward_payouts GROUP BY member_id",
    ).all<{ memberId: string; cents: number }>(),
  ]);
  const map = new Map<string, MemberBalance>();
  for (const row of earned.results) {
    map.set(row.memberId, { earnedCents: Number(row.cents ?? 0), paidCents: 0, balanceCents: 0 });
  }
  for (const row of paid.results) {
    const entry = map.get(row.memberId) ?? { earnedCents: 0, paidCents: 0, balanceCents: 0 };
    entry.paidCents = Number(row.cents ?? 0);
    map.set(row.memberId, entry);
  }
  for (const entry of map.values()) {
    entry.balanceCents = netBalanceCents(entry.earnedCents, entry.paidCents);
  }
  return map;
}

export async function memberBalance(db: D1Database, memberId: string): Promise<MemberBalance> {
  const [earnedRow, paidRow] = await Promise.all([
    db.prepare(
      "SELECT COALESCE(SUM(reward_cents), 0) AS cents FROM husbandry_events WHERE completed_by_member_id = ? AND voided_at IS NULL AND reward_cents > 0",
    ).bind(memberId).first<{ cents: number }>(),
    db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM reward_payouts WHERE member_id = ?").bind(memberId).first<{ cents: number }>(),
  ]);
  const earnedCents = Number(earnedRow?.cents ?? 0);
  const paidCents = Number(paidRow?.cents ?? 0);
  return { earnedCents, paidCents, balanceCents: netBalanceCents(earnedCents, paidCents) };
}
