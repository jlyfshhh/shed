// The "Missed" list behind the dashboard.
//
// Missed tasks are a settled record the keeper must be able to find and act on,
// so this list reaches back to the care baseline ("start fresh"), NOT the
// rolling 13-day overdue window the active overdue list uses. A non-superseded
// miss — a monthly feeding, say, whose next occurrence is weeks away — must not
// disappear two weeks after it was missed while its make-up window is still open.
//
// Each row carries `superseded`: 1 when a later occurrence of the same task
// (lib/superseded.ts) for that animal is already due (so it can be completed late but not put back), 0 while
// the make-up window is still open. Completed, skipped and active animals'
// brumation are handled exactly as the today/overdue lists handle them.
import { CARE_SCHEDULE_JOIN_SQL } from "./care-window.ts";
import { supersededSql } from "./superseded.ts";

export const MISSED_TASKS_SQL =
  "SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName, a.species, " +
  "t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, t.missed_by_name AS missedBy, " +
  "COALESCE(s.grace_days, 0) AS graceDays, 0 AS complete, NULL AS completionEventId, " +
  "NULL AS completedByMemberId, NULL AS completedBy, " +
  "(" + supersededSql("t") + ") AS superseded " +
  "FROM care_tasks t JOIN animals a ON a.id=t.animal_id " + CARE_SCHEDULE_JOIN_SQL +
  " LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL " +
  "WHERE a.active = 1 AND a.brumating = 0 AND t.missed_at IS NOT NULL AND e.id IS NULL AND t.due_date >= ? " +
  "ORDER BY t.due_date DESC, a.name, t.title";

/**
 * The earliest due date the missed list reaches: the care baseline, or the
 * beginning of time when no baseline is set. Deliberately NOT the overdue
 * cutoff — misses stay findable for as long as the record itself goes back.
 */
export function missedTasksSince(careStartDate: string | null): string {
  return careStartDate ?? "0001-01-01";
}
