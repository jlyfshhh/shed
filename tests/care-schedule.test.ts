import assert from "node:assert/strict";
import test from "node:test";
import { scheduleIsDue, type CareScheduleRow } from "../lib/schedules.ts";

const base: CareScheduleRow = { id: "schedule", animalId: "animal", taskType: "care", title: "Care", details: "", frequency: "daily", intervalDays: null, weekdaysJson: null, dayOfMonth: null, startDate: "2026-07-01", endDate: null };

test("generic schedules support daily, weekly, interval, monthly, and one-time recurrence", () => {
  assert.equal(scheduleIsDue(base, "2026-07-20"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "weekly", weekdaysJson: "[6]" }, "2026-07-25"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "interval", intervalDays: 14 }, "2026-07-15"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "monthly", dayOfMonth: 20 }, "2026-08-20"), true);
  assert.equal(scheduleIsDue({ ...base, frequency: "once", startDate: "2026-07-20" }, "2026-07-21"), false);
});
