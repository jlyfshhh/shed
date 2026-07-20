import { env } from "cloudflare:workers";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/date";
import { previousIsoDate, scheduledTasksForDate } from "@/lib/care-schedule";
import { feederInventorySeed } from "@/lib/feeder-inventory";

const animalRows = [
  ["telemachus", "Telemachus", "Ball Python", "Reptile", "Indoor habitat", 576, "2026-07-14"],
  ["achilles", "Achilles", "Ball Python", "Reptile", "Indoor habitat", 425, "2026-07-14"],
  ["ares", "Ares", "Ball Python", "Reptile", "Indoor habitat", 1257, "2026-07-14"],
  ["calypso", "Calypso", "Ball Python", "Reptile", "Indoor habitat", 625, "2026-07-14"],
  ["odysseus", "Odysseus", "Ball Python", "Reptile", "Indoor habitat", 935, "2026-07-14"],
  ["apollo", "Apollo", "Ball Python", "Reptile", "Indoor habitat", 411, "2026-07-14"],
  ["dracarys", "Dracarys", "Bearded Dragon", "Reptile", "Indoor habitat", null, null],
  ["pascal", "Pascal", "Veiled Chameleon", "Reptile", "Indoor habitat", null, null],
  ["wasabi", "Wasabi", "Panther Chameleon", "Reptile", "Indoor habitat", null, null],
  ["mort", "Mort", "Leopard Gecko", "Reptile", "Indoor habitat", null, null],
  ["turtle", "Turtle", "Leopard Gecko", "Reptile", "Indoor habitat", null, null],
  ["blue", "Blue", "Leopard Gecko", "Reptile", "Indoor habitat", null, null],
  ["rhino", "Rhino", "Western Hognose", "Reptile", "Indoor habitat", null, null],
  ["sriracha", "Sriracha", "Western Hognose — Albino", "Reptile", "Indoor habitat", null, null],
  ["echo", "Echo", "Crested Gecko", "Reptile", "Indoor habitat", null, null],
  ["rue", "Rue", "Crested Gecko", "Reptile", "Indoor habitat", null, null],
  ["taco", "Taco", "Pacman Frog", "Amphibian", "Indoor habitat", null, null],
  ["paludarium", "Paludarium", "Tree frogs, mourning geckos, vampire crabs & fish", "Community", "Indoor habitat", null, null],
  ["taki", "Taki", "Red-eared Slider & guppies", "Aquatic", "Indoor habitat", null, null],
  ["reef", "Reef Tank", "Clownfish, goby, shrimp, snails & corals", "Aquatic", "Indoor habitat", null, null],
  ["community-tank", "Living Room Tank", "Platys, cory catfish & gourami", "Aquatic", "Indoor habitat", null, null],
  ["tetra-frog-tank", "Dining Room Tank", "Tetras & African dwarf frogs", "Aquatic", "Indoor habitat", null, null],
  ["oscar", "Mr. Oscar", "Betta", "Aquatic", "Indoor habitat", null, null],
  ["nani", "Nani", "Betta", "Aquatic", "Indoor habitat", null, null],
  ["pond", "Porch Pond", "Ricefish", "Aquatic", "Outdoor habitat", null, null],
] as const;

const initialEvents = [
  ["seed-20260719-salad", "salad-dracarys:2026-07-19", "dracarys", "feeding", "Serve salad", null, "2026-07-19", "2026-07-19T13:00:00-04:00", "Zookeeper"],
  ["seed-20260719-bugs", "bugs-dracarys:2026-07-19", "dracarys", "feeding", "Feed insects", "Dubia roaches and a hornworm; dusted with Repashy Calcium Plus.", "2026-07-19", "2026-07-19T13:05:00-04:00", "Zookeeper"],
  ...["telemachus", "achilles", "ares", "calypso", "odysseus"].map((animalId) => [`seed-20260719-mist-${animalId}`, `mist-${animalId}:2026-07-18`, animalId, "misting", "Mist enclosure", null, "2026-07-18", "2026-07-19T13:10:00-04:00", "Zookeeper"]),
  ...["mort", "turtle"].map((animalId) => [`seed-20260719-mist-${animalId}`, `mist-${animalId}:2026-07-18`, animalId, "misting", "Mist enclosure", null, "2026-07-18", "2026-07-19T13:10:00-04:00", "Zookeeper"]),
  ...["pascal", "wasabi", "echo", "rue"].map((animalId) => [`seed-20260719-mist-${animalId}`, `mist-${animalId}:2026-07-19`, animalId, "misting", "Mist enclosure", null, "2026-07-19", "2026-07-19T13:15:00-04:00", "Zookeeper"]),
  ...["taco", "paludarium"].map((animalId) => [`seed-20260719-mist-${animalId}`, null, animalId, "misting", "Mist enclosure", null, "2026-07-19", "2026-07-19T13:15:00-04:00", "Zookeeper"]),
  ["seed-20260719-rhino-water", null, "rhino", "water refresh", "Refresh water", "Fresh water provided; bowl cleaning not reported.", "2026-07-19", "2026-07-19T13:20:00-04:00", "Zookeeper"],
  ["seed-20260719-pascal-feed", null, "pascal", "feeding", "Feed insects", "Dubia roaches and a hornworm; dusted with Repashy Calcium Plus.", "2026-07-19", "2026-07-19T13:25:00-04:00", "Zookeeper"],
  ["seed-20260719-wasabi-feed", null, "wasabi", "feeding", "Feed insects", "Dubia roaches and mealworms; dusted with Repashy Calcium Plus.", "2026-07-19", "2026-07-19T13:25:00-04:00", "Zookeeper"],
  ...[["mort", "Dubia roaches"], ["turtle", "Dubia roaches"], ["paludarium", "Dubia roaches for the red-eyed tree frogs"]].map(([animalId, food]) => [`seed-20260719-feed-${animalId}`, null, animalId, "feeding", "Feed insects", `${food}; dusted with Repashy Calcium Plus.`, "2026-07-19", "2026-07-19T13:30:00-04:00", "Zookeeper"]),
  ...[["oscar", "Fluval Bug Bites"], ["nani", "Fluval Bug Bites"], ["tetra-frog-tank", "Fluval Bug Bites for tetras and African dwarf frogs"], ["paludarium", "Fluval Bug Bites for rasboras"], ["taki", "Fluval Bug Bites for guppies"], ["pond", "Fluval Bug Bites for ricefish"], ["reef", "Marine Life pellets for reef fish"], ["community-tank", "Fluval Bug Bites for platys, Cory catfish, and gourami"]].map(([animalId, food]) => [`seed-20260719-aquatic-${animalId}`, null, animalId, "feeding", "Feed aquatic residents", food, "2026-07-19", "2026-07-19T13:35:00-04:00", "Zookeeper"]),
  ["seed-20260719-taki-pellets", null, "taki", "feeding", "Feed", "Taki was fed pellets; separate from the guppies' Fluval Bug Bites.", "2026-07-19", "2026-07-19T14:00:00-04:00", "Zookeeper"],
  ["calypso-feed-20250712", null, "calypso", "feeding", "Feed", "Historical note: 29 g rat.", "2025-07-12", "2025-07-12T12:00:00-04:00", "Owner"],
  ["calypso-feed-20250804", null, "calypso", "feeding", "Feed", "Historical note: 30 g rat.", "2025-08-04", "2025-08-04T12:00:00-04:00", "Owner"],
  ["calypso-feed-20250817", null, "calypso", "feeding", "Feed", "Historical note: 28 g rat.", "2025-08-17", "2025-08-17T12:00:00-04:00", "Owner"],
  ["calypso-length-20250803", null, "calypso", "measurement", "Measured length", "Historical note: approximately 2.5 ft.", "2025-08-03", "2025-08-03T12:00:00-04:00", "Owner"],
] as const;

const weightRows = [
  ["tele-prev", "telemachus", "2026-05-30", 532], ["tele-now", "telemachus", "2026-07-14", 576],
  ["ach-prev", "achilles", "2026-05-30", 382], ["ach-now", "achilles", "2026-07-14", 425],
  ["ares-prev", "ares", "2026-05-30", 1289], ["ares-now", "ares", "2026-07-14", 1257],
  ["cal-20241026", "calypso", "2024-10-26", 137],
  ["cal-20241104", "calypso", "2024-11-04", 267],
  ["cal-20241116", "calypso", "2024-11-16", 270],
  ["cal-20241213", "calypso", "2024-12-13", 282],
  ["cal-20250323", "calypso", "2025-03-23", 314],
  ["cal-20250626", "calypso", "2025-06-26", 328],
  ["cal-20250703", "calypso", "2025-07-03", 352],
  ["cal-20250803", "calypso", "2025-08-03", 354],
  ["cal-20250808", "calypso", "2025-08-08", 384],
  ["cal-20250816", "calypso", "2025-08-16", 361],
  ["cal-20250823", "calypso", "2025-08-23", 392],
  ["cal-20250831", "calypso", "2025-08-31", 364],
  ["cal-prev", "calypso", "2026-05-16", 555], ["cal-now", "calypso", "2026-07-14", 625],
  ["ody-prev", "odysseus", "2026-05-30", 924], ["ody-now", "odysseus", "2026-07-14", 935],
  ["apollo-prev", "apollo", "2026-05-30", 355], ["apollo-now", "apollo", "2026-07-14", 411],
] as const;

export async function ensureDatabase(targetDate?: string) {
  const db = env.DB;
  const timeZone = typeof env.SHED_TIME_ZONE === "string" ? env.SHED_TIME_ZONE : DEFAULT_TIME_ZONE;
  const today = targetDate ?? dateInTimeZone(timeZone);
  const taskRows = [
    ...scheduledTasksForDate(previousIsoDate(today)),
    ...scheduledTasksForDate(today),
  ];
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS animals (id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL, group_name TEXT NOT NULL, location TEXT NOT NULL, weight_grams INTEGER, weight_date TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS care_tasks (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, details TEXT NOT NULL, due_date TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, animal_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL, notes TEXT, due_date TEXT, occurred_at TEXT NOT NULL, actor_role TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS household_members (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL, access_code_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS household_members_access_code_hash_unique ON household_members(access_code_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS household_members_active_role_idx ON household_members(active, role)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS event_task_due_unique ON husbandry_events(task_id, due_date)"),
    db.prepare("CREATE TABLE IF NOT EXISTS weight_events (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, recorded_on TEXT NOT NULL, weight_grams INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS voice_audit_logs (id TEXT PRIMARY KEY, requested_at TEXT NOT NULL, completed_at TEXT, utterance TEXT NOT NULL, status TEXT NOT NULL, model TEXT NOT NULL, tool_calls_json TEXT NOT NULL DEFAULT '[]', response_text TEXT, error_message TEXT, duration_ms INTEGER, user_agent TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS voice_audit_requested_at_idx ON voice_audit_logs(requested_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feeder_inventory (id TEXT PRIMARY KEY, prey_species TEXT NOT NULL, size_class TEXT NOT NULL, weight_grams INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'available', added_on TEXT NOT NULL, consumed_at TEXT, animal_id TEXT, husbandry_event_id TEXT, notes TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_status_idx ON feeder_inventory(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeder_inventory_size_weight_idx ON feeder_inventory(prey_species, size_class, weight_grams)"),
    db.prepare("CREATE TABLE IF NOT EXISTS feeding_assignments (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, feeder_id TEXT NOT NULL, planned_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, consumed_at TEXT, husbandry_event_id TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeding_assignments_animal_date_idx ON feeding_assignments(animal_id, planned_for)"),
    db.prepare("CREATE INDEX IF NOT EXISTS feeding_assignments_feeder_idx ON feeding_assignments(feeder_id)"),
  ]);

  // D1 and SQLite do not support ADD COLUMN IF NOT EXISTS consistently. Inspect
  // the live schema so existing installations can upgrade without losing data.
  const [taskColumns, eventColumns] = await Promise.all([
    db.prepare("PRAGMA table_info(care_tasks)").all<{ name: string }>(),
    db.prepare("PRAGMA table_info(husbandry_events)").all<{ name: string }>(),
  ]);
  const taskColumnNames = new Set(taskColumns.results.map((column: { name: string }) => column.name));
  const eventColumnNames = new Set(eventColumns.results.map((column: { name: string }) => column.name));
  const upgrades = [];
  if (!taskColumnNames.has("task_type")) {
    upgrades.push(db.prepare("ALTER TABLE care_tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'general'"));
  }
  if (!eventColumnNames.has("task_type")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN task_type TEXT NOT NULL DEFAULT 'general'"));
  }
  if (!eventColumnNames.has("notes")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN notes TEXT"));
  }
  if (!eventColumnNames.has("completed_by_member_id")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN completed_by_member_id TEXT"));
  }
  if (!eventColumnNames.has("completed_by_name")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN completed_by_name TEXT"));
  }
  if (!eventColumnNames.has("voided_at")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN voided_at TEXT"));
  }
  if (!eventColumnNames.has("voided_by_member_id")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN voided_by_member_id TEXT"));
  }
  if (!eventColumnNames.has("voided_by_name")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN voided_by_name TEXT"));
  }
  if (!eventColumnNames.has("void_reason")) {
    upgrades.push(db.prepare("ALTER TABLE husbandry_events ADD COLUMN void_reason TEXT"));
  }
  if (upgrades.length) await db.batch(upgrades);

  await db.batch([
    db.prepare("DELETE FROM care_tasks WHERE task_type = 'water bowl cleaning' AND animal_id IN ('pascal', 'wasabi', 'echo', 'rue')"),
    ...animalRows.map((row) => db.prepare("INSERT OR IGNORE INTO animals (id, name, species, group_name, location, weight_grams, weight_date) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...row)),
    ...taskRows.map((row) => db.prepare("INSERT OR IGNORE INTO care_tasks (id, animal_id, task_type, title, details, due_date) VALUES (?, ?, ?, ?, ?, ?)").bind(row.id, row.animalId, row.taskType, row.title, row.details, row.dueDate)),
    ...initialEvents.map((row) => db.prepare("INSERT OR IGNORE INTO husbandry_events (id, task_id, animal_id, task_type, title, notes, due_date, occurred_at, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...row)),
    ...weightRows.map((row) => db.prepare("INSERT OR IGNORE INTO weight_events (id, animal_id, recorded_on, weight_grams) VALUES (?, ?, ?, ?)").bind(...row)),
    ...feederInventorySeed.map((row) => db.prepare("INSERT OR IGNORE INTO feeder_inventory (id, prey_species, size_class, weight_grams, status, added_on) VALUES (?, ?, ?, ?, 'available', '2026-07-19')").bind(row.id, row.preySpecies, row.sizeClass, row.weightGrams)),
  ]);
  return db;
}
