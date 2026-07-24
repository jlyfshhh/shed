// "Start fresh from today" — added by Claude 2026-07-24 while Codex was out.
// Sets the care baseline to today and discards the un-acted-on backlog (tasks
// from earlier days with no completion) so it counts as neither done nor missed.
// Completed history is untouched. This baseline is the anchor for the planned
// husbandry-score / achievements work.
import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { setCareStartDate } from "@/lib/care-settings";
import { requireHouseholdMember } from "@/lib/household-auth";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;

    const today = dateInTimeZone();
    // Remove leftover tasks from before today that were never completed, so they
    // don't linger as overdue or drag down a future score. Completed tasks keep
    // their husbandry event and are left alone.
    const cleared = await db.prepare(
      "DELETE FROM care_tasks WHERE due_date < ? AND NOT EXISTS (SELECT 1 FROM husbandry_events e WHERE e.task_id = care_tasks.id AND e.due_date = care_tasks.due_date AND e.voided_at IS NULL)",
    ).bind(today).run();
    await setCareStartDate(db, today);

    return Response.json({ saved: true, startDate: today, cleared: cleared.meta?.changes ?? 0 }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to start fresh" }, { status: 500, headers: noStore });
  }
}
