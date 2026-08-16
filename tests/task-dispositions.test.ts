import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import {
  missAllOverdueTasks,
  missScheduledTask,
  normalizeLegacyTaskDispositions,
  skipScheduledTask,
  TaskDispositionError,
  unskipScheduledTask,
} from "../lib/task-dispositions.ts";

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

  async batch(statements: BoundStatement[]) {
    return statements.map((statement) => statement.run());
  }
}

function fixture() {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE care_schedules (id TEXT PRIMARY KEY, grace_days INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY,
      schedule_id TEXT,
      due_date TEXT NOT NULL,
      missed_at TEXT,
      missed_by_member_id TEXT,
      missed_by_name TEXT,
      skipped_at TEXT,
      skipped_by_member_id TEXT,
      skipped_by_name TEXT,
      skip_reason TEXT
    );
    CREATE TABLE husbandry_events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      due_date TEXT,
      voided_at TEXT
    );
    INSERT INTO care_tasks (id, due_date) VALUES
      ('open', '2026-08-09'),
      ('other-open', '2026-08-09'),
      ('today', '2026-08-10'),
      ('completed', '2026-08-09'),
      ('skipped', '2026-08-09');
    INSERT INTO husbandry_events VALUES ('event-completed', 'completed', '2026-08-09', NULL);
    UPDATE care_tasks
       SET skipped_at = '2026-08-09T08:00:00.000Z',
           skipped_by_member_id = 'keeper-a',
           skipped_by_name = 'Keeper A',
           skip_reason = 'Settling in'
     WHERE id = 'skipped';
  `);
  return adapter;
}

function task(adapter: SqliteD1, id: string) {
  return { ...adapter.sqlite.prepare(
    "SELECT missed_at, missed_by_name, skipped_at, skipped_by_name, skip_reason FROM care_tasks WHERE id = ?",
  ).get(id) } as Record<string, unknown>;
}

const owner = { id: "owner", name: "Head Keeper" };

test("skip is atomic, clears a miss, and an idempotent retry preserves the first decision", async () => {
  const adapter = fixture();
  adapter.sqlite.prepare(
    "UPDATE care_tasks SET missed_at = ?, missed_by_member_id = ?, missed_by_name = ? WHERE id = 'open'",
  ).run("2026-08-09T07:00:00.000Z", "keeper-a", "Keeper A");

  const first = await skipScheduledTask(adapter as unknown as D1Database, {
    taskId: "open",
    dueDate: "2026-08-09",
    reason: "Animal is settling in",
    actor: owner,
    occurredAt: "2026-08-09T09:00:00.000Z",
  });
  assert.equal(first.skipped, true);
  assert.deepEqual(task(adapter, "open"), {
    missed_at: null,
    missed_by_name: null,
    skipped_at: "2026-08-09T09:00:00.000Z",
    skipped_by_name: "Head Keeper",
    skip_reason: "Animal is settling in",
  });

  const retry = await skipScheduledTask(adapter as unknown as D1Database, {
    taskId: "open",
    dueDate: "2026-08-09",
    reason: "A different retry reason",
    actor: { id: "keeper-b", name: "Keeper B" },
    occurredAt: "2026-08-09T10:00:00.000Z",
  });
  assert.deepEqual(retry, { skipped: true, by: "Head Keeper", reason: "Animal is settling in" });
  assert.equal(task(adapter, "open").skipped_at, "2026-08-09T09:00:00.000Z");
});

test("a completion cannot be overwritten by skip, including the race-guard path", async () => {
  const adapter = fixture();
  await assert.rejects(
    skipScheduledTask(adapter as unknown as D1Database, {
      taskId: "completed",
      dueDate: "2026-08-09",
      reason: null,
      actor: owner,
    }),
    (error) => error instanceof TaskDispositionError && error.status === 409,
  );
  assert.equal(task(adapter, "completed").skipped_at, null);
});

test("a skipped task cannot also be missed and bulk miss excludes settled tasks", async () => {
  const adapter = fixture();
  await assert.rejects(
    missScheduledTask(adapter as unknown as D1Database, {
      taskId: "skipped",
      dueDate: "2026-08-09",
      actor: owner,
    }),
    (error) => error instanceof TaskDispositionError && error.status === 409,
  );

  const changed = await missAllOverdueTasks(adapter as unknown as D1Database, {
    beforeDate: "2026-08-10",
    actor: owner,
    occurredAt: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(changed, 2, "only the two open overdue tasks should be marked missed");
  assert.equal(task(adapter, "open").missed_at, "2026-08-10T12:00:00.000Z");
  assert.equal(task(adapter, "other-open").missed_at, "2026-08-10T12:00:00.000Z");
  assert.equal(task(adapter, "skipped").missed_at, null);
  assert.equal(task(adapter, "completed").missed_at, null);
  assert.equal(task(adapter, "today").missed_at, null);
});

test("put back is idempotent and makes a task eligible for a later miss", async () => {
  const adapter = fixture();
  assert.deepEqual(
    await unskipScheduledTask(adapter as unknown as D1Database, "skipped", "2026-08-09"),
    { skipped: false },
  );
  assert.deepEqual(
    await unskipScheduledTask(adapter as unknown as D1Database, "skipped", "2026-08-09"),
    { skipped: false },
  );
  await missScheduledTask(adapter as unknown as D1Database, {
    taskId: "skipped",
    dueDate: "2026-08-09",
    actor: owner,
    occurredAt: "2026-08-10T13:00:00.000Z",
  });
  assert.equal(task(adapter, "skipped").missed_at, "2026-08-10T13:00:00.000Z");
});

test("legacy impossible dispositions are normalized without inventing care", async () => {
  const adapter = fixture();
  adapter.sqlite.exec(`
    INSERT INTO care_tasks
      (id, due_date, missed_at, missed_by_name, skipped_at, skipped_by_name, skip_reason)
    VALUES
      ('legacy-completed', '2026-08-09', '2026-08-09T08:00:00.000Z', 'Keeper A',
       '2026-08-09T09:00:00.000Z', 'Keeper B', 'Old race'),
      ('legacy-miss-newer', '2026-08-09', '2026-08-09T10:00:00.000Z', 'Keeper A',
       '2026-08-09T09:00:00.000Z', 'Keeper B', 'Changed mind'),
      ('legacy-skip-newer', '2026-08-09', '2026-08-09T08:00:00.000Z', 'Keeper A',
       '2026-08-09T11:00:00.000Z', 'Keeper B', 'Not needed');
    INSERT INTO husbandry_events VALUES
      ('event-legacy-completed', 'legacy-completed', '2026-08-09', NULL);
  `);

  await normalizeLegacyTaskDispositions(adapter as unknown as D1Database);

  assert.deepEqual(task(adapter, "legacy-completed"), {
    missed_at: null,
    missed_by_name: null,
    skipped_at: null,
    skipped_by_name: null,
    skip_reason: null,
  });
  assert.equal(task(adapter, "legacy-miss-newer").missed_at, "2026-08-09T10:00:00.000Z");
  assert.equal(task(adapter, "legacy-miss-newer").skipped_at, null);
  assert.equal(task(adapter, "legacy-skip-newer").missed_at, null);
  assert.equal(task(adapter, "legacy-skip-newer").skipped_at, "2026-08-09T11:00:00.000Z");

  // Running schema setup again must not change the chosen history.
  await normalizeLegacyTaskDispositions(adapter as unknown as D1Database);
  assert.equal(task(adapter, "legacy-miss-newer").missed_at, "2026-08-09T10:00:00.000Z");
  assert.equal(task(adapter, "legacy-skip-newer").skipped_at, "2026-08-09T11:00:00.000Z");
});
