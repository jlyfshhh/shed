import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { attributedTo, requireCapability } from "@/lib/household-auth";
import {
  skipScheduledTask,
  TaskDispositionError,
  unskipScheduledTask,
} from "@/lib/task-dispositions";

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

    const actor = attributedTo(auth.member);
    return Response.json(
      await skipScheduledTask(db, { taskId, dueDate, reason: reason || null, actor }),
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof TaskDispositionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    return internalErrorResponse(error, { context: "Task skip failed", message: "Could not skip that task.", headers: noStore });
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

    return Response.json(await unskipScheduledTask(db, taskId, dueDate), { headers: noStore });
  } catch (error) {
    if (error instanceof TaskDispositionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    return internalErrorResponse(error, { context: "Task unskip failed", message: "Could not restore that task.", headers: noStore });
  }
}
