import { ensureDatabase } from "@/db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await ensureDatabase();
    const animalsResult = await db.prepare("SELECT id, name, species, group_name AS 'group', location, weight_grams AS weightGrams, weight_date AS weightDate FROM animals ORDER BY CASE group_name WHEN 'Reptile' THEN 1 WHEN 'Amphibian' THEN 2 WHEN 'Community' THEN 3 ELSE 4 END, name").all();
    const tasksResult = await db.prepare("SELECT t.id, t.animal_id AS animalId, a.name AS animalName, a.species, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date ORDER BY complete, t.id").all();
    const eventsResult = await db.prepare("SELECT e.id, a.name AS animalName, e.title, e.occurred_at AS occurredAt, e.actor_role AS actorRole FROM husbandry_events e JOIN animals a ON a.id=e.animal_id ORDER BY e.occurred_at DESC LIMIT 20").all();
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

    return Response.json({ date: "2026-07-14", tasks: tasksResult.results, animals: animalsResult.results, recentEvents: eventsResult.results, weightTrends });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load dashboard" }, { status: 500 });
  }
}
