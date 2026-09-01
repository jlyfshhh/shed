import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { ANIMAL_PURGE_STEPS, EVENT_PURGE_STEPS, animalIdsWithout } from "../lib/purge.ts";

const runtime = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");

/** Tables the schema says carry an animal_id. */
function tablesReferencingAnimals(): string[] {
  const tables: string[] = [];
  for (const match of runtime.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([^"]*)\)"/g)) {
    const [, table, body] = match;
    if (table !== "animals" && /\banimal_id\b/.test(body)) tables.push(table);
  }
  return tables;
}

test("every table holding an animal_id is dealt with by the purge", () => {
  // A table added later and forgotten here would leave orphan rows pointing at
  // an animal that no longer exists — the same silent-omission shape that has
  // bitten the backup manifest and the copy-routines list.
  const handled = ANIMAL_PURGE_STEPS.map((step) => step.sql);
  const missing = tablesReferencingAnimals().filter(
    (table) => !handled.some((sql) => sql.includes(` ${table} `)),
  );
  assert.deepEqual(missing, [], `tables referencing an animal that the purge ignores: ${missing.join(", ")}`);
});

test("the animal itself goes last, after everything that points at it", () => {
  const last = ANIMAL_PURGE_STEPS.at(-1)!.sql;
  assert.match(last, /DELETE FROM animals WHERE id = \?/);
});

test("stock history and shared equipment survive, unlinked", () => {
  // A feeder already bought is inventory history, and equipment belongs to the
  // enclosure as much as to whoever lived in it.
  const feeder = ANIMAL_PURGE_STEPS.find((s) => s.sql.includes("feeder_inventory"))!;
  assert.match(feeder.sql, /^UPDATE/);
  const equipment = ANIMAL_PURGE_STEPS.find((s) => s.sql.includes("equipment"))!;
  assert.match(equipment.sql, /^UPDATE/);
});

test("a voided entry takes its correction trail with it", () => {
  assert.equal(EVENT_PURGE_STEPS.length, 2);
  assert.match(EVENT_PURGE_STEPS[0].sql, /husbandry_event_revisions/);
  // Only ever an entry already voided; the guard lives in the SQL as well as
  // the route, so a direct call cannot erase live care.
  assert.match(EVENT_PURGE_STEPS[1].sql, /voided_at IS NOT NULL/);
});

test("a grouped plan loses the member, not the plan", () => {
  const json = JSON.stringify(["primary", "gone", "other"]);
  assert.equal(animalIdsWithout(json, "gone", "primary"), JSON.stringify(["primary", "other"]));
});

test("a group down to its last animal stops being a group", () => {
  assert.equal(animalIdsWithout(JSON.stringify(["primary", "gone"]), "gone", "primary"), null);
});

test("a damaged animal list does not throw during a purge", () => {
  for (const broken of ["", "not json", "{}", "[1,2]", "null"]) {
    assert.equal(animalIdsWithout(broken, "gone", "primary"), null, broken);
  }
});
