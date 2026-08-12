import { ensureDatabase } from "@/db/runtime";
import { env } from "cloudflare:workers";
import { requireCapability } from "@/lib/household-auth";
import { BACKUP_SCHEMA_VERSION, PORTABLE_APP_SETTING_KEYS, PORTABLE_RESOURCES } from "@/lib/portable-backup";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const db = await ensureDatabase();
  // This hands out the entire database, so it uses the same Owner gate as every
  // other Owner route rather than its own copy of the logic.
  const auth = await requireCapability(request, db, "records.export");
  if (auth.response) return auth.response;
  const portableEntries = Object.entries(PORTABLE_RESOURCES) as Array<
    [keyof typeof PORTABLE_RESOURCES, (typeof PORTABLE_RESOURCES)[keyof typeof PORTABLE_RESOURCES]]
  >;
  const [resourceResults, householdMembers] = await Promise.all([
    Promise.all(portableEntries.map(([resource, definition]) => {
      const columns = definition.columns.join(", ");
      if (resource === "appSettings") {
        return db.prepare(
          `SELECT ${columns} FROM ${definition.table} WHERE key IN (${PORTABLE_APP_SETTING_KEYS.map(() => "?").join(", ")}) ORDER BY ${definition.key}`,
        ).bind(...PORTABLE_APP_SETTING_KEYS).all<Record<string, unknown>>();
      }
      return db.prepare(`SELECT ${columns} FROM ${definition.table} ORDER BY ${definition.key}`).all<Record<string, unknown>>();
    })),
    db.prepare("SELECT id, display_name, role, active, earning_enabled, created_at, updated_at, last_login_at FROM household_members ORDER BY display_name").all(),
  ]);
  const portableData = Object.fromEntries(
    portableEntries.map(([resource], index) => [resource, resourceResults[index].results]),
  ) as Record<keyof typeof PORTABLE_RESOURCES, Array<Record<string, unknown>>>;
  const lightingPlanSheets = await Promise.all(portableData.lightingPlans.filter((plan) => typeof plan.plan_sheet_key === "string" && plan.plan_sheet_key).map(async (plan) => {
    const object = await env.FILES.get(String(plan.plan_sheet_key));
    if (!object) return null;
    return { planId: plan.id, name: plan.plan_sheet_name, type: plan.plan_sheet_type, dataBase64: bytesToBase64(new Uint8Array(await object.arrayBuffer())) };
  }));
  const bundle = {
    exportedAt: new Date().toISOString(),
    schemaVersion: BACKUP_SCHEMA_VERSION,
    ...portableData,
    householdMembers: householdMembers.results,
    lightingPlanSheets: lightingPlanSheets.filter(Boolean),
  };
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const lines = ["record_type,data_json", ...Object.entries(bundle).flatMap(([kind, rows]) => kind !== "lightingPlanSheets" && kind !== "animalPhotos" && Array.isArray(rows) ? rows.map((row) => `${csvCell(kind)},${csvCell(JSON.stringify(row))}`) : [])];
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.csv" } });
  }
  return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.json" } });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
