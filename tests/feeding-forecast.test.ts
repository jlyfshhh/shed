import assert from "node:assert/strict";
import test from "node:test";
import { buildFeederForecast, predictWeight } from "../lib/feeding-forecast.ts";
import { feederGuidance } from "../lib/feeder-guidance.ts";

const interval = (id: string, animalId: string, days: number, startDate: string, targetPercent: number) => ({
  animalId, preySpecies: "rat", preyDescription: "rat", preySizeClass: null, targetPercent, minimumPercent: targetPercent - 0.01, maximumPercent: targetPercent + 0.01, buyAsNeeded: false,
  schedule: { id, animalId, taskType: "feeding", title: "Feed", details: "", frequency: "interval" as const, intervalDays: days, weekdaysJson: null, dayOfMonth: null, startDate, endDate: null },
});
const profiles = [
  interval("tele", "telemachus", 14, "2026-07-19", .055), interval("ach", "achilles", 14, "2026-07-19", .10),
  { ...interval("ares", "ares", 1, "2026-08-01", .05), schedule: { ...interval("ares", "ares", 1, "2026-08-01", .05).schedule, frequency: "monthly" as const, intervalDays: null, dayOfMonth: 1 } },
  interval("cal", "calypso", 14, "2026-07-19", .055),
  { ...interval("ody", "odysseus", 1, "2026-08-01", .05), schedule: { ...interval("ody", "odysseus", 1, "2026-08-01", .05).schedule, frequency: "monthly" as const, intervalDays: null, dayOfMonth: 1 } },
  interval("apollo", "apollo", 14, "2026-07-19", .10),
  ...[["rhino", 7], ["taco", 30]].map(([animalId, days]) => ({ animalId: String(animalId), preySpecies: "mouse", preyDescription: "pinky mouse", preySizeClass: null, targetPercent: null, minimumPercent: null, maximumPercent: null, buyAsNeeded: true, schedule: { id: String(animalId), animalId: String(animalId), taskType: "feeding", title: "Feed", details: "", frequency: "interval" as const, intervalDays: Number(days), weekdaysJson: null, dayOfMonth: null, startDate: "2026-07-19", endDate: null } })),
];
profiles[profiles.length - 1].schedule = { ...profiles[profiles.length - 1].schedule, frequency: "monthly", intervalDays: null, dayOfMonth: 1 };

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
    today: "2026-07-20",
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
    profiles,
  });

  assert.equal(forecast.nextFeedings.find((event) => event.animalId === "ares")?.feedingDate, "2026-08-01");
  assert.equal(forecast.nextFeedings.find((event) => event.animalId === "achilles")?.feedingDate, "2026-08-02");
  assert.equal(forecast.events.filter((event) => event.preySpecies === "rat" && event.status === "covered").length, 6);
  const allocatedIds = forecast.events.flatMap((event) => event.allocatedFeeder?.id ?? []);
  assert.equal(new Set(allocatedIds).size, allocatedIds.length);
  assert.ok(forecast.alerts.some((alert) => alert.code === "buy-as-needed" && alert.animalName === "Rhino"));
  assert.ok(forecast.alerts.some((alert) => alert.code === "buy-as-needed" && alert.animalName === "Taco"));
});

test("forecast warns when no close-enough rat remains", () => {
  const forecast = buildFeederForecast({
    today: "2026-07-20",
    horizonDays: 20,
    animals,
    weights,
    availableFeeders: [],
    profiles,
  });
  assert.equal(forecast.orderNeeded, true);
  assert.ok(forecast.alerts.some((alert) => alert.code === "feeder-shortage" && alert.dueBy === "2026-08-01"));
});

test("fixed-size mouse plans allocate matching inventory once and warn when it runs out", () => {
  const mouseProfiles = [
    {
      animalId: "rhino", preySpecies: "mouse", preyDescription: "large pinky mouse", preySizeClass: "large pinky",
      targetPercent: null, minimumPercent: null, maximumPercent: null, buyAsNeeded: false,
      schedule: { id: "rhino-fixed", animalId: "rhino", taskType: "feeding", title: "Feed", details: "", frequency: "interval" as const, intervalDays: 7, weekdaysJson: null, dayOfMonth: null, startDate: "2026-07-19", endDate: null },
    },
    {
      animalId: "sriracha", preySpecies: "mouse", preyDescription: "hopper mouse", preySizeClass: "hopper",
      targetPercent: null, minimumPercent: null, maximumPercent: null, buyAsNeeded: false,
      schedule: { id: "sriracha-fixed", animalId: "sriracha", taskType: "feeding", title: "Feed", details: "", frequency: "interval" as const, intervalDays: 14, weekdaysJson: null, dayOfMonth: null, startDate: "2026-08-02", endDate: null },
    },
  ];
  const forecast = buildFeederForecast({
    today: "2026-07-31",
    horizonDays: 20,
    animals,
    weights,
    availableFeeders: [
      { id: "pinky-1", preySpecies: "mouse", sizeClass: "Large Pinky", weightGrams: 3 },
      { id: "hopper-1", preySpecies: "MOUSE", sizeClass: "hopper", weightGrams: 9 },
      { id: "wrong-species", preySpecies: "rat", sizeClass: "hopper", weightGrams: 9 },
    ],
    profiles: mouseProfiles,
  });

  const rhinoEvents = forecast.events.filter((event) => event.animalId === "rhino");
  assert.equal(rhinoEvents[0].allocatedFeeder?.id, "pinky-1");
  assert.equal(rhinoEvents[0].status, "covered");
  assert.equal(rhinoEvents[1].status, "shortage");
  assert.equal(forecast.nextFeedings.find((event) => event.animalId === "sriracha")?.allocatedFeeder?.id, "hopper-1");
  assert.ok(forecast.alerts.some((alert) => alert.message.includes("large pinky mouse")));
});

test("today's feeding is included and produces glanceable task guidance", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 1,
    animals,
    weights,
    availableFeeders: [
      { id: "rat-42", preySpecies: "rat", sizeClass: "small", weightGrams: 42 },
    ],
    profiles: [interval("ach-today", "achilles", 14, "2026-08-02", .10)],
  });

  const event = forecast.events[0];
  assert.equal(event.feedingDate, "2026-08-02");
  assert.equal(event.scheduleId, "ach-today");
  assert.equal(event.allocatedFeeder?.id, "rat-42");
  assert.match(feederGuidance(event), /^Target \d+–\d+ g rat · 42 g small rat ready$/);
});

test("completed schedule dates are excluded so their consumed feeders are not allocated again", () => {
  const forecast = buildFeederForecast({
    today: "2026-08-02",
    horizonDays: 15,
    animals,
    weights,
    availableFeeders: [{ id: "rat-next", preySpecies: "rat", sizeClass: "small", weightGrams: 42 }],
    profiles: [interval("ach-completed", "achilles", 14, "2026-08-02", .10)],
    excludedFeedings: ["ach-completed:2026-08-02"],
  });

  assert.equal(forecast.events.length, 1);
  assert.equal(forecast.events[0].feedingDate, "2026-08-16");
  assert.equal(forecast.events[0].allocatedFeeder?.id, "rat-next");
});
