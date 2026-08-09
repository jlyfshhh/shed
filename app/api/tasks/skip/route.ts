import { ensureDatabase } from "@/db/runtime";
import { attributedTo, requireCapability } from "@/lib/household-auth";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Skip a scheduled task: it did not need doing.
 *
 * This is deliberately not "missed". Missed means the care should have happened
 * and did not, and it is a lapse. Skipped means the keeper looked and judged it
 * unnecessary — the enclosure is still damp, or an animal is being left alone
 * to settle in. Recording both as the same thing would either punish good
 * judgement or hide real lapses, so they are separate columns and a future
 * husbandry score can count them differently.
 *
 * A skip is reversible: nothing is destroyed, and un-skipping puts the task
 * back on the list.
 */
export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "care.complete");
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as
      { taskId?: unknown; dueDate?: unknown; reason?: unknown } | null;
    const taskId = typeof body?.taskId === "string" ? body.taskId : "";
    const dueDate = typeof body?.dueDate === "string" ? body.dueDate : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    if (!taskId || !dueDate) {
      return Response.json({ error: "Which task, and for which day?" }, { status: 400, headers: noStore });
    }

    // A completed task is not skippable — that would quietly discard a record of
    // work someone actually did.
    const completed = await db.prepare(
      "SELECT id FROM husbandry_events WHERE task_id = ? AND due_date = ? AND voided_at IS NULL",
    ).bind(taskId, dueDate).first<{ id: string }>();
    if (completed) {
      return Response.json(
        { error: "That task is already recorded as done. Correct the completion instead." },
        { status: 409, headers: noStore },
      );
    }

    const actor = attributedTo(auth.member);
    const result = await db.prepare(
      `UPDATE care_tasks
          SET skipped_at = ?, skipped_by_member_id = ?, skipped_by_name = ?, skip_reason = ?,
              missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL
        WHERE id = ? AND due_date = ?`,
    ).bind(new Date().toISOString(), actor.id, actor.name, reason || null, taskId, dueDate).run();

    if (!result.meta.changes) {
      return Response.json({ error: "That task could not be found." }, { status: 404, headers: noStore });
    }
    return Response.json({ skipped: true, by: actor.name, reason: reason || null }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not skip that task." },
      { status: 400, headers: noStore },
    );
  }
}

/** Un-skip: the keeper changed their mind, or skipped the wrong one. */
export async function DELETE(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "care.complete");
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as { taskId?: unknown; dueDate?: unknown } | null;
    const taskId = typeof body?.taskId === "string" ? body.taskId : "";
    const dueDate = typeof body?.dueDate === "string" ? body.dueDate : "";
    if (!taskId || !dueDate) {
      return Response.json({ error: "Which task, and for which day?" }, { status: 400, headers: noStore });
    }

    const result = await db.prepare(
      `UPDATE care_tasks
          SET skipped_at = NULL, skipped_by_member_id = NULL, skipped_by_name = NULL, skip_reason = NULL
        WHERE id = ? AND due_date = ?`,
    ).bind(taskId, dueDate).run();

    if (!result.meta.changes) {
      return Response.json({ error: "That task could not be found." }, { status: 404, headers: noStore });
    }
    return Response.json({ skipped: false }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not restore that task." },
      { status: 400, headers: noStore },
    );
  }
}
