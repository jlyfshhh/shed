import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { refreshCachedWeight, refreshCachedWeights, weightCacheTargets } from "../lib/weight-cache.ts";

// F11: reassigning a weight to a different animal must rebuild BOTH the source
// and destination animals' cached latest weight. The manage PATCH used to
// refresh only the destination, leaving the source advertising a weight that
// now belonged to another animal.

class BoundStatement {
  private readonly statement: StatementSync;
  private readonly values: SQLInputValue[];
  constructor(statement: StatementSync, values: SQLInputValue[] = []) {
    this.statement = statement;
    this.values = values;
  }
  bind(...values: unknown[]) { return new BoundStatement(this.statement, values as SQLInputValue[]); }
  first<T>() { return (this.statement.get(...this.values) as T | undefined) ?? null; }
  all<T>() { return { results: this.statement.all(...this.values) as T[], success: true, meta: {} }; }
  run() { const r = this.statement.run(...this.values); return { success: true, meta: { changes: Number(r.changes) } }; }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new BoundStatement(this.sqlite.prepare(sql)); }
  async batch(statements: BoundStatement[]) { return statements.map((s) => s.run()); }
}

function fixture() {
  const a = new SqliteD1();
  a.sqlite.exec(`
    CREATE TABLE animals (id TEXT PRIMARY KEY, weight_grams REAL, weight_date TEXT, updated_at TEXT);
    CREATE TABLE weight_events (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, recorded_on TEXT NOT NULL, weight_grams REAL NOT NULL);
    INSERT INTO animals (id) VALUES ('alpha'), ('beta');
  `);
  return a;
}
function addWeight(a: SqliteD1, id: string, animalId: string, recordedOn: string, grams: number) {
  a.sqlite.prepare("INSERT INTO weight_events (id, animal_id, recorded_on, weight_grams) VALUES (?, ?, ?, ?)").run(id, animalId, recordedOn, grams);
}
function cached(a: SqliteD1, id: string) {
  return a.sqlite.prepare("SELECT weight_grams AS g, weight_date AS d FROM animals WHERE id = ?").get(id) as { g: number | null; d: string | null };
}
/** Reassign a weight's animal exactly as the manage PATCH does, then refresh. */
async function reassign(a: SqliteD1, weightId: string, fromAnimal: string, toAnimal: string) {
  a.sqlite.prepare("UPDATE weight_events SET animal_id = ? WHERE id = ?").run(toAnimal, weightId);
  await refreshCachedWeights(a as unknown as D1Database, weightCacheTargets(fromAnimal, toAnimal));
}

test("weightCacheTargets names both animals on a reassignment and one on a same-animal edit", () => {
  assert.deepEqual(weightCacheTargets("alpha", "beta"), ["beta", "alpha"]);
  assert.deepEqual(weightCacheTargets("alpha", "alpha"), ["alpha"]);
});

test("moving the latest weight refreshes the source back to its next weight", async () => {
  const a = fixture();
  addWeight(a, "w1", "alpha", "2026-10-01", 100);
  addWeight(a, "w2", "alpha", "2026-10-10", 120); // alpha's current latest
  addWeight(a, "b1", "beta", "2026-10-05", 50);
  await refreshCachedWeight(a as unknown as D1Database, "alpha");
  await refreshCachedWeight(a as unknown as D1Database, "beta");
  assert.equal(cached(a, "alpha").g, 120);

  // Move alpha's latest (w2) to beta.
  await reassign(a, "w2", "alpha", "beta");
  assert.equal(cached(a, "alpha").g, 100, "alpha falls back to its remaining weight, not the moved one");
  assert.equal(cached(a, "alpha").d, "2026-10-01");
  assert.equal(cached(a, "beta").g, 120, "beta now shows the moved, newer weight");
  assert.equal(cached(a, "beta").d, "2026-10-10");
});

test("the source is NOT left stale (the F11 bug reproduces when only the destination refreshes)", async () => {
  const a = fixture();
  addWeight(a, "w2", "alpha", "2026-10-10", 120);
  await refreshCachedWeight(a as unknown as D1Database, "alpha");
  assert.equal(cached(a, "alpha").g, 120);

  // Simulate the buggy PATCH: reassign but refresh only the destination.
  a.sqlite.prepare("UPDATE weight_events SET animal_id = 'beta' WHERE id = 'w2'").run();
  await refreshCachedWeight(a as unknown as D1Database, "beta");
  assert.equal(cached(a, "alpha").g, 120, "bug: alpha still advertises a weight that now belongs to beta");

  // The fix refreshes both.
  await refreshCachedWeights(a as unknown as D1Database, weightCacheTargets("alpha", "beta"));
  assert.equal(cached(a, "alpha").g, null, "fixed: alpha has no remaining weight");
  assert.equal(cached(a, "beta").g, 120);
});

test("moving an older weight leaves the source latest intact and gives the destination its newest", async () => {
  const a = fixture();
  addWeight(a, "w1", "alpha", "2026-10-01", 100); // older
  addWeight(a, "w2", "alpha", "2026-10-10", 120); // alpha latest, stays
  addWeight(a, "b1", "beta", "2026-09-01", 40);
  await refreshCachedWeights(a as unknown as D1Database, ["alpha", "beta"]);

  // Move alpha's OLDER weight (w1, Oct 1) to beta; it becomes beta's newest.
  await reassign(a, "w1", "alpha", "beta");
  assert.equal(cached(a, "alpha").g, 120, "alpha's latest is unchanged");
  assert.equal(cached(a, "beta").g, 100, "beta's latest becomes the moved Oct-1 weight");
  assert.equal(cached(a, "beta").d, "2026-10-01");
});

test("moving an animal's only weight leaves it with a null cached weight", async () => {
  const a = fixture();
  addWeight(a, "w1", "alpha", "2026-10-01", 100);
  await refreshCachedWeight(a as unknown as D1Database, "alpha");
  assert.equal(cached(a, "alpha").g, 100);

  await reassign(a, "w1", "alpha", "beta");
  assert.equal(cached(a, "alpha").g, null, "no weights left for alpha");
  assert.equal(cached(a, "alpha").d, null);
  assert.equal(cached(a, "beta").g, 100);
});

test("a same-animal edit still refreshes that animal's cache", async () => {
  const a = fixture();
  addWeight(a, "w1", "alpha", "2026-10-01", 100);
  await refreshCachedWeight(a as unknown as D1Database, "alpha");

  // Edit the value in place (no animal change).
  a.sqlite.prepare("UPDATE weight_events SET weight_grams = 111 WHERE id = 'w1'").run();
  await refreshCachedWeights(a as unknown as D1Database, weightCacheTargets("alpha", "alpha"));
  assert.equal(cached(a, "alpha").g, 111);
});
