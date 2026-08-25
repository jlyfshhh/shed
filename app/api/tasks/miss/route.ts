// Overdue handling — added by Claude 2026-07-21 while Codex was out.
// Marks a leftover task as "missed" (acknowledged as not done) so it stops
// showing without fabricating a completion event. Reversible: completing the
// task later clears the missed mark.
import { readJsonObject } from "@/lib/json-body";
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { attributedTo, requireCapability } from "@/lib/household-auth";
import {
  missAllOverdueTasks,
  missScheduledTask,
  TaskDispositionError,
} from "@/lib/task-dispositions";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const parsed = await readJsonObject(request);
    if (parsed.response) return parsed.response;
    const payload = parsed.body as unknown as { taskId?: string; dueDate?: string; all?: boolean };
    const db = await ensureDatabase();
    // Both actions alter the expected-care record rather than record work that
    // happened, so they stay with the Head Keeper. The named capabilities keep
    // the single-task action separate from the broader backlog sweep.
    const auth = await requireCapability(request, db, payload.all ? "care.missAll" : "care.miss");
    if (auth.response) return auth.response;
    const actor = attributedTo(auth.member);

    // Bulk clear: mark every still-open overdue task as missed in one go.
    if (payload.all) {
      const missed = await missAllOverdueTasks(db, { beforeDate: dateInTimeZone(), actor });
      return Response.json({ saved: true, missed }, { headers: noStore });
    }

    if (!payload.taskId || !payload.dueDate) {
      return Response.json({ error: "Task and due date are required" }, { status: 400, headers: noStore });
    }

    await missScheduledTask(db, { taskId: payload.taskId, dueDate: payload.dueDate, actor });
    return Response.json({ saved: true }, { headers: noStore });
  } catch (error) {
    if (error instanceof TaskDispositionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    return internalErrorResponse(error, { context: "Task missed-state update failed", message: "Unable to update the task", headers: noStore });
  }
}
