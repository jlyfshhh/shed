import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { loadFeederForecast } from "../lib/feeder-forecast-data.ts";
import { careTaskId } from "../lib/care-group.ts";

class BoundStatement {
  private readonly statement: StatementSync;
  private readonly values: SQLInputValue[];

  constructor(
    statement: StatementSync,
    values: SQLInputValue[] = [],
  ) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new BoundStatement(this.statement, values as SQLInputValue[]);
  }

  first<T>() {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  all<T>() {
    return { results: this.statement.all(...this.values) as T[] };
  }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new BoundStatement(this.sqlite.prepare(sql));
  }
}

// The columns the loader actually reads, mirroring db/runtime.ts: brumation and
// week_interval on top of the care-plan shape, animal_id on care_tasks (grouped
// plans are per-animal rows), and the disposition marks that settle an occurrence.
function newDb(): SqliteD1 {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE animals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      brumating INTEGER NOT NULL DEFAULT 0, care_resume_on TEXT
    );
    CREATE TABLE weight_events (animal_id TEXT, recorded_on TEXT, weight_grams INTEGER);
    CREATE TABLE feeder_inventory (
      id TEXT PRIMARY KEY, prey_species TEXT, size_class TEXT, weight_grams INTEGER,
      status TEXT, added_on TEXT, consumed_at TEXT, animal_id TEXT, husbandry_event_id TEXT
    );
    CREATE TABLE care_schedules (
      id TEXT PRIMARY KEY, animal_id TEXT, animal_ids_json TEXT, task_type TEXT, title TEXT, details TEXT,
      frequency TEXT, interval_days INTEGER, weekdays_json TEXT, day_of_month INTEGER, week_interval INTEGER,
      start_date TEXT, end_date TEXT, prey_species TEXT, prey_description TEXT,
      prey_size_class TEXT, buy_as_needed INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT, due_date TEXT,
      skipped_at TEXT, missed_at TEXT
    );
    CREATE TABLE husbandry_events (
      id TEXT PRIMARY KEY, task_id TEXT, due_date TEXT, outcome TEXT, voided_at TEXT
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  return adapter;
}

type ScheduleSpec = {
  id: string;
  animalId: string;
  animalIdsJson?: string | null;
  frequency: string;
  intervalDays?: number | null;
  weekdaysJson?: string | null;
  dayOfMonth?: number | null;
  weekInterval?: number | null;
  startDate: string;
  endDate?: string | null;
  preySpecies?: string | null;
  preySizeClass?: string | null;
  buyAsNeeded?: number;
};

function insertSchedule(db: SqliteD1, spec: ScheduleSpec) {
  db.sqlite
    .prepare(
      `INSERT INTO care_schedules
         (id, animal_id, animal_ids_json, task_type, title, details, frequency, interval_days,
          weekdays_json, day_of_month, week_interval, start_date, end_date, prey_species,
          prey_description, prey_size_class, buy_as_needed, active)
       VALUES (?, ?, ?, 'feeding', 'Feed', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      spec.id,
      spec.animalId,
      spec.animalIdsJson ?? null,
      spec.frequency,
      spec.intervalDays ?? null,
      spec.weekdaysJson ?? null,
      spec.dayOfMonth ?? null,
      spec.weekInterval ?? 1,
      spec.startDate,
      spec.endDate ?? null,
      spec.preySpecies ?? "mouse",
      spec.preySizeClass ? `${spec.preySizeClass} ${spec.preySpecies ?? "mouse"}` : (spec.preySpecies ?? "mouse"),
      spec.preySizeClass ?? null,
      spec.buyAsNeeded ?? 0,
    );
}

function insertAnimal(db: SqliteD1, id: string, name: string, extra: { brumating?: number; careResumeOn?: string | null } = {}) {
  db.sqlite
    .prepare("INSERT INTO animals (id, name, active, brumating, care_resume_on) VALUES (?, ?, 1, ?, ?)")
    .run(id, name, extra.brumating ?? 0, extra.careResumeOn ?? null);
}

function insertFeeder(db: SqliteD1, id: string, preySpecies: string, sizeClass: string, addedOn: string, status = "available") {
  db.sqlite
    .prepare("INSERT INTO feeder_inventory (id, prey_species, size_class, weight_grams, status, added_on) VALUES (?, ?, ?, NULL, ?, ?)")
    .run(id, preySpecies, sizeClass, status, addedOn);
}

function insertTask(db: SqliteD1, scheduleId: string, animalId: string, primaryAnimalId: string, dueDate: string, marks: { skippedAt?: string } = {}) {
  const id = careTaskId(scheduleId, animalId, primaryAnimalId, dueDate);
  db.sqlite
    .prepare("INSERT INTO care_tasks (id, schedule_id, animal_id, due_date, skipped_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, scheduleId, animalId, dueDate, marks.skippedAt ?? null);
  return id;
}

/** Mimic a recorded completion/refusal exactly as the complete route writes it. */
function completeTask(db: SqliteD1, taskId: string, dueDate: string, outcome: "done" | "refused", opts: { voidedAt?: string | null } = {}) {
  db.sqlite
    .prepare("INSERT INTO husbandry_events (id, task_id, due_date, outcome, voided_at) VALUES (?, ?, ?, ?, ?)")
    .run(`evt-${taskId}`, taskId, dueDate, outcome, opts.voidedAt ?? null);
}

function consumeFeeder(db: SqliteD1, feederId: string, animalId: string, eventId: string) {
  db.sqlite
    .prepare("UPDATE feeder_inventory SET status = 'consumed', consumed_at = ?, animal_id = ?, husbandry_event_id = ? WHERE id = ?")
    .run("2026-10-09T12:00:00Z", animalId, eventId, feederId);
}

const asD1 = (db: SqliteD1) => db as unknown as D1Database;
const dates = (forecast: Awaited<ReturnType<typeof loadFeederForecast>>) =>
  forecast.events.map((event) => event.feedingDate);

test("alternating-week plans skip their off weeks", async () => {
  const db = newDb();
  insertAnimal(db, "rhino", "Rhino");
  insertFeeder(db, "mouse-1", "mouse", "large pinky", "2026-08-01");
  insertFeeder(db, "mouse-2", "mouse", "large pinky", "2026-08-01");
  insertFeeder(db, "mouse-3", "mouse", "large pinky", "2026-08-01");
  // Every other Sunday from 2026-09-27 (a Sunday): 09-27, 10-11, 10-25 are on;
  // 10-04 and 10-18 are the off weeks the loader previously forecast as meals.
  insertSchedule(db, {
    id: "rhino-feed", animalId: "rhino", frequency: "weekly",
    weekdaysJson: "[0]", weekInterval: 2, startDate: "2026-09-27",
    preySpecies: "mouse", preySizeClass: "large pinky",
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-09-27", 28);
  assert.deepEqual(dates(forecast), ["2026-09-27", "2026-10-11", "2026-10-25"]);
});

test("a brumating animal is forecast no meals at all", async () => {
  const db = newDb();
  insertAnimal(db, "pascal", "Pascal", { brumating: 1 });
  insertFeeder(db, "mouse-1", "mouse", "adult", "2026-08-01");
  insertSchedule(db, {
    id: "pascal-feed", animalId: "pascal", frequency: "daily",
    startDate: "2026-09-01", preySpecies: "mouse", preySizeClass: "adult",
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-10-04", 2);
  assert.deepEqual(dates(forecast), []);
  assert.equal(forecast.alerts.length, 0, "no shortage alerts for a paused animal");
});

test("a recent resume floor suppresses days before care resumes", async () => {
  const db = newDb();
  insertAnimal(db, "wasabi", "Wasabi", { careResumeOn: "2026-10-12" });
  insertFeeder(db, "mouse-1", "mouse", "adult", "2026-08-01");
  insertFeeder(db, "mouse-2", "mouse", "adult", "2026-08-01");
  insertSchedule(db, {
    id: "wasabi-feed", animalId: "wasabi", frequency: "daily",
    startDate: "2026-09-01", preySpecies: "mouse", preySizeClass: "adult",
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-10-09", 4);
  // 10-09, 10-10, 10-11 are before the resume floor; 10-12, 10-13 are forecast.
  assert.deepEqual(dates(forecast), ["2026-10-12", "2026-10-13"]);
});

test("monthly ordinal weekday plans forecast only that weekday-of-month", async () => {
  const db = newDb();
  insertAnimal(db, "monty", "Monty");
  for (let i = 1; i <= 3; i += 1) insertFeeder(db, `rat-${i}`, "rat", "small", "2026-08-01");
  // 2nd Tuesday of each month.
  insertSchedule(db, {
    id: "monty-feed", animalId: "monty", frequency: "monthly",
    weekdaysJson: "[2]", dayOfMonth: 2, startDate: "2026-10-01",
    preySpecies: "rat", preySizeClass: "small",
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-10-01", 50);
  assert.deepEqual(dates(forecast), ["2026-10-13", "2026-11-10"]);
});

test("start and end dates bound the forecast window", async () => {
  const db = newDb();
  insertAnimal(db, "boundy", "Boundy");
  for (let i = 1; i <= 5; i += 1) insertFeeder(db, `mouse-${i}`, "mouse", "fuzzy", "2026-08-01");
  // Every 3 days, but only live 10-12 .. 10-18.
  insertSchedule(db, {
    id: "boundy-feed", animalId: "boundy", frequency: "interval", intervalDays: 3,
    startDate: "2026-10-12", endDate: "2026-10-18",
    preySpecies: "mouse", preySizeClass: "fuzzy",
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-10-09", 30);
  // Nothing before the start date, nothing after the end date.
  assert.deepEqual(dates(forecast), ["2026-10-12", "2026-10-15", "2026-10-18"]);
});

test("skipped, completed and refused occurrences are excluded; voided ones return", async () => {
  const db = newDb();
  insertAnimal(db, "rhino", "Rhino");
  for (let i = 1; i <= 4; i += 1) insertFeeder(db, `mouse-${i}`, "mouse", "large pinky", "2026-08-01");
  insertSchedule(db, {
    id: "rhino-feed", animalId: "rhino", frequency: "interval", intervalDays: 7,
    startDate: "2026-08-09", preySpecies: "mouse", preySizeClass: "large pinky",
  });
  // Weekly from 08-09: 09-27, 10-04, 10-11, 10-18 within a 09-27 + 21 window.
  insertTask(db, "rhino-feed", "rhino", "rhino", "2026-09-27", { skippedAt: "2026-09-27T09:00:00Z" });
  const doneTask = insertTask(db, "rhino-feed", "rhino", "rhino", "2026-10-04");
  completeTask(db, doneTask, "2026-10-04", "done");
  const refusedTask = insertTask(db, "rhino-feed", "rhino", "rhino", "2026-10-11");
  completeTask(db, refusedTask, "2026-10-11", "refused");
  const voidedTask = insertTask(db, "rhino-feed", "rhino", "rhino", "2026-10-18");
  completeTask(db, voidedTask, "2026-10-18", "done", { voidedAt: "2026-10-18T20:00:00Z" });

  const forecast = await loadFeederForecast(asD1(db), "2026-09-27", 21);
  // Skipped (09-27), completed (10-04) and refused (10-11) are settled; the
  // voided completion (10-18) is undone and must be forecast again.
  assert.deepEqual(dates(forecast), ["2026-10-18"]);
});

test("loading a forecast never mutates inventory", async () => {
  const db = newDb();
  insertAnimal(db, "rhino", "Rhino");
  insertFeeder(db, "mouse-1", "mouse", "large pinky", "2026-08-01");
  insertSchedule(db, {
    id: "rhino-feed", animalId: "rhino", frequency: "interval", intervalDays: 7,
    startDate: "2026-08-09", preySpecies: "mouse", preySizeClass: "large pinky",
  });

  await loadFeederForecast(asD1(db), "2026-08-09", 8);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM feeder_inventory WHERE status = 'available'").get()?.count,
    1,
  );
});

test("a two-animal grouped feeding forecasts and allocates each animal its own feeder", async () => {
  const db = newDb();
  insertAnimal(db, "castor", "Castor");
  insertAnimal(db, "pollux", "Pollux");
  insertFeeder(db, "rat-old", "rat", "small", "2026-06-01");
  insertFeeder(db, "rat-new", "rat", "small", "2026-07-01");
  // One plan, both twins, same day.
  insertSchedule(db, {
    id: "twins-feed", animalId: "castor", animalIdsJson: JSON.stringify(["castor", "pollux"]),
    frequency: "interval", intervalDays: 7, startDate: "2026-10-09",
    preySpecies: "rat", preySizeClass: "small",
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-10-09", 1);
  const todays = forecast.events.filter((event) => event.feedingDate === "2026-10-09");
  assert.deepEqual(todays.map((event) => event.animalId).sort(), ["castor", "pollux"]);
  const feederIds = todays.map((event) => event.allocatedFeeder?.id);
  assert.ok(feederIds.every(Boolean), "both twins are covered");
  assert.equal(new Set(feederIds).size, 2, "two distinct feeders, never the same one twice");

  // The complete route's lookup predicate, exercised per animal: each twin's own
  // event (and its own feeder) is selected, so completing one can never consume
  // or recommend the cage-mate's.
  for (const animalId of ["castor", "pollux"]) {
    const feeding = forecast.events.find((event) =>
      event.scheduleId === "twins-feed" && event.animalId === animalId && event.feedingDate === "2026-10-09");
    assert.ok(feeding?.allocatedFeeder, `${animalId} resolves its own feeder`);
  }
  const castor = forecast.events.find((e) => e.animalId === "castor" && e.feedingDate === "2026-10-09");
  const pollux = forecast.events.find((e) => e.animalId === "pollux" && e.feedingDate === "2026-10-09");
  assert.notEqual(castor!.allocatedFeeder!.id, pollux!.allocatedFeeder!.id);
});

test("completing one grouped animal leaves its cage-mate due, without double-consuming", async () => {
  const db = newDb();
  insertAnimal(db, "castor", "Castor");
  insertAnimal(db, "pollux", "Pollux");
  insertFeeder(db, "rat-old", "rat", "small", "2026-06-01");
  insertFeeder(db, "rat-new", "rat", "small", "2026-07-01");
  insertSchedule(db, {
    id: "twins-feed", animalId: "castor", animalIdsJson: JSON.stringify(["castor", "pollux"]),
    frequency: "interval", intervalDays: 7, startDate: "2026-10-09",
    preySpecies: "rat", preySizeClass: "small",
  });

  // Materialize both twins' tasks, then complete only Castor and consume Castor's
  // (oldest) feeder, exactly as the complete route would.
  const castorTask = insertTask(db, "twins-feed", "castor", "castor", "2026-10-09");
  insertTask(db, "twins-feed", "pollux", "castor", "2026-10-09");
  completeTask(db, castorTask, "2026-10-09", "done");
  consumeFeeder(db, "rat-old", "castor", `evt-${castorTask}`);

  const partial = await loadFeederForecast(asD1(db), "2026-10-09", 1);
  const partialToday = partial.events.filter((event) => event.feedingDate === "2026-10-09");
  assert.deepEqual(partialToday.map((event) => event.animalId), ["pollux"], "only Pollux remains due");
  assert.equal(partialToday[0].allocatedFeeder?.id, "rat-new", "Pollux draws the remaining feeder");
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM feeder_inventory WHERE status = 'available'").get()?.n,
    1,
    "Castor's consumed feeder is not re-offered",
  );

  // Retry (idempotent re-complete): Castor stays settled, Pollux unchanged, no
  // extra feeder is forecast as consumed.
  const retry = await loadFeederForecast(asD1(db), "2026-10-09", 1);
  assert.deepEqual(retry.events.filter((e) => e.feedingDate === "2026-10-09").map((e) => e.animalId), ["pollux"]);

  // Undo: void Castor's completion and return its feeder to stock. Both twins are
  // due again and each is allocated a distinct feeder — no leak, no double count.
  db.sqlite.prepare("UPDATE husbandry_events SET voided_at = '2026-10-09T20:00:00Z' WHERE task_id = ?").run(castorTask);
  db.sqlite.prepare("UPDATE feeder_inventory SET status = 'available', consumed_at = NULL, animal_id = NULL, husbandry_event_id = NULL WHERE id = 'rat-old'").run();
  const undone = await loadFeederForecast(asD1(db), "2026-10-09", 1);
  const undoneToday = undone.events.filter((event) => event.feedingDate === "2026-10-09");
  assert.deepEqual(undoneToday.map((event) => event.animalId).sort(), ["castor", "pollux"]);
  assert.equal(new Set(undoneToday.map((event) => event.allocatedFeeder?.id)).size, 2);
});

test("buy-as-needed grouped prey never draws stock and alerts each animal", async () => {
  const db = newDb();
  insertAnimal(db, "castor", "Castor");
  insertAnimal(db, "pollux", "Pollux");
  insertSchedule(db, {
    id: "twins-feed", animalId: "castor", animalIdsJson: JSON.stringify(["castor", "pollux"]),
    frequency: "interval", intervalDays: 7, startDate: "2026-10-09",
    preySpecies: "dubia", preySizeClass: null, buyAsNeeded: 1,
  });

  const forecast = await loadFeederForecast(asD1(db), "2026-10-09", 1);
  const todays = forecast.events.filter((event) => event.feedingDate === "2026-10-09");
  assert.deepEqual(todays.map((event) => event.status), ["buy-as-needed", "buy-as-needed"]);
  assert.ok(todays.every((event) => event.allocatedFeeder === null));
  assert.equal(forecast.alerts.filter((alert) => alert.code === "buy-as-needed").length, 2);
});
