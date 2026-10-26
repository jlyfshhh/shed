// Date-bounded cleanup of an animal's materialized care tasks at an archive or
// brumation boundary (F08).
//
// The one rule both share: only ever remove UNSETTLED tasks — no completion, not
// skipped, not explicitly marked missed — and only within the date range the
// boundary actually covers. A task left pending for a day the animal was active
// and present is a genuine (implicit) miss and must survive, so the streak
// reader keeps scoring history truthfully. Statements are returned (not run) so
// a caller can commit them in the same D1 batch as the flag change, keeping the
// boundary move and its cleanup atomic.

const UNSETTLED = "skipped_at IS NULL AND missed_at IS NULL AND NOT EXISTS (SELECT 1 FROM husbandry_events e WHERE e.task_id = care_tasks.id AND e.voided_at IS NULL)";

/**
 * Clear an animal's pending tasks on or after `from`. Used when archiving: care
 * ends from the archive day forward, but anything dated before `from`
 * (pre-archive implicit misses and all settled rows) is preserved.
 */
export function clearPendingTasksFromStatement(db: D1Database, animalId: string, from: string) {
  return db
    .prepare(`DELETE FROM care_tasks WHERE animal_id = ? AND due_date >= ? AND ${UNSETTLED}`)
    .bind(animalId, from);
}

/**
 * Clear an animal's pending tasks within the window [from, until) — the paused
 * days of a brumation. A task due before `from` (before the pause began) is
 * pre-boundary history, so an implicit overdue miss dated before brumation is
 * preserved on resume rather than wrongly deleted.
 */
export function clearPendingTasksInWindowStatement(db: D1Database, animalId: string, from: string, until: string) {
  return db
    .prepare(`DELETE FROM care_tasks WHERE animal_id = ? AND due_date >= ? AND due_date < ? AND ${UNSETTLED}`)
    .bind(animalId, from, until);
}
