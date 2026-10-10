// The care streak — consecutive days of complete care — for the share card and
// the Today header. It reads the materialized care_tasks (which persist, unlike
// pruned climate raw) joined to their completions, one row per day, over a
// bounded window so the query stays small.
//
// Accountability is date-aware: whether an animal was accountable on a past day
// comes from the task rows that exist for that day, not from the animal's
// current active/brumating flags, so pausing or archiving an animal can never
// retroactively erase an earlier miss. A task inside its grace window is held,
// not counted missed, until its deadline passes. Both rules live in
// lib/care-streak (which reuses lib/care-window for the deadline), so the pure
// logic is unit-tested and this route stays a thin reader.
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";
import { careStreakFromDatabase } from "@/lib/care-streak";

const noStore = { "Cache-Control": "no-store" };
const STREAK_WINDOW_DAYS = 400;

export async function GET(request: Request) {
  try {
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const auth = await requireCapability(request, db, "care.read");
    if (auth.response) return auth.response;

    const streak = await careStreakFromDatabase(db, { today, windowDays: STREAK_WINDOW_DAYS });
    return Response.json({ ...streak, windowDays: STREAK_WINDOW_DAYS }, { headers: noStore });
  } catch (error) {
    return internalErrorResponse(error, { context: "Care streak read failed", message: "Unable to compute the care streak", headers: noStore });
  }
}
