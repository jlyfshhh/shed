import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone, isIsoDate } from "@/lib/date";
import { requireHouseholdMember } from "@/lib/household-auth";
import { normalizedEmptyValue } from "@/lib/manage-values";

type Resource = "animal" | "enclosure" | "schedule" | "note" | "equipment" | "weight" | "event" | "feeder";
type Payload = { resource?: Resource; id?: string; data?: Record<string, unknown>; reason?: string };
type Field = { column: string; kind?: "text" | "number" | "boolean" | "date" };
type Config = { table: string; fields: Record<string, Field>; required: string[]; softDelete?: boolean };

const configs: Record<Resource, Config> = {
  animal: { table: "animals", required: ["name", "species"], softDelete: true, fields: {
    name: { column: "name" }, species: { column: "species" }, group: { column: "group_name" }, location: { column: "location" },
    scientificName: { column: "scientific_name" }, morph: { column: "morph" }, sex: { column: "sex" }, birthDate: { column: "birth_date", kind: "date" },
    acquiredDate: { column: "acquired_date", kind: "date" }, source: { column: "source" }, notes: { column: "notes" }, active: { column: "active", kind: "boolean" },
    enclosureId: { column: "enclosure_id" }, updatedAt: { column: "updated_at" }, createdAt: { column: "created_at" },
  } },
  enclosure: { table: "enclosures", required: ["name"], softDelete: true, fields: {
    name: { column: "name" }, enclosureType: { column: "enclosure_type" }, manufacturer: { column: "manufacturer" }, model: { column: "model" },
    width: { column: "width", kind: "number" }, depth: { column: "depth", kind: "number" }, height: { column: "height", kind: "number" }, dimensionUnit: { column: "dimension_unit" },
    location: { column: "location" }, substrate: { column: "substrate" }, bioactive: { column: "bioactive", kind: "boolean" }, sharedHabitatId: { column: "shared_habitat_id" },
    notes: { column: "notes" }, active: { column: "active", kind: "boolean" }, createdAt: { column: "created_at" }, updatedAt: { column: "updated_at" },
  } },
  schedule: { table: "care_schedules", required: ["animalId", "taskType", "title", "frequency", "startDate"], softDelete: true, fields: {
    animalId: { column: "animal_id" }, taskType: { column: "task_type" }, title: { column: "title" }, details: { column: "details" }, frequency: { column: "frequency" },
    intervalDays: { column: "interval_days", kind: "number" }, weekdaysJson: { column: "weekdays_json" }, dayOfMonth: { column: "day_of_month", kind: "number" },
    startDate: { column: "start_date", kind: "date" }, endDate: { column: "end_date", kind: "date" }, active: { column: "active", kind: "boolean" }, createdAt: { column: "created_at" }, updatedAt: { column: "updated_at" },
    preySpecies: { column: "prey_species" }, preyDescription: { column: "prey_description" }, preySizeClass: { column: "prey_size_class" }, targetPercent: { column: "target_percent", kind: "number" },
    minimumPercent: { column: "minimum_percent", kind: "number" }, maximumPercent: { column: "maximum_percent", kind: "number" }, buyAsNeeded: { column: "buy_as_needed", kind: "boolean" },
    rewardCents: { column: "reward_cents", kind: "number" },
  } },
  note: { table: "animal_notes", required: ["title", "body"], fields: {
    animalId: { column: "animal_id" }, enclosureId: { column: "enclosure_id" }, category: { column: "category" }, title: { column: "title" }, body: { column: "body" },
    pinned: { column: "pinned", kind: "boolean" }, createdAt: { column: "created_at" }, updatedAt: { column: "updated_at" }, createdByMemberId: { column: "created_by_member_id" }, createdByName: { column: "created_by_name" },
  } },
  equipment: { table: "equipment", required: ["name"], softDelete: true, fields: {
    animalId: { column: "animal_id" }, enclosureId: { column: "enclosure_id" }, category: { column: "category" }, name: { column: "name" }, brand: { column: "brand" }, model: { column: "model" },
    installedOn: { column: "installed_on", kind: "date" }, replaceOn: { column: "replace_on", kind: "date" }, active: { column: "active", kind: "boolean" }, notes: { column: "notes" },
    createdAt: { column: "created_at" }, updatedAt: { column: "updated_at" },
  } },
  weight: { table: "weight_events", required: ["animalId", "recordedOn", "weightGrams"], fields: {
    animalId: { column: "animal_id" }, recordedOn: { column: "recorded_on", kind: "date" }, weightGrams: { column: "weight_grams", kind: "number" }, notes: { column: "notes" },
    recordedByMemberId: { column: "recorded_by_member_id" }, recordedByName: { column: "recorded_by_name" }, createdAt: { column: "created_at" },
  } },
  event: { table: "husbandry_events", required: ["animalId", "taskType", "title", "occurredAt"], fields: {
    animalId: { column: "animal_id" }, taskType: { column: "task_type" }, title: { column: "title" }, notes: { column: "notes" }, dueDate: { column: "due_date", kind: "date" },
    occurredAt: { column: "occurred_at" }, actorRole: { column: "actor_role" }, completedByMemberId: { column: "completed_by_member_id" }, completedByName: { column: "completed_by_name" },
    editedAt: { column: "edited_at" }, editedByMemberId: { column: "edited_by_member_id" }, editedByName: { column: "edited_by_name" },
  } },
  feeder: { table: "feeder_inventory", required: ["preySpecies", "sizeClass", "weightGrams", "addedOn"], fields: {
    preySpecies: { column: "prey_species" }, sizeClass: { column: "size_class" }, weightGrams: { column: "weight_grams", kind: "number" }, status: { column: "status" },
    addedOn: { column: "added_on", kind: "date" }, notes: { column: "notes" },
  } },
};

export async function GET(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const [animals, enclosures, schedules, notes, equipment, weights, events, feeders] = await Promise.all([
      db.prepare("SELECT * FROM animals ORDER BY active DESC, name").all(), db.prepare("SELECT * FROM enclosures ORDER BY active DESC, name").all(),
      db.prepare("SELECT * FROM care_schedules ORDER BY active DESC, title").all(), db.prepare("SELECT * FROM animal_notes ORDER BY pinned DESC, updated_at DESC").all(),
      db.prepare("SELECT * FROM equipment ORDER BY active DESC, name").all(), db.prepare("SELECT * FROM weight_events ORDER BY recorded_on DESC").all(),
      db.prepare("SELECT * FROM husbandry_events ORDER BY occurred_at DESC LIMIT 500").all(), db.prepare("SELECT * FROM feeder_inventory ORDER BY status, prey_species, size_class, weight_grams").all(),
    ]);
    return Response.json({ animals: animals.results, enclosures: enclosures.results, schedules: schedules.results, notes: notes.results, equipment: equipment.results, weights: weights.results, events: events.results, feeders: feeders.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as Payload;
    const resource = requireResource(payload.resource);
    const data = { ...(payload.data ?? {}) };
    const now = new Date().toISOString();
    applyCreateDefaults(resource, data, now, auth.member!.id, auth.member!.displayName);
    const normalized = normalize(resource, data, true);
    const id = cleanId(payload.id) ?? crypto.randomUUID();
    const columns = ["id", ...Object.keys(normalized).map((key) => configs[resource].fields[key].column)];
    const values = [id, ...Object.values(normalized)];
    await db.prepare(`INSERT INTO ${configs[resource].table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).bind(...values).run();
    if (resource === "weight") await refreshAnimalWeight(db, String(normalized.animalId));
    return Response.json({ saved: true, id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as Payload;
    const resource = requireResource(payload.resource);
    const id = requireId(payload.id);
    const existing = await db.prepare(`SELECT * FROM ${configs[resource].table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!existing) return Response.json({ error: "Record not found" }, { status: 404 });
    const data = { ...(payload.data ?? {}) };
    const now = new Date().toISOString();
    if (["animal", "enclosure", "schedule", "note", "equipment"].includes(resource)) data.updatedAt = now;
    if (resource === "event") {
      await db.prepare("INSERT INTO husbandry_event_revisions (id, event_id, changed_at, changed_by_member_id, changed_by_name, previous_json) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, now, auth.member!.id, auth.member!.displayName, JSON.stringify(existing)).run();
      Object.assign(data, { editedAt: now, editedByMemberId: auth.member!.id, editedByName: auth.member!.displayName });
    }
    const normalized = normalize(resource, data, false);
    if (!Object.keys(normalized).length) return Response.json({ error: "No editable fields supplied" }, { status: 400 });
    const assignments = Object.keys(normalized).map((key) => `${configs[resource].fields[key].column} = ?`);
    await db.prepare(`UPDATE ${configs[resource].table} SET ${assignments.join(", ")} WHERE id = ?`).bind(...Object.values(normalized), id).run();
    if (resource === "schedule") await db.prepare("DELETE FROM care_tasks WHERE schedule_id = ? AND due_date >= ? AND id NOT IN (SELECT task_id FROM husbandry_events WHERE task_id IS NOT NULL)").bind(id, dateInTimeZone()).run();
    if (resource === "weight") await refreshAnimalWeight(db, String(normalized.animalId ?? existing.animal_id));
    if (resource === "feeder" && normalized.status === "available") {
      await db.batch([
        db.prepare("UPDATE feeder_inventory SET consumed_at = NULL, animal_id = NULL, husbandry_event_id = NULL WHERE id = ?").bind(id),
        db.prepare("UPDATE feeding_assignments SET status = 'released' WHERE feeder_id = ? AND status = 'consumed'").bind(id),
      ]);
    }
    return Response.json({ saved: true, id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as Payload;
    const resource = requireResource(payload.resource);
    const id = requireId(payload.id);
    if (resource === "event") {
      await db.prepare("UPDATE husbandry_events SET voided_at = ?, voided_by_member_id = ?, voided_by_name = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL")
        .bind(new Date().toISOString(), auth.member!.id, auth.member!.displayName, cleanText(payload.reason, 500) ?? "Voided by the Head Keeper.", id).run();
    } else if (configs[resource].softDelete) {
      await db.prepare(`UPDATE ${configs[resource].table} SET active = 0 WHERE id = ?`).bind(id).run();
      if (resource === "schedule") await db.prepare("DELETE FROM care_tasks WHERE schedule_id = ? AND due_date >= ? AND id NOT IN (SELECT task_id FROM husbandry_events WHERE task_id IS NOT NULL)").bind(id, dateInTimeZone()).run();
    } else {
      const existing = await db.prepare(`SELECT * FROM ${configs[resource].table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
      await db.prepare(`DELETE FROM ${configs[resource].table} WHERE id = ?`).bind(id).run();
      if (resource === "weight" && existing) await refreshAnimalWeight(db, String(existing.animal_id));
    }
    return Response.json({ saved: true, id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

function applyCreateDefaults(resource: Resource, data: Record<string, unknown>, now: string, memberId: string, memberName: string) {
  if (resource === "animal") Object.assign(data, { group: data.group ?? "Reptile", location: data.location ?? "", active: true, createdAt: now, updatedAt: now });
  if (resource === "enclosure") Object.assign(data, { dimensionUnit: data.dimensionUnit ?? "in", bioactive: data.bioactive ?? false, active: true, createdAt: now, updatedAt: now });
  if (resource === "schedule") Object.assign(data, { details: data.details ?? "", active: true, createdAt: now, updatedAt: now });
  if (resource === "note") Object.assign(data, { category: data.category ?? "general", pinned: data.pinned ?? false, createdAt: now, updatedAt: now, createdByMemberId: memberId, createdByName: memberName });
  if (resource === "equipment") Object.assign(data, { category: data.category ?? "other", active: true, createdAt: now, updatedAt: now });
  if (resource === "weight") Object.assign(data, { recordedByMemberId: memberId, recordedByName: memberName, createdAt: now });
  if (resource === "event") Object.assign(data, { occurredAt: data.occurredAt ?? now, actorRole: "Owner", completedByMemberId: memberId, completedByName: memberName });
  if (resource === "feeder") Object.assign(data, { status: data.status ?? "available", addedOn: data.addedOn ?? dateInTimeZone() });
}

function normalize(resource: Resource, data: Record<string, unknown>, creating: boolean) {
  const config = configs[resource];
  if (creating) for (const key of config.required) if (data[key] === undefined || data[key] === null || data[key] === "") throw new Error(`${key} is required`);
  const output: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(data)) {
    const field = config.fields[key]; if (!field) continue;
    if (value === null || value === "") { output[key] = normalizedEmptyValue(resource, key); continue; }
    if (field.kind === "boolean") output[key] = value ? 1 : 0;
    else if (field.kind === "number") { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${key} must be a positive number`); output[key] = number; }
    else if (field.kind === "date") { const text = String(value); if (!isIsoDate(text)) throw new Error(`${key} must use YYYY-MM-DD`); output[key] = text; }
    else output[key] = cleanText(value, key === "notes" || key === "body" || key === "details" ? 5000 : 200) ?? "";
  }
  if (resource === "schedule") validateSchedule(output);
  return output;
}

function validateSchedule(data: Record<string, string | number | null>) {
  const frequency = data.frequency;
  if (frequency && !["daily", "weekly", "interval", "monthly", "once"].includes(String(frequency))) throw new Error("Unsupported schedule frequency");
  if (frequency === "interval" && Number(data.intervalDays ?? 0) < 1) throw new Error("Interval schedules need intervalDays");
  if (frequency === "monthly" && (Number(data.dayOfMonth) < 1 || Number(data.dayOfMonth) > 31)) throw new Error("Monthly schedules need a day from 1–31");
  if (data.weekdaysJson) { const parsed = JSON.parse(String(data.weekdaysJson)); if (!Array.isArray(parsed) || parsed.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("weekdaysJson must contain weekday numbers 0–6"); }
  for (const key of ["targetPercent", "minimumPercent", "maximumPercent"]) if (data[key] !== undefined && data[key] !== null && Number(data[key]) > 1) throw new Error(`${key} must be a decimal from 0 to 1`);
}

async function refreshAnimalWeight(db: D1Database, animalId: string) {
  const latest = await db.prepare("SELECT weight_grams AS weightGrams, recorded_on AS recordedOn FROM weight_events WHERE animal_id = ? ORDER BY recorded_on DESC, rowid DESC LIMIT 1").bind(animalId).first<{ weightGrams: number; recordedOn: string }>();
  await db.prepare("UPDATE animals SET weight_grams = ?, weight_date = ?, updated_at = ? WHERE id = ?").bind(latest?.weightGrams ?? null, latest?.recordedOn ?? null, new Date().toISOString(), animalId).run();
}

function requireResource(value: Resource | undefined): Resource { if (!value || !configs[value]) throw new Error("A supported resource is required"); return value; }
function requireId(value: string | undefined) { const id = cleanId(value); if (!id) throw new Error("A valid record id is required"); return id; }
function cleanId(value: unknown) { const text = typeof value === "string" ? value.trim() : ""; return /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(text) ? text : null; }
function cleanText(value: unknown, max: number) { if (value === undefined || value === null) return null; const text = String(value).trim(); return text ? text.slice(0, max) : null; }
function failure(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update Shed" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
