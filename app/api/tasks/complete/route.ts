import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { taskId?: string; dueDate?: string; actorRole?: string };
    if (!payload.taskId || !payload.dueDate) return Response.json({ error: "Task and due date are required" }, { status: 400 });
    const db = await ensureDatabase();
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401 });
    }
    const task = await db.prepare("SELECT id, animal_id AS animalId, task_type AS taskType, title, details FROM care_tasks WHERE id=? AND due_date=?").bind(payload.taskId, payload.dueDate).first<{ id: string; animalId: string; taskType: string; title: string; details: string }>();
    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    const id = crypto.randomUUID();
    const actorRole = member?.role ?? (payload.actorRole === "Owner" ? "Owner" : "Zookeeper");
    await db.prepare("INSERT OR IGNORE INTO husbandry_events (id, task_id, animal_id, task_type, title, notes, due_date, occurred_at, actor_role, completed_by_member_id, completed_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, task.id, task.animalId, task.taskType, task.title, task.details, payload.dueDate, new Date().toISOString(), actorRole, member?.id ?? null, member?.displayName ?? null).run();
    const completion = await db.prepare(
      "SELECT e.id, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.occurred_at AS occurredAt FROM husbandry_events e WHERE e.task_id = ? AND e.due_date = ?",
    ).bind(task.id, payload.dueDate).first();
    return Response.json({ saved: true, completion });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record task" }, { status: 500 });
  }
}
