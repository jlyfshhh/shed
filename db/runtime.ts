import { env } from "cloudflare:workers";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/date";
import { careLookbackDates } from "@/lib/care-schedule";
import { getCareStartDate } from "@/lib/care-settings";
import { scheduleIsDue, type CareScheduleRow } from "@/lib/schedules";

export async function ensureDatabase(targetDate?: string) {
  const db = env.DB;
  const timeZone = typeof env.SHED_TIME_ZONE === "string" ? env.SHED_TIME_ZONE : DEFAULT_TIME_ZONE;
  const today = targetDate ?? dateInTimeZone(timeZone);

  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS animals (id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT 'Reptile', location TEXT NOT NULL DEFAULT '', weight_grams INTEGER, weight_date TEXT, scientific_name TEXT, morph TEXT, sex TEXT, birth_date TEXT, acquired_date TEXT, source TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, enclosure_id TEXT, created_at TEXT, updated_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS enclosures (id TEXT PRIMARY KEY, name TEXT NOT NULL, enclosure_type TEXT, manufacturer TEXT, model TEXT, width REAL, depth REAL, height REAL, dimension_unit TEXT NOT NULL DEFAULT 'in', location TEXT, substrate TEXT, bioactive INTEGER NOT NULL DEFAULT 0, shared_habitat_id TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS enclosures_active_name_idx ON enclosures(active, name)"),
    db.prepare("CREATE TABLE IF NOT EXISTS care_schedules (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, task_type TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL, interval_days INTEGER, weekdays_json TEXT, day_of_month INTEGER, start_date TEXT NOT NULL, end_date TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, prey_species TEXT, prey_description TEXT, prey_size_class TEXT, target_percent REAL, minimum_percent REAL, maximum_percent REAL, buy_as_needed INTEGER NOT NULL DEFAULT 0, reward_cents INTEGER)"),
    db.prepare("CREATE INDEX IF NOT EXISTS care_schedules_active_animal_idx ON care_schedules(active, animal_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS care_tasks (id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, details TEXT NOT NULL, due_date TEXT NOT NULL, missed_at TEXT, missed_by_member_id TEXT, missed_by_name TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS care_tasks_due_idx ON care_tasks(due_date, animal_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, animal_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, notes TEXT, due_date TEXT, occurred_at TEXT NOT NULL, actor_role TEXT NOT NULL, completed_by_member_id TEXT, completed_by_name TEXT, voided_at TEXT, voided_by_member_id TEXT, voided_by_name TEXT, void_reason TEXT, edited_at TEXT, edited_by_member_id TEXT, edited_by_name TEXT, reward_cents INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS event_task_due_unique ON husbandry_events(task_id, due_date)"),
    db.prepare("CREATE TABLE IF NOT EXISTS husbandry_event_revisions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by_member_id TEXT NOT NULL, changed_by_name TEXT NOT NULL, previous_json TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS husbandry_event_revisions_event_idx ON husbandry_event_revisions(event_id, changed_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS animal_notes (id TEXT PRIMARY KEY, animal_id TEXT, enclosure_id TEXT, category TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by_member_id TEXT, created_by_name TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS animal_notes_animal_idx ON animal_notes(animal_id, updated_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS equipment (id TEXT PRIMARY KEY, animal_id TEXT, enclosure_id TEXT, category TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL, brand TEXT, model TEXT, installed_on TEXT, replace_on TEXT, active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS equipment_animal_active_idx ON equipment(animal_id, active)"),
    db.prepare("CREATE TABLE IF NOT EXISTS household_members (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL, access_code_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, earning_enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS household_members_access_code_hash_unique ON household_members(access_code_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS household_members_active_role_idx ON household_members(active, role)"),
    db.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS reward_payouts (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT, paid_at TEXT NOT NULL, paid_by_member_id TEXT, paid_by_name TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS reward_payouts_member_idx ON reward_payouts(member_id, paid_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS weight_events (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, recorded_on TEXT NOT NULL, weight_grams INTEGER NOT NULL, notes TEXT, recorded_by_member_id TEXT, recorded_by_name TEXT, created_at TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS weight_events_animal_date_idx ON weight_events(animal_id, recorded_on)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feeder_inventory (id TEXT PRIMARY KEY, prey_species TEXT NOT NULL, size_class TEXT NOT NULL, weight_grams INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'available', added_on TEXT NOT NULL, consumed_at TEXT, animal_id TEXT, husbandry_event_id TEXT, notes TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_status_idx ON feeder_inventory(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_size_weight_idx ON feeder_inventory(prey_species, size_class, weight_grams)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feeding_assignments (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, feeder_id TEXT NOT NULL, planned_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, consumed_at TEXT, husbandry_event_id TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeding_assignments_animal_date_idx ON feeding_assignments(animal_id, planned_for)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeding_assignments_feeder_idx ON feeding_assignments(feeder_id)"),
  ]);

  await addMissingColumns(db, "animals", [
    ["scientific_name", "TEXT"], ["morph", "TEXT"], ["sex", "TEXT"], ["birth_date", "TEXT"],
    ["acquired_date", "TEXT"], ["source", "TEXT"], ["notes", "TEXT"], ["active", "INTEGER NOT NULL DEFAULT 1"],
    ["enclosure_id", "TEXT"], ["created_at", "TEXT"], ["updated_at", "TEXT"],
  ]);
  await addMissingColumns(db, "care_tasks", [["task_type", "TEXT NOT NULL DEFAULT 'general'"], ["schedule_id", "TEXT"], ["missed_at", "TEXT"], ["missed_by_member_id", "TEXT"], ["missed_by_name", "TEXT"]]);
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
  // Task earnings ("allowance") — added by Claude 2026-07-21 while Codex was out.
  await addMissingColumns(db, "household_members", [["earning_enabled", "INTEGER NOT NULL DEFAULT 0"]]);
  await addMissingColumns(db, "care_schedules", [["reward_cents", "INTEGER"]]);
  await addMissingColumns(db, "husbandry_events", [["reward_cents", "INTEGER NOT NULL DEFAULT 0"]]);
  await db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_reward_cents', '25')").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS animals_active_name_idx ON animals(active, name)").run();

  const schedules = await db.prepare(
    "SELECT id, animal_id AS animalId, task_type AS taskType, title, details, frequency, interval_days AS intervalDays, weekdays_json AS weekdaysJson, day_of_month AS dayOfMonth, start_date AS startDate, end_date AS endDate FROM care_schedules WHERE active = 1",
  ).all<CareScheduleRow>();
  // Materialize tasks for a lookback window (not just yesterday+today) so that
  // care missed a few days ago still shows up as an actionable overdue task —
  // but never before the "start fresh" baseline, if one has been set.
  const careStartDate = await getCareStartDate(db);
  const dates = careLookbackDates(today, careStartDate);
  const taskStatements = schedules.results.flatMap((schedule) => dates.filter((date) => scheduleIsDue(schedule, date)).map((date) =>
    db.prepare("INSERT OR IGNORE INTO care_tasks (id, schedule_id, animal_id, task_type, title, details, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`${schedule.id}:${date}`, schedule.id, schedule.animalId, schedule.taskType, schedule.title, schedule.details, date),
  ));
  if (taskStatements.length) await db.batch(taskStatements);
  return db;
}

async function addMissingColumns(db: D1Database, table: string, columns: Array<[string, string]>) {
  const existing = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set(existing.results.map((column) => column.name));
  const statements = columns.filter(([name]) => !names.has(name)).map(([name, definition]) =>
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`),
  );
  if (statements.length) await db.batch(statements);
}
