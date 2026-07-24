// Overdue handling — added by Claude 2026-07-21 while Codex was out.
// Marks a leftover task as "missed" (acknowledged as not done) so it stops
// showing without fabricating a completion event. Reversible: completing the
// task later clears the missed mark.
import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { taskId?: string; dueDate?: string; all?: boolean };
    const db = await ensureDatabase();
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401, headers: noStore });
    }

    // Bulk clear: mark every still-open overdue task as missed in one go.
    if (payload.all) {
      const result = await db.prepare(
        "UPDATE care_tasks SET missed_at = ?, missed_by_member_id = ?, missed_by_name = ? WHERE due_date < ? AND missed_at IS NULL AND NOT EXISTS (SELECT 1 FROM husbandry_events e WHERE e.task_id = care_tasks.id AND e.due_date = care_tasks.due_date AND e.voided_at IS NULL)",
      ).bind(new Date().toISOString(), member?.id ?? null, member?.displayName ?? null, dateInTimeZone()).run();
      return Response.json({ saved: true, missed: result.meta?.changes ?? 0 }, { headers: noStore });
    }

    if (!payload.taskId || !payload.dueDate) {
      return Response.json({ error: "Task and due date are required" }, { status: 400, headers: noStore });
    }

    const task = await db.prepare("SELECT id FROM care_tasks WHERE id = ? AND due_date = ?").bind(payload.taskId, payload.dueDate).first<{ id: string }>();
    if (!task) return Response.json({ error: "Task not found" }, { status: 404, headers: noStore });

    const completed = await db.prepare(
      "SELECT id FROM husbandry_events WHERE task_id = ? AND due_date = ? AND voided_at IS NULL",
    ).bind(payload.taskId, payload.dueDate).first<{ id: string }>();
    if (completed) return Response.json({ error: "That task is already marked done" }, { status: 409, headers: noStore });

    await db.prepare("UPDATE care_tasks SET missed_at = ?, missed_by_member_id = ?, missed_by_name = ? WHERE id = ? AND due_date = ?")
      .bind(new Date().toISOString(), member?.id ?? null, member?.displayName ?? null, payload.taskId, payload.dueDate).run();

    return Response.json({ saved: true }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update the task" }, { status: 500, headers: noStore });
  }
}
