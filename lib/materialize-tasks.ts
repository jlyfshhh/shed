import { careLookbackDates } from "./care-schedule.ts";
import { getCareStartDate } from "./care-settings.ts";
import { scheduleIsDue, type CareScheduleRow } from "./schedules.ts";
import { careTaskId, scheduleAnimalIds } from "./care-group.ts";
import { skipCareTask } from "./brumation.ts";

/**
 * Create the care_tasks rows that should exist across the lookback window ending
 * `today` — one row per covered animal per due date, `INSERT OR IGNORE` so the
 * pass is idempotent and never disturbs an existing row or its disposition.
 *
 * Accountability is decided per animal, on each date:
 *   • An archived (inactive) animal accrues no new care at all, so none of its
 *     tasks are materialized. Archiving therefore stops care going forward
 *     without deleting or rewriting any already-settled history — the streak
 *     reader still sees the pre-archive rows it always did (F08).
 *   • A brumating animal, and the paused days before a resumed animal's resume
 *     floor, are skipped per lib/brumation.
 * Both checks are per animal (not per plan) so a grouped plan covering a mix of
 * active/archived or awake/brumating animals materializes only the right ones.
 */
export async function materializeTasks(db: D1Database, today: string) {
  const schedules = await db.prepare(
    "SELECT id, animal_id AS animalId, animal_ids_json AS animalIdsJson, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, week_interval AS weekInterval, start_date AS startDate, end_date AS endDate FROM care_schedules WHERE active = 1",
  ).all<CareScheduleRow & { animalIdsJson: string | null }>();
  // Materialize tasks for a lookback window (not just yesterday+today) so that
  // care missed a few days ago still shows up as an actionable overdue task —
  // but never before the "start fresh" baseline, if one has been set.
  const careStartDate = await getCareStartDate(db);
  const dates = careLookbackDates(today, careStartDate);
  // Archived animals get no tasks on any date. Keyed individually so a grouped
  // plan covering an archived animal and a kept one only drops the archived one.
  const inactiveRows = await db.prepare("SELECT id FROM animals WHERE active = 0").all<{ id: string }>();
  const inactive = new Set(inactiveRows.results.map((row) => row.id));
  // A brumating animal's care is paused, and an animal that just came out of a
  // long brumation must not have the whole pause backfilled as overdue. Both
  // are per-animal, not per-schedule: a grouped plan can cover a brumating
  // dragon and a wide-awake one, so the skip has to happen at the animal, not
  // drop the whole plan.
  const pauseRows = await db.prepare(
    "SELECT id, brumating, care_resume_on AS careResumeOn FROM animals WHERE brumating = 1 OR care_resume_on IS NOT NULL",
  ).all<{ id: string; brumating: number; careResumeOn: string | null }>();
  const paused = new Map(pauseRows.results.map((row) => [row.id, row]));
  // One task per animal on the plan. They collapse into a single line on Today,
  // but stay separate rows so that history, weights and feeder consumption
  // remain per-animal.
  const taskStatements = schedules.results.flatMap((schedule) =>
    dates.filter((date) => scheduleIsDue(schedule, date)).flatMap((date) =>
      scheduleAnimalIds(schedule)
        .filter((animalId) => !inactive.has(animalId) && !skipCareTask(paused.get(animalId), date))
        .map((animalId) =>
          db.prepare("INSERT OR IGNORE INTO care_tasks (id, schedule_id, animal_id, task_type, title, details, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(careTaskId(schedule.id, animalId, schedule.animalId, date), schedule.id, animalId, schedule.taskType, schedule.title, schedule.details, date),
        ),
    ),
  );
  if (taskStatements.length) await db.batch(taskStatements);
}
