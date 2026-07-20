import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const { id } = await context.params;
    const animal = await db.prepare(
      "SELECT id, name, species, group_name AS 'group', location, weight_grams AS weightGrams, weight_date AS weightDate FROM animals WHERE id = ?",
    ).bind(id).first();
    if (!animal) {
      return Response.json({ error: "Animal not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const [weights, events, tasks] = await Promise.all([
      db.prepare(
        "SELECT id, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events WHERE animal_id = ? ORDER BY recorded_on DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT id, task_id AS taskId, task_type AS taskType, title, notes, due_date AS dueDate, occurred_at AS occurredAt, actor_role AS actorRole, completed_by_member_id AS completedByMemberId, COALESCE(completed_by_name, actor_role) AS completedBy, voided_at AS voidedAt, voided_by_member_id AS voidedByMemberId, voided_by_name AS voidedBy, void_reason AS voidReason FROM husbandry_events WHERE animal_id = ? ORDER BY COALESCE(voided_at, occurred_at) DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT t.id, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.id AS completionEventId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy FROM care_tasks t LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL WHERE t.animal_id = ? ORDER BY t.due_date DESC, t.title",
      ).bind(id).all(),
    ]);

    const history = events.results as Array<{ taskType: string; notes?: string | null; voidedAt?: string | null }>;
    const activeEvents = history.filter((event) => !event.voidedAt);
    return Response.json({
      viewer: member ? { id: member.id, displayName: member.displayName, role: member.role } : null,
      animal,
      weightHistory: weights.results,
      notes: activeEvents.filter((event) => Boolean(event.notes?.trim())),
      equipment: activeEvents.filter((event) => event.taskType === "equipment"),
      enclosureHistory: activeEvents.filter((event) => event.taskType === "enclosure"),
      feedingHistory: activeEvents.filter((event) => event.taskType === "feeding"),
      history,
      tasks: tasks.results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the animal profile" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
