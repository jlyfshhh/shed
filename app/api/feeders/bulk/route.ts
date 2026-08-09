import { ensureDatabase } from "@/db/runtime";
import { normalizeBulkFeeders, type BulkFeederInput } from "@/lib/bulk-feeders";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "feeders.manage");
    if (auth.response) return auth.response;
    const batch = normalizeBulkFeeders(await request.json() as BulkFeederInput, dateInTimeZone());
    const ids = batch.weightsGrams.map(() => crypto.randomUUID());
    await db.batch(batch.weightsGrams.map((weightGrams, index) =>
      db.prepare(
        "INSERT INTO feeder_inventory (id, prey_species, size_class, weight_grams, status, added_on, notes) VALUES (?, ?, ?, ?, 'available', ?, ?)",
      ).bind(ids[index], batch.preySpecies, batch.sizeClass, weightGrams, batch.addedOn, batch.notes),
    ));
    return Response.json({
      saved: true,
      count: ids.length,
      ids,
      preySpecies: batch.preySpecies,
      sizeClass: batch.sizeClass,
      minimumWeightGrams: Math.min(...batch.weightsGrams),
      maximumWeightGrams: Math.max(...batch.weightsGrams),
    }, { status: 201, headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to add feeder inventory" },
      { status: 400, headers },
    );
  }
}
