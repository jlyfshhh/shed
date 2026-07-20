import { ensureDatabase } from "@/db/runtime";
import { requireHouseholdMember } from "@/lib/household-auth";

const resources = {
  animals: ["animals", ["id", "name", "species", "group_name", "location", "weight_grams", "weight_date", "scientific_name", "morph", "sex", "birth_date", "acquired_date", "source", "notes", "active", "enclosure_id", "created_at", "updated_at"]],
  enclosures: ["enclosures", ["id", "name", "enclosure_type", "manufacturer", "model", "width", "depth", "height", "dimension_unit", "location", "substrate", "bioactive", "shared_habitat_id", "notes", "active", "created_at", "updated_at"]],
  careSchedules: ["care_schedules", ["id", "animal_id", "task_type", "title", "details", "frequency", "interval_days", "weekdays_json", "day_of_month", "start_date", "end_date", "active", "created_at", "updated_at", "prey_species", "prey_description", "target_percent", "minimum_percent", "maximum_percent", "buy_as_needed"]],
  careTasks: ["care_tasks", ["id", "schedule_id", "animal_id", "task_type", "title", "details", "due_date"]],
  husbandryEvents: ["husbandry_events", ["id", "task_id", "animal_id", "task_type", "title", "notes", "due_date", "occurred_at", "actor_role", "completed_by_member_id", "completed_by_name", "voided_at", "voided_by_member_id", "voided_by_name", "void_reason", "edited_at", "edited_by_member_id", "edited_by_name"]],
  husbandryEventRevisions: ["husbandry_event_revisions", ["id", "event_id", "changed_at", "changed_by_member_id", "changed_by_name", "previous_json"]],
  animalNotes: ["animal_notes", ["id", "animal_id", "enclosure_id", "category", "title", "body", "pinned", "created_at", "updated_at", "created_by_member_id", "created_by_name"]],
  equipment: ["equipment", ["id", "animal_id", "enclosure_id", "category", "name", "brand", "model", "installed_on", "replace_on", "active", "notes", "created_at", "updated_at"]],
  weightEvents: ["weight_events", ["id", "animal_id", "recorded_on", "weight_grams", "notes", "recorded_by_member_id", "recorded_by_name", "created_at"]],
  feederInventory: ["feeder_inventory", ["id", "prey_species", "size_class", "weight_grams", "status", "added_on", "consumed_at", "animal_id", "husbandry_event_id", "notes"]],
  feedingAssignments: ["feeding_assignments", ["id", "animal_id", "feeder_id", "planned_for", "status", "created_at", "consumed_at", "husbandry_event_id"]],
} as const;

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as { mode?: "merge" | "replace"; confirmation?: string; bundle?: Record<string, unknown> };
    const bundle = payload.bundle;
    if (!bundle || Number(bundle.schemaVersion) < 8) return Response.json({ error: "A Shed schema version 8+ JSON export is required" }, { status: 400 });
    if (payload.mode === "replace" && payload.confirmation !== "REPLACE") return Response.json({ error: "Type REPLACE to confirm a full data restore" }, { status: 400 });

    if (payload.mode === "replace") {
      const deleteOrder = ["feeding_assignments", "feeder_inventory", "husbandry_event_revisions", "husbandry_events", "care_tasks", "care_schedules", "weight_events", "animal_notes", "equipment", "animals", "enclosures"];
      await db.batch(deleteOrder.map((table) => db.prepare(`DELETE FROM ${table}`)));
    }

    let imported = 0;
    for (const [bundleKey, [table, columns]] of Object.entries(resources) as Array<[keyof typeof resources, readonly [string, readonly string[]]]>) {
      const rows = Array.isArray(bundle[bundleKey]) ? bundle[bundleKey] as Array<Record<string, unknown>> : [];
      const statements = rows.map((row) => {
        const present = columns.filter((column) => Object.hasOwn(row, column));
        if (!present.includes("id")) throw new Error(`${bundleKey} contains a row without an id`);
        return db.prepare(`INSERT OR REPLACE INTO ${table} (${present.join(", ")}) VALUES (${present.map(() => "?").join(", ")})`).bind(...present.map((column) => row[column] ?? null));
      });
      for (let offset = 0; offset < statements.length; offset += 100) await db.batch(statements.slice(offset, offset + 100));
      imported += statements.length;
    }
    return Response.json({ saved: true, imported, mode: payload.mode ?? "merge" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import the backup" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
