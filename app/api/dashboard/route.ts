import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { previousIsoDate } from "@/lib/care-schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = dateInTimeZone();
    const yesterday = previousIsoDate(today);
    const db = await ensureDatabase(today);
    const animalsResult = await db.prepare("SELECT id, name, species, group_name AS 'group', location, weight_grams AS weightGrams, weight_date AS weightDate FROM animals ORDER BY CASE group_name WHEN 'Reptile' THEN 1 WHEN 'Amphibian' THEN 2 WHEN 'Community' THEN 3 ELSE 4 END, name").all();
    const tasksResult = await db.prepare("SELECT t.id, t.animal_id AS animalId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date WHERE t.due_date = ? OR (t.due_date = ? AND e.id IS NULL AND t.id NOT LIKE 'salad-dracarys:%' AND NOT (t.task_type = 'misting' AND t.animal_id IN ('pascal', 'wasabi', 'echo', 'rue'))) ORDER BY complete, t.due_date, a.name, t.title").bind(today, yesterday).all();
    const eventsResult = await db.prepare("SELECT e.id, a.name AS animalName, e.task_type AS taskType, e.title, e.notes, e.occurred_at AS occurredAt, e.actor_role AS actorRole FROM husbandry_events e JOIN animals a ON a.id=e.animal_id ORDER BY e.occurred_at DESC LIMIT 20").all();
    const weightsResult = await db.prepare("SELECT w.animal_id AS animalId, a.name AS animalName, w.recorded_on AS recordedOn, w.weight_grams AS weightGrams FROM weight_events w JOIN animals a ON a.id=w.animal_id ORDER BY w.animal_id, w.recorded_on").all();

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

    return Response.json({ date: today, tasks: tasksResult.results, animals: animalsResult.results, recentEvents: eventsResult.results, weightTrends });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load dashboard" }, { status: 500 });
  }
}
