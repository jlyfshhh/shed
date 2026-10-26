import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { materializeTasks } from "../lib/materialize-tasks.ts";
import { clearPendingTasksFromStatement, clearPendingTasksInWindowStatement } from "../lib/care-boundaries.ts";
import { careStreak, streakDays } from "../lib/care-streak.ts";

// F08: archive and brumation boundaries must be date-bounded. Tasks for an
// archived animal must stop being materialized (so the streak does not score
// phantom pending/missed care), settled history and pre-boundary implicit misses
// must survive, and resuming a brumation must delete ONLY the paused days — not
// an earlier miss. Exercised against the real materializer and the real streak
// reader.

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
const asD1 = (a: SqliteD1) => a as unknown as D1Database;

function fixture() {
  const a = new SqliteD1();
  a.sqlite.exec(`
    CREATE TABLE animals (id TEXT PRIMARY KEY, name TEXT, active INTEGER NOT NULL DEFAULT 1, brumating INTEGER NOT NULL DEFAULT 0, brumation_since TEXT, care_resume_on TEXT);
    CREATE TABLE care_schedules (id TEXT PRIMARY KEY, animal_id TEXT, animal_ids_json TEXT, task_type TEXT, title TEXT, details TEXT, frequency TEXT, interval_days INTEGER, weekdays_json TEXT, day_of_month INTEGER, week_interval INTEGER NOT NULL DEFAULT 1, start_date TEXT, end_date TEXT, grace_days INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE care_tasks (id TEXT PRIMARY KEY, schedule_id TEXT, animal_id TEXT NOT NULL, task_type TEXT, title TEXT, details TEXT, due_date TEXT NOT NULL, missed_at TEXT, skipped_at TEXT);
    CREATE UNIQUE INDEX care_tasks_unique ON care_tasks(schedule_id, animal_id, due_date);
    CREATE TABLE husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, due_date TEXT, voided_at TEXT);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  return a;
}
function addAnimal(a: SqliteD1, id: string, extra: { active?: number; brumating?: number; brumationSince?: string | null; careResumeOn?: string | null } = {}) {
  a.sqlite.prepare("INSERT INTO animals (id, name, active, brumating, brumation_since, care_resume_on) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, id, extra.active ?? 1, extra.brumating ?? 0, extra.brumationSince ?? null, extra.careResumeOn ?? null);
}
function addDailyPlan(a: SqliteD1, id: string, animalId: string, startDate: string, animalIdsJson: string | null = null) {
  a.sqlite.prepare("INSERT INTO care_schedules (id, animal_id, animal_ids_json, task_type, title, details, frequency, start_date, active) VALUES (?, ?, ?, 'feeding', 'Feed', '', 'daily', ?, 1)")
    .run(id, animalId, animalIdsJson, startDate);
}
function taskId(a: SqliteD1, animalId: string, dueDate: string): string | null {
  const row = a.sqlite.prepare("SELECT id FROM care_tasks WHERE animal_id = ? AND due_date = ?").get(animalId, dueDate) as { id: string } | undefined;
  return row?.id ?? null;
}
function complete(a: SqliteD1, id: string, dueDate: string) {
  a.sqlite.prepare("INSERT INTO husbandry_events (id, task_id, due_date, voided_at) VALUES (?, ?, ?, NULL)").run(`evt-${id}`, id, dueDate);
}
function addRawTask(a: SqliteD1, scheduleId: string, animalId: string, dueDate: string, marks: { missedAt?: string | null } = {}) {
  const id = `${scheduleId}:${animalId}:${dueDate}`;
  a.sqlite.prepare("INSERT INTO care_tasks (id, schedule_id, animal_id, due_date, missed_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, scheduleId, animalId, dueDate, marks.missedAt ?? null);
  return id;
}
function taskDates(a: SqliteD1, animalId: string): string[] {
  return (a.sqlite.prepare("SELECT due_date AS d FROM care_tasks WHERE animal_id = ? ORDER BY due_date").all(animalId) as { d: string }[]).map((r) => r.d);
}
const WINDOW = 400;

test("the materializer skips archived animals but still serves their active cage-mates", async () => {
  const a = fixture();
  addAnimal(a, "alpha");
  addAnimal(a, "beta", { active: 0 }); // archived
  addDailyPlan(a, "twins", "alpha", "2026-10-20", JSON.stringify(["alpha", "beta"]));

  await materializeTasks(asD1(a), "2026-10-25");
  assert.ok(taskDates(a, "alpha").length > 0, "the active animal gets its tasks");
  assert.deepEqual(taskDates(a, "beta"), [], "the archived cage-mate gets none");
});

test("archiving stops phantom streak scoring and preserves settled history", async () => {
  const a = fixture();
  addAnimal(a, "dragon");
  addDailyPlan(a, "feed", "dragon", "2026-10-01");

  // Build 14 days of history ending today; complete everything up to yesterday,
  // leaving today's task pending (held).
  await materializeTasks(asD1(a), "2026-10-25");
  for (let d = 12; d <= 24; d += 1) {
    const date = `2026-10-${d}`;
    const id = taskId(a, "dragon", date)!;
    complete(a, id, date);
  }
  const before = careStreak(await streakDays(asD1(a), "2026-10-25", WINDOW), "2026-10-25");
  assert.equal(before.current, 13, "13 settled clean days");
  assert.equal(before.todayInProgress, true, "today still held");

  // Archive the animal: clear its pending today/future tasks, then re-materialize.
  a.sqlite.prepare("UPDATE animals SET active = 0 WHERE id = 'dragon'").run();
  clearPendingTasksFromStatement(asD1(a), "dragon", "2026-10-25").run();
  await materializeTasks(asD1(a), "2026-10-25");
  assert.equal(taskId(a, "dragon", "2026-10-25"), null, "today's pending task is gone");

  // Day rolls forward; re-materialize. No new tasks appear for the archived animal.
  await materializeTasks(asD1(a), "2026-10-30");
  const future = taskDates(a, "dragon").filter((d) => d >= "2026-10-25");
  assert.deepEqual(future, [], "no phantom today/future tasks for the archived animal");

  const after = await streakDays(asD1(a), "2026-10-30", WINDOW);
  assert.equal(after.some((day) => day.missed > 0), false, "no phantom missed day after archiving");
  assert.equal(careStreak(after, "2026-10-30").current, 13, "the 13 clean days of history are preserved");

  // Negative control: a phantom pending task (what the old materializer left
  // behind for an archived animal) is exactly what would break the streak.
  addRawTask(a, "feed", "dragon", "2026-10-25");
  const withPhantom = await streakDays(asD1(a), "2026-10-30", WINDOW);
  const phantomDay = withPhantom.find((day) => day.date === "2026-10-25");
  assert.ok(phantomDay && phantomDay.missed === 1, "the phantom would score as a miss — the bug the fix prevents");
});

test("resuming a brumation clears only the paused days and keeps a pre-pause miss", async () => {
  const a = fixture();
  addAnimal(a, "dragon", { brumating: 1, brumationSince: "2026-10-21" });
  addDailyPlan(a, "feed", "dragon", "2026-10-01");
  // A genuine implicit miss before the pause, plus two paused-day tasks.
  addRawTask(a, "feed", "dragon", "2026-10-19"); // pre-pause miss (unsettled)
  addRawTask(a, "feed", "dragon", "2026-10-21"); // paused day
  addRawTask(a, "feed", "dragon", "2026-10-22"); // paused day

  // Resume on 2026-10-23: clear the pause window [brumation_since, today) only.
  a.sqlite.prepare("UPDATE animals SET brumating = 0, brumation_since = NULL, care_resume_on = '2026-10-23' WHERE id = 'dragon'").run();
  clearPendingTasksInWindowStatement(asD1(a), "dragon", "2026-10-21", "2026-10-23").run();

  assert.deepEqual(taskDates(a, "dragon"), ["2026-10-19"], "paused days gone, the pre-pause miss survives");
  const days = await streakDays(asD1(a), "2026-10-23", WINDOW);
  const miss = days.find((day) => day.date === "2026-10-19");
  assert.ok(miss && miss.missed === 1, "the Oct 19 miss is still scored after resume");
});

test("the old unbounded resume delete destroyed the pre-pause miss (regression guard)", async () => {
  // Proves the fix matters: the previous `due_date < today` delete removed the
  // Oct 19 miss along with the paused days.
  const a = fixture();
  addAnimal(a, "dragon");
  addDailyPlan(a, "feed", "dragon", "2026-10-01");
  addRawTask(a, "feed", "dragon", "2026-10-19");
  addRawTask(a, "feed", "dragon", "2026-10-21");
  addRawTask(a, "feed", "dragon", "2026-10-22");

  // The old statement, replayed:
  a.sqlite.prepare(
    "DELETE FROM care_tasks WHERE animal_id = ? AND due_date < ? AND skipped_at IS NULL AND missed_at IS NULL AND NOT EXISTS (SELECT 1 FROM husbandry_events e WHERE e.task_id = care_tasks.id AND e.voided_at IS NULL)",
  ).run("dragon", "2026-10-23");
  assert.deepEqual(taskDates(a, "dragon"), [], "the old delete wrongly removed the Oct 19 miss too");

  // The new bounded statement would have kept it.
  const b = fixture();
  addAnimal(b, "dragon");
  addDailyPlan(b, "feed", "dragon", "2026-10-01");
  addRawTask(b, "feed", "dragon", "2026-10-19");
  addRawTask(b, "feed", "dragon", "2026-10-21");
  addRawTask(b, "feed", "dragon", "2026-10-22");
  clearPendingTasksInWindowStatement(asD1(b), "dragon", "2026-10-21", "2026-10-23").run();
  assert.deepEqual(taskDates(b, "dragon"), ["2026-10-19"], "the fix preserves it");
});

test("pausing clears unsettled care from the boundary so a paused day is not scored missed", async () => {
  // C: the streak reader scores from task rows, not the live flag, so a pause
  // that keeps pending rows lets the paused days score pending-then-missed.
  const a = fixture();
  addAnimal(a, "dragon");
  addDailyPlan(a, "feed", "dragon", "2026-10-24");
  await materializeTasks(asD1(a), "2026-10-25");
  assert.ok(taskId(a, "dragon", "2026-10-25"), "today's task exists before pausing");

  // Pause on Oct 25 exactly as the route does: set the flag (preserving any
  // existing start) and clear unsettled tasks from the pause boundary forward.
  a.sqlite.prepare("UPDATE animals SET brumating = 1, brumation_since = COALESCE(brumation_since, '2026-10-25'), care_resume_on = NULL WHERE id = 'dragon'").run();
  clearPendingTasksFromStatement(asD1(a), "dragon", "2026-10-25").run();
  assert.equal(taskId(a, "dragon", "2026-10-25"), null, "the paused day's pending task is cleared");

  // Day rolls to Oct 26 while still paused; re-materialize (the brumating animal
  // is skipped). The paused day must not score as a miss.
  await materializeTasks(asD1(a), "2026-10-26");
  const days = await streakDays(asD1(a), "2026-10-26", WINDOW);
  const paused = days.find((day) => day.date === "2026-10-25");
  assert.ok(!paused || paused.missed === 0, "the paused day is not scored as a miss");

  // Negative control: the old pause kept the pending row, which is exactly what
  // scores the paused day missed on the day-roll.
  addRawTask(a, "feed", "dragon", "2026-10-25");
  const withPhantom = await streakDays(asD1(a), "2026-10-26", WINDOW);
  const phantom = withPhantom.find((day) => day.date === "2026-10-25");
  assert.ok(phantom && phantom.missed === 1, "a retained pending row would wrongly score the paused day missed");
});

test("a repeated pause preserves the original brumation_since", () => {
  // C: a later same-brumation re-pause must not overwrite the start, or the
  // resume cleanup window shrinks and earlier paused days leak back.
  const a = fixture();
  addAnimal(a, "dragon");
  a.sqlite.prepare("UPDATE animals SET brumating = 1, brumation_since = COALESCE(brumation_since, '2026-10-21') WHERE id = 'dragon'").run();
  a.sqlite.prepare("UPDATE animals SET brumating = 1, brumation_since = COALESCE(brumation_since, '2026-10-25') WHERE id = 'dragon'").run();
  const since = (a.sqlite.prepare("SELECT brumation_since AS s FROM animals WHERE id = 'dragon'").get() as { s: string }).s;
  assert.equal(since, "2026-10-21", "the original pause start survives a repeated pause");
});

test("a reactivated animal resumes care without backfilling the archived gap", async () => {
  // care_resume_on is the lookback floor set on un-archive; the materializer must
  // not regenerate tasks for the days the animal was archived.
  const a = fixture();
  addAnimal(a, "dragon", { careResumeOn: "2026-10-25" }); // reactivated today
  addDailyPlan(a, "feed", "dragon", "2026-10-01");

  await materializeTasks(asD1(a), "2026-10-25");
  const dates = taskDates(a, "dragon");
  assert.ok(dates.every((d) => d >= "2026-10-25"), "nothing before the resume floor is backfilled");
  assert.ok(dates.includes("2026-10-25"), "care resumes from today");
});
