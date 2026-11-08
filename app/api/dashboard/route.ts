import { ensureDatabase } from "@/db/runtime";
import { CARE_SCHEDULE_JOIN_SQL, TASK_IS_CURRENT_SQL, TASK_IS_OVERDUE_SQL } from "@/lib/care-window";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { overdueStartDate } from "@/lib/care-schedule";
import { getCareStartDate } from "@/lib/care-settings";
import { requireCapability } from "@/lib/household-auth";
import { memberBalance } from "@/lib/rewards";
import { loadFeederForecast } from "@/lib/feeder-forecast-data";
import { feederGuidance } from "@/lib/feeder-guidance";
import { scheduleAnimalIds } from "@/lib/care-group";

export const dynamic = "force-dynamic";

type DashboardTask = {
  id: string;
  skippedAt?: string | null;
  skipReason?: string | null;
  outcome?: string | null;
  scheduleId: string | null;
  animalId: string;
  animalName: string;
  species: string;
  taskType: string;
  title: string;
  details: string;
  dueDate: string;
  /** Days after `dueDate` this stays to-do rather than overdue. 0 for most care. */
  graceDays: number;
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
    const auth = await requireCapability(request, db, "care.read");
    if (auth.response) return auth.response;
    const member = auth.member;
    const animalsResult = await db.prepare("SELECT a.id, a.name, a.species, a.group_name AS 'group', a.location, a.morph, a.sex, a.birth_date AS birthDate, a.weight_grams AS weightGrams, a.weight_date AS weightDate, a.enclosure_id AS enclosureId, a.brumating AS brumating, e.name AS enclosureName, p.updated_at AS photoUpdatedAt FROM animals a LEFT JOIN enclosures e ON e.id = a.enclosure_id LEFT JOIN animal_photos p ON p.animal_id = a.id WHERE a.active = 1 ORDER BY a.sort_order IS NULL, a.sort_order, CASE a.group_name WHEN 'Reptile' THEN 1 WHEN 'Amphibian' THEN 2 WHEN 'Community' THEN 3 ELSE 4 END, a.name").all();
    // Today's list.
    const tasksResult = await db.prepare("SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, t.skipped_at AS skippedAt, t.skip_reason AS skipReason, t.missed_at AS missedAt, t.missed_by_name AS missedBy, e.outcome AS outcome, COALESCE(s.grace_days, 0) AS graceDays, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.id AS completionEventId, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy FROM care_tasks t JOIN animals a ON a.id=t.animal_id " + CARE_SCHEDULE_JOIN_SQL + " LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND a.brumating = 0 AND " + TASK_IS_CURRENT_SQL + " ORDER BY complete, t.due_date, a.name, t.title").bind(today, today).all<DashboardTask>();
    // Leftovers from earlier days that were never completed and not marked missed.
    const overdueResult = await db.prepare("SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, COALESCE(s.grace_days, 0) AS graceDays, 0 AS complete, NULL AS completionEventId, NULL AS completedByMemberId, NULL AS completedBy FROM care_tasks t JOIN animals a ON a.id=t.animal_id " + CARE_SCHEDULE_JOIN_SQL + " LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND a.brumating = 0 AND " + TASK_IS_OVERDUE_SQL + " AND t.due_date >= ? AND e.id IS NULL AND t.missed_at IS NULL AND t.skipped_at IS NULL ORDER BY t.due_date DESC, a.name, t.title").bind(today, overdueSince).all<DashboardTask>();
    // The animal's whole active routine, so the enclosure-QR quick-log can offer
    // care that is not due today — logged early (before a trip) or out of cycle.
    // Expanded per covered active animal here (grouped plans cover several), the
    // same rule the materializer and week projection use.
    const careScheduleRows = await db.prepare(
      "SELECT id, animal_id AS animalId, animal_ids_json AS animalIdsJson, task_type AS taskType, title FROM care_schedules WHERE active = 1",
    ).all<{ id: string; animalId: string; animalIdsJson: string | null; taskType: string; title: string }>();
    const activeAnimalIds = new Set((animalsResult.results as Array<{ id: string }>).map((row) => row.id));
    const careMenu = careScheduleRows.results.flatMap((schedule) =>
      scheduleAnimalIds(schedule)
        .filter((animalId) => activeAnimalIds.has(animalId))
        .map((animalId) => ({ id: schedule.id, animalId, taskType: schedule.taskType, title: schedule.title })),
    );
    // Missed tasks: acknowledged as not done, so they leave the active pending
    // and overdue lists — but they must not vanish. Kept findable and reversible
    // here (back to the baseline), since a task marked missed past its grace
    // window otherwise disappears with no way to undo it.
    const missedResult = await db.prepare("SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, t.missed_by_name AS missedBy, COALESCE(s.grace_days, 0) AS graceDays, 0 AS complete, NULL AS completionEventId, NULL AS completedByMemberId, NULL AS completedBy FROM care_tasks t JOIN animals a ON a.id=t.animal_id " + CARE_SCHEDULE_JOIN_SQL + " LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND a.brumating = 0 AND t.missed_at IS NOT NULL AND e.id IS NULL AND t.due_date >= ? ORDER BY t.due_date DESC, a.name, t.title").bind(overdueSince).all<DashboardTask>();
    const eventsResult = await db.prepare("SELECT e.id, e.task_id AS taskId, e.due_date AS dueDate, a.name AS animalName, e.task_type AS taskType, e.title, e.notes, e.outcome AS outcome, e.occurred_at AS occurredAt, e.actor_role AS actorRole, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.voided_at AS voidedAt, e.voided_by_member_id AS voidedByMemberId, e.voided_by_name AS voidedBy, e.void_reason AS voidReason FROM husbandry_events e JOIN animals a ON a.id=e.animal_id WHERE e.voided_at IS NULL ORDER BY e.occurred_at DESC LIMIT 20").all();
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
    // Key by animal too: grouped plans now emit one forecast event per covered
    // animal, so a plain scheduleId:date key would collapse cage-mates onto one
    // animal's feeder label.
    const guidanceByTask = new Map(
      (forecast?.events ?? []).map((event) => [`${event.scheduleId}:${event.animalId}:${event.feedingDate}`, feederGuidance(event)]),
    );
    const enrichTask = (task: DashboardTask) => ({
      ...task,
      feedingGuidance: task.scheduleId
        ? guidanceByTask.get(`${task.scheduleId}:${task.animalId}:${task.dueDate}`) ?? null
        : null,
    });

    return Response.json({
      date: today,
      capabilities: auth.capabilities,
      viewer: member ? { id: member.id, displayName: member.displayName, role: member.role, earningEnabled, balanceCents: viewerBalanceCents } : null,
      tasks: todayTasks.map(enrichTask),
      overdue: overdueResult.results.map(enrichTask),
      missed: missedResult.results.map(enrichTask),
      careMenu,
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
    return internalErrorResponse(error, { context: "Dashboard query failed", message: "Unable to load dashboard" });
  }
}
