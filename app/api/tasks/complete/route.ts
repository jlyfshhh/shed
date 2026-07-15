import { ensureDatabase } from "@/db/runtime";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { taskId?: string; dueDate?: string; actorRole?: string };
    if (!payload.taskId || !payload.dueDate) return Response.json({ error: "Task and due date are required" }, { status: 400 });
    const db = await ensureDatabase();
    const task = await db.prepare("SELECT id, animal_id AS animalId, title FROM care_tasks WHERE id=? AND due_date=?").bind(payload.taskId, payload.dueDate).first<{ id: string; animalId: string; title: string }>();
    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    const id = crypto.randomUUID();
    await db.prepare("INSERT OR IGNORE INTO husbandry_events (id, task_id, animal_id, title, due_date, occurred_at, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, task.id, task.animalId, task.title, payload.dueDate, new Date().toISOString(), payload.actorRole === "Owner" ? "Owner" : "Zookeeper").run();
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record task" }, { status: 500 });
  }
}
