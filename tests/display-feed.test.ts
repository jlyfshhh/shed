import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  isActionableTodayDisplayTask,
  summarizeTodayDisplayTasks,
  TODAY_DISPLAY_TASKS_SQL,
} from "../lib/display-feed.ts";

test("room display retains every scheduled disposition but exposes only actionable work", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE animals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      species TEXT NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE TABLE care_tasks (
      id TEXT PRIMARY KEY,
      schedule_id TEXT,
      animal_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      due_date TEXT NOT NULL,
      missed_at TEXT,
      skipped_at TEXT
    );
    CREATE TABLE husbandry_events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      due_date TEXT,
      outcome TEXT,
      voided_at TEXT
    );

    INSERT INTO animals VALUES
      ('active', 'Animal', 'Species', 1),
      ('inactive', 'Inactive animal', 'Species', 0);
    INSERT INTO care_tasks VALUES
      ('open', NULL, 'active', 'feeding', 'Open', '', '2026-08-13', NULL, NULL),
      ('missed', NULL, 'active', 'feeding', 'Missed', '', '2026-08-13', '2026-08-13T10:00:00Z', NULL),
      ('skipped', NULL, 'active', 'feeding', 'Skipped', '', '2026-08-13', NULL, '2026-08-13T10:00:00Z'),
      ('completed', NULL, 'active', 'feeding', 'Completed', '', '2026-08-13', NULL, NULL),
      ('completed-missed', NULL, 'active', 'feeding', 'Completed after miss', '', '2026-08-13', '2026-08-13T09:00:00Z', NULL),
      ('completed-skipped', NULL, 'active', 'feeding', 'Completed after skip', '', '2026-08-13', NULL, '2026-08-13T09:00:00Z'),
      ('refused', NULL, 'active', 'feeding', 'Refused', '', '2026-08-13', NULL, NULL),
      ('inactive-task', NULL, 'inactive', 'feeding', 'Inactive', '', '2026-08-13', NULL, NULL),
      ('other-day', NULL, 'active', 'feeding', 'Other day', '', '2026-08-12', NULL, NULL);
    INSERT INTO husbandry_events VALUES
      ('event-completed', 'completed', '2026-08-13', 'done', NULL),
      ('event-completed-missed', 'completed-missed', '2026-08-13', 'done', NULL),
      ('event-completed-skipped', 'completed-skipped', '2026-08-13', 'done', NULL),
      ('event-refused', 'refused', '2026-08-13', 'refused', NULL);
  `);

  const rows = db.prepare(TODAY_DISPLAY_TASKS_SQL).all("2026-08-13") as Array<{
    title: string;
    complete: number;
    outcome: string | null;
    missedAt: string | null;
    skippedAt: string | null;
  }>;

  assert.deepEqual(
    rows.map((row) => row.title).sort(),
    ["Completed", "Completed after miss", "Completed after skip", "Missed", "Open", "Refused", "Skipped"],
  );
  assert.deepEqual(
    rows.filter(isActionableTodayDisplayTask).map((row) => row.title),
    ["Open"],
  );
  assert.deepEqual(summarizeTodayDisplayTasks(rows), {
    total: 7,
    completed: 4,
    refused: 1,
    skipped: 1,
    missed: 1,
    remaining: 1,
  });
});

test("an all-missed or skipped day is settled without becoming complete", () => {
  const summary = summarizeTodayDisplayTasks([
    { complete: 0, outcome: null, missedAt: "2026-08-13T10:00:00Z", skippedAt: null },
    { complete: 0, outcome: null, missedAt: null, skippedAt: "2026-08-13T11:00:00Z" },
  ]);

  assert.deepEqual(summary, {
    total: 2,
    completed: 0,
    refused: 0,
    skipped: 1,
    missed: 1,
    remaining: 0,
  });
  assert.equal(
    summary.total,
    summary.completed + summary.skipped + summary.missed + summary.remaining,
  );
});
