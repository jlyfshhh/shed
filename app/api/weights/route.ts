// Quick weight logging — added by Claude 2026-07-21 while Codex was out.
// A weight is a record, not a completed task: it rewrites the animal's headline
// weight and feeds the growth trend, and there is no keeper-facing way to undo
// one. It is Head Keeper work, alongside editing and deleting weights in
// /api/manage.
import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone, isIsoDate } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "weights.record");
    if (auth.response) return auth.response;
    const member = auth.member;

    const payload = await request.json() as { animalId?: string; recordedOn?: string; weightGrams?: number | string; notes?: string };
    const animalId = payload.animalId?.trim();
    if (!animalId) return Response.json({ error: "An animal is required" }, { status: 400, headers: noStore });

    const animal = await db.prepare("SELECT id FROM animals WHERE id = ?").bind(animalId).first<{ id: string }>();
    if (!animal) return Response.json({ error: "Animal not found" }, { status: 404, headers: noStore });

    const recordedOn = payload.recordedOn?.trim() || dateInTimeZone();
    if (!isIsoDate(recordedOn)) return Response.json({ error: "Date must use YYYY-MM-DD" }, { status: 400, headers: noStore });

    const weightGrams = Math.round(Number(payload.weightGrams));
    if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
      return Response.json({ error: "Enter a weight in grams greater than zero" }, { status: 400, headers: noStore });
    }
    const notes = payload.notes?.trim().slice(0, 500) || null;

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO weight_events (id, animal_id, recorded_on, weight_grams, notes, recorded_by_member_id, recorded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), animalId, recordedOn, weightGrams, notes, member?.id ?? null, member?.displayName ?? null, now).run();

    // Keep the animal's headline weight pointing at its latest measurement.
    const latest = await db.prepare(
      "SELECT weight_grams AS weightGrams, recorded_on AS recordedOn FROM weight_events WHERE animal_id = ? ORDER BY recorded_on DESC, rowid DESC LIMIT 1",
    ).bind(animalId).first<{ weightGrams: number; recordedOn: string }>();
    await db.prepare("UPDATE animals SET weight_grams = ?, weight_date = ?, updated_at = ? WHERE id = ?")
      .bind(latest?.weightGrams ?? weightGrams, latest?.recordedOn ?? recordedOn, now, animalId).run();

    return Response.json({ saved: true, weightGrams, recordedOn }, { status: 201, headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record the weight" }, { status: 500, headers: noStore });
  }
}
