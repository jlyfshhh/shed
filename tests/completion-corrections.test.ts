import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import {
  CompletionCorrectionError,
  correctCompletionAttribution,
  undoCompletion,
} from "../lib/completion-corrections.ts";

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

  batch(statements: BoundStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class RacingSqliteD1 extends SqliteD1 {
  beforeBatch: (() => void) | null = null;

  batch(statements: BoundStatement[]) {
    const race = this.beforeBatch;
    this.beforeBatch = null;
    race?.();
    return super.batch(statements);
  }
}

function fixture<T extends SqliteD1>(adapter: T = new SqliteD1() as T) {
  adapter.sqlite.exec(`
    CREATE TABLE household_members (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE husbandry_events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      animal_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT,
      occurred_at TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      completed_by_member_id TEXT,
      completed_by_name TEXT,
      voided_at TEXT,
      voided_by_member_id TEXT,
      voided_by_name TEXT,
      void_reason TEXT,
      edited_at TEXT,
      edited_by_member_id TEXT,
      edited_by_name TEXT,
      reward_cents INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE husbandry_event_revisions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by_member_id TEXT NOT NULL,
      changed_by_name TEXT NOT NULL,
      previous_json TEXT NOT NULL
    );
    CREATE TABLE feeder_inventory (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      consumed_at TEXT,
      animal_id TEXT,
      husbandry_event_id TEXT
    );
    CREATE TABLE feeding_assignments (
      id TEXT PRIMARY KEY,
      feeder_id TEXT NOT NULL,
      status TEXT NOT NULL,
      consumed_at TEXT,
      husbandry_event_id TEXT
    );
    INSERT INTO household_members VALUES
      ('owner', 'Head Keeper', 'Owner', 1),
      ('keeper-a', 'Keeper A', 'Zookeeper', 1),
      ('keeper-b', 'Keeper B', 'Zookeeper', 1),
      ('disabled', 'Former Keeper', 'Zookeeper', 0);
    INSERT INTO husbandry_events (
      id, task_id, animal_id, task_type, title, due_date, occurred_at,
      actor_role, completed_by_member_id, completed_by_name, reward_cents
    ) VALUES (
      'event-1', 'task-1', 'animal-1', 'feeding', 'Feed', '2026-08-09',
      '2026-08-09T12:00:00.000Z', 'Zookeeper', 'keeper-a', 'Keeper A', 25
    );
    INSERT INTO feeder_inventory VALUES
      ('feeder-1', 'consumed', '2026-08-09T12:00:00.000Z', 'animal-1', 'event-1');
    INSERT INTO feeding_assignments VALUES
      ('assignment-1', 'feeder-1', 'consumed', '2026-08-09T12:00:00.000Z', 'event-1');
  `);
  return adapter;
}

function row<T>(db: SqliteD1, sql: string) {
  return { ...db.sqlite.prepare(sql).get() } as T;
}

test("attribution correction transfers credit but preserves completion, reward, and feeder state", async () => {
  const adapter = fixture();
  const db = adapter as unknown as D1Database;
  const result = await correctCompletionAttribution(db, {
    taskId: "task-1",
    dueDate: "2026-08-09",
    targetMemberId: "keeper-b",
    actor: { id: "owner", name: "Head Keeper" },
    reason: "The wrong keeper tapped complete.",
    now: "2026-08-09T13:00:00.000Z",
    revisionId: "revision-1",
  });

  assert.equal(result.changed, true);
  assert.equal(result.rewardCents, 25);
  assert.deepEqual(
    row(adapter, "SELECT completed_by_member_id, completed_by_name, actor_role, reward_cents, voided_at FROM husbandry_events"),
    {
      completed_by_member_id: "keeper-b",
      completed_by_name: "Keeper B",
      actor_role: "Zookeeper",
      reward_cents: 25,
      voided_at: null,
    },
  );
  assert.deepEqual(row(adapter, "SELECT status, husbandry_event_id FROM feeder_inventory"), {
    status: "consumed",
    husbandry_event_id: "event-1",
  });
  assert.deepEqual(row(adapter, "SELECT status, husbandry_event_id FROM feeding_assignments"), {
    status: "consumed",
    husbandry_event_id: "event-1",
  });

  const revision = row<{ changed_by_member_id: string; changed_by_name: string; previous_json: string }>(
    adapter,
    "SELECT changed_by_member_id, changed_by_name, previous_json FROM husbandry_event_revisions",
  );
  assert.equal(revision.changed_by_member_id, "owner");
  assert.equal(revision.changed_by_name, "Head Keeper");
  assert.deepEqual(
    (({ completed_by_member_id, completed_by_name, attribution_correction_reason }) => ({ completed_by_member_id, completed_by_name, attribution_correction_reason }))(
      JSON.parse(revision.previous_json) as Record<string, unknown>,
    ),
    {
      completed_by_member_id: "keeper-a",
      completed_by_name: "Keeper A",
      attribution_correction_reason: "The wrong keeper tapped complete.",
    },
  );

  // Balances are derived from active rows, so the historical 25-cent snapshot
  // moves from A to B without being recalculated.
  assert.deepEqual(
    adapter.sqlite.prepare("SELECT completed_by_member_id AS member, SUM(reward_cents) AS cents FROM husbandry_events WHERE voided_at IS NULL GROUP BY completed_by_member_id").all().map((item) => ({ ...item })),
    [{ member: "keeper-b", cents: 25 }],
  );
});

test("true undo is audited and atomically restores a consumed feeder", async () => {
  const adapter = fixture();
  const result = await undoCompletion(adapter as unknown as D1Database, {
    taskId: "task-1",
    dueDate: "2026-08-09",
    actor: { id: "owner", name: "Head Keeper" },
    reason: "Task was not actually done.",
    now: "2026-08-09T14:00:00.000Z",
  });

  assert.equal(result.restoredFeederCount, 1);
  assert.deepEqual(
    row(adapter, "SELECT voided_at, voided_by_member_id, voided_by_name, void_reason, reward_cents FROM husbandry_events"),
    {
      voided_at: "2026-08-09T14:00:00.000Z",
      voided_by_member_id: "owner",
      voided_by_name: "Head Keeper",
      void_reason: "Task was not actually done.",
      reward_cents: 25,
    },
  );
  assert.deepEqual(
    row(adapter, "SELECT status, consumed_at, animal_id, husbandry_event_id FROM feeder_inventory"),
    { status: "available", consumed_at: null, animal_id: null, husbandry_event_id: null },
  );
  assert.deepEqual(
    row(adapter, "SELECT status, consumed_at, husbandry_event_id FROM feeding_assignments"),
    { status: "released", consumed_at: null, husbandry_event_id: "event-1" },
  );
  assert.equal(
    row<{ cents: number }>(adapter, "SELECT COALESCE(SUM(reward_cents), 0) AS cents FROM husbandry_events WHERE voided_at IS NULL").cents,
    0,
  );
});

test("undo rolls every state change back if feeder release fails", async () => {
  const adapter = fixture();
  adapter.sqlite.exec(`
    CREATE TRIGGER reject_assignment_release
    BEFORE UPDATE OF status ON feeding_assignments
    WHEN NEW.status = 'released'
    BEGIN
      SELECT RAISE(ABORT, 'simulated release failure');
    END;
  `);

  await assert.rejects(
    undoCompletion(adapter as unknown as D1Database, {
      taskId: "task-1",
      dueDate: "2026-08-09",
      actor: { id: "owner", name: "Head Keeper" },
      reason: "Task was not actually done.",
      now: "2026-08-09T14:00:00.000Z",
    }),
    /simulated release failure/,
  );

  assert.deepEqual(row(adapter, "SELECT voided_at FROM husbandry_events"), { voided_at: null });
  assert.deepEqual(row(adapter, "SELECT status, husbandry_event_id FROM feeder_inventory"), {
    status: "consumed",
    husbandry_event_id: "event-1",
  });
  assert.deepEqual(row(adapter, "SELECT status FROM feeding_assignments"), { status: "consumed" });
});

test("attribution correction rejects a stale edit without writing a phantom revision", async () => {
  const adapter = fixture(new RacingSqliteD1());
  adapter.beforeBatch = () => {
    adapter.sqlite.prepare(
      "UPDATE husbandry_events SET completed_by_member_id = ?, completed_by_name = ?, actor_role = ?, edited_at = ? WHERE id = ?",
    ).run("owner", "Head Keeper", "Owner", "2026-08-09T12:59:00.000Z", "event-1");
  };

  await assert.rejects(
    correctCompletionAttribution(adapter as unknown as D1Database, {
      taskId: "task-1",
      dueDate: "2026-08-09",
      targetMemberId: "keeper-b",
      actor: { id: "owner", name: "Head Keeper" },
      now: "2026-08-09T13:00:00.000Z",
      revisionId: "stale-revision",
    }),
    (error) => error instanceof CompletionCorrectionError && error.status === 409,
  );

  assert.deepEqual(
    row(adapter, "SELECT completed_by_member_id, completed_by_name, edited_at FROM husbandry_events"),
    {
      completed_by_member_id: "owner",
      completed_by_name: "Head Keeper",
      edited_at: "2026-08-09T12:59:00.000Z",
    },
  );
  assert.equal(
    row<{ count: number }>(adapter, "SELECT COUNT(*) AS count FROM husbandry_event_revisions").count,
    0,
  );
});

test("undo rejects a replaced completion without releasing its feeder", async () => {
  const adapter = fixture(new RacingSqliteD1());
  adapter.beforeBatch = () => {
    adapter.sqlite.prepare(
      "UPDATE husbandry_events SET occurred_at = ? WHERE id = ?",
    ).run("2026-08-09T13:59:00.000Z", "event-1");
    adapter.sqlite.prepare(
      "UPDATE feeder_inventory SET consumed_at = ? WHERE id = ?",
    ).run("2026-08-09T13:59:00.000Z", "feeder-1");
    adapter.sqlite.prepare(
      "UPDATE feeding_assignments SET consumed_at = ? WHERE id = ?",
    ).run("2026-08-09T13:59:00.000Z", "assignment-1");
  };

  await assert.rejects(
    undoCompletion(adapter as unknown as D1Database, {
      taskId: "task-1",
      dueDate: "2026-08-09",
      actor: { id: "owner", name: "Head Keeper" },
      reason: "Task was not actually done.",
      now: "2026-08-09T14:00:00.000Z",
    }),
    (error) => error instanceof CompletionCorrectionError && error.status === 409,
  );

  assert.deepEqual(
    row(adapter, "SELECT occurred_at, voided_at FROM husbandry_events"),
    { occurred_at: "2026-08-09T13:59:00.000Z", voided_at: null },
  );
  assert.deepEqual(
    row(adapter, "SELECT status, consumed_at, husbandry_event_id FROM feeder_inventory"),
    {
      status: "consumed",
      consumed_at: "2026-08-09T13:59:00.000Z",
      husbandry_event_id: "event-1",
    },
  );
  assert.deepEqual(
    row(adapter, "SELECT status, consumed_at FROM feeding_assignments"),
    { status: "consumed", consumed_at: "2026-08-09T13:59:00.000Z" },
  );
});
