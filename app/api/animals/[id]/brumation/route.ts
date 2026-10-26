// Brumation pause — a whole-animal toggle from the profile. A reptile that is
// brumating should not nag the keeper with feeding, misting or cleaning tasks
// for weeks, and should resume cleanly without a wall of "overdue" for the days
// it was deliberately left alone. Task queries and the materializer suppress new
// work while brumating, but the streak reader scores history from the task rows
// that exist (not the live flag), so this route also clears unsettled tasks from
// the pause boundary forward on PAUSE — otherwise those rows score as
// pending-then-missed during the pause — and clears the paused window on resume.
// Both paths invalidate the per-isolate materialization cache so a same-day
// toggle takes effect immediately rather than after the date rolls over.
import { ensureDatabase, invalidateMaterializedTasks } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";
import { clearPendingTasksFromStatement, clearPendingTasksInWindowStatement } from "@/lib/care-boundaries";

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

    const animal = await db.prepare("SELECT id, name, brumation_since AS brumationSince FROM animals WHERE id = ? AND active = 1").bind(id).first<{ id: string; name: string; brumationSince: string | null }>();
    if (!animal) return Response.json({ error: "Animal not found" }, { status: 404, headers: noStore });

    const today = dateInTimeZone();
    const now = new Date().toISOString();
    // The pause boundary: the first day the animal was paused. On a repeated
    // pause this is the ORIGINAL date (preserved below), not today, so the resume
    // cleanup window and the streak suppression both stay anchored to when
    // brumation actually began.
    const pauseStart = animal.brumationSince ?? today;

    if (payload.brumating) {
      // Pause. COALESCE preserves an existing brumation_since so a later same-
      // brumation re-pause cannot overwrite the original start. Clearing unsettled
      // tasks from the pause boundary forward keeps the streak reader (which
      // scores from task rows, not the live flag) from counting the suppressed
      // days as pending-then-missed. Tasks dated before the boundary are
      // pre-pause history — an implicit overdue miss there survives — and
      // completed/skipped/explicitly-missed rows are settled and untouched.
      await db.batch([
        db.prepare(
          "UPDATE animals SET brumating = 1, brumation_since = COALESCE(brumation_since, ?), care_resume_on = NULL, updated_at = ? WHERE id = ?",
        ).bind(today, now, id),
        clearPendingTasksFromStatement(db, id, pauseStart),
      ]);
    } else {
      // Resume from today. care_resume_on stops the 14-day backfill from
      // regenerating the pause, and the delete clears any pending rows for the
      // paused days only [brumation_since, today) — a task that fell due *before*
      // the pause is pre-boundary history and must survive resume (the earlier
      // code deleted every uncompleted past task and wrongly healed those misses,
      // F08). Settled rows stay untouched; an absent brumation_since means an
      // empty window and nothing is deleted.
      await db.batch([
        db.prepare(
          "UPDATE animals SET brumating = 0, brumation_since = NULL, care_resume_on = ?, updated_at = ? WHERE id = ?",
        ).bind(today, now, id),
        clearPendingTasksInWindowStatement(db, id, pauseStart, today),
      ]);
    }

    // The flag and the task rows just changed, so this isolate's materialization
    // for `today` is stale. Invalidate it, or a same-day resume would leave
    // today's care missing until the date rolled over or the process restarted.
    invalidateMaterializedTasks();

    return Response.json({ brumating: payload.brumating, brumationSince: payload.brumating ? pauseStart : null }, { status: 200, headers: noStore });
  } catch (error) {
    return internalErrorResponse(error, { context: "Brumation toggle failed", message: "Unable to update brumation", headers: noStore });
  }
}
