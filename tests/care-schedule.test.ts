import assert from "node:assert/strict";
import test from "node:test";
import { careLookbackDates, overdueStartDate } from "../lib/care-schedule.ts";
import { scheduleIsDue, type CareScheduleRow } from "../lib/schedules.ts";

const base: CareScheduleRow = { id: "schedule", animalId: "animal", taskType: "care", title: "Care", details: "", frequency: "daily", intervalDays: null, weekdaysJson: null, dayOfMonth: null, startDate: "2026-07-01", endDate: null };

test("generic schedules support daily, weekly, interval, monthly, and one-time recurrence", () => {
  assert.equal(scheduleIsDue(base, "2026-07-20"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "weekly", weekdaysJson: "[6]" }, "2026-07-25"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "interval", intervalDays: 14 }, "2026-07-15"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "monthly", dayOfMonth: 20 }, "2026-08-20"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "monthly", dayOfMonth: 1, weekdaysJson: "[6]" }, "2026-08-01"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "monthly", dayOfMonth: 1, weekdaysJson: "[6]" }, "2026-08-08"), false);
  assert.equal(scheduleIsDue({ ...base, frequency: "monthly", dayOfMonth: 2, weekdaysJson: "[6]" }, "2026-08-08"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "once", startDate: "2026-07-20" }, "2026-07-21"), false);
});

test("the fresh-start baseline prevents old tasks from regenerating or becoming overdue", () => {
  const dates = careLookbackDates("2026-07-24", "2026-07-24");
  assert.deepEqual(dates, ["2026-07-24"]);
  assert.equal(overdueStartDate("2026-07-24", "2026-07-24"), "2026-07-24");
});

test("without a baseline Shed keeps the full 14-day actionable window", () => {
  const dates = careLookbackDates("2026-07-24", null);
  assert.equal(dates.length, 14);
  assert.equal(dates.at(-1), "2026-07-11");
  assert.equal(overdueStartDate("2026-07-24", null), "2026-07-11");
});
