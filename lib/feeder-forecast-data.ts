import {
  buildFeederForecast,
  type AvailableFeeder,
  type FeedingProfile,
  type ForecastAnimal,
  type ForecastWeight,
} from "./feeding-forecast.ts";
import { scheduleAnimalIds } from "./care-group.ts";
import { skipCareTask, type BrumationPause } from "./brumation.ts";

type ProfileRow = Omit<FeedingProfile, "schedule" | "buyAsNeeded" | "animalId"> & {
  id: string;
  animalId: string;
  animalIdsJson: string | null;
  taskType: string;
  title: string;
  details: string;
  frequency: FeedingProfile["schedule"]["frequency"];
  intervalDays: number | null;
  weekdaysJson: string | null;
  dayOfMonth: number | null;
  weekInterval: number | null;
  startDate: string;
  endDate: string | null;
  buyAsNeeded: number;
};

type AnimalRow = ForecastAnimal & {
  brumating: number;
  careResumeOn: string | null;
};

export async function loadFeederForecast(
  db: D1Database,
  today: string,
  horizonDays: number,
) {
  const clampedHorizon = Math.min(Math.max(Math.trunc(horizonDays), 1), 180);
  const throughDate = addDays(today, clampedHorizon);
  const [animals, weights, availableFeeders, profileRows, dispositionedFeedings] = await Promise.all([
    db.prepare("SELECT id, name, brumating, care_resume_on AS careResumeOn FROM animals WHERE active = 1 ORDER BY name").all<AnimalRow>(),
    db.prepare("SELECT animal_id AS animalId, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events ORDER BY animal_id, recorded_on").all<ForecastWeight>(),
    db.prepare("SELECT id, prey_species AS preySpecies, size_class AS sizeClass, weight_grams AS weightGrams, added_on AS addedOn FROM feeder_inventory WHERE status = 'available' ORDER BY added_on, id").all<AvailableFeeder>(),
    db.prepare("SELECT id, animal_id AS animalId, animal_ids_json AS animalIdsJson, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, week_interval AS weekInterval, start_date AS startDate, end_date AS endDate, prey_species AS preySpecies, COALESCE(prey_description, prey_species) AS preyDescription, prey_size_class AS preySizeClass, buy_as_needed AS buyAsNeeded FROM care_schedules WHERE active = 1 AND task_type = 'feeding' AND prey_species IS NOT NULL").all<ProfileRow>(),
    db.prepare(
      // Per-animal: care_tasks rows are one per covered animal (grouped plans
      // included), so a settled occurrence must be keyed by its own animal, not
      // by schedule+date alone — otherwise finishing one animal in a group would
      // retire the whole group's forecast while its cage-mates are still due.
      `SELECT DISTINCT t.schedule_id AS scheduleId, t.animal_id AS animalId, t.due_date AS dueDate
         FROM care_tasks t
         LEFT JOIN husbandry_events e
           ON e.task_id = t.id
          AND e.due_date = t.due_date
          AND e.voided_at IS NULL
        WHERE t.schedule_id IS NOT NULL
          AND t.due_date >= ?
          AND t.due_date <= ?
          AND (t.skipped_at IS NOT NULL OR e.id IS NOT NULL)`,
    ).bind(today, throughDate).all<{ scheduleId: string; animalId: string; dueDate: string }>(),
  ]);

  // Pause state per animal, exactly as task materialization reads it: a currently
  // brumating animal gets no care at all, and an animal that just resumed is not
  // backfilled before its resume day. Keyed by animal so a grouped plan can cover
  // a brumating animal and a wide-awake one and only the sleeper drops out.
  const pauses = new Map<string, BrumationPause>();
  for (const animal of animals.results) {
    if (animal.brumating || animal.careResumeOn != null) {
      pauses.set(animal.id, { brumating: animal.brumating, careResumeOn: animal.careResumeOn });
    }
  }

  // One profile per covered animal. A grouped plan (`animal_ids_json`) expands
  // into a profile for each of its animals so every animal is forecast, gets its
  // own feeder allocated from stock, and is keyed individually for completion.
  const profiles: FeedingProfile[] = profileRows.results.flatMap((row) =>
    scheduleAnimalIds({ animalId: row.animalId, animalIdsJson: row.animalIdsJson }).map((animalId) => ({
      animalId,
      preySpecies: row.preySpecies,
      preyDescription: row.preyDescription,
      preySizeClass: row.preySizeClass,
      buyAsNeeded: Boolean(row.buyAsNeeded),
      schedule: {
        id: row.id,
        animalId: row.animalId,
        taskType: row.taskType,
        title: row.title,
        details: row.details,
        frequency: row.frequency,
        intervalDays: row.intervalDays,
        weekdaysJson: row.weekdaysJson,
        dayOfMonth: row.dayOfMonth,
        // `week_interval` is what makes an every-other-week plan skip its off
        // weeks; omitting it made the forecast invent meals the tasks never
        // materialize.
        weekInterval: row.weekInterval,
        startDate: row.startDate,
        endDate: row.endDate,
      },
    })),
  );

  // A settled (skipped/completed/refused) occurrence was intentionally dealt with
  // and must not be forecast as another feeder need. Brumation/resume days are
  // suppressed the same way, so the projection cannot forecast a meal on a day a
  // real task would never be created. Both are keyed `scheduleId:animalId:date`.
  const excludedFeedings = new Set<string>(
    dispositionedFeedings.results.map((row) => `${row.scheduleId}:${row.animalId}:${row.dueDate}`),
  );
  for (const profile of profiles) {
    const pause = pauses.get(profile.animalId);
    if (!pause) continue;
    for (let offset = 0; offset <= clampedHorizon; offset += 1) {
      const date = addDays(today, offset);
      if (skipCareTask(pause, date)) {
        excludedFeedings.add(`${profile.schedule.id}:${profile.animalId}:${date}`);
      }
    }
  }

  const forecast = buildFeederForecast({
    today,
    horizonDays,
    animals: animals.results,
    weights: weights.results,
    availableFeeders: availableFeeders.results,
    profiles,
    excludedFeedings,
  });

  return { ...forecast, reorderAcknowledged: await reorderAcknowledged(db) };
}

/**
 * True while the keeper has said an order is placed and it hasn't shown up yet.
 * Clears itself when stock arrives (a feeder added after the order was marked)
 * or after 30 days, so a forgotten or cancelled order starts nagging again.
 */
async function reorderAcknowledged(db: D1Database) {
  const setting = await db
    .prepare("SELECT value FROM app_settings WHERE key = 'feeder_order_placed_at'")
    .first<{ value: string }>();
  const placedAt = setting?.value;
  if (!placedAt) return false;

  const placed = Date.parse(placedAt);
  if (!Number.isFinite(placed)) return false;
  if (Date.now() - placed > 30 * 24 * 60 * 60 * 1000) return false;

  const arrival = await db
    .prepare("SELECT COUNT(*) AS n FROM feeder_inventory WHERE added_on > ?")
    .bind(placedAt.slice(0, 10))
    .first<{ n: number }>();
  return (arrival?.n ?? 0) === 0;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
