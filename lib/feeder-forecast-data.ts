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
  const [animals, weights, availableFeeders, profileRows, completedFeedings] = await Promise.all([
    db.prepare("SELECT id, name FROM animals WHERE active = 1 ORDER BY name").all<ForecastAnimal>(),
    db.prepare("SELECT animal_id AS animalId, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events ORDER BY animal_id, recorded_on").all<ForecastWeight>(),
    db.prepare("SELECT id, prey_species AS preySpecies, size_class AS sizeClass, weight_grams AS weightGrams FROM feeder_inventory WHERE status = 'available' ORDER BY weight_grams, id").all<AvailableFeeder>(),
    db.prepare("SELECT id, animal_id AS animalId, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, start_date AS startDate, end_date AS endDate, prey_species AS preySpecies, COALESCE(prey_description, prey_species) AS preyDescription, prey_size_class AS preySizeClass, target_percent AS targetPercent, minimum_percent AS minimumPercent, maximum_percent AS maximumPercent, buy_as_needed AS buyAsNeeded FROM care_schedules WHERE active = 1 AND task_type = 'feeding' AND prey_species IS NOT NULL").all<ProfileRow>(),
    db.prepare("SELECT t.schedule_id AS scheduleId, e.due_date AS dueDate FROM husbandry_events e JOIN care_tasks t ON t.id = e.task_id WHERE e.voided_at IS NULL AND t.schedule_id IS NOT NULL AND e.due_date >= ? AND e.due_date <= ?").bind(today, throughDate).all<{ scheduleId: string; dueDate: string }>(),
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

  return buildFeederForecast({
    today,
    horizonDays,
    animals: animals.results,
    weights: weights.results,
    availableFeeders: availableFeeders.results,
    profiles,
    excludedFeedings: completedFeedings.results.map((row) => `${row.scheduleId}:${row.dueDate}`),
  });
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
