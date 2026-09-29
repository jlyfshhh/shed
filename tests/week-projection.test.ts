import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { projectFutureDay, type ProjectionSchedule, type ProjectionAnimal } from "../lib/week-projection.ts";

// ── Behavioural coverage of the future-week projection ───────────────────────
// The future half of the week view derives tasks from care_schedules with its
// own copy of "which task exists on which day". It once dropped week_interval
// and animal_ids_json, so exercise the real composition here.

const sched = (over: Partial<ProjectionSchedule> = {}): ProjectionSchedule => ({
  id: "plan", animalId: "a", animalIdsJson: null, taskType: "feeding", title: "Feed",
  details: "", frequency: "daily", intervalDays: null, weekdaysJson: null, dayOfMonth: null,
  weekInterval: 1, startDate: "2026-01-04", endDate: null, ...over,
});

const animals = (...entries: ProjectionAnimal[]) => new Map(entries.map((a) => [a.id, a]));
const awake = (id: string, name: string): ProjectionAnimal => ({ id, name, brumating: false, careResumeOn: null });

// 2026-01-04 is a Sunday; weeks are counted from the plan's start week.
const SUN0 = "2026-01-04";  // week 0
const SUN1 = "2026-01-11";  // week 1
const SUN2 = "2026-01-18";  // week 2

test("an every-other-week plan is due on its on-weeks and silent on its off-weeks", () => {
  const plan = sched({ frequency: "weekly", weekdaysJson: "[0]", weekInterval: 2 });
  const who = animals(awake("a", "Ziggy"));
  assert.equal(projectFutureDay([plan], who, SUN0).length, 1, "week 0 is on");
  assert.equal(projectFutureDay([plan], who, SUN1).length, 0, "week 1 is off");
  assert.equal(projectFutureDay([plan], who, SUN2).length, 1, "week 2 is on");
  // A plain weekly plan fires every week, for contrast.
  const weekly = sched({ frequency: "weekly", weekdaysJson: "[0]", weekInterval: 1 });
  assert.equal(projectFutureDay([weekly], who, SUN1).length, 1);
});

test("a grouped plan expands to one task per covered animal", () => {
  const plan = sched({ animalId: "a", animalIdsJson: JSON.stringify(["a", "b", "c"]) });
  const tasks = projectFutureDay([plan], animals(awake("a", "Ares"), awake("b", "Bravo"), awake("c", "Calypso")), SUN0);
  assert.deepEqual(tasks.map((t) => t.animalName), ["Ares", "Bravo", "Calypso"]);
});

test("a brumating member drops out while the awake ones keep their task", () => {
  const plan = sched({ animalId: "a", animalIdsJson: JSON.stringify(["a", "b"]) });
  const who = animals(awake("a", "Awake"), { id: "b", name: "Sleepy", brumating: true, careResumeOn: null });
  assert.deepEqual(projectFutureDay([plan], who, SUN0).map((t) => t.animalName), ["Awake"]);
});

test("an archived or missing member simply does not appear", () => {
  // animalsById holds only active animals, so an archived "b" is absent from it.
  const plan = sched({ animalId: "a", animalIdsJson: JSON.stringify(["a", "b"]) });
  assert.deepEqual(projectFutureDay([plan], animals(awake("a", "Ares")), SUN0).map((t) => t.animalName), ["Ares"]);
});

test("a plan past its end date projects nothing", () => {
  const plan = sched({ endDate: "2026-01-10" });
  const who = animals(awake("a", "Ares"));
  assert.equal(projectFutureDay([plan], who, "2026-01-09").length, 1, "before end date");
  assert.equal(projectFutureDay([plan], who, "2026-01-11").length, 0, "after end date");
});

test("results are ordered by animal then title", () => {
  const feed = sched({ id: "feed", title: "Feed", animalIdsJson: JSON.stringify(["a", "b"]) });
  const mist = sched({ id: "mist", title: "Mist", taskType: "misting", animalIdsJson: JSON.stringify(["a", "b"]) });
  const tasks = projectFutureDay([mist, feed], animals(awake("b", "Bravo"), awake("a", "Ares")), SUN0);
  assert.deepEqual(tasks.map((t) => `${t.animalName}:${t.title}`), ["Ares:Feed", "Ares:Mist", "Bravo:Feed", "Bravo:Mist"]);
});

// ── The route wires the shared calculation, not a second reduced query ───────
test("the week route projects through the shared calculation", () => {
  const route = readFileSync(new URL("../app/api/week/route.ts", import.meta.url), "utf8");
  assert.match(route, /projectFutureDay\(/, "future days must go through projectFutureDay");
  assert.match(route, /s\.week_interval AS weekInterval/, "the query must still select week_interval");
  assert.match(route, /s\.animal_ids_json AS animalIdsJson/, "the query must still select animal_ids_json");
});
