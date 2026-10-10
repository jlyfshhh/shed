// The care streak: consecutive recent days on which every accountable scheduled
// task was completed. It is the honest, motivating number a keeper can share —
// so it never overclaims, and it never rewrites the past.
//
// Accountability is date-aware. A day's counts come from the care_tasks that
// were actually materialized for that day, and a task only exists for an animal
// that was active and not paused *on that day* (see db/runtime materializer and
// lib/brumation). So a day that already held a miss keeps that miss: pausing,
// brumating, or archiving an animal today changes its future care, never its
// history. The database read below must therefore never re-filter the window by
// an animal's *current* active/brumating flags — doing so was the bug that let a
// pause retroactively heal an old miss.
//
// Each day gets one of three verdicts:
//   • clean  — nothing missed and nothing still outstanding; it extends a run.
//   • broken — at least one accountable task passed its settlement deadline (its
//              due date plus the schedule's grace days, per lib/care-window)
//              without being done, or was explicitly marked missed. It resets
//              the run.
//   • held   — nothing missed, but at least one accountable task is still inside
//              its grace window. The day is not yet settled, so it neither breaks
//              the streak nor is allowed to extend it; the count is held at the
//              last fully-settled boundary. "Today" is the usual held day (care
//              still left to do), but a weekend chore with grace days also keeps
//              its own earlier day held until that later deadline — so the streak
//              never calls a day missed before it actually is.
import { isoDaysAgo } from "./care-schedule.ts";
import { CARE_SCHEDULE_JOIN_SQL, TASK_IS_OVERDUE_SQL } from "./care-window.ts";

export type StreakDay = {
  date: string;
  /** Accountable tasks due that day (scheduled, minus skipped). Always equal to
   *  completed + missed + pending. */
  accountable: number;
  /** Accountable tasks completed. */
  completed: number;
  /** Accountable tasks past their settlement deadline (grace included) and still
   *  not done, or explicitly marked missed — genuine misses that break the day. */
  missed: number;
  /** Accountable tasks still inside their grace window and not yet done — not a
   *  miss yet, so the day is "held" rather than broken. */
  pending: number;
};

export type CareStreak = {
  current: number;
  longest: number;
  /** True when the most recent day is still held — today with care left to do,
   *  or an earlier day not yet past its grace window. */
  todayInProgress: boolean;
};

type DayVerdict = "clean" | "broken" | "held";

function verdict(day: StreakDay): DayVerdict {
  if (day.missed > 0) return "broken";
  if (day.pending > 0) return "held";
  return "clean";
}

/**
 * @param days  chronological, one per calendar day, oldest first, ending today.
 * @param today the household's current date (YYYY-MM-DD).
 */
export function careStreak(days: readonly StreakDay[], today: string): CareStreak {
  // Defensive: never score a day that has not happened yet.
  const timeline = days.filter((day) => day.date <= today);

  // Longest run of clean days anywhere in the window. A broken day resets the
  // run; so does a still-unsettled (held) day, because a run cannot be claimed
  // *through* a day whose verdict is not yet known. The current streak reaches
  // back over trailing held days separately, and Math.max folds it in.
  let longest = 0;
  let run = 0;
  for (const day of timeline) {
    run = verdict(day) === "clean" ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  const last = timeline[timeline.length - 1];
  const todayInProgress = Boolean(last && verdict(last) === "held");

  // Current streak: skip any trailing held (unsettled) days, then count clean
  // days backwards. Stop at the first broken day *or* held day — the streak is
  // only ever claimed up to the last fully-settled boundary.
  let end = timeline.length - 1;
  while (end >= 0 && verdict(timeline[end]) === "held") end -= 1;
  let current = 0;
  for (let i = end; i >= 0; i -= 1) {
    if (verdict(timeline[i]) !== "clean") break;
    current += 1;
  }

  return { current, longest: Math.max(longest, current), todayInProgress };
}

type StreakRow = { date: string; accountable: number; completed: number; missed: number; pending: number };

/**
 * Read one StreakDay per calendar day from the materialized care tasks joined to
 * their completions, over the window ending `today`. Accountability is taken
 * from the task rows that exist for each day — not from the animals' current
 * flags — so history is preserved (see the module comment). Missed-vs-pending is
 * decided by each task's settlement deadline, reusing lib/care-window's SQL so
 * the streak, the overdue list, and the client can never disagree about when a
 * task is actually late.
 */
export async function streakDays(
  db: D1Database,
  today: string,
  windowDays: number,
): Promise<StreakDay[]> {
  const since = isoDaysAgo(today, windowDays);
  // A task is accountable unless it was skipped without being completed.
  // "completed" is a non-voided husbandry event. A not-skipped, not-completed
  // task is "missed" once it is explicitly marked missed or has passed its
  // grace deadline, and otherwise "pending" (still inside its grace window).
  const rows = await db.prepare(
    `SELECT t.due_date AS date,
            SUM(CASE WHEN t.skipped_at IS NULL OR e.id IS NOT NULL THEN 1 ELSE 0 END) AS accountable,
            SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN e.id IS NULL AND t.skipped_at IS NULL
                      AND (t.missed_at IS NOT NULL OR ${TASK_IS_OVERDUE_SQL})
                     THEN 1 ELSE 0 END) AS missed,
            SUM(CASE WHEN e.id IS NULL AND t.skipped_at IS NULL
                      AND t.missed_at IS NULL AND NOT (${TASK_IS_OVERDUE_SQL})
                     THEN 1 ELSE 0 END) AS pending
       FROM care_tasks t
       JOIN animals a ON a.id = t.animal_id
       ${CARE_SCHEDULE_JOIN_SQL}
       LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL
      WHERE t.due_date >= ? AND t.due_date <= ?
      GROUP BY t.due_date
      ORDER BY t.due_date`,
  ).bind(today, today, since, today).all<StreakRow>();

  return rows.results
    .map((row) => ({
      date: row.date,
      accountable: Number(row.accountable),
      completed: Number(row.completed),
      missed: Number(row.missed),
      pending: Number(row.pending),
    }))
    .filter((day) => day.accountable > 0);
}

/** Read the window and reduce it to the streak the endpoint returns. */
export async function careStreakFromDatabase(
  db: D1Database,
  options: { today: string; windowDays: number },
): Promise<CareStreak> {
  const days = await streakDays(db, options.today, options.windowDays);
  return careStreak(days, options.today);
}
