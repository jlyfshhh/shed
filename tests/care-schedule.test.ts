import assert from "node:assert/strict";
import test from "node:test";

import { scheduledTasksForDate } from "../lib/care-schedule.ts";

const dailyMisters = ["pascal", "wasabi", "echo", "rue"];

test("arboreal daily misters never receive water-bowl tasks", () => {
  for (const date of ["2026-07-19", "2026-07-20", "2026-07-25"]) {
    const tasks = scheduledTasksForDate(date);
    for (const animalId of dailyMisters) {
      assert.ok(tasks.some((task) => task.id === `mist-${animalId}:${date}`));
      assert.ok(!tasks.some((task) => task.id === `water-${animalId}:${date}`));
    }
  }
});
