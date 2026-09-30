import assert from "node:assert/strict";
import test from "node:test";
import { careStreak, type StreakDay } from "../lib/care-streak.ts";

const day = (date: string, accountable: number, completed: number, missed = 0): StreakDay => ({ date, accountable, completed, missed });

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
