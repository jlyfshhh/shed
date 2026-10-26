export type FeederConsumptionInput = {
  animalId: string;
  feederId: string;
  plannedFor: string;
  occurredAt: string;
  husbandryEventId: string;
  assignmentId?: string;
};

export type FeederClaimInput = {
  animalId: string;
  preySpecies: string;
  preySizeClass: string | null;
  plannedFor: string;
  occurredAt: string;
  husbandryEventId: string;
  assignmentId?: string;
};

/**
 * SQL that mirrors normalizeLabel() from the forecast: lower-case, trim, and
 * collapse any run of whitespace to a single space. SQLite/D1 has no regex, so
 * every ASCII whitespace character is turned into a space and runs are flattened
 * with repeated replace() (five passes flatten runs up to 32 characters, far
 * beyond any real prey label). Applied to BOTH the stored column and the bound
 * value so the actual claim matches exactly what the forecast counts as covered —
 * e.g. a plan entered as "large  pinky" still claims "large pinky" stock.
 */
function normalizedLabelSql(expr: string): string {
  let s = expr;
  for (const code of [9, 10, 11, 12, 13]) s = `replace(${s}, char(${code}), ' ')`;
  for (let i = 0; i < 5; i++) s = `replace(${s}, '  ', ' ')`;
  return `lower(trim(${s}))`;
}

/**
 * Claim one ACTUAL available feeder matching a feeding's requirement, atomically
 * and independent of any forecast reservation (F07).
 *
 * The feeder forecast reserves one feeder per covered animal across the whole
 * horizon, so an alphabetically earlier cage-mate's reservation could hide
 * suitable in-stock feeders from the animal actually being fed. This claims
 * against real inventory instead: the INSERT…SELECT picks the oldest available
 * feeder of the right species (and size class, when the plan names one) and
 * records a consumed assignment in a single statement. Because D1 runs each
 * completion as a transaction, two feedings competing for the last feeder cannot
 * both win — the loser's SELECT finds nothing still available and records care
 * with no deduction, so one feeder is never consumed twice and available stock
 * is never ignored because of another animal's forecast. Species and size class
 * are compared through normalizedLabelSql — case-, surrounding- AND internal-
 * whitespace-insensitive — so the claim matches exactly what the forecast counts.
 */
export function claimMatchingFeederStatements(db: D1Database, input: FeederClaimInput) {
  const assignmentId = input.assignmentId ?? crypto.randomUUID();
  const hasSize = input.preySizeClass != null && input.preySizeClass.trim() !== "";
  const sizeFilter = hasSize
    ? ` AND ${normalizedLabelSql("f.size_class")} = ${normalizedLabelSql("?")}`
    : "";
  const insertArgs: unknown[] = [
    assignmentId,
    input.animalId,
    input.plannedFor,
    input.occurredAt,
    input.occurredAt,
    input.husbandryEventId,
    input.preySpecies,
  ];
  if (hasSize) insertArgs.push(input.preySizeClass);
  return [
    db.prepare(
      `INSERT INTO feeding_assignments (id, animal_id, feeder_id, planned_for, status, created_at, consumed_at, husbandry_event_id)
       SELECT ?, ?, f.id, ?, 'consumed', ?, ?, ?
         FROM feeder_inventory f
        WHERE f.status = 'available'
          AND ${normalizedLabelSql("f.prey_species")} = ${normalizedLabelSql("?")}${sizeFilter}
        ORDER BY f.added_on, f.id
        LIMIT 1`,
    ).bind(...insertArgs),
    db.prepare(
      `UPDATE feeder_inventory
          SET status = 'consumed', consumed_at = ?, animal_id = ?, husbandry_event_id = ?
        WHERE status = 'available'
          AND id = (SELECT feeder_id FROM feeding_assignments WHERE husbandry_event_id = ? AND status = 'consumed')`,
    ).bind(input.occurredAt, input.animalId, input.husbandryEventId, input.husbandryEventId),
  ];
}

/**
 * Best-effort, race-safe inventory consumption for a recorded feeding.
 *
 * The INSERT claims only an available feeder. The UPDATE is tied to that
 * claim, so a second phone that forecast the same last feeder changes zero
 * inventory rows instead of throwing and rolling back the care completion.
 */
export function feederConsumptionStatements(db: D1Database, input: FeederConsumptionInput) {
  return [
    db.prepare("INSERT INTO feeding_assignments (id, animal_id, feeder_id, planned_for, status, created_at, consumed_at, husbandry_event_id) SELECT ?, ?, f.id, ?, 'consumed', ?, ?, ? FROM feeder_inventory f WHERE f.id = ? AND f.status = 'available'")
      .bind(
        input.assignmentId ?? crypto.randomUUID(),
        input.animalId,
        input.plannedFor,
        input.occurredAt,
        input.occurredAt,
        input.husbandryEventId,
        input.feederId,
      ),
    db.prepare("UPDATE feeder_inventory SET status = 'consumed', consumed_at = ?, animal_id = ?, husbandry_event_id = ? WHERE id = ? AND status = 'available' AND EXISTS (SELECT 1 FROM feeding_assignments fa WHERE fa.husbandry_event_id = ? AND fa.feeder_id = ? AND fa.status = 'consumed')")
      .bind(
        input.occurredAt,
        input.animalId,
        input.husbandryEventId,
        input.feederId,
        input.husbandryEventId,
        input.feederId,
      ),
  ];
}
