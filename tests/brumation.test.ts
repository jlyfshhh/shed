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

test("the resume cleanup is date-bounded and never deletes settled history", () => {
  // The delete now lives in the shared, tested lib/care-boundaries helper.
  const lib = readFileSync(new URL("../lib/care-boundaries.ts", import.meta.url), "utf8");
  const windowDel = lib.slice(lib.indexOf("clearPendingTasksInWindowStatement")).slice(0, 400);
  assert.match(windowDel, /due_date >= \? AND due_date < \?/, "bounded to the pause window, not every past task (F08)");
  assert.match(lib, /skipped_at IS NULL/, "must not delete skipped history");
  assert.match(lib, /missed_at IS NULL/, "must not delete missed history");
  assert.match(lib, /NOT EXISTS[^)]*husbandry_events/, "must not delete completed tasks");

  // The resume route must read the pause start and feed it as the window's lower
  // bound, so an implicit miss dated before the pause is preserved.
  const route = readFileSync(new URL("../app/api/animals/[id]/brumation/route.ts", import.meta.url), "utf8");
  assert.match(route, /brumation_since AS brumationSince/, "the pause start is read before it is cleared");
  assert.match(route, /clearPendingTasksInWindowStatement\(db, id, pauseStart, today\)/, "resume bounds the delete by the pause start");
});

test("the pause path bounds care at the boundary, preserves the start, and refreshes materialization (C)", () => {
  const route = readFileSync(new URL("../app/api/animals/[id]/brumation/route.ts", import.meta.url), "utf8");
  // Pause clears unsettled care from the boundary forward, so the streak reader
  // cannot score the suppressed days as pending-then-missed during the pause.
  assert.match(route, /clearPendingTasksFromStatement\(db, id, pauseStart\)/, "pause clears unsettled tasks from the boundary forward");
  // A repeated pause must not overwrite the original start.
  assert.match(route, /brumation_since = COALESCE\(brumation_since, \?\)/, "a repeated pause preserves the original brumation_since");
  // Both toggles invalidate the per-isolate materialization cache so a same-day
  // resume re-materializes today's care immediately rather than after a day-roll.
  // (The cache itself imports cloudflare:workers and can't load under the node
  // test runner, so this wiring is asserted structurally.)
  assert.match(route, /invalidateMaterializedTasks\(\)/, "the toggle invalidates the materialization cache");
});
