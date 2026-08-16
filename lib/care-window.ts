/**
 * Grace days: how long after its due date a task is still simply "to do".
 *
 * Some care is genuinely tied to a day — a feeding is due when it is due. Other
 * work is scheduled on a day only because it has to be scheduled on some day.
 * A weekend chore put on Saturday so it can be done Saturday *or* Sunday is not
 * late on Sunday morning, and calling it late trains the keeper to ignore the
 * overdue list, which is the one list that has to stay trustworthy.
 *
 * So a schedule may carry a window. Inside it the task stays on today's list;
 * past it, the existing overdue and missed behaviour takes over unchanged. The
 * default is zero, so nothing that does not opt in changes at all.
 *
 * The due date itself never moves: it is the identity of the occurrence, which
 * completions, the `(task_id, due_date)` uniqueness rule, and reward
 * attribution all depend on. Only the deadline is affected.
 */

/** The last day a task with this window is still current. */
export function taskLastDay(dueDate: string, graceDays: number): string {
  const days = normalizeGraceDays(graceDays);
  if (days === 0) return dueDate;
  const at = new Date(`${dueDate}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** True while the task belongs on today's list — due, or inside its window. */
export function taskIsCurrent(dueDate: string, graceDays: number, today: string): boolean {
  return dueDate <= today && today <= taskLastDay(dueDate, graceDays);
}

/** True once the window has closed without the task being done. */
export function taskIsOverdue(dueDate: string, graceDays: number, today: string): boolean {
  return today > taskLastDay(dueDate, graceDays);
}

/**
 * A negative or non-integer window would silently shift a deadline earlier or
 * throw off `date()` arithmetic, so it is treated as no window at all.
 */
export function normalizeGraceDays(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * The same rule in SQL, so a query and the client can never disagree about
 * whether a task is late. Expects `care_tasks t` left-joined to
 * `care_schedules s`; an ad-hoc task with no schedule has no window.
 */
export const CARE_SCHEDULE_JOIN_SQL =
  "LEFT JOIN care_schedules s ON s.id = t.schedule_id";

export const TASK_LAST_DAY_SQL =
  "date(t.due_date, '+' || COALESCE(s.grace_days, 0) || ' days')";

/** Due on or before the given day, and still inside its window. */
export const TASK_IS_CURRENT_SQL =
  `(t.due_date <= ? AND ${TASK_LAST_DAY_SQL} >= ?)`;

/** Past the end of its window. */
export const TASK_IS_OVERDUE_SQL = `(${TASK_LAST_DAY_SQL} < ?)`;
