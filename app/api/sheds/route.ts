// Shed logging. A shed is spotted rather than scheduled, so this is a record
// on its own rather than the completion of a care task — the keeper notices a
// skin in the enclosure and wants it written down before they forget.
//
// Owner-only, matching weights: a shed cannot be corrected from the profile
// once it is saved. Quality is the useful part over time — a run of patchy or
// stuck sheds usually means humidity has drifted.
import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone, isIsoDate } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";
import { SHED_QUALITIES, isShedQuality } from "@/lib/shed-quality";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "sheds.record");
    if (auth.response) return auth.response;
    const member = auth.member;

    const payload = await request.json() as { animalId?: string; recordedOn?: string; quality?: string; notes?: string };
    const animalId = payload.animalId?.trim();
    if (!animalId) return Response.json({ error: "An animal is required" }, { status: 400, headers: noStore });

    const animal = await db.prepare("SELECT id FROM animals WHERE id = ?").bind(animalId).first<{ id: string }>();
    if (!animal) return Response.json({ error: "Animal not found" }, { status: 404, headers: noStore });

    const recordedOn = payload.recordedOn?.trim() || dateInTimeZone();
    if (!isIsoDate(recordedOn)) return Response.json({ error: "Date must use YYYY-MM-DD" }, { status: 400, headers: noStore });
    // A shed can be logged days late, but never for a day that hasn't happened.
    if (recordedOn > dateInTimeZone()) {
      return Response.json({ error: "A shed can't be recorded for a future date" }, { status: 400, headers: noStore });
    }

    const quality = payload.quality?.trim() || "complete";
    if (!isShedQuality(quality)) {
      return Response.json({ error: `Quality must be one of: ${SHED_QUALITIES.join(", ")}` }, { status: 400, headers: noStore });
    }
    const notes = payload.notes?.trim().slice(0, 500) || null;

    await db.prepare(
      "INSERT INTO shed_events (id, animal_id, recorded_on, quality, notes, recorded_by_member_id, recorded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), animalId, recordedOn, quality, notes, member?.id ?? null, member?.displayName ?? null, new Date().toISOString()).run();

    return Response.json({ saved: true, recordedOn, quality }, { status: 201, headers: noStore });
  } catch (error) {
    return internalErrorResponse(error, { context: "Shed event write failed", message: "Unable to record the shed", headers: noStore });
  }
}
