import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Record that feeders have been ordered, so the reorder nudge stops asking.
 * The mark is cleared automatically once stock actually arrives — see
 * reorderAcknowledged in lib/feeder-forecast-data.
 */
export async function POST(request: Request) {
  try {
    const db = await ensureDatabase(dateInTimeZone());
    const auth = await requireCapability(request, db, "feeders.manage");
    if (auth.response) return auth.response;

    const placedAt = new Date().toISOString();
    await db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('feeder_order_placed_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(placedAt).run();

    return Response.json({ placedAt }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to record the feeder order" },
      { status: 500, headers: noStore },
    );
  }
}

/** Undo, for when an order falls through. */
export async function DELETE(request: Request) {
  try {
    const db = await ensureDatabase(dateInTimeZone());
    const auth = await requireCapability(request, db, "feeders.manage");
    if (auth.response) return auth.response;
    await db.prepare("DELETE FROM app_settings WHERE key = 'feeder_order_placed_at'").run();
    return Response.json({ placedAt: null }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to clear the feeder order" },
      { status: 500, headers: noStore },
    );
  }
}
