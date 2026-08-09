import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { requireHouseholdMember } from "@/lib/household-auth";
import { COPYABLE_SCHEDULE_COLUMNS, copySignature } from "@/lib/copy-routines";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type Body = {
  animalId?: unknown;
  scheduleIds?: unknown;
  idempotencyKey?: unknown;
};

/**
 * Copy several care plans onto one animal, all or nothing.
 *
 * The interface used to POST one plan at a time. A failure part way through
 * left some plans created and some not, and pressing the button again created
 * duplicates of the ones that had already worked — with no way to tell which.
 *
 * Everything is validated first, the inserts go in a single batch (D1 runs a
 * batch as one transaction), and an idempotency key makes a repeat of the same
 * request return the original outcome instead of copying again.
 */
export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as Body | null;
    const animalId = typeof body?.animalId === "string" ? body.animalId : "";
    const scheduleIds = Array.isArray(body?.scheduleIds)
      ? body!.scheduleIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 100) : "";

    if (!animalId) return Response.json({ error: "Which animal are these for?" }, { status: 400, headers: noStore });
    if (!scheduleIds.length) return Response.json({ error: "Choose at least one routine to copy." }, { status: 400, headers: noStore });
    if (scheduleIds.length > 100) return Response.json({ error: "That is more routines than one animal can use." }, { status: 400, headers: noStore });

    const animal = await db.prepare("SELECT id, name FROM animals WHERE id = ? AND active = 1")
      .bind(animalId).first<{ id: string; name: string }>();
    if (!animal) return Response.json({ error: "That animal could not be found." }, { status: 404, headers: noStore });

    // A repeat of the same request returns what the first one did. Without
    // this, a lost response or an impatient second tap duplicates every plan.
    if (idempotencyKey) {
      const seen = await db.prepare("SELECT value FROM app_settings WHERE key = ?")
        .bind(`copy-routines:${idempotencyKey}`).first<{ value: string }>();
      if (seen) {
        return Response.json({ ...JSON.parse(seen.value), repeated: true }, { headers: noStore });
      }
    }

    const placeholders = scheduleIds.map(() => "?").join(", ");
    const sources = await db.prepare(
      `SELECT ${COPYABLE_SCHEDULE_COLUMNS.join(", ")}, id FROM care_schedules WHERE id IN (${placeholders}) AND active = 1`,
    ).bind(...scheduleIds).all<Record<string, unknown>>();

    const missing = scheduleIds.filter((id) => !sources.results.some((row) => String(row.id) === id));
    if (missing.length) {
      return Response.json(
        { error: "Some of those routines no longer exist. Reload and try again.", missing },
        { status: 409, headers: noStore },
      );
    }

    // Plans this animal already has, by the same signature the interface uses
    // to group them, so copying twice reports "skipped" rather than making a
    // second identical plan.
    const existing = await db.prepare(
      `SELECT ${COPYABLE_SCHEDULE_COLUMNS.join(", ")} FROM care_schedules WHERE animal_id = ? AND active = 1`,
    ).bind(animalId).all<Record<string, unknown>>();
    const existingSignatures = new Set(existing.results.map(copySignature));

    const today = dateInTimeZone();
    const created: string[] = [];
    const skipped: string[] = [];
    const statements = [];

    for (const source of sources.results) {
      if (existingSignatures.has(copySignature(source))) {
        skipped.push(String(source.title ?? ""));
        continue;
      }
      const id = crypto.randomUUID();
      const columns = ["id", "animal_id", "start_date", "active", "created_at", "updated_at", ...COPYABLE_SCHEDULE_COLUMNS];
      const now = new Date().toISOString();
      const values = [id, animalId, today, 1, now, now, ...COPYABLE_SCHEDULE_COLUMNS.map((column) => source[column] ?? null)];
      statements.push(
        db.prepare(`INSERT INTO care_schedules (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
          .bind(...values),
      );
      created.push(String(source.title ?? ""));
      // Guard against the same signature appearing twice in one request.
      existingSignatures.add(copySignature(source));
    }

    const result = { saved: true, animal: animal.name, created, skipped };
    if (idempotencyKey) {
      statements.push(
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")
          .bind(`copy-routines:${idempotencyKey}`, JSON.stringify(result)),
      );
    }
    // One batch, one transaction: either every plan is created or none is.
    if (statements.length) await db.batch(statements);

    return Response.json(result, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not copy those routines." },
      { status: 400, headers: noStore },
    );
  }
}
