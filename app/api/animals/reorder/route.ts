// Household-wide manual order for the Animals tab. The client sends the full
// list of active animal ids in the desired order; we number them so the grid
// can sort by sort_order. Renumbering the whole list on each save keeps the
// stored values dense and avoids fractional-insert bookkeeping — there are only
// ever a few dozen animals, so one small batch is cheap.
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { requireCapability } from "@/lib/household-auth";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "records.manage");
    if (auth.response) return auth.response;

    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const order = payload?.order;
    if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
      return Response.json({ error: "Send { order: string[] } of animal ids" }, { status: 400, headers: noStore });
    }
    if (new Set(order).size !== order.length) {
      return Response.json({ error: "The order lists an animal more than once" }, { status: 400, headers: noStore });
    }

    // Reorder only ever covers the animals shown on the tab: the active ones.
    // A stale client (an animal archived in another tab) must not write a
    // position onto a row it no longer represents, so intersect with reality.
    const active = await db.prepare("SELECT id FROM animals WHERE active = 1").all<{ id: string }>();
    const known = new Set(active.results.map((row) => row.id));
    const ids = (order as string[]).filter((id) => known.has(id));

    const now = new Date().toISOString();
    await db.batch(ids.map((id, index) =>
      db.prepare("UPDATE animals SET sort_order = ?, updated_at = ? WHERE id = ?").bind(index, now, id)));

    return Response.json({ saved: true, count: ids.length }, { status: 200, headers: noStore });
  } catch (error) {
    return internalErrorResponse(error, { context: "Animal reorder failed", message: "Unable to save the order", headers: noStore });
  }
}
