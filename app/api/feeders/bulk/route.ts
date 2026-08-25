import { readJsonObject } from "@/lib/json-body";
import { ensureDatabase } from "@/db/runtime";
import { safeErrorResponse } from "@/lib/api-errors";
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
    const parsed = await readJsonObject(request);
    if (parsed.response) return parsed.response;
    const batch = normalizeBulkFeeders(parsed.body as unknown as BulkFeederInput, dateInTimeZone());
    const ids = Array.from({ length: batch.count }, () => crypto.randomUUID());
    await db.batch(ids.map((id) =>
      db.prepare(
        "INSERT INTO feeder_inventory (id, prey_species, size_class, status, added_on, notes) VALUES (?, ?, ?, 'available', ?, ?)",
      ).bind(id, batch.preySpecies, batch.sizeClass, batch.addedOn, batch.notes),
    ));
    return Response.json({
      saved: true,
      count: ids.length,
      ids,
      preySpecies: batch.preySpecies,
      sizeClass: batch.sizeClass,
    }, { status: 201, headers });
  } catch (error) {
    return safeErrorResponse(error, { context: "Bulk feeder inventory write failed", message: "Unable to add feeder inventory", headers });
  }
}
