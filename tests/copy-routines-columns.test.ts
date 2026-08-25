import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { COPYABLE_SCHEDULE_COLUMNS, DELIBERATELY_NOT_COPIED } from "../lib/copy-routines.ts";

/** The columns the app actually creates, read from the statement it runs. */
function scheduleColumns(): string[] {
  const runtime = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");
  const create = runtime.slice(runtime.indexOf("CREATE TABLE IF NOT EXISTS care_schedules ("));
  const body = create.slice(create.indexOf("(") + 1, create.indexOf(")\""));
  const columns = body.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  // Columns added to existing databases after the fact.
  const added = [...runtime.matchAll(/addMissingColumns\(db, "care_schedules", \[([^\]]*)\]/g)]
    .flatMap((match) => [...match[1].matchAll(/\["(\w+)"/g)].map((m) => m[1]));
  return [...new Set([...columns, ...added])];
}

test("every care-plan column is either copied or deliberately excluded", () => {
  // Copying ran off a hand-written list with nothing holding it to the schema,
  // so grace_days and end_date were silently dropped: a copied weekend chore
  // went overdue a day early and a plan meant to end ran forever. The same
  // shape of gap has now cost this app three separate bugs.
  const classified = new Set<string>([...COPYABLE_SCHEDULE_COLUMNS, ...DELIBERATELY_NOT_COPIED]);
  const unclassified = scheduleColumns().filter((column) => !classified.has(column));
  assert.deepEqual(unclassified, [], `care_schedules columns neither copied nor excluded: ${unclassified.join(", ")}`);
});

test("the exclusions are real columns, not stale names", () => {
  const columns = new Set(scheduleColumns());
  const stale = [...COPYABLE_SCHEDULE_COLUMNS, ...DELIBERATELY_NOT_COPIED].filter((c) => !columns.has(c));
  assert.deepEqual(stale, [], `named columns that no longer exist: ${stale.join(", ")}`);
});

test("a copy never inherits the source plan's other animals", () => {
  // A grouped plan copied onto a new animal must cover that animal only.
  assert.ok(!COPYABLE_SCHEDULE_COLUMNS.includes("animal_ids_json" as never));
  assert.ok(DELIBERATELY_NOT_COPIED.includes("animal_ids_json" as never));
});
