import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shed replaces the starter with its husbandry surface", async () => {
  const [page, layout, app, css, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HusbandryApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /HusbandryApp/);
  assert.match(layout, /Good care shows/);
  assert.match(app, /Today’s care/);
  assert.match(app, /Weight trends/);
  assert.match(app, /marked not done/);
  assert.match(app, /Change keeper/);
  assert.match(app, /Mark not done/);
  assert.match(css, /--moss: #e0701a/);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

// Two UI invariants that only showed up in front of real users, and that the
// suite could not otherwise see: it reads source rather than rendering, so
// these guard the specific regressions rather than the whole behaviour.
test("the care-routine sheet never renders nothing after a save", async () => {
  const manage = await readFile(new URL("../app/manage.tsx", import.meta.url), "utf8");
  const suggestions = manage.slice(manage.indexOf("export function CareRoutineSuggestions"));
  const body = suggestions.slice(0, suggestions.indexOf("\nexport function"));
  // The catalog reload that adds the new animal lands a beat after the sheet
  // opens. Returning null in that window looked exactly like the save failing:
  // a keeper pressed Add animal, saw nothing happen, refreshed, and found the
  // animal had been created all along.
  assert.doesNotMatch(body, /if \(!animal\) return null;/);
  assert.match(body, /Loading the care routines you can copy/);
});

test("feeder intake is offered by count, not by weight", async () => {
  const [app, manage] = await Promise.all([
    readFile(new URL("../app/HusbandryApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/manage.tsx", import.meta.url), "utf8"),
  ]);
  // Feeder weights were removed; inventory is quantity per size class. Entry
  // points kept asking for "weighed feeders" long after the form had stopped.
  assert.doesNotMatch(app, /Add weighed feeders|gram weights/);
  assert.doesNotMatch(manage, /inventory by type and weight/);
});

test("Today collapses a grouped plan into one line", async () => {
  const app = await readFile(new URL("../app/HusbandryApp.tsx", import.meta.url), "utf8");
  // Both lists have to group, or a plan covering six animals fills Today with
  // six identical rows in whichever list it lands in.
  const grouped = app.match(/groupTasks\(/g) ?? [];
  assert.ok(grouped.length >= 2, "overdue and up-next must both group");
  // One line, one timing question: the dialog records the whole group.
  assert.match(app, /recordCompletionAll\(timingTask\.tasks/);
  assert.doesNotMatch(app, /recordCompletion\(timingTask\.task,/);
});

test("a plan's animal list is not truncated like prose", async () => {
  const route = await readFile(new URL("../app/api/manage/route.ts", import.meta.url), "utf8");
  // Text fields are capped at 200 characters. An animal id costs about 39
  // characters inside a JSON array, so that cap cut the list mid-string past
  // roughly five animals and stored unparseable JSON — the plan silently
  // ungrouped and the extra animals lost their tasks.
  assert.match(route, /animalIdsJson" \? \d{4,}/, "the animal list needs its own, larger cap");
  // And a list that does not parse must be refused, never stored.
  assert.match(route, /was not readable/);
});

test("every field the manage form offers can actually be saved", async () => {
  const [form, route] = await Promise.all([
    readFile(new URL("../app/manage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/manage/route.ts", import.meta.url), "utf8"),
  ]);
  // normalize() drops any key the route's field map does not know, without an
  // error, so a field present in the form but missing from the map is accepted,
  // reported as saved, and thrown away. graceDays was in exactly that state:
  // every weekend-chore window a keeper set was silently discarded.
  const schedule = form.slice(form.indexOf('key: "schedule"'), form.indexOf('key: "note"'));
  const offered = [...schedule.matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]);
  const map = route.slice(route.indexOf("schedule: { table:"), route.indexOf("note: { table:"));
  const missing = offered.filter((key) => !map.includes(`${key}: { column:`));
  assert.deepEqual(missing, [], `care plan fields the API would silently discard: ${missing.join(", ")}`);
});

test("a grouped line can be settled one animal at a time", async () => {
  const app = await readFile(new URL("../app/HusbandryApp.tsx", import.meta.url), "utf8");
  // A group is a convenience, not a claim the animals are interchangeable: one
  // dragon brumates while its housemates eat. Without per-animal rows the only
  // way to record that was to break the plan up again.
  assert.match(app, /Each animal separately/);
  assert.match(app, /const memberRow = /);
  // And the bulk actions must ask once, not once per animal.
  assert.match(app, /const skipGroup = /);
  assert.match(app, /const missGroup = /);
  assert.doesNotMatch(app, /for \(const member of tasks\) void skipTask/);
  assert.doesNotMatch(app, /for \(const member of tasks\) void missTask/);
});

test("a care plan names every animal it covers", async () => {
  const manage = await readFile(new URL("../app/manage.tsx", import.meta.url), "utf8");
  // The list read as though a six-gecko plan belonged to whichever was picked
  // first, and the animal's own profile did not show the plan at all.
  assert.match(manage, /const coveredAnimals = /);
  assert.match(manage, /case "schedule": return scheduleAnimalIds\(/);
});
