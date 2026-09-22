import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const runtime = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");
const weights = readFileSync(new URL("../app/api/weights/route.ts", import.meta.url), "utf8");
const manage = readFileSync(new URL("../app/api/manage/route.ts", import.meta.url), "utf8");
const forecast = readFileSync(new URL("../lib/feeding-forecast.ts", import.meta.url), "utf8");

/**
 * Everything below rests on one SQLite fact: INTEGER is an affinity, not a
 * constraint, so a non-integral value is stored as REAL rather than truncated.
 * If that ever stops being true the columns need a real migration, so pin it.
 */
test("an INTEGER-affinity column keeps fractional grams", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE w (weight_grams INTEGER NOT NULL)");
  const insert = db.prepare("INSERT INTO w VALUES (?)");
  for (const grams of [6.4, 6.85, 7]) insert.run(grams);

  const stored = db.prepare("SELECT weight_grams AS g FROM w ORDER BY rowid").all();
  assert.deepEqual(stored.map((row) => row.g), [6.4, 6.85, 7]);
});

test("the live schema still declares weights as INTEGER affinity", () => {
  // Guards the comment in db/schema.ts: if someone migrates these to REAL the
  // affinity test above is no longer the thing protecting the data.
  for (const table of ["animals", "weight_events"]) {
    const create = runtime.slice(runtime.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
    const body = create.slice(0, create.indexOf(')"'));
    assert.match(body, /weight_grams INTEGER/, `${table}.weight_grams should still be INTEGER`);
  }
});

test("the weights route rounds to 0.1 g rather than to whole grams", () => {
  assert.match(weights, /Math\.round\(Number\(rawWeight\) \* 10\) \/ 10/);
  assert.doesNotMatch(weights, /Math\.round\(Number\(rawWeight\)\)/);
});

test("the weights route accepts a sub-gram animal", () => {
  // A 6 g gecko loses a sixth of its mass to integer rounding; the floor has to
  // sit below 1 g or the smallest animals cannot be recorded at all.
  assert.match(weights, /weightGrams < 0\.1/);
  assert.doesNotMatch(weights, /weightGrams <= 0\b/);
  assert.match(weights, /from 0\.1 to 1,000,000 grams/);
});

test("the manage route applies the same 0.1 g rule", () => {
  const guard = manage.slice(manage.indexOf('resource === "weight" || resource === "feeder"'));
  assert.ok(guard, "manage route should carry a weight guard");
  assert.match(guard.slice(0, 400), /Math\.round\(Number\(output\.weightGrams\) \* 10\) \/ 10/);
  assert.match(guard.slice(0, 400), /grams < 0\.1/);
});

test("the feeding forecast does not round a projection back to whole grams", () => {
  assert.match(forecast, /Math\.max\(0\.1, Math\.round\(\(latest\.weightGrams[^)]*\) \* 10\) \/ 10\)/);
});
