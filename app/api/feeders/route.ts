import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

export const dynamic = "force-dynamic";

type FeederRow = {
  id: string;
  preySpecies: string;
  sizeClass: string;
  weightGrams: number;
  status: string;
  addedOn: string;
  consumedAt: string | null;
  animalId: string | null;
  animalName: string | null;
  husbandryEventId: string | null;
  notes: string | null;
};

export async function GET(request: Request) {
  try {
    const db = await ensureDatabase();
    if (householdAuthRequired() && !(await memberFromRequest(request, db))) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401 });
    }
    const result = await db.prepare(
      `SELECT f.id, f.prey_species AS preySpecies, f.size_class AS sizeClass,
        f.weight_grams AS weightGrams, f.status, f.added_on AS addedOn,
        f.consumed_at AS consumedAt, f.animal_id AS animalId, a.name AS animalName,
        f.husbandry_event_id AS husbandryEventId, f.notes
       FROM feeder_inventory f
       LEFT JOIN animals a ON a.id = f.animal_id
       ORDER BY CASE f.status WHEN 'available' THEN 1 ELSE 2 END,
         f.prey_species, f.size_class, f.weight_grams, f.id`,
    ).all<FeederRow>();
    const inventory = result.results;
    const summary = Object.values(
      inventory
        .filter((row) => row.status === "available")
        .reduce<Record<string, { preySpecies: string; sizeClass: string; count: number; weightsGrams: number[] }>>((groups, row) => {
          const key = `${row.preySpecies}:${row.sizeClass}`;
          const group = groups[key] ?? {
            preySpecies: row.preySpecies,
            sizeClass: row.sizeClass,
            count: 0,
            weightsGrams: [],
          };
          group.count += 1;
          group.weightsGrams.push(row.weightGrams);
          groups[key] = group;
          return groups;
        }, {}),
    );
    return Response.json({ summary, inventory });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load feeder inventory" },
      { status: 500 },
    );
  }
}
