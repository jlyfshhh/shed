import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/week/route.ts", import.meta.url), "utf8");

// The future half of the week view derives tasks from care_schedules instead of
// reading materialized rows, so it has its own copy of "which task exists on
// which day". That copy silently omitted week_interval and animal_ids_json,
// which made every-other-week plans appear weekly and grouped plans show only
// their first animal. These guard that the projection keeps using the same
// inputs and helpers as materializeTasks, since nothing else forces it to.

/** The block that builds future days (from the future-dates branch onward). */
const future = route.slice(route.indexOf("futureDates.length"));

test("the future projection selects the N-week anchor and the covered-animal set", () => {
  assert.match(future, /s\.week_interval AS weekInterval/, "week_interval must be selected or alternating weeks project wrong");
  assert.match(future, /s\.animal_ids_json AS animalIdsJson/, "animal_ids_json must be selected or grouped plans lose members");
});

test("the future projection expands groups and applies brumation per animal", () => {
  assert.match(future, /scheduleAnimalIds\(schedule\)/, "must expand grouped plans to every covered animal");
  assert.match(future, /skipCareTask\(animal, date\)/, "must skip brumating animals per covered animal, not just the primary");
  assert.match(future, /scheduleIsDue\(schedule, date\)/, "must reuse the shared due-date rule");
});

test("the future projection no longer judges brumation on the primary animal alone", () => {
  // The old query filtered a.brumating = 0 on the single joined primary animal.
  // A grouped plan must instead be judged member by member, so that join filter
  // must be gone from the future block.
  assert.doesNotMatch(future, /JOIN animals a ON a\.id = s\.animal_id\s+WHERE s\.active = 1 AND a\.active = 1 AND a\.brumating = 0/);
});
