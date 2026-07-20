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
      "SELECT a.id, a.name, a.species, a.group_name AS 'group', a.location, a.weight_grams AS weightGrams, a.weight_date AS weightDate, a.scientific_name AS scientificName, a.morph, a.sex, a.birth_date AS birthDate, a.acquired_date AS acquiredDate, a.source, a.notes, a.active, a.enclosure_id AS enclosureId, e.name AS enclosureName FROM animals a LEFT JOIN enclosures e ON e.id = a.enclosure_id WHERE a.id = ?",
    ).bind(id).first();
    if (!animal) {
      return Response.json({ error: "Animal not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const [weights, events, tasks, notes, equipment, schedules, enclosure] = await Promise.all([
      db.prepare(
        "SELECT id, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events WHERE animal_id = ? ORDER BY recorded_on DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT id, task_id AS taskId, task_type AS taskType, title, notes, due_date AS dueDate, occurred_at AS occurredAt, actor_role AS actorRole, completed_by_member_id AS completedByMemberId, COALESCE(completed_by_name, actor_role) AS completedBy, voided_at AS voidedAt, voided_by_member_id AS voidedByMemberId, voided_by_name AS voidedBy, void_reason AS voidReason FROM husbandry_events WHERE animal_id = ? ORDER BY COALESCE(voided_at, occurred_at) DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT t.id, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.id AS completionEventId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy FROM care_tasks t LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL WHERE t.animal_id = ? ORDER BY t.due_date DESC, t.title",
      ).bind(id).all(),
      db.prepare("SELECT id, category, title, body, pinned, created_at AS createdAt, updated_at AS updatedAt, created_by_name AS createdBy FROM animal_notes WHERE animal_id = ? ORDER BY pinned DESC, updated_at DESC").bind(id).all(),
      db.prepare("SELECT id, category, name, brand, model, installed_on AS installedOn, replace_on AS replaceOn, active, notes FROM equipment WHERE animal_id = ? ORDER BY active DESC, name").bind(id).all(),
      db.prepare("SELECT id, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, start_date AS startDate, end_date AS endDate, active FROM care_schedules WHERE animal_id = ? ORDER BY active DESC, title").bind(id).all(),
      db.prepare("SELECT e.* FROM enclosures e JOIN animals a ON a.enclosure_id = e.id WHERE a.id = ?").bind(id).first(),
    ]);

    const history = events.results as Array<{ taskType: string; notes?: string | null; voidedAt?: string | null }>;
    const activeEvents = history.filter((event) => !event.voidedAt);
    return Response.json({
      viewer: member ? { id: member.id, displayName: member.displayName, role: member.role } : null,
      animal,
      weightHistory: weights.results,
      notes: notes.results,
      legacyEventNotes: activeEvents.filter((event) => Boolean(event.notes?.trim())),
      equipment: equipment.results,
      enclosure,
      schedules: schedules.results,
      enclosureHistory: activeEvents.filter((event) => event.taskType === "enclosure"),
      feedingHistory: activeEvents.filter((event) => event.taskType === "feeding"),
      history,
      tasks: tasks.results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the animal profile" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
