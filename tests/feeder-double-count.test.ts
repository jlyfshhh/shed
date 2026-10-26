import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { claimMatchingFeederStatements } from "../lib/feeder-consumption.ts";
import { buildFeederForecast } from "../lib/feeding-forecast.ts";

// F07: completing a feeding must claim an ACTUAL available feeder for the animal
// being completed, not the one the cross-animal forecast reserved for it. Two
// cage-mates on one plan with a single matching feeder in stock is the trap: the
// forecast hands the feeder to the alphabetically-earlier animal, so completing
// the later one first used to record the meal while ignoring the available rat.

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
    CREATE TABLE feeder_inventory (
      id TEXT PRIMARY KEY, prey_species TEXT NOT NULL, size_class TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available', added_on TEXT NOT NULL,
      consumed_at TEXT, animal_id TEXT, husbandry_event_id TEXT
    );
    CREATE TABLE feeding_assignments (
      id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, feeder_id TEXT NOT NULL,
      planned_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL, consumed_at TEXT, husbandry_event_id TEXT
    );
    CREATE UNIQUE INDEX consumed_feeder ON feeding_assignments(feeder_id) WHERE status = 'consumed';
    CREATE UNIQUE INDEX consumed_event ON feeding_assignments(husbandry_event_id) WHERE status = 'consumed';
  `);
  return a;
}
function addFeeder(a: SqliteD1, id: string, species: string, size: string, addedOn: string, status = "available") {
  a.sqlite.prepare("INSERT INTO feeder_inventory (id, prey_species, size_class, status, added_on) VALUES (?, ?, ?, ?, ?)").run(id, species, size, status, addedOn);
}
function available(a: SqliteD1) {
  return (a.sqlite.prepare("SELECT COUNT(*) AS n FROM feeder_inventory WHERE status = 'available'").get() as { n: number }).n;
}
function consumerOf(a: SqliteD1, feederId: string) {
  return { ...(a.sqlite.prepare("SELECT status, animal_id AS a, husbandry_event_id AS e FROM feeder_inventory WHERE id = ?").get(feederId) as { status: string; a: string | null; e: string | null }) };
}
/** Claim a matching feeder for one animal's feeding, as the complete route does. */
async function claim(a: SqliteD1, animalId: string, eventId: string, requirement: { species: string; size: string | null }) {
  const results = await a.batch(claimMatchingFeederStatements(a as unknown as D1Database, {
    animalId,
    preySpecies: requirement.species,
    preySizeClass: requirement.size,
    plannedFor: "2026-10-25",
    occurredAt: "2026-10-25T12:00:00.000Z",
    husbandryEventId: eventId,
  }) as unknown as BoundStatement[]);
  return results.map((r) => r.meta.changes);
}

const twinProfile = (animalId: string) => ({
  animalId,
  preySpecies: "rat",
  preyDescription: "small rat",
  preySizeClass: "small",
  buyAsNeeded: false,
  schedule: {
    id: "twins", animalId: "alpha", taskType: "feeding", title: "Feed", details: "",
    frequency: "interval" as const, intervalDays: 7, weekdaysJson: null, dayOfMonth: null,
    weekInterval: 1, startDate: "2026-10-25", endDate: null,
  },
});

test("the forecast reserves the only feeder for the alphabetically-earlier cage-mate (root cause)", () => {
  const forecast = buildFeederForecast({
    today: "2026-10-25",
    horizonDays: 1,
    animals: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }],
    weights: [],
    availableFeeders: [{ id: "rat-1", preySpecies: "rat", sizeClass: "small", weightGrams: null, addedOn: "2026-10-01" }],
    profiles: [twinProfile("alpha"), twinProfile("beta")],
  });
  const alpha = forecast.events.find((e) => e.animalId === "alpha")!;
  const beta = forecast.events.find((e) => e.animalId === "beta")!;
  assert.equal(alpha.allocatedFeeder?.id, "rat-1", "forecast gives the feeder to Alpha");
  assert.equal(beta.allocatedFeeder, null, "and leaves Beta as a forecast shortage — the trap the old route trusted");
});

test("completing Beta first claims the available rat instead of honouring Alpha's forecast reservation", async () => {
  const a = fixture();
  addFeeder(a, "rat-1", "rat", "small", "2026-10-01");

  // Beta is completed first. The real stock has one rat; it must be deducted for
  // Beta even though the forecast reserved it for Alpha.
  const betaChanges = await claim(a, "beta", "evt-beta", { species: "rat", size: "small" });
  assert.deepEqual(betaChanges, [1, 1], "Beta claims the rat");
  assert.deepEqual(consumerOf(a, "rat-1"), { status: "consumed", a: "beta", e: "evt-beta" });
  assert.equal(available(a), 0, "the rat is no longer available");

  // Now Alpha is completed. No stock remains, so its care records with no feeder
  // — the one rat is consumed exactly once, never twice.
  const alphaChanges = await claim(a, "alpha", "evt-alpha", { species: "rat", size: "small" });
  assert.deepEqual(alphaChanges, [0, 0], "Alpha gets no feeder — nothing left to consume");
  assert.equal(
    (a.sqlite.prepare("SELECT COUNT(*) AS n FROM feeding_assignments WHERE status = 'consumed'").get() as { n: number }).n,
    1,
    "exactly one consumed assignment exists",
  );
});

test("two animals with two rats each claim a distinct feeder, oldest first", async () => {
  const a = fixture();
  addFeeder(a, "rat-new", "rat", "small", "2026-10-10");
  addFeeder(a, "rat-old", "rat", "small", "2026-10-01");

  await claim(a, "beta", "evt-beta", { species: "rat", size: "small" });
  await claim(a, "alpha", "evt-alpha", { species: "rat", size: "small" });
  assert.equal(consumerOf(a, "rat-old").a, "beta", "the first claimant takes the oldest feeder");
  assert.equal(consumerOf(a, "rat-new").a, "alpha");
  assert.equal(available(a), 0);
});

test("concurrent claims for the last feeder: one wins, the other is care-only", async () => {
  const a = fixture();
  addFeeder(a, "rat-1", "rat", "small", "2026-10-01");
  // D1 serialises batch transactions; run them one after another on the shared db.
  const first = await claim(a, "alpha", "evt-alpha", { species: "rat", size: "small" });
  const second = await claim(a, "beta", "evt-beta", { species: "rat", size: "small" });
  assert.deepEqual(first, [1, 1]);
  assert.deepEqual(second, [0, 0]);
  assert.equal(available(a), 0, "the feeder is consumed exactly once");
});

test("a sized plan does not claim a wrong-size feeder, but a blank-size plan takes any same-species", async () => {
  const sized = fixture();
  addFeeder(sized, "jumbo-1", "rat", "jumbo", "2026-10-01");
  const sizedChanges = await claim(sized, "alpha", "evt-a", { species: "rat", size: "small" });
  assert.deepEqual(sizedChanges, [0, 0], "a small-rat plan never claims a jumbo rat");
  assert.equal(available(sized), 1, "the jumbo stays in stock");

  const blank = fixture();
  addFeeder(blank, "jumbo-1", "rat", "jumbo", "2026-10-01");
  const blankChanges = await claim(blank, "alpha", "evt-a", { species: "rat", size: null });
  assert.deepEqual(blankChanges, [1, 1], "a blank-size plan takes any same-species feeder");
  assert.equal(consumerOf(blank, "jumbo-1").a, "alpha");
});

test("species must still match", async () => {
  const a = fixture();
  addFeeder(a, "mouse-1", "mouse", "adult", "2026-10-01");
  const changes = await claim(a, "alpha", "evt-a", { species: "rat", size: null });
  assert.deepEqual(changes, [0, 0], "a mouse is never claimed for a rat feeding");
});

test("matching ignores case and surrounding whitespace", async () => {
  const a = fixture();
  addFeeder(a, "rat-1", "  Rat ", "Small", "2026-10-01");
  const changes = await claim(a, "alpha", "evt-a", { species: "rat", size: "small" });
  assert.deepEqual(changes, [1, 1], "case/space differences do not block a real match");
});

test("undo returns the feeder to stock so it can be claimed again", async () => {
  const a = fixture();
  addFeeder(a, "rat-1", "rat", "small", "2026-10-01");
  await claim(a, "alpha", "evt-a", { species: "rat", size: "small" });
  assert.equal(available(a), 0);

  // Undo: release the feeder and its assignment (as undoCompletion does).
  a.sqlite.prepare("UPDATE feeder_inventory SET status = 'available', consumed_at = NULL, animal_id = NULL, husbandry_event_id = NULL WHERE id = 'rat-1'").run();
  a.sqlite.prepare("UPDATE feeding_assignments SET status = 'released' WHERE husbandry_event_id = 'evt-a'").run();
  assert.equal(available(a), 1);

  // A later feeding for another animal can now claim the returned feeder.
  const changes = await claim(a, "beta", "evt-b", { species: "rat", size: "small" });
  assert.deepEqual(changes, [1, 1]);
  assert.equal(consumerOf(a, "rat-1").a, "beta");
});
