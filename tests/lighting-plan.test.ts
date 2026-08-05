import assert from "node:assert/strict";
import test from "node:test";
import { lightingPlanStatus } from "../lib/lighting-plan.ts";

test("lighting plan without a UVI target remains informational", () => {
  assert.equal(lightingPlanStatus({ planUpdatedAt: "2026-08-01T12:00:00Z", latestUvi: null }), "plan-only");
});

test("lighting plan needs a measurement newer than its latest update", () => {
  assert.equal(lightingPlanStatus({ targetUviMin: 3, targetUviMax: 4, planUpdatedAt: "2026-08-02T12:00:00Z", latestUvi: { value: 3.5, measuredAt: "2026-08-01T12:00:00Z" } }), "due");
});

test("lighting plan distinguishes verified and out-of-range measurements", () => {
  const base = { targetUviMin: 3, targetUviMax: 4, planUpdatedAt: "2026-08-01T12:00:00Z" };
  assert.equal(lightingPlanStatus({ ...base, latestUvi: { value: 3.5, measuredAt: "2026-08-02T12:00:00Z" } }), "verified");
  assert.equal(lightingPlanStatus({ ...base, latestUvi: { value: 5.1, measuredAt: "2026-08-02T12:00:00Z" } }), "review");
});
