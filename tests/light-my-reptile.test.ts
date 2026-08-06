import test from "node:test";
import assert from "node:assert/strict";
import { decodeLightMyReptileUrl, inches, unnamedFixtures } from "../lib/light-my-reptile.ts";

const MORT_SETUP = "https://lightmyreptile.com/#s=2.GRQRiKa4_eyFALcAWwBbAEYAmAAaACpGAAAGJLmDAQAxAgDf9bMBAEYCAACY";

test("decodes Mort's version 2 exact-setup link without contacting the source site", () => {
  const setup = decodeLightMyReptileUrl(MORT_SETUP);
  assert.equal(setup.formatVersion, 2);
  assert.equal(setup.unitSystem, "imperial");
  assert.equal(setup.mountingMode, "external");
  assert.equal(setup.lightingLevel, "E");
  assert.deepEqual(setup.enclosure, { widthCm: 91.5, depthCm: 45.5, heightCm: 45.5 });
  assert.equal(setup.platformHeightCm, 13);
  assert.equal(setup.baskingDistanceCm, 32.5);
  assert.equal(inches(setup.baskingDistanceCm), 12.8);
  assert.equal(setup.meshBlockagePercent, 35);
  assert.equal(setup.animalBackHeightCm, 3);
  assert.deepEqual(setup.fixtures.map(({ fixtureKey, role, sourceRef, positionCm }) => ({ fixtureKey, role, sourceRef, positionCm })), [
    { fixtureKey: "uvb-1", role: "uvb", sourceRef: "hash:88a6b8", positionCm: 35 },
    { fixtureKey: "heat-1", role: "heat", sourceRef: "hash:24b983", positionCm: 24.5 },
    { fixtureKey: "daylight-1", role: "daylight", sourceRef: "hash:dff5b3", positionCm: 35 },
  ]);
});

test("names Mort's three fixtures from the catalog, so nothing needs typing in", () => {
  const setup = decodeLightMyReptileUrl(MORT_SETUP);
  assert.deepEqual(setup.fixtures.map((fixture) => fixture.product?.name), [
    "Arcadia ProT5 ShadeDweller 7% UVB 8W",
    "Exo Terra 75W Intense Basking Spot",
    "Sol Reptile VisionLED 54W",
  ]);
  assert.deepEqual(setup.fixtures.map((fixture) => fixture.product?.brand), ["Arcadia", "Exo Terra", "Sol Reptile"]);
  assert.equal(unnamedFixtures(setup).length, 0);
});

test("rejects lookalike and ordinary planner URLs", () => {
  assert.throws(() => decodeLightMyReptileUrl("https://lightmyreptile.example/#s=2.anything"), /Only HTTPS share links/);
  assert.throws(() => decodeLightMyReptileUrl("https://lightmyreptile.com/"), /does not contain an exact shared setup/);
});
