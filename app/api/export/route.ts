import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest } from "@/lib/household-auth";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const member = await memberFromRequest(request, db);
  if (householdAuthRequired() && member?.role !== "Owner") {
    return Response.json({ error: member ? "Owner access required" : "Sign in to Shed first" }, { status: member ? 403 : 401 });
  }
  const [animals, careTasks, events, weights, feederInventory, feedingAssignments, householdMembers] = await Promise.all([
    db.prepare("SELECT * FROM animals ORDER BY id").all(),
    db.prepare("SELECT * FROM care_tasks ORDER BY id").all(),
    db.prepare("SELECT * FROM husbandry_events ORDER BY occurred_at").all(),
    db.prepare("SELECT * FROM weight_events ORDER BY animal_id, recorded_on").all(),
    db.prepare("SELECT * FROM feeder_inventory ORDER BY prey_species, size_class, weight_grams, id").all(),
    db.prepare("SELECT * FROM feeding_assignments ORDER BY planned_for, animal_id").all(),
    db.prepare("SELECT id, display_name, role, active, created_at, updated_at, last_login_at FROM household_members ORDER BY display_name").all(),
  ]);
  const bundle = { exportedAt: new Date().toISOString(), schemaVersion: 7, animals: animals.results, careTasks: careTasks.results, husbandryEvents: events.results, weightEvents: weights.results, feederInventory: feederInventory.results, feedingAssignments: feedingAssignments.results, householdMembers: householdMembers.results };
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const lines = ["record_type,data_json", ...Object.entries(bundle).flatMap(([kind, rows]) => Array.isArray(rows) ? rows.map((row) => `${csvCell(kind)},${csvCell(JSON.stringify(row))}`) : [])];
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.csv" } });
  }
  return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.json" } });
}
