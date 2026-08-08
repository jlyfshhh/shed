import assert from "node:assert/strict";
import test from "node:test";
import { addDays, describeWeek, resolveWeekStart, shiftWeeks, startOfWeek, weekDates, weekdayIndex } from "../lib/week.ts";

test("the week starts on Sunday", () => {
  // 2026-08-08 is a Saturday, so its week began on 2026-08-02.
  assert.equal(startOfWeek("2026-08-08"), "2026-08-02");
  assert.equal(startOfWeek("2026-08-02"), "2026-08-02", "a Sunday is its own week start");
  assert.equal(startOfWeek("2026-08-03"), "2026-08-02", "Monday belongs to the Sunday before it");
});

test("weekDates returns seven consecutive days, Sunday first", () => {
  const dates = weekDates("2026-08-05");
  assert.deepEqual(dates, [
    "2026-08-02", "2026-08-03", "2026-08-04",
    "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08",
  ]);
  assert.equal(weekdayIndex(dates[0]), 0);
  assert.equal(weekdayIndex(dates[6]), 6);
});

test("navigation crosses month and year boundaries", () => {
  assert.equal(shiftWeeks("2026-08-02", -1), "2026-07-26");
  assert.equal(shiftWeeks("2026-12-27", 1), "2027-01-03");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01", "2026 is not a leap year");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29", "2024 is");
});

test("a week is seven days no matter when daylight saving moves", () => {
  // US DST ends 2026-11-01, inside this week. Parsing at UTC noon means the
  // 25-hour local day cannot round a date backwards.
  const dates = weekDates("2026-11-04");
  assert.equal(dates.length, 7);
  assert.equal(dates[0], "2026-11-01");
  assert.equal(dates[6], "2026-11-07");
  assert.equal(new Set(dates).size, 7, "no day is repeated or skipped");
});

test("a bad or missing start falls back to this week instead of erroring", () => {
  assert.equal(resolveWeekStart(null, "2026-08-08"), "2026-08-02");
  assert.equal(resolveWeekStart("", "2026-08-08"), "2026-08-02");
  assert.equal(resolveWeekStart("not-a-date", "2026-08-08"), "2026-08-02");
  assert.equal(resolveWeekStart("2026-13-45", "2026-08-08"), "2026-08-02");
  assert.equal(resolveWeekStart("'; DROP TABLE care_tasks; --", "2026-08-08"), "2026-08-02");
});

test("a mid-week start is snapped to its Sunday", () => {
  // Otherwise a hand-edited URL would render a week running Wed–Tue.
  assert.equal(resolveWeekStart("2026-08-06", "2026-08-08"), "2026-08-02");
});

test("nearby weeks are named, distant ones get their dates", () => {
  const today = "2026-08-08";
  assert.equal(describeWeek("2026-08-02", today), "This week");
  assert.equal(describeWeek("2026-07-26", today), "Last week");
  assert.equal(describeWeek("2026-08-09", today), "Next week");
  assert.equal(describeWeek("2026-08-16", today), "Aug 16–22");
  assert.equal(describeWeek("2026-08-30", today), "Aug 30 – Sep 5", "a week spanning two months names both");
});
