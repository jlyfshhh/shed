import assert from "node:assert/strict";
import test from "node:test";
import { buildFeederForecast, predictWeight } from "../lib/feeding-forecast.ts";

const animals = [
  { id: "telemachus", name: "Telemachus" },
  { id: "achilles", name: "Achilles" },
  { id: "ares", name: "Ares" },
  { id: "calypso", name: "Calypso" },
  { id: "odysseus", name: "Odysseus" },
  { id: "apollo", name: "Apollo" },
  { id: "rhino", name: "Rhino" },
  { id: "taco", name: "Taco" },
  { id: "sriracha", name: "Sriracha" },
];

const weights = [
  ["telemachus", "2026-05-30", 532], ["telemachus", "2026-07-14", 576],
  ["achilles", "2026-05-30", 382], ["achilles", "2026-07-14", 425],
  ["ares", "2026-05-30", 1289], ["ares", "2026-07-14", 1257],
  ["calypso", "2026-05-16", 555], ["calypso", "2026-07-14", 625],
  ["odysseus", "2026-05-30", 924], ["odysseus", "2026-07-14", 935],
  ["apollo", "2026-05-30", 355], ["apollo", "2026-07-14", 411],
].map(([animalId, recordedOn, weightGrams]) => ({
  animalId: String(animalId),
  recordedOn: String(recordedOn),
  weightGrams: Number(weightGrams),
}));

test("weight trend projects the latest measurement to the feeding date", () => {
  const prediction = predictWeight(
    weights.filter((row) => row.animalId === "achilles"),
    "2026-08-02",
  );
  assert.ok(prediction);
  assert.equal(prediction.latestWeightGrams, 425);
  assert.equal(prediction.predictedWeightGrams, 443);
  assert.equal(prediction.confidence, "low");
});

test("forecast returns next dates, allocates each rat once, and schedules buy-as-needed mice", () => {
  const forecast = buildFeederForecast({
    today: "2026-07-19",
    horizonDays: 20,
    animals,
    weights,
    availableFeeders: [
      { id: "rat-59", preySpecies: "rat", sizeClass: "small", weightGrams: 59 },
      { id: "rat-42", preySpecies: "rat", sizeClass: "weaned", weightGrams: 42 },
      { id: "rat-40a", preySpecies: "rat", sizeClass: "small", weightGrams: 40 },
      { id: "rat-40b", preySpecies: "rat", sizeClass: "small", weightGrams: 40 },
      { id: "rat-34", preySpecies: "rat", sizeClass: "weaned", weightGrams: 34 },
      { id: "rat-33", preySpecies: "rat", sizeClass: "weaned", weightGrams: 33 },
    ],
  });

  assert.equal(forecast.nextFeedings.find((event) => event.animalId === "ares")?.feedingDate, "2026-08-01");
  assert.equal(forecast.nextFeedings.find((event) => event.animalId === "achilles")?.feedingDate, "2026-08-02");
  assert.equal(forecast.events.filter((event) => event.preySpecies === "rat" && event.status === "covered").length, 6);
  const allocatedIds = forecast.events.flatMap((event) => event.allocatedFeeder?.id ?? []);
  assert.equal(new Set(allocatedIds).size, allocatedIds.length);
  assert.ok(forecast.alerts.some((alert) => alert.code === "buy-as-needed" && alert.animalName === "Rhino"));
  assert.ok(forecast.alerts.some((alert) => alert.code === "buy-as-needed" && alert.animalName === "Taco"));
  assert.ok(forecast.alerts.some((alert) => alert.code === "missing-feeding-plan" && alert.animalId === "sriracha"));
});

test("forecast warns when no close-enough rat remains", () => {
  const forecast = buildFeederForecast({
    today: "2026-07-19",
    horizonDays: 20,
    animals,
    weights,
    availableFeeders: [],
  });
  assert.equal(forecast.orderNeeded, true);
  assert.ok(forecast.alerts.some((alert) => alert.code === "feeder-shortage" && alert.dueBy === "2026-08-01"));
});
