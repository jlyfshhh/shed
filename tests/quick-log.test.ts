import assert from "node:assert/strict";
import test from "node:test";

import {
  collectQuickLogTasks,
  quickLogCareDateValid,
  summariseQuickLogSave,
  type QuickLogEntryResult,
  type QuickLogSource,
} from "../lib/quick-log.ts";

const TODAY = "2026-10-09";

const source = (over: Partial<QuickLogSource> & Pick<QuickLogSource, "id">): QuickLogSource => ({
  animalId: "a1",
  title: "Feed",
  dueDate: TODAY,
  complete: false,
  skippedAt: null,
  missedAt: null,
  ...over,
});

// ── collectQuickLogTasks: only genuinely-due care, never settled occurrences ──

test("settled skips and misses are left out of due care", () => {
  const rows = collectQuickLogTasks(
    [
      source({ id: "due" }),
      source({ id: "skipped", skippedAt: "2026-10-08T00:00:00Z" }),
      source({ id: "missed", missedAt: "2026-10-08T00:00:00Z" }),
      source({ id: "done", complete: true }),
    ],
    "a1",
    TODAY,
  );
  assert.deepEqual(rows.map((row) => row.id), ["due"]);
});

test("only the scanned animal's tasks are collected", () => {
  const rows = collectQuickLogTasks(
    [source({ id: "mine" }), source({ id: "theirs", animalId: "a2" })],
    "a1",
    TODAY,
  );
  assert.deepEqual(rows.map((row) => row.id), ["mine"]);
});

test("a task appearing in both tasks and overdue is shown once", () => {
  const dup = source({ id: "t1", dueDate: "2026-10-01" });
  const rows = collectQuickLogTasks([dup, dup], "a1", TODAY);
  assert.equal(rows.length, 1);
});

test("overdue is computed from grace window, not just the due date", () => {
  const rows = collectQuickLogTasks(
    [
      source({ id: "today", dueDate: TODAY }),
      source({ id: "ingrace", dueDate: "2026-10-08", graceDays: 2 }),
      source({ id: "late", dueDate: "2026-10-01" }),
    ],
    "a1",
    TODAY,
  );
  const overdue = Object.fromEntries(rows.map((row) => [row.id, row.overdue]));
  assert.equal(overdue.today, false);
  assert.equal(overdue.ingrace, false); // still inside its 2-day window
  assert.equal(overdue.late, true);
});

test("the due date is shown only when the title alone wouldn't disambiguate", () => {
  const rows = collectQuickLogTasks(
    [
      source({ id: "a", title: "Feed", dueDate: "2026-10-02" }),
      source({ id: "b", title: "Feed", dueDate: "2026-10-09" }),
      source({ id: "c", title: "Mist", dueDate: TODAY }),
    ],
    "a1",
    TODAY,
  );
  const show = Object.fromEntries(rows.map((row) => [row.id, row.showDueDate]));
  assert.equal(show.a, true); // duplicate "Feed" title, and not today
  assert.equal(show.b, true); // duplicate "Feed" title
  assert.equal(show.c, false); // unique title, due today
});

// ── quickLogCareDateValid: the Today timing dialog's bounds, reused ──

test("a current task needs no date choice", () => {
  const task = { id: "t", title: "Feed", dueDate: TODAY, overdue: false, showDueDate: false };
  assert.equal(quickLogCareDateValid(task, "", TODAY), true);
});

test("an overdue task's care date is bounded by due date and today", () => {
  const task = { id: "t", title: "Feed", dueDate: "2026-10-05", overdue: true, showDueDate: true };
  assert.equal(quickLogCareDateValid(task, "2026-10-05", TODAY), true); // the due date
  assert.equal(quickLogCareDateValid(task, "2026-10-07", TODAY), true); // in between
  assert.equal(quickLogCareDateValid(task, TODAY, TODAY), true); // today
  assert.equal(quickLogCareDateValid(task, "2026-10-04", TODAY), false); // before due
  assert.equal(quickLogCareDateValid(task, "2026-10-10", TODAY), false); // after today
});

// ── summariseQuickLogSave: shortage is recorded, not failed ──

const okTask = (note: string, extra: Partial<Extract<QuickLogEntryResult, { ok: true }>> = {}): QuickLogEntryResult => ({
  ok: true,
  note,
  ...extra,
});
const failed = (label: string, error = "Unable to save"): QuickLogEntryResult => ({ ok: false, label, error });

test("a clean save stitches each entry's own note and is not slow", () => {
  const summary = summariseQuickLogSave([
    okTask("Noodle: Feed recorded · small rat used"),
    okTask("Weight 42 g logged"),
  ]);
  assert.equal(summary.allSaved, true);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.slow, false);
  assert.match(summary.message, /small rat used/);
  assert.match(summary.message, /Weight 42 g logged/);
});

test("a feeder shortage saves the care, flags it, and never reads as a failure", () => {
  const summary = summariseQuickLogSave([
    okTask("Noodle: Feed recorded · no feeder deducted — add it in Manage → Feeders if you used stock", {
      shortage: true,
      slow: true,
    }),
  ]);
  assert.equal(summary.allSaved, true);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.slow, true);
  assert.match(summary.message, /no feeder deducted/);
  assert.doesNotMatch(summary.message, /Couldn’t save/);
});

test("a partial failure reports what saved and what to retry", () => {
  const summary = summariseQuickLogSave([okTask("Noodle: Feed recorded"), failed("Weight", "Network error")]);
  assert.equal(summary.allSaved, false);
  assert.equal(summary.savedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.match(summary.message, /^Saved 1\. /);
  assert.match(summary.message, /Couldn’t save: Weight/);
});

test("when nothing saved the message does not pretend otherwise", () => {
  const summary = summariseQuickLogSave([failed("Feed"), failed("Shed")]);
  assert.equal(summary.allSaved, false);
  assert.equal(summary.savedCount, 0);
  assert.doesNotMatch(summary.message, /Saved/);
  assert.match(summary.message, /Feed, Shed/);
});
