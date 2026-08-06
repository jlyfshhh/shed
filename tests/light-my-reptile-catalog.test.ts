import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogSize,
  LIGHT_MY_REPTILE_PRODUCTS,
  lookupCatalogProduct,
  splitProductName,
} from "../lib/light-my-reptile-catalog.ts";

test("holds the catalog the Light My Reptile developer supplied", () => {
  assert.equal(catalogSize(), 52);
  // Every key is the bare 6-digit lowercase hex the decoder emits.
  for (const key of Object.keys(LIGHT_MY_REPTILE_PRODUCTS)) {
    assert.match(key, /^[0-9a-f]{6}$/, `${key} is not a bare 6-digit lowercase hash`);
  }
});

test("every product splits into a known brand, so nothing lands with a blank brand", () => {
  for (const [key, name] of Object.entries(LIGHT_MY_REPTILE_PRODUCTS)) {
    const { brand, model } = splitProductName(name);
    assert.ok(brand, `${key} (${name}) has no recognised brand`);
    assert.ok(model, `${key} (${name}) has no model left after the brand`);
  }
});

test("brands are matched longest-first, so Reptile Systems beats a shorter prefix", () => {
  assert.deepEqual(splitProductName("Reptile Systems Eco Halogen 50W"), { brand: "Reptile Systems", model: "Eco Halogen 50W" });
  assert.deepEqual(splitProductName("ReptiZoo 50W Intense Basking Spot"), { brand: "ReptiZoo", model: "50W Intense Basking Spot" });
  assert.deepEqual(splitProductName("Zoo Med Repti Basking Spot 75W"), { brand: "Zoo Med", model: "Repti Basking Spot 75W" });
  assert.deepEqual(splitProductName("Something Unbranded 10W"), { brand: null, model: null });
});

test("accepts the reference shapes a share link and a human can produce", () => {
  const expected = { name: "Arcadia ProT5 ShadeDweller 7% UVB 8W", brand: "Arcadia", model: "ProT5 ShadeDweller 7% UVB 8W" };
  assert.deepEqual(lookupCatalogProduct("hash:88a6b8"), expected);
  assert.deepEqual(lookupCatalogProduct("0x88A6B8"), expected);
  assert.deepEqual(lookupCatalogProduct("88A6B8"), expected);
  assert.deepEqual(lookupCatalogProduct(" hash:88A6B8 "), expected);
});

test("an unknown or legacy reference resolves to null rather than a guess", () => {
  // A hash newer than this snapshot must fall back to manual entry.
  assert.equal(lookupCatalogProduct("hash:000000"), null);
  // Version 1 links carry string catalog ids, which this table doesn't cover.
  assert.equal(lookupCatalogProduct("arcadia-d3-6-24"), null);
  assert.equal(lookupCatalogProduct(""), null);
  assert.equal(lookupCatalogProduct(null), null);
  assert.equal(lookupCatalogProduct(undefined), null);
  assert.equal(lookupCatalogProduct("hash:zzzzzz"), null);
});
