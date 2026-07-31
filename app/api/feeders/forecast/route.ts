import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";
import {
  buildFeederForecast,
  type AvailableFeeder,
  type ForecastAnimal,
  type ForecastWeight,
  type FeedingProfile,
} from "@/lib/feeding-forecast";

export const dynamic = "force-dynamic";

type ProfileRow = Omit<FeedingProfile, "schedule" | "buyAsNeeded"> & {
  id: string; taskType: string; title: string; details: string; frequency: FeedingProfile["schedule"]["frequency"];
  intervalDays: number | null; weekdaysJson: string | null; dayOfMonth: number | null; startDate: string; endDate: string | null; buyAsNeeded: number;
};

export async function GET(request: Request) {
  try {
    const parsedHorizon = Number.parseInt(
      new URL(request.url).searchParams.get("horizon") ?? "60",
      10,
    );
    const horizonDays = Number.isFinite(parsedHorizon) ? parsedHorizon : 60;
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    if (householdAuthRequired() && !(await memberFromRequest(request, db))) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401 });
    }
    const [animals, weights, availableFeeders, profileRows] = await Promise.all([
      db.prepare("SELECT id, name FROM animals ORDER BY name").all<ForecastAnimal>(),
      db.prepare("SELECT animal_id AS animalId, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events ORDER BY animal_id, recorded_on").all<ForecastWeight>(),
      db.prepare("SELECT id, prey_species AS preySpecies, size_class AS sizeClass, weight_grams AS weightGrams FROM feeder_inventory WHERE status = 'available' ORDER BY weight_grams, id").all<AvailableFeeder>(),
      db.prepare("SELECT id, animal_id AS animalId, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, start_date AS startDate, end_date AS endDate, prey_species AS preySpecies, COALESCE(prey_description, prey_species) AS preyDescription, prey_size_class AS preySizeClass, target_percent AS targetPercent, minimum_percent AS minimumPercent, maximum_percent AS maximumPercent, buy_as_needed AS buyAsNeeded FROM care_schedules WHERE active = 1 AND task_type = 'feeding' AND prey_species IS NOT NULL").all<ProfileRow>(),
    ]);
    const profiles: FeedingProfile[] = profileRows.results.map((row) => ({
      animalId: row.animalId, preySpecies: row.preySpecies, preyDescription: row.preyDescription, preySizeClass: row.preySizeClass,
      targetPercent: row.targetPercent, minimumPercent: row.minimumPercent, maximumPercent: row.maximumPercent,
      buyAsNeeded: Boolean(row.buyAsNeeded),
      schedule: { id: row.id, animalId: row.animalId, taskType: row.taskType, title: row.title, details: row.details, frequency: row.frequency, intervalDays: row.intervalDays, weekdaysJson: row.weekdaysJson, dayOfMonth: row.dayOfMonth, startDate: row.startDate, endDate: row.endDate },
    }));
    return Response.json(buildFeederForecast({
      today,
      horizonDays,
      animals: animals.results,
      weights: weights.results,
      availableFeeders: availableFeeders.results,
      profiles,
    }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to forecast feeder needs" },
      { status: 500 },
    );
  }
}
