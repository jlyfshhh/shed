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
  assert.match(app, /returned to today’s list/);
  assert.match(app, /Undo/);
  assert.match(css, /--moss: #e0701a/);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
