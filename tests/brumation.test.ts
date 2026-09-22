import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { skipCareTask } from "../lib/brumation.ts";

// ── The pure decision: what the materializer creates ─────────────────────────

test("a wide-awake animal is never skipped", () => {
  assert.equal(skipCareTask(undefined, "2026-09-22"), false);
  assert.equal(skipCareTask({ brumating: false, careResumeOn: null }, "2026-09-22"), false);
});

test("a brumating animal is skipped on every date", () => {
  assert.equal(skipCareTask({ brumating: true }, "2026-09-22"), true);
  assert.equal(skipCareTask({ brumating: 1 }, "1999-01-01"), true);
});

test("after resuming, the paused days stay skipped but today does not", () => {
  // Ended brumation on the 22nd; the 14-day backfill must not refill the pause.
  const resumed = { brumating: false, careResumeOn: "2026-09-22" };
  assert.equal(skipCareTask(resumed, "2026-09-15"), true, "a paused day");
  assert.equal(skipCareTask(resumed, "2026-09-21"), true, "the day before resuming");
  assert.equal(skipCareTask(resumed, "2026-09-22"), false, "the resume day is live");
  assert.equal(skipCareTask(resumed, "2026-09-25"), false, "days after resume are live");
});

// ── The guard: no care-task listing may forget the brumating filter ──────────

/**
 * Five separate bugs in this app came from a hand-maintained list nothing held
 * to a single source of truth. Brumation adds one more such list: every query
 * that lists care tasks for a keeper must exclude brumating animals, or a
 * paused animal's tasks leak back onto someone's screen. Assert it structurally
 * so a new task query cannot silently miss it.
 */
const CARE_TASK_QUERY_SOURCES = [
  "app/api/dashboard/route.ts",
  "app/api/week/route.ts",
  "app/api/display/route.ts",
  "lib/display-feed.ts",
];

/**
 * Every keeper-facing task listing narrows to a live animal with `a.active = 1
 * AND …` (the animal roster, which should still show a brumating animal, ends
 * that clause differently: `a.active = 1 ORDER BY`). So the presence of the
 * follow-on `AND` is exactly the signal that this is a task list, and every one
 * of them must carry the brumating filter right after it. Queries are built by
 * concatenating fragments, so match on whitespace-normalised whole-file text.
 */
test("every care-task listing filters out brumating animals", () => {
  let checked = 0;
  for (const source of CARE_TASK_QUERY_SOURCES) {
    const text = readFileSync(new URL(`../${source}`, import.meta.url), "utf8").replace(/\s+/g, " ");
    for (const match of text.matchAll(/a\.active = 1 AND (.{0,20})/g)) {
      checked += 1;
      assert.match(
        match[1],
        /^a\.brumating = 0\b/,
        `${source}: a task listing scoped to active animals is missing the brumating filter (found "${match[1]}")`,
      );
    }
  }
  // If this ever drops to zero the scan broke, not the code.
  assert.ok(checked >= 5, `expected to check several task queries, checked ${checked}`);
});

test("the resume path clears the pending backlog but never history", () => {
  const route = readFileSync(new URL("../app/api/animals/[id]/brumation/route.ts", import.meta.url), "utf8");
  const del = route.slice(route.indexOf("DELETE FROM care_tasks"));
  assert.match(del.slice(0, 260), /skipped_at IS NULL/, "must not delete skipped history");
  assert.match(del.slice(0, 260), /missed_at IS NULL/, "must not delete missed history");
  assert.match(del.slice(0, 260), /NOT EXISTS[^)]*husbandry_events/, "must not delete completed tasks");
});
