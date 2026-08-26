import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { normalizedEmptyValue } from "../lib/manage-values.ts";

const runtime = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/manage/route.ts", import.meta.url), "utf8");

/** Columns declared NOT NULL for one table, from the statement the app runs. */
function notNullColumns(table: string): Set<string> {
  const create = runtime.slice(runtime.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
  const body = create.slice(create.indexOf("(") + 1, create.indexOf(')"'));
  const columns = new Set<string>();
  for (const fragment of body.split(",")) {
    const trimmed = fragment.trim();
    if (/NOT NULL/i.test(trimmed)) columns.add(trimmed.split(/\s+/)[0]);
  }
  // Columns added later carry their constraint in the addMissingColumns call.
  for (const match of runtime.matchAll(new RegExp(`addMissingColumns\\(db, "${table}", \\[([^\\]]*)\\]`, "g"))) {
    for (const pair of match[1].matchAll(/\["(\w+)", "([^"]*)"\]/g)) {
      if (/NOT NULL/i.test(pair[2])) columns.add(pair[1]);
    }
  }
  return columns;
}

/** key -> column, from one resource's field map in the manage route. */
function fieldMap(resource: string, until: string): Map<string, string> {
  const slice = route.slice(route.indexOf(`${resource}: { table:`), route.indexOf(`${until}: { table:`));
  const map = new Map<string, string>();
  for (const match of slice.matchAll(/(\w+): \{ column: "(\w+)"/g)) map.set(match[1], match[2]);
  return map;
}


/** The keys a resource insists on, from the same field map. */
function requiredKeys(resource: string, until: string): Set<string> {
  const slice = route.slice(route.indexOf(`${resource}: { table:`), route.indexOf(`${until}: { table:`));
  const match = slice.match(/required: \[([^\]]*)\]/);
  return new Set([...(match?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]));
}

/** Fields declared as booleans, which have no blank value. */
function booleanKeys(resource: string, until: string): Set<string> {
  const slice = route.slice(route.indexOf(`${resource}: { table:`), route.indexOf(`${until}: { table:`));
  return new Set([...slice.matchAll(/(\w+): \{ column: "\w+", kind: "boolean" \}/g)].map((m) => m[1]));
}

test("a blank value never becomes NULL in a NOT NULL column", () => {
  // The manage form posts every field it shows, sending null for the empty
  // ones. grace_days is NOT NULL DEFAULT 0, so the moment it started being
  // written a blank box refused every care plan the form created — a working
  // form, a saved-looking request, and a 500.
  const cases: Array<[string, string, string]> = [
    ["schedule", "care_schedules", "note"],
    ["animal", "animals", "enclosure"],
  ];
  for (const [resource, table, until] of cases) {
    const notNull = notNullColumns(table);
    const required = requiredKeys(resource, until);
    for (const [key, column] of fieldMap(resource, until)) {
      if (!notNull.has(column)) continue;
      // Two correct answers, depending on the field. A required field must be
      // refused when cleared; an optional one needs a real default to write.
      if (required.has(key)) continue;
      // A yes/no field is refused rather than defaulted; see the route.
      if (booleanKeys(resource, until).has(key)) continue;
      // Timestamps are the server's; clearing one is refused, not defaulted.
      if (key === "createdAt" || key === "updatedAt") continue;
      const blank = normalizedEmptyValue(resource, key);
      assert.notEqual(blank, null, `${resource}.${key} writes NULL into NOT NULL column ${table}.${column}`);
    }
  }
});

test("grace days specifically: blank means no window, not unknown", () => {
  assert.equal(normalizedEmptyValue("schedule", "graceDays"), 0);
  assert.equal(normalizedEmptyValue("schedule", "details"), "");
  assert.equal(normalizedEmptyValue("schedule", "endDate"), null);
});

test("a required field is refused when cleared, not written as NULL", () => {
  // Every required key on a care plan maps to a NOT NULL column, so clearing
  // one has to be an input error rather than a database error.
  const required = requiredKeys("schedule", "note");
  assert.ok(required.size > 0, "the schedule resource should declare required fields");
  assert.match(route, /cannot be cleared/, "the route must refuse a cleared required field");
});

test("a yes/no field is refused when blank", () => {
  assert.match(route, /must be true or false/, "a blank boolean must be an input error");
});

test("server-owned timestamps cannot be cleared by a client", () => {
  assert.match(route, /is set automatically/);
});
