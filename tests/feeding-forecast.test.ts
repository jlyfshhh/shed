import assert from "node:assert/strict";
import test from "node:test";
import { buildFeederForecast, predictWeight } from "../lib/feeding-forecast.ts";
import { feederGuidance } from "../lib/feeder-guidance.ts";

const plan = (
  id: string,
  animalId: string,
  days: number,
  startDate: string,
  preySpecies: string,
  preySizeClass: string | null,
  buyAsNeeded = false,
) => ({
  animalId,
  preySpecies,
  preyDescription: preySizeClass ? `${preySizeClass} ${preySpecies}` : preySpecies,
  preySizeClass,
  buyAsNeeded,
  schedule: {
    id, animalId, taskType: "feeding", title: "Feed", details: "",
    frequency: "interval" as const, intervalDays: days,
    weekdaysJson: null, dayOfMonth: null, startDate, endDate: null,
  },
});

const animals = [
  { id: "achilles", name: "Achilles" },
  { id: "telemachus", name: "Telemachus" },
  { id: "rhino", name: "Rhino" },
];

const weights = [
  { animalId: "achilles", recordedOn: "2026-07-14", weightGrams: 425 },
  { animalId: "telemachus", recordedOn: "2026-07-14", weightGrams: 576 },
];

const feeder = (id: string, sizeClass: string, addedOn: string, preySpecies = "rat") =>
  ({ id, preySpecies, sizeClass, weightGrams: null, addedOn });

test("weight trend projects the latest measurement to the feeding date", () => {
  const prediction = predictWeight(
    [
      { animalId: "a", recordedOn: "2026-05-30", weightGrams: 532 },
      { animalId: "a", recordedOn: "2026-07-14", weightGrams: 576 },
    ],
    "2026-08-01",
  );
  assert.ok(prediction);
  assert.ok(prediction!.predictedWeightGrams > 576);
});

test("a feeder is chosen by size class, not by weight", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights,
    availableFeeders: [
      feeder("weaned-1", "weaned", "2026-08-01"),
      feeder("small-1", "small", "2026-08-01"),
    ],
    profiles: [plan("ach", "achilles", 14, "2026-08-02", "rat", "small")],
  });
  assert.equal(forecast.events[0].allocatedFeeder?.id, "small-1");
  assert.equal(forecast.events[0].status, "covered");
});

test("oldest stock is used first so the freezer rotates", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 15,
    animals,
    weights,
    availableFeeders: [
      feeder("newer", "small", "2026-08-17"),
      feeder("oldest", "small", "2026-06-01"),
      feeder("middle", "small", "2026-07-04"),
    ],
    profiles: [plan("ach", "achilles", 14, "2026-08-02", "rat", "small")],
  });
  assert.deepEqual(
    forecast.events.map((event) => event.allocatedFeeder?.id),
    ["oldest", "middle"],
  );
});

test("each feeder is allocated only once, and running out is a shortage", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 29,
    animals,
    weights,
    availableFeeders: [feeder("only-one", "small", "2026-08-01")],
    profiles: [plan("ach", "achilles", 14, "2026-08-02", "rat", "small")],
  });
  const covered = forecast.events.filter((event) => event.status === "covered");
  const short = forecast.events.filter((event) => event.status === "shortage");
  assert.equal(covered.length, 1);
  assert.ok(short.length >= 1);
  assert.equal(forecast.orderNeeded, true);
  assert.ok(forecast.alerts.some((alert) => alert.code === "feeder-shortage"));
});

test("size class and species matching ignores case and spacing", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights,
    availableFeeders: [
      feeder("wrong-species", "large pinky", "2026-08-01", "rat"),
      feeder("right", "Large  Pinky", "2026-08-01", "MOUSE"),
    ],
    profiles: [plan("rhi", "rhino", 7, "2026-08-02", "mouse", "large pinky")],
  });
  assert.equal(forecast.events[0].allocatedFeeder?.id, "right");
});

test("a plan with no size class accepts any feeder of that species", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights,
    availableFeeders: [feeder("whatever", "jumbo", "2026-08-01")],
    profiles: [plan("tele", "telemachus", 14, "2026-08-02", "rat", null)],
  });
  assert.equal(forecast.events[0].allocatedFeeder?.id, "whatever");
});

test("an animal with no recorded weight is still allocated a feeder", () => {
  // Weight used to gate this: no weight meant no computed target, so no feeder.
  // Size class needs no weight, so a new animal is no longer stuck.
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights: [],
    profiles: [plan("ach", "achilles", 14, "2026-08-02", "rat", "small")],
    availableFeeders: [feeder("small-1", "small", "2026-08-01")],
  });
  assert.equal(forecast.events[0].status, "covered");
  assert.equal(forecast.events[0].allocatedFeeder?.id, "small-1");
});

test("buy-as-needed prey is never drawn from stock", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights,
    availableFeeders: [feeder("in-stock", "large pinky", "2026-08-01", "mouse")],
    profiles: [plan("rhi", "rhino", 7, "2026-08-02", "mouse", "large pinky", true)],
  });
  assert.equal(forecast.events[0].status, "buy-as-needed");
  assert.equal(forecast.events[0].allocatedFeeder, null);
  assert.ok(forecast.alerts.some((alert) => alert.code === "buy-as-needed"));
});

test("guidance names the size class and never a weight", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights,
    availableFeeders: [feeder("small-1", "small", "2026-08-01")],
    profiles: [plan("ach", "achilles", 14, "2026-08-02", "rat", "small")],
  });
  const text = feederGuidance(forecast.events[0]);
  assert.match(text, /small rat/);
  assert.doesNotMatch(text, /\bg\b|gram/);
});

test("completed dates are excluded so their consumed feeders are not allocated again", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 15,
    animals,
    weights,
    availableFeeders: [feeder("rat-next", "small", "2026-08-01")],
    profiles: [plan("ach", "achilles", 14, "2026-08-02", "rat", "small")],
    excludedFeedings: ["ach:2026-08-02"],
  });
  assert.equal(forecast.events.length, 1);
  assert.equal(forecast.events[0].feedingDate, "2026-08-16");
  assert.equal(forecast.events[0].allocatedFeeder?.id, "rat-next");
});
