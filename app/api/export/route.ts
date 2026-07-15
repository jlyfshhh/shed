import { ensureDatabase } from "@/db/runtime";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const db = await ensureDatabase();
  const [animals, careTasks, events, weights] = await Promise.all([
    db.prepare("SELECT * FROM animals ORDER BY id").all(),
    db.prepare("SELECT * FROM care_tasks ORDER BY id").all(),
    db.prepare("SELECT * FROM husbandry_events ORDER BY occurred_at").all(),
    db.prepare("SELECT * FROM weight_events ORDER BY animal_id, recorded_on").all(),
  ]);
  const bundle = { exportedAt: new Date().toISOString(), schemaVersion: 1, animals: animals.results, careTasks: careTasks.results, husbandryEvents: events.results, weightEvents: weights.results };
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const lines = ["record_type,data_json", ...Object.entries(bundle).flatMap(([kind, rows]) => Array.isArray(rows) ? rows.map((row) => `${csvCell(kind)},${csvCell(JSON.stringify(row))}`) : [])];
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.csv" } });
  }
  return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=animal-room-export.json" } });
}
