import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { previousIsoDate } from "@/lib/care-schedule";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";
import { memberBalance } from "@/lib/rewards";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const today = dateInTimeZone();
    const yesterday = previousIsoDate(today);
    const db = await ensureDatabase(today);
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401 });
    }
    const animalsResult = await db.prepare("SELECT id, name, species, group_name AS 'group', location, weight_grams AS weightGrams, weight_date AS weightDate, enclosure_id AS enclosureId FROM animals WHERE active = 1 ORDER BY CASE group_name WHEN 'Reptile' THEN 1 WHEN 'Amphibian' THEN 2 WHEN 'Community' THEN 3 ELSE 4 END, name").all();
    const tasksResult = await db.prepare("SELECT t.id, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.id AS completionEventId, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND (t.due_date = ? OR (t.due_date = ? AND e.id IS NULL)) ORDER BY complete, t.due_date, a.name, t.title").bind(today, yesterday).all();
    const eventsResult = await db.prepare("SELECT e.id, e.task_id AS taskId, e.due_date AS dueDate, a.name AS animalName, e.task_type AS taskType, e.title, e.notes, e.occurred_at AS occurredAt, e.actor_role AS actorRole, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.voided_at AS voidedAt, e.voided_by_member_id AS voidedByMemberId, e.voided_by_name AS voidedBy, e.void_reason AS voidReason FROM husbandry_events e JOIN animals a ON a.id=e.animal_id ORDER BY COALESCE(e.voided_at, e.occurred_at) DESC LIMIT 20").all();
    const weightsResult = await db.prepare("SELECT w.animal_id AS animalId, a.name AS animalName, w.recorded_on AS recordedOn, w.weight_grams AS weightGrams FROM weight_events w JOIN animals a ON a.id=w.animal_id ORDER BY w.animal_id, w.recorded_on").all();
    const [enclosureCountRow, scheduleCountRow, eventCountRow, keeperCountRow] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM enclosures WHERE active = 1").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM care_schedules WHERE active = 1").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM husbandry_events WHERE voided_at IS NULL").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM household_members WHERE active = 1 AND role = 'Zookeeper'").first<{ count: number }>(),
    ]);

    const weightMap = new Map<string, Array<{ animalId: string; animalName: string; recordedOn: string; weightGrams: number }>>();
    for (const row of weightsResult.results as Array<{ animalId: string; animalName: string; recordedOn: string; weightGrams: number }>) {
      weightMap.set(row.animalId, [...(weightMap.get(row.animalId) ?? []), row]);
    }
    const weightTrends = [...weightMap.values()].filter((rows) => rows.length > 1).map((rows) => ({
      animalId: rows[0].animalId,
      animalName: rows[0].animalName,
      previous: rows.at(-2)!.weightGrams,
      current: rows.at(-1)!.weightGrams,
      previousDate: rows.at(-2)!.recordedOn,
      currentDate: rows.at(-1)!.recordedOn,
    }));

    const earningEnabled = Boolean(member?.earningEnabled);
    const viewerBalanceCents = member && earningEnabled ? (await memberBalance(db, member.id)).balanceCents : null;

    return Response.json({
      date: today,
      viewer: member ? { id: member.id, displayName: member.displayName, role: member.role, earningEnabled, balanceCents: viewerBalanceCents } : null,
      tasks: tasksResult.results,
      animals: animalsResult.results,
      recentEvents: eventsResult.results,
      weightTrends,
      setupSummary: {
        animalCount: animalsResult.results.length,
        enclosureCount: Number(enclosureCountRow?.count ?? 0),
        scheduleCount: Number(scheduleCountRow?.count ?? 0),
        eventCount: Number(eventCountRow?.count ?? 0),
        keeperCount: Number(keeperCountRow?.count ?? 0),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load dashboard" }, { status: 500 });
  }
}
