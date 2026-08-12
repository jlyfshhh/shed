export type FeederConsumptionInput = {
  animalId: string;
  feederId: string;
  plannedFor: string;
  occurredAt: string;
  husbandryEventId: string;
  assignmentId?: string;
};

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
