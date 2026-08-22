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
