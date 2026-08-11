import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { loadFeederForecast } from "../lib/feeder-forecast-data.ts";

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

test("a skipped feeding occurrence is excluded from inventory forecasting", async () => {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE animals (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL);
    CREATE TABLE weight_events (animal_id TEXT, recorded_on TEXT, weight_grams INTEGER);
    CREATE TABLE feeder_inventory (
      id TEXT PRIMARY KEY, prey_species TEXT, size_class TEXT, weight_grams INTEGER,
      status TEXT, added_on TEXT
    );
    CREATE TABLE care_schedules (
      id TEXT PRIMARY KEY, animal_id TEXT, task_type TEXT, title TEXT, details TEXT,
      frequency TEXT, interval_days INTEGER, weekdays_json TEXT, day_of_month INTEGER,
      start_date TEXT, end_date TEXT, prey_species TEXT, prey_description TEXT,
      prey_size_class TEXT, target_percent REAL, minimum_percent REAL,
      maximum_percent REAL, buy_as_needed INTEGER, active INTEGER
    );
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY, schedule_id TEXT, due_date TEXT, skipped_at TEXT
    );
    CREATE TABLE husbandry_events (
      id TEXT PRIMARY KEY, task_id TEXT, due_date TEXT, voided_at TEXT
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);

    INSERT INTO animals VALUES ('rhino', 'Rhino', 1);
    INSERT INTO feeder_inventory VALUES
      ('mouse-one', 'mouse', 'large pinky', 3, 'available', '2026-08-01'),
      ('mouse-two', 'mouse', 'large pinky', 3, 'available', '2026-08-01');
    INSERT INTO care_schedules VALUES (
      'rhino-feed', 'rhino', 'feeding', 'Feed', '', 'interval', 7, NULL, NULL,
      '2026-08-09', NULL, 'mouse', 'large pinky mouse', 'large pinky',
      NULL, NULL, NULL, 0, 1
    );
    INSERT INTO care_tasks VALUES (
      'rhino-feed:2026-08-09', 'rhino-feed', '2026-08-09', '2026-08-09T09:00:00.000Z'
    );
  `);

  const forecast = await loadFeederForecast(adapter as unknown as D1Database, "2026-08-09", 8);
  assert.deepEqual(forecast.events.map((event) => event.feedingDate), ["2026-08-16"]);
  assert.equal(forecast.events[0].allocatedFeeder?.id, "mouse-one");
  assert.equal(
    adapter.sqlite.prepare("SELECT COUNT(*) AS count FROM feeder_inventory WHERE status = 'available'").get()?.count,
    2,
    "loading a forecast must not mutate inventory",
  );
});
