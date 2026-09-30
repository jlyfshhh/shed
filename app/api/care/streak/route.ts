// The care streak — consecutive days of complete care — for the share card and
// the Today header. Read from the materialized care_tasks (which persist, unlike
// pruned climate raw) joined to completions, one row per day. Only days that had
// accountable care are considered, so a genuinely empty day neither breaks nor
// pads the streak. Bounded so the query stays small.
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { isoDaysAgo } from "@/lib/care-schedule";
import { requireCapability } from "@/lib/household-auth";
import { careStreak, type StreakDay } from "@/lib/care-streak";

const noStore = { "Cache-Control": "no-store" };
const STREAK_WINDOW_DAYS = 400;

export async function GET(request: Request) {
  try {
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const auth = await requireCapability(request, db, "care.read");
    if (auth.response) return auth.response;

    const since = isoDaysAgo(today, STREAK_WINDOW_DAYS);
    // A task is accountable unless it was skipped and not completed. "completed"
    // is a non-voided husbandry event; "missed" is an explicit miss that was
    // neither completed nor skipped. Brumating animals' paused care is excluded,
    // exactly as it is from Today.
    const rows = await db.prepare(
      `SELECT t.due_date AS date,
              SUM(CASE WHEN t.skipped_at IS NULL OR e.id IS NOT NULL THEN 1 ELSE 0 END) AS accountable,
              SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN e.id IS NULL AND t.missed_at IS NOT NULL AND t.skipped_at IS NULL THEN 1 ELSE 0 END) AS missed
         FROM care_tasks t
         JOIN animals a ON a.id = t.animal_id
         LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL
        WHERE a.active = 1 AND a.brumating = 0 AND t.due_date >= ? AND t.due_date <= ?
        GROUP BY t.due_date
        ORDER BY t.due_date`,
    ).bind(since, today).all<{ date: string; accountable: number; completed: number; missed: number }>();

    const days: StreakDay[] = rows.results
      .map((row) => ({ date: row.date, accountable: Number(row.accountable), completed: Number(row.completed), missed: Number(row.missed) }))
      .filter((day) => day.accountable > 0);

    const streak = careStreak(days, today);
    return Response.json({ ...streak, windowDays: STREAK_WINDOW_DAYS }, { headers: noStore });
  } catch (error) {
    return internalErrorResponse(error, { context: "Care streak read failed", message: "Unable to compute the care streak", headers: noStore });
  }
}
