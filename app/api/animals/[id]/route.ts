import { scheduleAnimalIds } from "@/lib/care-group";
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { isoDaysAgo } from "@/lib/care-schedule";
import { getCareStartDate } from "@/lib/care-settings";
import { requireCapability } from "@/lib/household-auth";
import { equipmentAgeDays } from "@/lib/equipment-age";
import { lightingPlanStatus } from "@/lib/lighting-plan";

export const dynamic = "force-dynamic";

// Husbandry score — added by Claude 2026-07-25. A derived (never stored) rolling
// completion rate: of the animal's scheduled care that is fully accountable
// (everything due before today, plus anything already done today), how much got
// done. Today's not-yet-done tasks don't count against it. Respects the
// "start fresh" baseline. This is the intended basis for future achievements.
const SCORE_WINDOW_DAYS = 30;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "care.read");
    if (auth.response) return auth.response;
    const member = auth.member;

    const { id } = await context.params;
    const animal = await db.prepare(
      "SELECT a.id, a.name, a.species, a.group_name AS 'group', a.location, a.weight_grams AS weightGrams, a.weight_date AS weightDate, a.scientific_name AS scientificName, a.morph, a.sex, a.birth_date AS birthDate, a.acquired_date AS acquiredDate, a.source, a.notes, a.active, a.enclosure_id AS enclosureId, e.name AS enclosureName, p.updated_at AS photoUpdatedAt FROM animals a LEFT JOIN enclosures e ON e.id = a.enclosure_id LEFT JOIN animal_photos p ON p.animal_id = a.id WHERE a.id = ?",
    ).bind(id).first();
    if (!animal) {
      return Response.json({ error: "Animal not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const [weights, sheds, events, tasks, notes, equipment, schedules, enclosure, lightingPlans, lightingFixtures, lightingMeasurements] = await Promise.all([
      db.prepare(
        "SELECT id, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events WHERE animal_id = ? ORDER BY recorded_on DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT id, recorded_on AS recordedOn, quality, notes, recorded_by_name AS recordedBy FROM shed_events WHERE animal_id = ? ORDER BY recorded_on DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT e.id, e.outcome AS outcome, e.task_id AS taskId, e.task_type AS taskType, e.title, e.notes, e.due_date AS dueDate, e.occurred_at AS occurredAt, e.actor_role AS actorRole, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.voided_at AS voidedAt, e.voided_by_member_id AS voidedByMemberId, e.voided_by_name AS voidedBy, e.void_reason AS voidReason, f.id AS feederId, f.prey_species AS feederSpecies, f.size_class AS feederSizeClass, f.weight_grams AS feederWeightGrams FROM husbandry_events e LEFT JOIN feeding_assignments fa ON fa.husbandry_event_id = e.id AND fa.status = 'consumed' LEFT JOIN feeder_inventory f ON f.id = fa.feeder_id WHERE e.animal_id = ? ORDER BY COALESCE(e.voided_at, e.occurred_at) DESC",
      ).bind(id).all(),
      db.prepare(
        "SELECT t.id, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.id AS completionEventId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy FROM care_tasks t LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL WHERE t.animal_id = ? ORDER BY t.due_date DESC, t.title",
      ).bind(id).all(),
      db.prepare("SELECT id, category, title, body, pinned, created_at AS createdAt, updated_at AS updatedAt, created_by_name AS createdBy FROM animal_notes WHERE animal_id = ? ORDER BY pinned DESC, updated_at DESC").bind(id).all(),
      db.prepare("SELECT q.id, q.category, q.name, q.brand, q.model, q.installed_on AS installedOn, q.active, q.notes, CASE WHEN q.animal_id = ? THEN 'animal' ELSE 'enclosure' END AS scope FROM equipment q WHERE q.animal_id = ? OR q.enclosure_id = (SELECT enclosure_id FROM animals WHERE id = ?) ORDER BY q.active DESC, q.name").bind(id, id, id).all(),
      // A grouped plan names one animal in animal_id and the rest in its list, so
      // matching only the first left an animal added by "Also covers" with no
      // sign on its own profile of the routine it is actually on. Candidates are
      // narrowed here and matched with the same helper the rest of the app uses.
      db.prepare("SELECT id, animal_id AS animalId, animal_ids_json AS animalIdsJson, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, start_date AS startDate, end_date AS endDate, active FROM care_schedules WHERE animal_id = ? OR animal_ids_json IS NOT NULL ORDER BY active DESC, title").bind(id).all(),
      db.prepare("SELECT e.* FROM enclosures e JOIN animals a ON a.enclosure_id = e.id WHERE a.id = ?").bind(id).first(),
      db.prepare("SELECT p.id, p.enclosure_id AS enclosureId, p.name, p.species, p.source_name AS sourceName, p.source_url AS sourceUrl, p.source_version AS sourceVersion, p.planned_on AS plannedOn, p.reviewed_on AS reviewedOn, p.mounting_mode AS mountingMode, p.mesh_loss_percent AS meshLossPercent, p.basking_height AS baskingHeight, p.height_unit AS heightUnit, p.target_uvi_min AS targetUviMin, p.target_uvi_max AS targetUviMax, p.target_lux_min AS targetLuxMin, p.target_lux_max AS targetLuxMax, p.target_power_density_min AS targetPowerDensityMin, p.target_power_density_max AS targetPowerDensityMax, p.plan_sheet_name AS planSheetName, p.import_status AS importStatus, p.imported_at AS importedAt, p.notes, p.updated_at AS updatedAt FROM lighting_plans p WHERE p.active = 1 AND p.enclosure_id = (SELECT enclosure_id FROM animals WHERE id = ?) ORDER BY p.planned_on DESC").bind(id).all(),
      db.prepare("SELECT f.id, f.plan_id AS planId, f.equipment_id AS equipmentId, f.role, f.position_cm AS positionCm, f.mounting_height_cm AS mountingHeightCm, f.quantity, f.notes, q.name AS equipmentName, q.brand, q.model, q.installed_on AS installedOn, q.active FROM lighting_plan_fixtures f JOIN lighting_plans p ON p.id = f.plan_id JOIN equipment q ON q.id = f.equipment_id WHERE p.active = 1 AND p.enclosure_id = (SELECT enclosure_id FROM animals WHERE id = ?) ORDER BY f.role, q.name").bind(id).all(),
      db.prepare("SELECT m.id, m.plan_id AS planId, m.metric, m.value, m.unit, m.measured_at AS measuredAt, m.position, m.height, m.height_unit AS heightUnit, m.instrument, m.notes, m.measured_by_name AS measuredBy FROM lighting_measurements m JOIN lighting_plans p ON p.id = m.plan_id WHERE p.active = 1 AND p.enclosure_id = (SELECT enclosure_id FROM animals WHERE id = ?) ORDER BY m.measured_at DESC").bind(id).all(),
    ]);

    const today = dateInTimeZone();
    const equipmentWithAge = (equipment.results as Array<Record<string, unknown> & { installedOn?: string | null }>).map((item) => ({
      ...item,
      inUseDays: equipmentAgeDays(item.installedOn, today),
    }));
    const history = events.results as Array<{ taskType: string; notes?: string | null; voidedAt?: string | null }>;
    const activeEvents = history.filter((event) => !event.voidedAt);
    const fixtureRows = lightingFixtures.results as Array<Record<string, unknown> & { planId: string }>;
    const measurementRows = lightingMeasurements.results as Array<Record<string, unknown> & { planId: string; metric: string; value: number; measuredAt: string }>;
    const lighting = (lightingPlans.results as Array<Record<string, unknown> & { id: string; targetUviMin?: number | null; targetUviMax?: number | null; updatedAt: string }>).map((plan) => {
      const planMeasurements = measurementRows.filter((measurement) => measurement.planId === plan.id);
      const latestUvi = planMeasurements.find((measurement) => measurement.metric.toLocaleLowerCase() === "uvi") ?? null;
      return {
        ...plan,
        status: lightingPlanStatus({ targetUviMin: plan.targetUviMin, targetUviMax: plan.targetUviMax, planUpdatedAt: plan.updatedAt, latestUvi }),
        fixtures: fixtureRows.filter((fixture) => fixture.planId === plan.id),
        measurements: planMeasurements,
        latestUvi,
      };
    });

    // Husbandry score over the rolling window (clamped to the fresh-start baseline).
    const careStartDate = await getCareStartDate(db);
    const windowStart = isoDaysAgo(today, SCORE_WINDOW_DAYS - 1);
    const scoreSince = careStartDate && careStartDate > windowStart ? careStartDate : windowStart;
    // A skipped task is not accountable. The keeper looked at it and judged it
    // did not need doing — leaving a new arrival alone to settle, or not misting
    // an enclosure that is already damp. Counting those as unmet would penalise
    // exactly the judgement good husbandry depends on, so they leave the
    // denominator rather than counting as done.
    //
    // A refused meal needs no special case here: the keeper thawed, offered, and
    // lost the feeder, so the care did happen and its completion counts. That
    // the animal did not eat is recorded as the event's outcome and belongs in
    // the feeding history, not in a score about whether the household keeps up.
    const scoreRow = await db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN date(t.due_date, '+' || COALESCE(s.grace_days, 0) || ' days') < ? AND (t.skipped_at IS NULL OR e.id IS NOT NULL) THEN 1 ELSE 0 END), 0) AS pastDue,
         COALESCE(SUM(CASE WHEN date(t.due_date, '+' || COALESCE(s.grace_days, 0) || ' days') < ? AND e.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS pastDone,
         COALESCE(SUM(CASE WHEN t.due_date = ? AND e.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS todayDone,
         COALESCE(SUM(CASE WHEN t.skipped_at IS NOT NULL AND e.id IS NULL THEN 1 ELSE 0 END), 0) AS skipped
       FROM care_tasks t
       LEFT JOIN care_schedules s ON s.id = t.schedule_id
       LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL
       WHERE t.animal_id = ? AND t.due_date >= ? AND t.due_date <= ?`,
    ).bind(today, today, today, id, scoreSince, today).first<{ pastDue: number; pastDone: number; todayDone: number; skipped: number }>();
    const accountable = Number(scoreRow?.pastDue ?? 0) + Number(scoreRow?.todayDone ?? 0);
    const done = Number(scoreRow?.pastDone ?? 0) + Number(scoreRow?.todayDone ?? 0);
    const husbandryScore = {
      percent: accountable > 0 ? Math.round((done / accountable) * 100) : null,
      done,
      accountable,
      // Surfaced so the number is explicable: "12 of 12 · 5 skipped" reads as
      // deliberate, where a silently smaller denominator looks like a bug.
      skipped: Number(scoreRow?.skipped ?? 0),
      since: scoreSince,
      windowDays: SCORE_WINDOW_DAYS,
    };

    return Response.json({
      viewer: member ? { id: member.id, displayName: member.displayName, role: member.role } : null,
      animal,
      husbandryScore,
      weightHistory: weights.results,
      shedHistory: sheds.results,
      notes: notes.results,
      legacyEventNotes: activeEvents.filter((event) => Boolean(event.notes?.trim())),
      equipment: equipmentWithAge,
      lighting,
      enclosure,
      // Keep only the plans this animal is actually on; the query above pulls
      // every grouped plan as a candidate.
      schedules: schedules.results.filter((row) =>
        scheduleAnimalIds({
          animalId: String((row as Record<string, unknown>).animalId ?? ""),
          animalIdsJson: ((row as Record<string, unknown>).animalIdsJson ?? null) as string | null,
        }).includes(id),
      ),
      enclosureHistory: activeEvents.filter((event) => event.taskType === "enclosure"),
      feedingHistory: activeEvents.filter((event) => event.taskType === "feeding"),
      history,
      tasks: tasks.results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return internalErrorResponse(error, { context: "Animal profile query failed", message: "Unable to load the animal profile" });
  }
}
