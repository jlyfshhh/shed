import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { feederConsumptionStatements } from "../lib/feeder-consumption.ts";

class BoundStatement {
  private readonly statement: StatementSync;
  private readonly values: SQLInputValue[];

  constructor(statement: StatementSync, values: SQLInputValue[] = []) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new BoundStatement(this.statement, values as SQLInputValue[]);
  }

  run() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new BoundStatement(this.sqlite.prepare(sql));
  }
}

test("two completions competing for one feeder leave the second as care-only", async () => {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE feeder_inventory (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, consumed_at TEXT,
      animal_id TEXT, husbandry_event_id TEXT
    );
    CREATE TABLE feeding_assignments (
      id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, feeder_id TEXT NOT NULL,
      planned_for TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      consumed_at TEXT, husbandry_event_id TEXT
    );
    CREATE UNIQUE INDEX consumed_feeder
      ON feeding_assignments(feeder_id) WHERE status = 'consumed';
    CREATE UNIQUE INDEX consumed_event
      ON feeding_assignments(husbandry_event_id) WHERE status = 'consumed';
    INSERT INTO feeder_inventory VALUES ('feeder-1', 'available', NULL, NULL, NULL);
  `);
  const db = adapter as unknown as D1Database;
  const first = feederConsumptionStatements(db, {
    assignmentId: "assignment-a",
    animalId: "animal-a",
    feederId: "feeder-1",
    plannedFor: "2026-08-09",
    occurredAt: "2026-08-09T12:00:00.000Z",
    husbandryEventId: "event-a",
  });
  const second = feederConsumptionStatements(db, {
    assignmentId: "assignment-b",
    animalId: "animal-b",
    feederId: "feeder-1",
    plannedFor: "2026-08-09",
    occurredAt: "2026-08-09T12:00:01.000Z",
    husbandryEventId: "event-b",
  });

  const firstResults = await Promise.all(first.map((statement) => statement.run()));
  const secondResults = await Promise.all(second.map((statement) => statement.run()));
  assert.deepEqual(firstResults.map((result) => result.meta.changes), [1, 1]);
  assert.deepEqual(secondResults.map((result) => result.meta.changes), [0, 0]);
  assert.deepEqual(
    { ...adapter.sqlite.prepare("SELECT status, animal_id, husbandry_event_id FROM feeder_inventory").get() },
    { status: "consumed", animal_id: "animal-a", husbandry_event_id: "event-a" },
  );
  assert.deepEqual(
    adapter.sqlite.prepare("SELECT id, animal_id, husbandry_event_id FROM feeding_assignments").all().map((row) => ({ ...row })),
    [{ id: "assignment-a", animal_id: "animal-a", husbandry_event_id: "event-a" }],
  );
});
