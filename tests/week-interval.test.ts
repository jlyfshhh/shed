import assert from "node:assert/strict";
import test from "node:test";

import { scheduleIsDue, weekInterval } from "../lib/schedules.ts";

const base = {
  id: "s", animalId: "a", taskType: "t", title: "T", details: "",
  frequency: "weekly" as const, intervalDays: null, dayOfMonth: null, endDate: null,
};
const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});
const hits = (plan: Parameters<typeof scheduleIsDue>[0], start: string, n: number) =>
  days(start, n).filter((date) => scheduleIsDue(plan, date));

test("a weekly plan with no interval is unchanged", () => {
  // Every plan that existed before this must behave identically.
  const weekly = { ...base, weekdaysJson: "[2,4]", startDate: "2026-09-01" };
  assert.deepEqual(hits(weekly, "2026-09-01", 14),
    ["2026-09-01", "2026-09-03", "2026-09-08", "2026-09-10"]);
  assert.deepEqual(hits({ ...weekly, weekInterval: 1 }, "2026-09-01", 14),
    ["2026-09-01", "2026-09-03", "2026-09-08", "2026-09-10"]);
});

test("alternating weeks interleave and never collide", () => {
  // The case this was built for: vitamin dust one week, plain calcium the next,
  // both on Tuesday and Thursday. Two plans instead of four.
  const weekA = { ...base, weekdaysJson: "[2,4]", weekInterval: 2, startDate: "2026-09-01" };
  const weekB = { ...base, weekdaysJson: "[2,4]", weekInterval: 2, startDate: "2026-09-08" };
  const a = new Set(hits(weekA, "2026-09-01", 60));
  const b = new Set(hits(weekB, "2026-09-01", 60));
  assert.ok(a.size > 0 && b.size > 0);
  for (const date of a) assert.ok(!b.has(date), `${date} is on both plans`);
  // Between them, every Tuesday and Thursday is covered exactly once.
  for (const date of days("2026-09-01", 60)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday !== 2 && weekday !== 4) continue;
    assert.ok(a.has(date) !== b.has(date), `${date} is covered by neither or both`);
  }
});

test("the skipped weeks really are skipped", () => {
  const fortnightly = { ...base, weekdaysJson: "[2]", weekInterval: 2, startDate: "2026-09-01" };
  assert.deepEqual(hits(fortnightly, "2026-09-01", 29), ["2026-09-01", "2026-09-15", "2026-09-29"]);
});

test("which week is 'on' does not drift across a month or a year", () => {
  const fortnightly = { ...base, weekdaysJson: "[2]", weekInterval: 2, startDate: "2026-12-01" };
  const dates = hits(fortnightly, "2026-12-01", 70);
  assert.deepEqual(dates, ["2026-12-01", "2026-12-15", "2026-12-29", "2027-01-12", "2027-01-26"]);
  // Assert the property rather than a hand-copied list: every gap is exactly a
  // fortnight, straight through the month and year boundaries.
  for (let i = 1; i < dates.length; i += 1) {
    const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
    assert.equal(gap, 14, `${dates[i - 1]} -> ${dates[i]}`);
  }
});

test("a nonsense interval is treated as every week rather than dividing by zero", () => {
  for (const bad of [0, -3, 1.5, null, undefined, "2" as unknown]) {
    assert.equal(weekInterval(bad), 1, String(bad));
  }
  const zero = { ...base, weekdaysJson: "[2]", weekInterval: 0, startDate: "2026-09-01" };
  assert.deepEqual(hits(zero, "2026-09-01", 15), ["2026-09-01", "2026-09-08", "2026-09-15"]);
});

test("an interval only applies to weekly plans", () => {
  // A stray value on a daily plan must not start skipping days.
  const daily = { ...base, frequency: "daily" as const, weekdaysJson: null, weekInterval: 2, startDate: "2026-09-01" };
  assert.equal(hits(daily, "2026-09-01", 5).length, 5);
});
