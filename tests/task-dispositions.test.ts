import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import {
  autoMissSupersededTasks,
  missAllOverdueTasks,
  missScheduledTask,
  normalizeLegacyTaskDispositions,
  skipScheduledTask,
  TaskDispositionError,
  unmissScheduledTask,
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
      animal_id TEXT,
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

test("un-miss returns a missed task to the list, is idempotent, and allows a later miss", async () => {
  const adapter = fixture();
  await missScheduledTask(adapter as unknown as D1Database, {
    taskId: "open",
    dueDate: "2026-08-09",
    actor: owner,
    occurredAt: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(task(adapter, "open").missed_at, "2026-08-10T12:00:00.000Z");

  assert.deepEqual(
    await unmissScheduledTask(adapter as unknown as D1Database, "open", "2026-08-09", "2026-08-10"),
    { missed: false },
  );
  assert.deepEqual(task(adapter, "open"), {
    missed_at: null,
    missed_by_name: null,
    skipped_at: null,
    skipped_by_name: null,
    skip_reason: null,
  });
  // Idempotent: undoing an already-open task is a no-op, not an error.
  assert.deepEqual(
    await unmissScheduledTask(adapter as unknown as D1Database, "open", "2026-08-09", "2026-08-10"),
    { missed: false },
  );
  // And the task can be missed again afterwards.
  await missScheduledTask(adapter as unknown as D1Database, {
    taskId: "open",
    dueDate: "2026-08-09",
    actor: owner,
    occurredAt: "2026-08-11T12:00:00.000Z",
  });
  assert.equal(task(adapter, "open").missed_at, "2026-08-11T12:00:00.000Z");
});

test("auto-miss closes a superseded occurrence once the plan is due again, and only then", async () => {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT NOT NULL, due_date TEXT NOT NULL,
      missed_at TEXT, missed_by_member_id TEXT, missed_by_name TEXT,
      skipped_at TEXT, skipped_by_member_id TEXT, skipped_by_name TEXT, skip_reason TEXT
    );
    CREATE TABLE husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, due_date TEXT, voided_at TEXT);
    INSERT INTO care_tasks (id, schedule_id, animal_id, due_date) VALUES
      ('feed:2026-11-01', 'feed', 'snake', '2026-11-01'),   -- open, overtaken by 11-08
      ('feed:2026-11-08', 'feed', 'snake', '2026-11-08'),   -- the now-due occurrence
      ('feed:2026-11-15', 'feed', 'snake', '2026-11-15'),   -- future, not due yet
      ('feed:2026-11-01-other', 'feed', 'gecko', '2026-11-01'), -- different animal, no later due
      ('mist:2026-11-01', 'mist', 'snake', '2026-11-01'),   -- different plan, no later due
      ('adhoc', NULL, 'snake', '2026-11-01'),               -- no schedule, never superseded
      ('feed:2026-10-18', 'feed', 'snake', '2026-10-18'),   -- completed, leave alone
      ('feed:2026-10-25', 'feed', 'snake', '2026-10-25');   -- skipped, leave alone
    UPDATE care_tasks SET skipped_at = '2026-10-26T00:00:00Z', skipped_by_name = 'Keeper A', skip_reason = 'Damp'
      WHERE id = 'feed:2026-10-25';
    INSERT INTO husbandry_events VALUES ('e1', 'feed:2026-10-18', '2026-10-18', NULL);
  `);

  const changed = await autoMissSupersededTasks(
    adapter as unknown as D1Database,
    "2026-11-08",
    "2026-11-08T12:00:00.000Z",
  );
  assert.equal(changed, 1, "only the snake's 11-01 feeding is superseded and still open");
  assert.equal(task(adapter, "feed:2026-11-01").missed_at, "2026-11-08T12:00:00.000Z");
  assert.equal(task(adapter, "feed:2026-11-01").missed_by_name, null, "auto-miss attributes no keeper");
  // The now-due one, a future one, a lone occurrence for another animal/plan, an
  // ad-hoc task, and already-settled (completed / skipped) ones are all untouched.
  for (const id of ["feed:2026-11-08", "feed:2026-11-15", "feed:2026-11-01-other", "mist:2026-11-01", "adhoc", "feed:2026-10-18"]) {
    assert.equal(task(adapter, id).missed_at, null, `${id} should not be auto-missed`);
  }
  assert.equal(task(adapter, "feed:2026-10-25").skipped_at, "2026-10-26T00:00:00Z");
  assert.equal(task(adapter, "feed:2026-10-25").missed_at, null);

  // Idempotent: a second pass has nothing left to do.
  assert.equal(await autoMissSupersededTasks(adapter as unknown as D1Database, "2026-11-08"), 0);
});

test("a superseded auto-miss cannot be put back, but a non-superseded miss can — and stays put through another pass", async () => {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT NOT NULL, due_date TEXT NOT NULL,
      missed_at TEXT, missed_by_member_id TEXT, missed_by_name TEXT,
      skipped_at TEXT, skipped_by_member_id TEXT, skipped_by_name TEXT, skip_reason TEXT
    );
    CREATE TABLE husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, due_date TEXT, voided_at TEXT);
    INSERT INTO care_tasks (id, schedule_id, animal_id, due_date) VALUES
      ('feed:2026-11-01', 'feed', 'snake', '2026-11-01'),   -- superseded by 11-08
      ('feed:2026-11-08', 'feed', 'snake', '2026-11-08'),   -- current (later one 11-15 not yet due)
      ('feed:2026-11-15', 'feed', 'snake', '2026-11-15');
  `);

  // 11-01 is auto-missed because 11-08 is due; restoring it is refused.
  assert.equal(await autoMissSupersededTasks(adapter as unknown as D1Database, "2026-11-08", "2026-11-08T12:00:00.000Z"), 1);
  await assert.rejects(
    unmissScheduledTask(adapter as unknown as D1Database, "feed:2026-11-01", "2026-11-01", "2026-11-08"),
    (error) => error instanceof TaskDispositionError && error.status === 409,
  );
  assert.equal(task(adapter, "feed:2026-11-01").missed_at, "2026-11-08T12:00:00.000Z", "a superseded miss stays missed");

  // 11-08 is not superseded (11-15 isn't due yet): a keeper can miss it and put it back,
  // and a later materialization pass must NOT silently re-miss it.
  await missScheduledTask(adapter as unknown as D1Database, {
    taskId: "feed:2026-11-08", dueDate: "2026-11-08", actor: owner, occurredAt: "2026-11-08T09:00:00.000Z",
  });
  assert.equal(task(adapter, "feed:2026-11-08").missed_at, "2026-11-08T09:00:00.000Z");
  assert.deepEqual(
    await unmissScheduledTask(adapter as unknown as D1Database, "feed:2026-11-08", "2026-11-08", "2026-11-08"),
    { missed: false },
  );
  assert.equal(task(adapter, "feed:2026-11-08").missed_at, null);
  assert.equal(await autoMissSupersededTasks(adapter as unknown as D1Database, "2026-11-08"), 0, "nothing new is superseded");
  assert.equal(task(adapter, "feed:2026-11-08").missed_at, null, "the restored, non-superseded task is left alone");
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
