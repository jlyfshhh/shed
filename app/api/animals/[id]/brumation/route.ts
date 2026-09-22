// Brumation pause — a whole-animal toggle from the profile. A reptile that is
// brumating should not nag the keeper with feeding, misting or cleaning tasks
// for weeks, and should resume cleanly without a wall of "overdue" for the days
// it was deliberately left alone. The suppression itself lives in the task
// queries and the materializer (both keyed on animals.brumating); this route
// only flips the flag and, on resume, clears the pending backlog so the lookback
// window cannot re-create it.
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "records.manage");
    if (auth.response) return auth.response;

    const { id } = await context.params;
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.brumating !== "boolean") {
      return Response.json({ error: "Send { brumating: true | false }" }, { status: 400, headers: noStore });
    }

    const animal = await db.prepare("SELECT id, name FROM animals WHERE id = ? AND active = 1").bind(id).first<{ id: string; name: string }>();
    if (!animal) return Response.json({ error: "Animal not found" }, { status: 404, headers: noStore });

    const today = dateInTimeZone();
    const now = new Date().toISOString();

    if (payload.brumating) {
      // Pause: the task queries hide everything from here; nothing to delete,
      // and keeping the rows means a same-day un-pause has them back intact.
      await db.prepare(
        "UPDATE animals SET brumating = 1, brumation_since = ?, care_resume_on = NULL, updated_at = ? WHERE id = ?",
      ).bind(today, now, id).run();
    } else {
      // Resume from today. care_resume_on stops the 14-day backfill from
      // regenerating the pause, and the delete clears any pending rows that
      // already exist for the paused days — completed, skipped and missed rows
      // are history and stay untouched.
      await db.batch([
        db.prepare(
          "UPDATE animals SET brumating = 0, brumation_since = NULL, care_resume_on = ?, updated_at = ? WHERE id = ?",
        ).bind(today, now, id),
        db.prepare(
          "DELETE FROM care_tasks WHERE animal_id = ? AND due_date < ? AND skipped_at IS NULL AND missed_at IS NULL AND NOT EXISTS (SELECT 1 FROM husbandry_events e WHERE e.task_id = care_tasks.id AND e.voided_at IS NULL)",
        ).bind(id, today),
      ]);
    }

    return Response.json({ brumating: payload.brumating, brumationSince: payload.brumating ? today : null }, { status: 200, headers: noStore });
  } catch (error) {
    return internalErrorResponse(error, { context: "Brumation toggle failed", message: "Unable to update brumation", headers: noStore });
  }
}
