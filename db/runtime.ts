import { env } from "cloudflare:workers";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/date";
import { careLookbackDates } from "@/lib/care-schedule";
import { getCareStartDate } from "@/lib/care-settings";
import { scheduleIsDue, type CareScheduleRow } from "@/lib/schedules";
import { careTaskId, scheduleAnimalIds } from "@/lib/care-group";
import { normalizeLegacyTaskDispositions } from "@/lib/task-dispositions";

// Every API call used to run the whole of this: create-table statements for
// every table, a PRAGMA introspection per table to add missing columns, a scan
// of every active schedule, and an insert attempt for every task in a 14-day
// window. Today polls every fifteen seconds, so a quiet household was doing all
// of that four times a minute forever.
//
// Schema work now happens once per process. Task materialization happens once
// per process *per date*, so it still runs when the day rolls over or a new
// worker starts, which is what actually needs to trigger it.
//
// Both guards are per-isolate rather than global. A second worker repeating the
// work is harmless: the schema statements are CREATE TABLE IF NOT EXISTS and
// the task inserts are INSERT OR IGNORE, so the operations are idempotent by
// construction. This trades a little duplicate work at startup for not needing
// a distributed lock.
let schemaReady: Promise<void> | null = null;
let materializedFor: string | null = null;
let materializing: Promise<void> | null = null;

/**
 * Call after anything that changes which tasks should exist — creating,
 * editing, or deactivating a care plan. Without this a new plan produces no
 * tasks until the date rolls over, which looks exactly like the plan not
 * working.
 */
export function invalidateMaterializedTasks() {
  materializedFor = null;
}

/** Only for tests: forget what this process thinks it has already done. */
export function resetRuntimeCaches() {
  schemaReady = null;
  materializedFor = null;
  materializing = null;
}

export async function ensureDatabase(targetDate?: string) {
  const db = env.DB;
  const timeZone = typeof env.SHED_TIME_ZONE === "string" ? env.SHED_TIME_ZONE : DEFAULT_TIME_ZONE;
  const today = targetDate ?? dateInTimeZone(timeZone);

  schemaReady ??= applySchema(db);
  try {
    await schemaReady;
  } catch (error) {
    // A failed attempt must not be cached, or every later request in this
    // isolate inherits the failure with no way to recover.
    schemaReady = null;
    throw error;
  }

  if (materializedFor !== today) {
    materializing ??= materializeTasks(db, today);
    try {
      await materializing;
      materializedFor = today;
    } finally {
      materializing = null;
    }
  }

  return db;
}

async function applySchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS animals (id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT 'Reptile', location TEXT NOT NULL DEFAULT '', weight_grams INTEGER, weight_date TEXT, scientific_name TEXT, morph TEXT, sex TEXT, birth_date TEXT, acquired_date TEXT, source TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, enclosure_id TEXT, created_at TEXT, updated_at TEXT, earning_enabled INTEGER NOT NULL DEFAULT 1)"),
    db.prepare("CREATE TABLE IF NOT EXISTS enclosures (id TEXT PRIMARY KEY, name TEXT NOT NULL, enclosure_type TEXT, manufacturer TEXT, model TEXT, width REAL, depth REAL, height REAL, dimension_unit TEXT NOT NULL DEFAULT 'in', location TEXT, substrate TEXT, bioactive INTEGER NOT NULL DEFAULT 0, shared_habitat_id TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS enclosures_active_name_idx ON enclosures(active, name)"),
    db.prepare("CREATE TABLE IF NOT EXISTS care_schedules (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, task_type TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL, interval_days INTEGER, weekdays_json TEXT, day_of_month INTEGER, start_date TEXT NOT NULL, end_date TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, prey_species TEXT, prey_description TEXT, prey_size_class TEXT, target_percent REAL, minimum_percent REAL, maximum_percent REAL, buy_as_needed INTEGER NOT NULL DEFAULT 0, reward_cents INTEGER, animal_ids_json TEXT, week_interval INTEGER NOT NULL DEFAULT 1)"),
    db.prepare("CREATE INDEX IF NOT EXISTS care_schedules_active_animal_idx ON care_schedules(active, animal_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS care_tasks (id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, details TEXT NOT NULL, due_date TEXT NOT NULL, missed_at TEXT, missed_by_member_id TEXT, missed_by_name TEXT, skipped_at TEXT, skipped_by_member_id TEXT, skipped_by_name TEXT, skip_reason TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS care_tasks_due_idx ON care_tasks(due_date, animal_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, animal_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, notes TEXT, due_date TEXT, occurred_at TEXT NOT NULL, actor_role TEXT NOT NULL, completed_by_member_id TEXT, completed_by_name TEXT, voided_at TEXT, voided_by_member_id TEXT, voided_by_name TEXT, void_reason TEXT, edited_at TEXT, edited_by_member_id TEXT, edited_by_name TEXT, reward_cents INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL DEFAULT 'done')"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS event_task_due_unique ON husbandry_events(task_id, due_date)"),
    db.prepare("CREATE TABLE IF NOT EXISTS husbandry_event_revisions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by_member_id TEXT NOT NULL, changed_by_name TEXT NOT NULL, previous_json TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS husbandry_event_revisions_event_idx ON husbandry_event_revisions(event_id, changed_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS animal_notes (id TEXT PRIMARY KEY, animal_id TEXT, enclosure_id TEXT, category TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by_member_id TEXT, created_by_name TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS animal_notes_animal_idx ON animal_notes(animal_id, updated_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS equipment (id TEXT PRIMARY KEY, animal_id TEXT, enclosure_id TEXT, category TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL, brand TEXT, model TEXT, installed_on TEXT, replace_on TEXT, source_name TEXT, source_ref TEXT, active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS equipment_animal_active_idx ON equipment(animal_id, active)"),
    db.prepare("CREATE TABLE IF NOT EXISTS lighting_plans (id TEXT PRIMARY KEY, enclosure_id TEXT NOT NULL, name TEXT NOT NULL, species TEXT, source_name TEXT NOT NULL DEFAULT 'Light My Reptile', source_url TEXT NOT NULL DEFAULT 'https://lightmyreptile.com/', source_version TEXT, planned_on TEXT NOT NULL, reviewed_on TEXT, mounting_mode TEXT, mesh_loss_percent REAL, basking_height REAL, height_unit TEXT NOT NULL DEFAULT 'cm', target_uvi_min REAL, target_uvi_max REAL, target_lux_min REAL, target_lux_max REAL, target_power_density_min REAL, target_power_density_max REAL, plan_sheet_key TEXT, plan_sheet_name TEXT, plan_sheet_type TEXT, source_snapshot_json TEXT, import_status TEXT, imported_at TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS lighting_plans_enclosure_active_idx ON lighting_plans(enclosure_id, active)"),
    db.prepare("CREATE TABLE IF NOT EXISTS lighting_plan_fixtures (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, equipment_id TEXT NOT NULL, role TEXT NOT NULL, position_cm REAL, mounting_height_cm REAL, quantity INTEGER NOT NULL DEFAULT 1, source_ref TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS lighting_plan_fixtures_plan_equipment_unique ON lighting_plan_fixtures(plan_id, equipment_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS lighting_plan_fixtures_plan_idx ON lighting_plan_fixtures(plan_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS lighting_measurements (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, measured_at TEXT NOT NULL, position TEXT, height REAL, height_unit TEXT NOT NULL DEFAULT 'cm', instrument TEXT, notes TEXT, measured_by_member_id TEXT, measured_by_name TEXT, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS lighting_measurements_plan_metric_date_idx ON lighting_measurements(plan_id, metric, measured_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS household_members (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL, access_code_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, earning_enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS household_members_access_code_hash_unique ON household_members(access_code_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS household_members_active_role_idx ON household_members(active, role)"),
    // One portrait per animal, stored base64 in the row. Photos are downscaled
    // in the browser before upload, so these stay tens of KB, not megabytes.
    db.prepare("CREATE TABLE IF NOT EXISTS animal_photos (animal_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, byte_size INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by_member_id TEXT, updated_by_name TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS reward_payouts (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT, paid_at TEXT NOT NULL, paid_by_member_id TEXT, paid_by_name TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS reward_payouts_member_idx ON reward_payouts(member_id, paid_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS weight_events (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, recorded_on TEXT NOT NULL, weight_grams INTEGER NOT NULL, notes TEXT, recorded_by_member_id TEXT, recorded_by_name TEXT, created_at TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS weight_events_animal_date_idx ON weight_events(animal_id, recorded_on)"),
    // A shed is noticed rather than scheduled, so it is its own record instead
    // of a care task. Quality is the part worth keeping: a run of patchy or
    // stuck sheds is usually the first sign humidity has drifted.
    db.prepare("CREATE TABLE IF NOT EXISTS shed_events (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, recorded_on TEXT NOT NULL, quality TEXT NOT NULL DEFAULT 'complete', notes TEXT, recorded_by_member_id TEXT, recorded_by_name TEXT, created_at TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS shed_events_animal_date_idx ON shed_events(animal_id, recorded_on)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feeder_inventory (id TEXT PRIMARY KEY, prey_species TEXT NOT NULL, size_class TEXT NOT NULL, weight_grams INTEGER, status TEXT NOT NULL DEFAULT 'available', added_on TEXT NOT NULL, consumed_at TEXT, animal_id TEXT, husbandry_event_id TEXT, notes TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_status_idx ON feeder_inventory(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_size_weight_idx ON feeder_inventory(prey_species, size_class, weight_grams)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feeding_assignments (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, feeder_id TEXT NOT NULL, planned_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, consumed_at TEXT, husbandry_event_id TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeding_assignments_animal_date_idx ON feeding_assignments(animal_id, planned_for)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeding_assignments_feeder_idx ON feeding_assignments(feeder_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS feeding_assignments_consumed_feeder_unique ON feeding_assignments(feeder_id) WHERE status = 'consumed'"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS feeding_assignments_consumed_event_unique ON feeding_assignments(husbandry_event_id) WHERE status = 'consumed'"),
  ]);

  await addMissingColumns(db, "animals", [
    ["scientific_name", "TEXT"], ["morph", "TEXT"], ["sex", "TEXT"], ["birth_date", "TEXT"],
    ["acquired_date", "TEXT"], ["source", "TEXT"], ["notes", "TEXT"], ["active", "INTEGER NOT NULL DEFAULT 1"],
    ["enclosure_id", "TEXT"], ["created_at", "TEXT"], ["updated_at", "TEXT"],
    ["earning_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ]);
  await addMissingColumns(db, "care_tasks", [["task_type", "TEXT NOT NULL DEFAULT 'general'"], ["schedule_id", "TEXT"], ["missed_at", "TEXT"], ["missed_by_member_id", "TEXT"], ["missed_by_name", "TEXT"],
    // Skipped is a third disposition, not a flavour of missed. Missed means the
    // care should have happened and did not; skipped means the keeper judged it
    // did not need doing — a damp enclosure, or an animal being left alone to
    // settle. Only one of those is a lapse, so they must be distinguishable.
    ["skipped_at", "TEXT"], ["skipped_by_member_id", "TEXT"], ["skipped_by_name", "TEXT"], ["skip_reason", "TEXT"]]);
  // A completion records what the keeper did; the outcome records what the
  // animal did. A refused meal is still husbandry performed — the rat was
  // thawed, offered, and wasted — but it is not a meal eaten, and for a snake
  // that distinction is the whole point of keeping records. The animal simply
  // waits for its next scheduled meal; a refusal does not move any dates.
  await addMissingColumns(db, "husbandry_events", [["outcome", "TEXT NOT NULL DEFAULT 'done'"]]);
  await addMissingColumns(db, "care_schedules", [["prey_species", "TEXT"], ["prey_description", "TEXT"], ["prey_size_class", "TEXT"], ["target_percent", "REAL"], ["minimum_percent", "REAL"], ["maximum_percent", "REAL"], ["buy_as_needed", "INTEGER NOT NULL DEFAULT 0"]]);
  await addMissingColumns(db, "husbandry_events", [
    ["task_type", "TEXT NOT NULL DEFAULT 'general'"], ["notes", "TEXT"], ["completed_by_member_id", "TEXT"],
    ["completed_by_name", "TEXT"], ["voided_at", "TEXT"], ["voided_by_member_id", "TEXT"],
    ["voided_by_name", "TEXT"], ["void_reason", "TEXT"], ["edited_at", "TEXT"],
    ["edited_by_member_id", "TEXT"], ["edited_by_name", "TEXT"],
  ]);
  await addMissingColumns(db, "weight_events", [
    ["notes", "TEXT"], ["recorded_by_member_id", "TEXT"], ["recorded_by_name", "TEXT"], ["created_at", "TEXT"],
  ]);
  await addMissingColumns(db, "equipment", [["source_name", "TEXT"], ["source_ref", "TEXT"]]);
  await addMissingColumns(db, "lighting_plans", [["source_snapshot_json", "TEXT"], ["import_status", "TEXT"], ["imported_at", "TEXT"]]);
  await addMissingColumns(db, "lighting_plan_fixtures", [["source_ref", "TEXT"]]);
  // Task earnings ("allowance") — added by Claude 2026-07-21 while Codex was out.
  await addMissingColumns(db, "household_members", [["earning_enabled", "INTEGER NOT NULL DEFAULT 0"]]);
  await addMissingColumns(db, "care_schedules", [["reward_cents", "INTEGER"]]);
  await addMissingColumns(db, "husbandry_events", [["reward_cents", "INTEGER NOT NULL DEFAULT 0"]]);
  // Completing an overdue task can file the care on its due date, so occurred_at
  // is no longer necessarily the moment the entry was made. Keep that instant.
  // Nullable on purpose: rows written before this column existed genuinely do
  // not know, and a backfilled guess would be indistinguishable from a fact.
  await addMissingColumns(db, "husbandry_events", [["recorded_at", "TEXT"]]);
  // Weekend chores sit on Saturday only because a schedule needs a day. Zero
  // keeps every existing plan exactly as strict as it is today.
  // A plan covering several animals lists them here; null means the one animal
  // in animal_id, which is every plan that existed before grouping.
  await addMissingColumns(db, "care_schedules", [["grace_days", "INTEGER NOT NULL DEFAULT 0"], ["animal_ids_json", "TEXT"], ["week_interval", "INTEGER NOT NULL DEFAULT 1"]]);
  await relaxFeederWeight(db);
  await normalizeLegacyTaskDispositions(db);
  await db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_reward_cents', '25')").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS animals_active_name_idx ON animals(active, name)").run();

  return;
}

async function materializeTasks(db: D1Database, today: string) {
  const schedules = await db.prepare(
    "SELECT id, animal_id AS animalId, animal_ids_json AS animalIdsJson, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, week_interval AS weekInterval, start_date AS startDate, end_date AS endDate FROM care_schedules WHERE active = 1",
  ).all<CareScheduleRow & { animalIdsJson: string | null }>();
  // Materialize tasks for a lookback window (not just yesterday+today) so that
  // care missed a few days ago still shows up as an actionable overdue task —
  // but never before the "start fresh" baseline, if one has been set.
  const careStartDate = await getCareStartDate(db);
  const dates = careLookbackDates(today, careStartDate);
  // One task per animal on the plan. They collapse into a single line on Today,
  // but stay separate rows so that history, weights and feeder consumption
  // remain per-animal.
  const taskStatements = schedules.results.flatMap((schedule) =>
    dates.filter((date) => scheduleIsDue(schedule, date)).flatMap((date) =>
      scheduleAnimalIds(schedule).map((animalId) =>
        db.prepare("INSERT OR IGNORE INTO care_tasks (id, schedule_id, animal_id, task_type, title, details, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(careTaskId(schedule.id, animalId, schedule.animalId, date), schedule.id, animalId, schedule.taskType, schedule.title, schedule.details, date),
      ),
    ),
  );
  if (taskStatements.length) await db.batch(taskStatements);
}

/**
 * Feeders are counted by size class now, so new rows carry no weight — but
 * databases created before that still declare `weight_grams INTEGER NOT NULL`,
 * and SQLite cannot relax a column constraint in place. Rebuild the table once,
 * preserving every existing weight so old records keep their history.
 *
 * Guarded on the current constraint, so it runs at most once per database and
 * is a no-op everywhere else. D1 executes a batch transactionally, so the table
 * is never left dropped.
 */
async function relaxFeederWeight(db: D1Database) {
  const columns = await db.prepare("PRAGMA table_info(feeder_inventory)").all<{ name: string; notnull: number }>();
  const weight = columns.results.find((column) => column.name === "weight_grams");
  if (!weight || Number(weight.notnull) !== 1) return;
  await db.batch([
    db.prepare("CREATE TABLE feeder_inventory_rebuild (id TEXT PRIMARY KEY, prey_species TEXT NOT NULL, size_class TEXT NOT NULL, weight_grams INTEGER, status TEXT NOT NULL DEFAULT 'available', added_on TEXT NOT NULL, consumed_at TEXT, animal_id TEXT, husbandry_event_id TEXT, notes TEXT)"),
    db.prepare("INSERT INTO feeder_inventory_rebuild (id, prey_species, size_class, weight_grams, status, added_on, consumed_at, animal_id, husbandry_event_id, notes) SELECT id, prey_species, size_class, weight_grams, status, added_on, consumed_at, animal_id, husbandry_event_id, notes FROM feeder_inventory"),
    db.prepare("DROP TABLE feeder_inventory"),
    db.prepare("ALTER TABLE feeder_inventory_rebuild RENAME TO feeder_inventory"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_status_idx ON feeder_inventory(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_size_weight_idx ON feeder_inventory(prey_species, size_class, weight_grams)"),
  ]);
}

async function addMissingColumns(db: D1Database, table: string, columns: Array<[string, string]>) {
  const existing = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set(existing.results.map((column) => column.name));
  const statements = columns.filter(([name]) => !names.has(name)).map(([name, definition]) =>
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`),
  );
  if (statements.length) await db.batch(statements);
}
