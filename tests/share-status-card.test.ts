import assert from "node:assert/strict";
import test from "node:test";
import { buildShareStatusCardModel } from "../lib/share-status-card.ts";

test("the default public card is a whitelist and redacts every identity", () => {
  const model = buildShareStatusCardModel({
    date: "2026-09-28",
    animalCount: 2,
    tasks: [{
      animalName: "Mort",
      complete: true,
      skippedAt: null,
      missedAt: null,
      keeperName: "Private Keeper",
      accessCode: "shed-secret-code",
      rewardCents: 25,
      notes: "Private household note",
      localIp: "192.168.1.50",
      id: "private-record-id",
    } as never],
    overdue: [{ animalName: "Turtle", completedBy: "Another Keeper" } as never],
  });

  assert.deepEqual(Object.keys(model), [
    "date", "animalCount", "scheduled", "completed", "remaining", "missed", "skipped",
    "overdue", "completionPercent", "status", "animalNames",
  ]);
  assert.deepEqual(model.animalNames, []);
  const publicPayload = JSON.stringify(model);
  for (const privateValue of ["Mort", "Turtle", "Private Keeper", "Another Keeper", "shed-secret-code", "Private household note", "192.168.1.50", "private-record-id", "rewardCents"]) {
    assert.doesNotMatch(publicPayload, new RegExp(privateValue.replaceAll(".", "\\.")));
  }
});

test("animal names appear only after explicit opt-in and are normalised", () => {
  const input = {
    date: "2026-09-28",
    animalCount: 3,
    tasks: [
      { animalName: "  Mort  ", complete: true },
      { animalName: "Mort", complete: false },
      { animalName: "Turtle\nThe Gecko", complete: false },
    ],
    overdue: [{ animalName: "Rhino" }],
  };

  assert.deepEqual(buildShareStatusCardModel(input).animalNames, []);
  assert.deepEqual(
    buildShareStatusCardModel(input, { includeAnimalNames: true }).animalNames,
    ["Mort", "Turtle The Gecko", "Rhino"],
  );
});

test("share totals use the same skipped and missed semantics as Today", () => {
  const model = buildShareStatusCardModel({
    date: "2026-09-28",
    animalCount: 4,
    tasks: [
      { animalName: "A", complete: true },
      { animalName: "B", complete: false },
      { animalName: "C", complete: false, missedAt: "2026-09-28T20:00:00Z" },
      { animalName: "D", complete: false, skippedAt: "2026-09-28T19:00:00Z" },
    ],
    overdue: [],
  });

  assert.equal(model.scheduled, 4);
  assert.equal(model.completed, 1);
  assert.equal(model.remaining, 1);
  assert.equal(model.missed, 1);
  assert.equal(model.skipped, 1);
  assert.equal(model.completionPercent, 33);
  assert.equal(model.status, "One care task remains today.");
});

test("overdue work takes priority in the public status without exposing its animal", () => {
  const model = buildShareStatusCardModel({
    date: "not-a-date",
    animalCount: Number.NaN,
    tasks: [],
    overdue: [{ animalName: "Secret Snake" }, { animalName: "Private Frog" }],
  });

  assert.equal(model.date, "");
  assert.equal(model.animalCount, 0);
  assert.equal(model.status, "2 overdue care items need attention.");
  assert.doesNotMatch(JSON.stringify(model), /Secret Snake|Private Frog/);
});
