import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";
import { BACKUP_SCHEMA_VERSION, PORTABLE_APP_SETTING_KEYS } from "@/lib/portable-backup";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const member = await memberFromRequest(request, db);
  if (householdAuthRequired() && member?.role !== "Owner") {
    return Response.json({ error: member ? "Owner access required" : "Sign in to Shed first" }, { status: member ? 403 : 401 });
  }
  const [animals, enclosures, careSchedules, careTasks, events, eventRevisions, notes, equipment, weights, feederInventory, feedingAssignments, householdMembers, appSettings, rewardPayouts] = await Promise.all([
    db.prepare("SELECT * FROM animals ORDER BY id").all(),
    db.prepare("SELECT * FROM enclosures ORDER BY id").all(),
    db.prepare("SELECT * FROM care_schedules ORDER BY id").all(),
    db.prepare("SELECT * FROM care_tasks ORDER BY id").all(),
    db.prepare("SELECT * FROM husbandry_events ORDER BY occurred_at").all(),
    db.prepare("SELECT * FROM husbandry_event_revisions ORDER BY changed_at").all(),
    db.prepare("SELECT * FROM animal_notes ORDER BY updated_at").all(),
    db.prepare("SELECT * FROM equipment ORDER BY id").all(),
    db.prepare("SELECT * FROM weight_events ORDER BY animal_id, recorded_on").all(),
    db.prepare("SELECT * FROM feeder_inventory ORDER BY prey_species, size_class, weight_grams, id").all(),
    db.prepare("SELECT * FROM feeding_assignments ORDER BY planned_for, animal_id").all(),
    db.prepare("SELECT id, display_name, role, active, earning_enabled, created_at, updated_at, last_login_at FROM household_members ORDER BY display_name").all(),
    db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${PORTABLE_APP_SETTING_KEYS.map(() => "?").join(", ")}) ORDER BY key`).bind(...PORTABLE_APP_SETTING_KEYS).all(),
    db.prepare("SELECT * FROM reward_payouts ORDER BY paid_at, id").all(),
  ]);
  const bundle = { exportedAt: new Date().toISOString(), schemaVersion: BACKUP_SCHEMA_VERSION, animals: animals.results, enclosures: enclosures.results, careSchedules: careSchedules.results, careTasks: careTasks.results, husbandryEvents: events.results, husbandryEventRevisions: eventRevisions.results, animalNotes: notes.results, equipment: equipment.results, weightEvents: weights.results, feederInventory: feederInventory.results, feedingAssignments: feedingAssignments.results, householdMembers: householdMembers.results, appSettings: appSettings.results, rewardPayouts: rewardPayouts.results };
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const lines = ["record_type,data_json", ...Object.entries(bundle).flatMap(([kind, rows]) => Array.isArray(rows) ? rows.map((row) => `${csvCell(kind)},${csvCell(JSON.stringify(row))}`) : [])];
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.csv" } });
  }
  return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.json" } });
}
