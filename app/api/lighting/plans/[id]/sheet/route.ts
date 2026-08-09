import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest, requireHouseholdMember } from "@/lib/household-auth";
import { attachmentHeaders, checkAttachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const db = await ensureDatabase();
  const member = await memberFromRequest(request, db);
  if (householdAuthRequired() && !member) return Response.json({ error: "Sign in to Shed first" }, { status: 401 });
  const { id } = await context.params;
  const plan = await db.prepare("SELECT plan_sheet_key AS sheetKey, plan_sheet_name AS sheetName, plan_sheet_type AS sheetType FROM lighting_plans WHERE id = ?").bind(id).first<{ sheetKey: string | null; sheetName: string | null; sheetType: string | null }>();
  if (!plan?.sheetKey) return Response.json({ error: "This lighting plan has no attached plan sheet" }, { status: 404 });
  const object = await env.FILES.get(plan.sheetKey);
  if (!object) return Response.json({ error: "The attached plan sheet could not be found" }, { status: 404 });
  // Downloaded rather than displayed in place: these are third-party documents,
  // and serving one inline puts it on Shed's own origin with Shed's cookies
  // reachable from it. The stored type is a claim — a restored bundle used to
  // be able to set it to anything — so a type we do not validate is served as
  // an opaque download rather than passed through.
  const storedType = (plan.sheetType ?? "").split(";")[0]!.trim().toLowerCase();
  const servedType = ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(storedType)
    ? storedType
    : "application/octet-stream";
  const headers = new Headers(attachmentHeaders(servedType, { filename: plan.sheetName ?? "lighting-plan" }));
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const existing = await db.prepare("SELECT id, plan_sheet_key AS sheetKey FROM lighting_plans WHERE id = ?").bind(id).first<{ id: string; sheetKey: string | null }>();
    if (!existing) return Response.json({ error: "Lighting plan not found" }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a plan sheet to upload" }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Use a PDF, PNG, JPEG, or WebP plan sheet" }, { status: 400 });
    if (file.size < 1 || file.size > MAX_BYTES) return Response.json({ error: "Plan sheets must be between 1 byte and 5 MB" }, { status: 400 });

    // file.type is whatever the browser was told, and a crafted request can say
    // anything. Read the bytes and let the shared validator decide, then store
    // the type it detected — the same check the restore path runs.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verified = checkAttachment(bytes, "document", file.type);
    if (!verified.ok) return Response.json({ error: verified.error }, { status: 400 });

    const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).replace(/[^.a-zA-Z0-9]/g, "") : "";
    const key = `lighting-plans/${id}/${crypto.randomUUID()}${extension}`;
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: verified.mime }, customMetadata: { originalName: file.name } });
    await db.prepare("UPDATE lighting_plans SET plan_sheet_key = ?, plan_sheet_name = ?, plan_sheet_type = ?, updated_at = ? WHERE id = ?")
      .bind(key, file.name.slice(0, 200), verified.mime, new Date().toISOString(), id).run();
    if (existing.sheetKey) await env.FILES.delete(existing.sheetKey);
    return Response.json({ saved: true, fileName: file.name }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload the plan sheet" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const db = await ensureDatabase();
  const auth = await requireHouseholdMember(request, db, ["Owner"]);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const plan = await db.prepare("SELECT plan_sheet_key AS sheetKey FROM lighting_plans WHERE id = ?").bind(id).first<{ sheetKey: string | null }>();
  if (!plan) return Response.json({ error: "Lighting plan not found" }, { status: 404 });
  if (plan.sheetKey) await env.FILES.delete(plan.sheetKey);
  await db.prepare("UPDATE lighting_plans SET plan_sheet_key = NULL, plan_sheet_name = NULL, plan_sheet_type = NULL, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
}
