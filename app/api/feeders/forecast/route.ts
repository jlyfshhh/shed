import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import {
  buildFeederForecast,
  type AvailableFeeder,
  type ForecastAnimal,
  type ForecastWeight,
} from "@/lib/feeding-forecast";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const parsedHorizon = Number.parseInt(
      new URL(request.url).searchParams.get("horizon") ?? "60",
      10,
    );
    const horizonDays = Number.isFinite(parsedHorizon) ? parsedHorizon : 60;
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const [animals, weights, availableFeeders] = await Promise.all([
      db.prepare("SELECT id, name FROM animals ORDER BY name").all<ForecastAnimal>(),
      db.prepare("SELECT animal_id AS animalId, recorded_on AS recordedOn, weight_grams AS weightGrams FROM weight_events ORDER BY animal_id, recorded_on").all<ForecastWeight>(),
      db.prepare("SELECT id, prey_species AS preySpecies, size_class AS sizeClass, weight_grams AS weightGrams FROM feeder_inventory WHERE status = 'available' ORDER BY weight_grams, id").all<AvailableFeeder>(),
    ]);
    return Response.json(buildFeederForecast({
      today,
      horizonDays,
      animals: animals.results,
      weights: weights.results,
      availableFeeders: availableFeeders.results,
    }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to forecast feeder needs" },
      { status: 500 },
    );
  }
}
