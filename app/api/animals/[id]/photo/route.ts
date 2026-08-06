import { ensureDatabase } from "@/db/runtime";
import { base64ToBytes, parsePhotoDataUrl } from "@/lib/animal-photo";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type PhotoRow = { mime: string; data: string; updatedAt: string };

/**
 * Serve an animal's portrait. Callers cache-bust with `?v=<photoUpdatedAt>`, so
 * a hit can be cached hard — and the ETag covers anyone who drops the query.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401, headers: noStore });
    }

    const { id } = await context.params;
    const row = await db.prepare(
      "SELECT mime, data, updated_at AS updatedAt FROM animal_photos WHERE animal_id = ?",
    ).bind(id).first<PhotoRow>();
    if (!row) return Response.json({ error: "No photo yet" }, { status: 404, headers: noStore });

    const etag = `"${row.updatedAt}"`;
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, max-age=31536000" } });
    }

    return new Response(base64ToBytes(row.data), {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "private, max-age=31536000",
        ETag: etag,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load the photo" },
      { status: 500, headers: noStore },
    );
  }
}

/** Save (or replace) the portrait. Any signed-in keeper can — they take the pictures. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    // Keeper-level write: same gate as logging a weight, so a self-hosted
    // install that hasn't turned household auth on still works.
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401, headers: noStore });
    }

    const { id } = await context.params;
    const animal = await db.prepare("SELECT id FROM animals WHERE id = ?").bind(id).first<{ id: string }>();
    if (!animal) return Response.json({ error: "Animal not found" }, { status: 404, headers: noStore });

    const body = (await request.json().catch(() => null)) as { dataUrl?: unknown } | null;
    const parsed = parsePhotoDataUrl(body?.dataUrl);
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400, headers: noStore });

    const updatedAt = new Date().toISOString();
    await db.prepare(
      `INSERT INTO animal_photos (animal_id, mime, data, byte_size, updated_at, updated_by_member_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(animal_id) DO UPDATE SET
         mime = excluded.mime, data = excluded.data, byte_size = excluded.byte_size,
         updated_at = excluded.updated_at, updated_by_member_id = excluded.updated_by_member_id,
         updated_by_name = excluded.updated_by_name`,
    ).bind(id, parsed.photo.mime, parsed.photo.base64, parsed.photo.byteSize, updatedAt, member?.id ?? null, member?.displayName ?? null).run();

    return Response.json({ photoUpdatedAt: updatedAt, byteSize: parsed.photo.byteSize }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save the photo" },
      { status: 500, headers: noStore },
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    // Keeper-level write: same gate as logging a weight, so a self-hosted
    // install that hasn't turned household auth on still works.
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401, headers: noStore });
    }

    const { id } = await context.params;
    await db.prepare("DELETE FROM animal_photos WHERE animal_id = ?").bind(id).run();
    return Response.json({ photoUpdatedAt: null }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to remove the photo" },
      { status: 500, headers: noStore },
    );
  }
}
