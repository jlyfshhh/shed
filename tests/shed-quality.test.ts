import test from "node:test";
import assert from "node:assert/strict";
import { SHED_QUALITIES, SHED_QUALITY_LABELS, isPoorShed, isShedQuality, shedIntervalDays } from "../lib/shed-quality.ts";

test("every quality has a keeper-facing label", () => {
  for (const quality of SHED_QUALITIES) {
    assert.ok(SHED_QUALITY_LABELS[quality], `${quality} has no label`);
  }
  assert.equal(Object.keys(SHED_QUALITY_LABELS).length, SHED_QUALITIES.length);
});

test("only known qualities are accepted", () => {
  assert.ok(isShedQuality("complete"));
  assert.ok(isShedQuality("stuck-eyecaps"));
  // The API rejects anything else, so a typo cannot reach the database.
  assert.equal(isShedQuality("perfect"), false);
  assert.equal(isShedQuality(""), false);
  assert.equal(isShedQuality("COMPLETE"), false);
});

test("a clean shed is the only one that is not flagged", () => {
  assert.equal(isPoorShed("complete"), false);
  for (const quality of SHED_QUALITIES.filter((q) => q !== "complete")) {
    assert.ok(isPoorShed(quality), `${quality} should be flagged`);
  }
  // An unknown value is not a poor shed; it is not a shed quality at all.
  assert.equal(isPoorShed("nonsense"), false);
});

test("interval needs two sheds", () => {
  assert.equal(shedIntervalDays([]), null);
  assert.equal(shedIntervalDays([{ recordedOn: "2026-08-10" }]), null);
});

test("interval counts whole days between the two most recent sheds", () => {
  const history = [
    { recordedOn: "2026-08-10" },
    { recordedOn: "2026-07-11" },
    { recordedOn: "2026-06-02" },
  ];
  assert.equal(shedIntervalDays(history), 30);
});

test("a daylight-saving boundary inside the interval does not shift the count", () => {
  // US DST ended 2025-11-02; parsing these as local time would give 91.958…
  // days and round to the wrong answer on some hosts.
  assert.equal(shedIntervalDays([{ recordedOn: "2025-12-01" }, { recordedOn: "2025-09-01" }]), 91);
});

test("a malformed date yields no interval rather than NaN", () => {
  assert.equal(shedIntervalDays([{ recordedOn: "not-a-date" }, { recordedOn: "2026-08-01" }]), null);
});
