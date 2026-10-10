import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { careStreak, careStreakFromDatabase, streakDays, type StreakDay } from "../lib/care-streak.ts";

// `pending` defaults to "everything accountable that is neither done nor a
// genuine miss" — i.e. still outstanding but not yet late. That matches the
// endpoint's invariant (accountable = completed + missed + pending) and keeps
// an unfinished-but-not-overdue day reading as "held", exactly as before.
const day = (date: string, accountable: number, completed: number, missed = 0, pending = Math.max(0, accountable - completed - missed)): StreakDay =>
  ({ date, accountable, completed, missed, pending });

test("a run of fully-cared days is the streak", () => {
  const days = [day("2026-01-01", 3, 3), day("2026-01-02", 2, 2), day("2026-01-03", 4, 4)];
  const s = careStreak(days, "2026-01-03");
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});

test("a missed task breaks the streak", () => {
  const days = [day("2026-01-01", 2, 2), day("2026-01-02", 2, 1, 1), day("2026-01-03", 2, 2)];
  const s = careStreak(days, "2026-01-03");
  assert.equal(s.current, 1, "only today after the break");
  assert.equal(s.longest, 1);
});

test("an unfinished today holds the streak instead of breaking it", () => {
  // Today has 3 due, 1 done so far, nothing missed — in progress, not broken.
  const days = [day("2026-01-01", 2, 2), day("2026-01-02", 2, 2), day("2026-01-03", 3, 1, 0)];
  const s = careStreak(days, "2026-01-03");
  assert.equal(s.todayInProgress, true);
  assert.equal(s.current, 2, "streak measured up to yesterday");
});

test("a finished today extends the streak", () => {
  const days = [day("2026-01-01", 2, 2), day("2026-01-02", 3, 3)];
  const s = careStreak(days, "2026-01-02");
  assert.equal(s.todayInProgress, false);
  assert.equal(s.current, 2);
});

test("longest can exceed the current streak", () => {
  const days = [day("d1", 1, 1), day("d2", 1, 1), day("d3", 1, 1), day("d4", 1, 0, 1), day("d5", 1, 1)];
  const s = careStreak(days, "d5");
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
});

test("skips do not count against a clean day (accountable already excludes them)", () => {
  // A day where everything accountable was done is clean even if some tasks were
  // skipped — the endpoint folds skips into the accountable/completed counts.
  const days = [day("2026-01-01", 1, 1), day("2026-01-02", 2, 2)];
  assert.equal(careStreak(days, "2026-01-02").current, 2);
});

test("no days means no streak", () => {
  const s = careStreak([], "2026-01-01");
  assert.equal(s.current, 0);
  assert.equal(s.longest, 0);
});

test("a day still inside its grace window holds the streak instead of breaking it", () => {
  // Friday's chore has grace days and is not done yet; today is still inside the
  // window. It must not read as a broken day the way an overdue miss would.
  const days = [
    day("2026-01-01", 1, 1),
    day("2026-01-02", 1, 1),
    day("2026-01-03", 1, 0, 0, 1), // held: outstanding, not yet late
  ];
  const s = careStreak(days, "2026-01-03");
  assert.equal(s.todayInProgress, true);
  assert.equal(s.current, 2, "the two settled clean days still count");
  assert.equal(s.longest, 2);
});

test("an unsettled day in the middle caps the current streak instead of being counted through", () => {
  // d3 is held (within grace). The streak can be claimed only up to the last
  // fully-settled boundary, so it stops at d3 rather than reaching d2/d1.
  const days = [day("d1", 1, 1), day("d2", 1, 1), day("d3", 1, 0, 0, 1), day("d4", 1, 1), day("d5", 1, 1)];
  const s = careStreak(days, "d5");
  assert.equal(s.current, 2, "only the settled days after the held day");
  assert.equal(s.longest, 2);
});

// ── Endpoint accountability / grace: the SQL read, against in-memory SQLite ──

class BoundStatement {
  private readonly statement: StatementSync;
  private readonly values: SQLInputValue[];

  constructor(statement: StatementSync, values: SQLInputValue[] = []) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values: unknown[]) { return new BoundStatement(this.statement, values as SQLInputValue[]); }
  first<T>() { return (this.statement.get(...this.values) as T | undefined) ?? null; }
  all<T>() { return { results: this.statement.all(...this.values) as T[], success: true, meta: {} }; }
  run() { const r = this.statement.run(...this.values); return { success: true, meta: { changes: Number(r.changes) } }; }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new BoundStatement(this.sqlite.prepare(sql)); }
  async batch(statements: BoundStatement[]) { return statements.map((s) => s.run()); }
}

function fixture() {
  const adapter = new SqliteD1();
  adapter.sqlite.exec(`
    CREATE TABLE animals (id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1, brumating INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE care_schedules (id TEXT PRIMARY KEY, grace_days INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT NOT NULL, due_date TEXT NOT NULL,
      missed_at TEXT, skipped_at TEXT
    );
    CREATE TABLE husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, due_date TEXT, voided_at TEXT);
  `);
  return adapter;
}

function addAnimal(a: SqliteD1, id: string) {
  a.sqlite.prepare("INSERT INTO animals (id, active, brumating) VALUES (?, 1, 0)").run(id);
}
function addSchedule(a: SqliteD1, id: string, graceDays: number) {
  a.sqlite.prepare("INSERT INTO care_schedules (id, grace_days) VALUES (?, ?)").run(id, graceDays);
}
/** Add a materialized task; mark it done, missed, or leave it open. */
function addTask(
  a: SqliteD1,
  task: { id: string; animalId: string; dueDate: string; scheduleId?: string | null; done?: boolean; missedAt?: string | null; skippedAt?: string | null },
) {
  a.sqlite.prepare("INSERT INTO care_tasks (id, schedule_id, animal_id, due_date, missed_at, skipped_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(task.id, task.scheduleId ?? null, task.animalId, task.dueDate, task.missedAt ?? null, task.skippedAt ?? null);
  if (task.done) {
    a.sqlite.prepare("INSERT INTO husbandry_events (id, task_id, due_date, voided_at) VALUES (?, ?, ?, NULL)")
      .run(`event-${task.id}`, task.id, task.dueDate);
  }
}

const WINDOW = 400;

test("pausing an animal does not rewrite its earlier misses (no streak inflation)", async () => {
  // Reproduces the finding: a recent miss on one animal breaks the streak; the
  // other animal's days stay clean. Pausing the first animal must not drop its
  // rows and heal the miss.
  const a = fixture();
  addAnimal(a, "a1");
  addAnimal(a, "a2");
  for (const date of ["2026-10-07", "2026-10-08", "2026-10-09"]) {
    addTask(a, { id: `a2-${date}`, animalId: "a2", dueDate: date, done: true });
  }
  addTask(a, { id: "a1-07", animalId: "a1", dueDate: "2026-10-07", done: true });
  addTask(a, { id: "a1-08", animalId: "a1", dueDate: "2026-10-08" }); // yesterday's open miss
  addTask(a, { id: "a1-09", animalId: "a1", dueDate: "2026-10-09", done: true });

  const before = await careStreakFromDatabase(a as unknown as D1Database, { today: "2026-10-09", windowDays: WINDOW });
  assert.equal(before.current, 1, "yesterday's miss breaks the streak back to just today");

  // Pause a1 today — change no task or event row.
  a.sqlite.prepare("UPDATE animals SET brumating = 1 WHERE id = 'a1'").run();
  const paused = await careStreakFromDatabase(a as unknown as D1Database, { today: "2026-10-09", windowDays: WINDOW });
  assert.deepEqual(paused, before, "a pause must not change the historical score");
  assert.equal(paused.current, 1, "the old miss is preserved, not healed to 3");

  // Archiving instead must behave identically.
  a.sqlite.prepare("UPDATE animals SET brumating = 0, active = 0 WHERE id = 'a1'").run();
  const archived = await careStreakFromDatabase(a as unknown as D1Database, { today: "2026-10-09", windowDays: WINDOW });
  assert.deepEqual(archived, before, "archiving must not change the historical score either");

  // And the day with the miss is still present and still broken.
  const days = await streakDays(a as unknown as D1Database, "2026-10-09", WINDOW);
  const missedDay = days.find((d) => d.date === "2026-10-08");
  assert.ok(missedDay && missedDay.missed === 1, "2026-10-08 still carries its miss after the pause/archive");
});

test("a task inside its grace window is held, not counted missed, until its deadline", async () => {
  const a = fixture();
  addAnimal(a, "a1");
  addSchedule(a, "weekend", 2); // Friday chore, good through Sunday
  addTask(a, { id: "t-0930", animalId: "a1", dueDate: "2026-09-30", done: true });
  addTask(a, { id: "t-1001", animalId: "a1", dueDate: "2026-10-01", done: true });
  addTask(a, { id: "t-1002", animalId: "a1", dueDate: "2026-10-02", scheduleId: "weekend" }); // Friday, open

  // Saturday: still inside the grace window (last day is 2026-10-04).
  const saturday = await streakDays(a as unknown as D1Database, "2026-10-03", WINDOW);
  const friday = saturday.find((d) => d.date === "2026-10-02");
  assert.ok(friday, "the Friday task is in the window");
  assert.equal(friday!.missed, 0, "not counted missed while inside its grace window");
  assert.equal(friday!.pending, 1, "it is held instead");
  const satStreak = careStreak(saturday, "2026-10-03");
  assert.equal(satStreak.current, 2, "the two earlier clean days still count; Friday does not break them");
  assert.equal(satStreak.todayInProgress, true);

  // Monday: the window has closed and the task is still not done — now a miss.
  const monday = await streakDays(a as unknown as D1Database, "2026-10-05", WINDOW);
  const fridayLate = monday.find((d) => d.date === "2026-10-02");
  assert.equal(fridayLate!.missed, 1, "past the deadline it is a genuine miss");
  assert.equal(fridayLate!.pending, 0);
  assert.equal(careStreak(monday, "2026-10-05").current, 0, "the overdue miss breaks the current streak");
});

test("a skipped-only day is left out and an explicit miss breaks the day", async () => {
  const a = fixture();
  addAnimal(a, "a1");
  addTask(a, { id: "s-0101", animalId: "a1", dueDate: "2026-01-01", skippedAt: "2026-01-01T09:00:00.000Z" });
  addTask(a, { id: "d-0102", animalId: "a1", dueDate: "2026-01-02", done: true });
  addTask(a, { id: "m-0103", animalId: "a1", dueDate: "2026-01-03", missedAt: "2026-01-03T20:00:00.000Z" });

  const days = await streakDays(a as unknown as D1Database, "2026-01-10", WINDOW);
  assert.equal(days.find((d) => d.date === "2026-01-01"), undefined, "a skipped-only day has no accountable care");
  assert.equal(days.find((d) => d.date === "2026-01-03")!.missed, 1, "an explicit miss is a miss regardless of grace");
});
