import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { overdueStartDate } from "@/lib/care-schedule";
import { getCareStartDate } from "@/lib/care-settings";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";
import { memberBalance } from "@/lib/rewards";
import { loadFeederForecast } from "@/lib/feeder-forecast-data";
import { feederGuidance } from "@/lib/feeder-guidance";

export const dynamic = "force-dynamic";

type DashboardTask = {
  id: string;
  scheduleId: string | null;
  animalId: string;
  animalName: string;
  species: string;
  taskType: string;
  title: string;
  details: string;
  dueDate: string;
  complete: number;
  completionEventId: string | null;
  completedByMemberId: string | null;
  completedBy: string | null;
};

export async function GET(request: Request) {
  try {
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const careStartDate = await getCareStartDate(db);
    // Overdue never reaches before the "start fresh" baseline.
    const overdueSince = overdueStartDate(today, careStartDate);
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401 });
    }
    const animalsResult = await db.prepare("SELECT a.id, a.name, a.species, a.group_name AS 'group', a.location, a.weight_grams AS weightGrams, a.weight_date AS weightDate, a.enclosure_id AS enclosureId, e.shared_habitat_id AS sharedHabitatId FROM animals a LEFT JOIN enclosures e ON e.id = a.enclosure_id WHERE a.active = 1 ORDER BY CASE a.group_name WHEN 'Reptile' THEN 1 WHEN 'Amphibian' THEN 2 WHEN 'Community' THEN 3 ELSE 4 END, a.name").all();
    // Today's list.
    const tasksResult = await db.prepare("SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.id AS completionEventId, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND t.due_date = ? ORDER BY complete, a.name, t.title").bind(today).all<DashboardTask>();
    // Leftovers from earlier days that were never completed and not marked missed.
    const overdueResult = await db.prepare("SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, 0 AS complete, NULL AS completionEventId, NULL AS completedByMemberId, NULL AS completedBy FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND t.due_date < ? AND t.due_date >= ? AND e.id IS NULL AND t.missed_at IS NULL ORDER BY t.due_date DESC, a.name, t.title").bind(today, overdueSince).all<DashboardTask>();
    const eventsResult = await db.prepare("SELECT e.id, e.task_id AS taskId, e.due_date AS dueDate, a.name AS animalName, e.task_type AS taskType, e.title, e.notes, e.occurred_at AS occurredAt, e.actor_role AS actorRole, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.voided_at AS voidedAt, e.voided_by_member_id AS voidedByMemberId, e.voided_by_name AS voidedBy, e.void_reason AS voidReason FROM husbandry_events e JOIN animals a ON a.id=e.animal_id WHERE e.voided_at IS NULL ORDER BY e.occurred_at DESC LIMIT 20").all();
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
    const todayTasks = tasksResult.results;
    const forecast = todayTasks.some((task) => task.taskType === "feeding" && task.scheduleId)
      ? await loadFeederForecast(db, today, 1)
      : null;
    const guidanceByTask = new Map(
      (forecast?.events ?? []).map((event) => [`${event.scheduleId}:${event.feedingDate}`, feederGuidance(event)]),
    );
    const enrichTask = (task: DashboardTask) => ({
      ...task,
      feedingGuidance: task.scheduleId
        ? guidanceByTask.get(`${task.scheduleId}:${task.dueDate}`) ?? null
        : null,
    });

    return Response.json({
      date: today,
      viewer: member ? { id: member.id, displayName: member.displayName, role: member.role, earningEnabled, balanceCents: viewerBalanceCents } : null,
      tasks: todayTasks.map(enrichTask),
      overdue: overdueResult.results.map(enrichTask),
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
