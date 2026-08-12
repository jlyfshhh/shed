import {
  buildFeederForecast,
  type AvailableFeeder,
  type FeedingProfile,
  type ForecastAnimal,
  type ForecastWeight,
} from "./feeding-forecast.ts";

type ProfileRow = Omit<FeedingProfile, "schedule" | "buyAsNeeded"> & {
  id: string;
  taskType: string;
  title: string;
  details: string;
  frequency: FeedingProfile["schedule"]["frequency"];
  intervalDays: number | null;
  weekdaysJson: string | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  buyAsNeeded: number;
};

export async function loadFeederForecast(
  db: D1Database,
  today: string,
  horizonDays: number,
) {
  const throughDate = addDays(today, Math.min(Math.max(Math.trunc(horizonDays), 1), 180));
  const [animals, weights, availableFeeders, profileRows, dispositionedFeedings] = await Promise.all([
    db.prepare("SELECT id, name FROM animals WHERE active = 1 ORDER BY name").all<ForecastAnimal>(),
    db.prepare("SELECT animal_id AS animalId, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events ORDER BY animal_id, recorded_on").all<ForecastWeight>(),
    db.prepare("SELECT id, prey_species AS preySpecies, size_class AS sizeClass, weight_grams AS weightGrams FROM feeder_inventory WHERE status = 'available' ORDER BY weight_grams, id").all<AvailableFeeder>(),
    db.prepare("SELECT id, animal_id AS animalId, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, start_date AS startDate, end_date AS endDate, prey_species AS preySpecies, COALESCE(prey_description, prey_species) AS preyDescription, prey_size_class AS preySizeClass, target_percent AS targetPercent, minimum_percent AS minimumPercent, maximum_percent AS maximumPercent, buy_as_needed AS buyAsNeeded FROM care_schedules WHERE active = 1 AND task_type = 'feeding' AND prey_species IS NOT NULL").all<ProfileRow>(),
    db.prepare(
      `SELECT DISTINCT t.schedule_id AS scheduleId, t.due_date AS dueDate
         FROM care_tasks t
         LEFT JOIN husbandry_events e
           ON e.task_id = t.id
          AND e.due_date = t.due_date
          AND e.voided_at IS NULL
        WHERE t.schedule_id IS NOT NULL
          AND t.due_date >= ?
          AND t.due_date <= ?
          AND (t.skipped_at IS NOT NULL OR e.id IS NOT NULL)`,
    ).bind(today, throughDate).all<{ scheduleId: string; dueDate: string }>(),
  ]);

  const profiles: FeedingProfile[] = profileRows.results.map((row) => ({
    animalId: row.animalId,
    preySpecies: row.preySpecies,
    preyDescription: row.preyDescription,
    preySizeClass: row.preySizeClass,
    targetPercent: row.targetPercent,
    minimumPercent: row.minimumPercent,
    maximumPercent: row.maximumPercent,
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
      startDate: row.startDate,
      endDate: row.endDate,
    },
  }));

  const forecast = buildFeederForecast({
    today,
    horizonDays,
    animals: animals.results,
    weights: weights.results,
    availableFeeders: availableFeeders.results,
    profiles,
    // A skipped occurrence was intentionally settled and must not be forecast as
    // another feeder need. Completed/refused occurrences are excluded here too.
    excludedFeedings: dispositionedFeedings.results.map((row) => `${row.scheduleId}:${row.dueDate}`),
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
