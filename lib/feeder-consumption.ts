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
 * SQL that follows normalizeLabel() from the forecast — lower-case, trim, and
 * collapse whitespace runs to a single space — for the labels that actually occur.
 * SQLite/D1 has no regex, so each whitespace character is turned into a space and
 * runs are flattened with repeated replace(). It converts the ASCII whitespace
 * set (tab, LF, VT, FF, CR) AND the no-break space U+00A0 (char(160)) — the common
 * copy-paste artifact Codex flagged — then runs nine collapse passes, flattening
 * any run up to ~512 characters, past the 200-char plan-label cap.
 *
 * This is deliberately NOT claimed identical to JS `\s+` for every exotic Unicode
 * space, but it agrees with the forecast for all realistic inputs, and both the
 * stored column and the bound value pass through it — so a plan entered as
 * "large  pinky", "large pinky" (NBSP), or with an extreme run still claims
 * "large pinky" stock, exactly what the forecast counted as covered.
 */
function normalizedLabelSql(expr: string): string {
  let s = expr;
  for (const code of [9, 10, 11, 12, 13, 160]) s = `replace(${s}, char(${code}), ' ')`;
  for (let i = 0; i < 9; i++) s = `replace(${s}, '  ', ' ')`;
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
