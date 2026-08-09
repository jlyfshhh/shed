import { ensureDatabase } from "@/db/runtime";
import { env } from "cloudflare:workers";
import { requireHouseholdMember } from "@/lib/household-auth";
import { MAX_BUNDLE_BYTES, validateBundle } from "@/lib/restore-plan";
import {
  matchingExistingMember,
  PORTABLE_APP_SETTING_KEYS,
  PORTABLE_RESOURCES,
  remapMemberReferences,
  type ExistingMember,
  type PortableMember,
} from "@/lib/portable-backup";

const isPortableMember = (value: Record<string, unknown>): value is Record<string, unknown> & PortableMember =>
  typeof value.id === "string"
  && typeof value.display_name === "string"
  && value.display_name.trim().length > 0
  && value.display_name.trim().length <= 40
  && (value.role === "Owner" || value.role === "Zookeeper");

async function restoreHouseholdProfiles(
  db: D1Database,
  bundle: Record<string, unknown>,
): Promise<{ memberIds: Map<string, string>; restored: number }> {
  const sourceMembers = (Array.isArray(bundle.householdMembers) ? bundle.householdMembers : [])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .filter(isPortableMember);
  const existingResult = await db.prepare(
    "SELECT id, display_name AS displayName, role FROM household_members ORDER BY created_at",
  ).all<ExistingMember>();
  const existing = [...existingResult.results];
  const memberIds = new Map<string, string>();
  let restored = 0;

  for (const source of sourceMembers) {
    let target = matchingExistingMember(source, existing);
    if (!target && source.role === "Zookeeper") {
      const now = new Date().toISOString();
      const restoredId = existing.some((member) => member.id === source.id) ? crypto.randomUUID() : source.id;
      target = { id: restoredId, displayName: source.display_name.trim().replace(/\s+/g, " "), role: "Zookeeper" };
      await db.prepare(
        "INSERT OR IGNORE INTO household_members (id, display_name, role, access_code_hash, active, earning_enabled, created_at, updated_at) VALUES (?, ?, 'Zookeeper', ?, 0, ?, ?, ?)",
      ).bind(
        target.id,
        target.displayName,
        `restored-disabled:${crypto.randomUUID()}`,
        Number(source.earning_enabled ?? 0) ? 1 : 0,
        typeof source.created_at === "string" ? source.created_at : now,
        typeof source.updated_at === "string" ? source.updated_at : now,
      ).run();
      existing.push(target);
    }
    if (!target) continue;
    if (Object.hasOwn(source, "earning_enabled")) {
      await db.prepare("UPDATE household_members SET earning_enabled = ?, updated_at = ? WHERE id = ?")
        .bind(Number(source.earning_enabled ?? 0) ? 1 : 0, new Date().toISOString(), target.id).run();
    }
    memberIds.set(source.id, target.id);
    restored += 1;
  }
  return { memberIds, restored };
}

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    // Refuse an oversized bundle before it is buffered, not after. There was no
    // limit at all: a large upload was parsed in full and only then rejected.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BUNDLE_BYTES) {
      return Response.json(
        { error: `A backup larger than ${Math.floor(MAX_BUNDLE_BYTES / (1024 * 1024))} MB cannot be restored here.` },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    const payload = await request.json() as { mode?: "merge" | "replace"; confirmation?: string; dryRun?: boolean; bundle?: Record<string, unknown> };
    const bundle = payload.bundle;
    if (!bundle || Number(bundle.schemaVersion) < 8) return Response.json({ error: "A Shed schema version 8+ JSON export is required" }, { status: 400 });
    if (payload.mode === "replace" && !payload.dryRun && payload.confirmation !== "REPLACE") return Response.json({ error: "Type REPLACE to confirm a full data restore" }, { status: 400 });

    // ── Validate everything before touching anything ─────────────────────────
    // Replace used to delete first and validate as it went, so a bad row late
    // in a bundle — or an attachment that would not decode — left a half
    // restored database with no way back.
    const plan = validateBundle(bundle);
    if (plan.errors.length) {
      return Response.json(
        { error: "This backup cannot be restored.", problems: plan.errors.slice(0, 20), checked: plan.counts },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (payload.dryRun) {
      return Response.json(
        { dryRun: true, wouldRestore: plan.counts, mode: payload.mode ?? "merge" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const household = await restoreHouseholdProfiles(db, bundle);
    const portableSheets = (Array.isArray(bundle.lightingPlanSheets) ? bundle.lightingPlanSheets : []).filter((sheet): sheet is Record<string, unknown> => Boolean(sheet) && typeof sheet === "object");
    const sheetPlanIds = new Set(portableSheets.map((sheet) => typeof sheet.planId === "string" ? sheet.planId : "").filter(Boolean));
    let imported = household.restored;
    const writes: D1PreparedStatement[] = [];
    for (const [bundleKey, definition] of Object.entries(PORTABLE_RESOURCES) as Array<[keyof typeof PORTABLE_RESOURCES, (typeof PORTABLE_RESOURCES)[keyof typeof PORTABLE_RESOURCES]]>) {
      const rows = (Array.isArray(bundle[bundleKey]) ? bundle[bundleKey] as Array<Record<string, unknown>> : [])
        .filter((row) => bundleKey !== "appSettings" || PORTABLE_APP_SETTING_KEYS.includes(String(row.key) as (typeof PORTABLE_APP_SETTING_KEYS)[number]));
      const statements = rows.map((sourceRow) => {
        const row = remapMemberReferences(bundleKey, sourceRow, household.memberIds);
        if (bundleKey === "lightingPlans") {
          row.plan_sheet_key = null;
          if (!sheetPlanIds.has(String(row.id ?? ""))) {
            row.plan_sheet_name = null;
            row.plan_sheet_type = null;
          }
        }
        const { table, columns, key } = definition;
        const present = columns.filter((column) => Object.hasOwn(row, column));
        if (!present.includes(key)) throw new Error(`${bundleKey} contains a row without its ${key}`);
        return db.prepare(`INSERT OR REPLACE INTO ${table} (${present.join(", ")}) VALUES (${present.map(() => "?").join(", ")})`).bind(...present.map((column) => row[column] ?? null));
      });
      writes.push(...statements);
      imported += statements.length;
    }

    // Deletes and inserts go into one batch. D1 runs a batch as a single
    // transaction, so a failure anywhere rolls the whole thing back and the
    // database is left exactly as it was. Previously the deletes ran first and
    // the inserts followed in separate hundred-statement batches, so any error
    // after the first batch left a partially restored database.
    if (payload.mode === "replace") {
      const deleteOrder = ["reward_payouts", "feeding_assignments", "feeder_inventory", "lighting_measurements", "lighting_plan_fixtures", "lighting_plans", "husbandry_event_revisions", "husbandry_events", "care_tasks", "care_schedules", "weight_events", "animal_notes", "animal_photos", "equipment", "animals", "enclosures"];
      writes.unshift(
        db.prepare("UPDATE household_members SET earning_enabled = 0"),
        db.prepare(`DELETE FROM app_settings WHERE key IN (${PORTABLE_APP_SETTING_KEYS.map(() => "?").join(", ")})`)
          .bind(...PORTABLE_APP_SETTING_KEYS),
        ...deleteOrder.map((table) => db.prepare(`DELETE FROM ${table}`)),
      );
    }
    if (writes.length) await db.batch(writes);
    // Stored files are outside the transaction, so they are cleared only once
    // the database change has committed.
    if (payload.mode === "replace") await deleteLightingPlanSheets();
    for (const sheet of portableSheets) {
      const planId = typeof sheet.planId === "string" ? sheet.planId : "";
      const encoded = typeof sheet.dataBase64 === "string" ? sheet.dataBase64 : "";
      const type = typeof sheet.type === "string" ? sheet.type : "application/octet-stream";
      const name = typeof sheet.name === "string" ? sheet.name.slice(0, 200) : "lighting-plan";
      if (!planId || !encoded) continue;
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error(`Plan sheet for ${planId} exceeds 5 MB`);
      const key = `lighting-plans/${planId}/${crypto.randomUUID()}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { originalName: name } });
      await db.prepare("UPDATE lighting_plans SET plan_sheet_key = ?, plan_sheet_name = ?, plan_sheet_type = ? WHERE id = ?").bind(key, name, type, planId).run();
      imported += 1;
    }
    await db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_reward_cents', '25')").run();
    return Response.json({ saved: true, imported, householdProfiles: household.restored, mode: payload.mode ?? "merge" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import the backup" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

async function deleteLightingPlanSheets() {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: "lighting-plans/", cursor });
    if (page.objects.length) await env.FILES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
