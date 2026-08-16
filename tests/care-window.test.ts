import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CARE_SCHEDULE_JOIN_SQL,
  normalizeGraceDays,
  TASK_IS_CURRENT_SQL,
  TASK_IS_OVERDUE_SQL,
  taskIsCurrent,
  taskIsOverdue,
  taskLastDay,
} from "../lib/care-window.ts";

test("no window leaves the deadline on the due date", () => {
  assert.equal(taskLastDay("2026-08-15", 0), "2026-08-15");
  assert.equal(taskIsCurrent("2026-08-15", 0, "2026-08-15"), true);
  assert.equal(taskIsOverdue("2026-08-15", 0, "2026-08-16"), true);
});

test("a Saturday chore with one grace day is still to-do on Sunday", () => {
  // 2026-08-15 is a Saturday; the 16th is Sunday.
  assert.equal(taskIsCurrent("2026-08-15", 1, "2026-08-15"), true);
  assert.equal(taskIsCurrent("2026-08-15", 1, "2026-08-16"), true);
  assert.equal(taskIsOverdue("2026-08-15", 1, "2026-08-16"), false);
});

test("it goes overdue on Monday, not Sunday", () => {
  assert.equal(taskIsOverdue("2026-08-15", 1, "2026-08-17"), true);
  assert.equal(taskIsCurrent("2026-08-15", 1, "2026-08-17"), false);
});

test("a task is not current before it is due", () => {
  assert.equal(taskIsCurrent("2026-08-15", 1, "2026-08-14"), false);
});

test("the window crosses a month boundary", () => {
  assert.equal(taskLastDay("2026-08-31", 2), "2026-09-02");
  assert.equal(taskIsCurrent("2026-08-31", 2, "2026-09-02"), true);
  assert.equal(taskIsOverdue("2026-08-31", 2, "2026-09-03"), true);
});

test("the window crosses a leap day", () => {
  assert.equal(taskLastDay("2028-02-28", 1), "2028-02-29");
});

test("a nonsense window is treated as none", () => {
  for (const value of [-1, 1.5, NaN, null, undefined, "1", true]) {
    assert.equal(normalizeGraceDays(value), 0, `${String(value)} should normalize to 0`);
  }
  // A negative window must never pull a deadline earlier than the due date.
  assert.equal(taskLastDay("2026-08-15", -3), "2026-08-15");
});

test("the SQL rule agrees with the TypeScript rule", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE care_schedules (id TEXT PRIMARY KEY, grace_days INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE care_tasks (id TEXT PRIMARY KEY, schedule_id TEXT, due_date TEXT NOT NULL);
    INSERT INTO care_schedules (id, grace_days) VALUES ('weekend', 1), ('strict', 0);
    INSERT INTO care_tasks (id, schedule_id, due_date) VALUES
      ('chore',   'weekend', '2026-08-15'),
      ('feeding', 'strict',  '2026-08-15'),
      ('adhoc',   NULL,      '2026-08-15');
  `);

  const current = db.prepare(
    `SELECT t.id FROM care_tasks t ${CARE_SCHEDULE_JOIN_SQL} WHERE ${TASK_IS_CURRENT_SQL} ORDER BY t.id`,
  );
  const overdue = db.prepare(
    `SELECT t.id FROM care_tasks t ${CARE_SCHEDULE_JOIN_SQL} WHERE ${TASK_IS_OVERDUE_SQL} ORDER BY t.id`,
  );

  const cases: Array<[string, number, string]> = [
    ["chore", 1, "2026-08-16"],
    ["feeding", 0, "2026-08-16"],
    ["adhoc", 0, "2026-08-16"],
    ["chore", 1, "2026-08-17"],
  ];
  for (const [id, grace, today] of cases) {
    const isCurrent = current.all(today, today).some((row) => row.id === id);
    const isOverdue = overdue.all(today).some((row) => row.id === id);
    assert.equal(isCurrent, taskIsCurrent("2026-08-15", grace, today), `${id} current on ${today}`);
    assert.equal(isOverdue, taskIsOverdue("2026-08-15", grace, today), `${id} overdue on ${today}`);
  }
});

test("an ad-hoc task with no schedule gets no window", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE care_schedules (id TEXT PRIMARY KEY, grace_days INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE care_tasks (id TEXT PRIMARY KEY, schedule_id TEXT, due_date TEXT NOT NULL);
    INSERT INTO care_tasks (id, schedule_id, due_date) VALUES ('adhoc', NULL, '2026-08-15');
  `);
  const rows = db.prepare(
    `SELECT t.id FROM care_tasks t ${CARE_SCHEDULE_JOIN_SQL} WHERE ${TASK_IS_OVERDUE_SQL}`,
  ).all("2026-08-16");
  assert.equal(rows.length, 1, "a task with no schedule must be overdue the next day");
});
