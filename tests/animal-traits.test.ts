import assert from "node:assert/strict";
import test from "node:test";
import { ageLabel, animalFacts, habitatLabel, sexLabel, speciesGlyph } from "../lib/animal-traits.ts";

test("habitat drops the placeholder location every animal shared", () => {
  // The whole reason for this helper: "Indoor habitat" is the schema default.
  assert.equal(habitatLabel(null, "Apollo", "Indoor habitat"), null);
  assert.equal(habitatLabel(null, "Apollo", "  indoor HABITAT "), null);
  assert.equal(habitatLabel(null, "Blue", "Animal Room"), "Animal Room");
});

test("habitat skips an enclosure name that just echoes the animal", () => {
  assert.equal(habitatLabel("Apollo enclosure", "Apollo", "Indoor habitat"), null);
  assert.equal(habitatLabel("Arcadia", "Arcadia", "Indoor habitat"), null);
  assert.equal(habitatLabel("Rubber Ducky Terrarium", "Rubber Ducky Isopods", "Animal room"), "Rubber Ducky Terrarium");
  assert.equal(habitatLabel("Cypress", "Taki", "Indoor habitat"), "Cypress");
});

test("habitat falls back to the location when the enclosure is redundant", () => {
  assert.equal(habitatLabel("Achilles enclosure", "Achilles", "Animal Room"), "Animal Room");
});

test("species glyphs pick the animal, not the group default", () => {
  assert.equal(speciesGlyph("Ball Python", "Reptile"), "🐍");
  assert.equal(speciesGlyph("Western Hognose — Albino", "Reptile"), "🐍");
  assert.equal(speciesGlyph("Leopard Gecko", "Reptile"), "🦎");
  assert.equal(speciesGlyph("Pacman Frog", "Amphibian"), "🐸");
  assert.equal(speciesGlyph("Red-eared Slider & guppies", "Aquatic"), "🐢");
  assert.equal(speciesGlyph('Cubaris sp. "Rubber Ducky"', "Invertebrate"), "🪲");
  assert.equal(speciesGlyph("Veiled Chameleon", "Reptile"), "🦎");
  // A community record describes a habitat, not one animal.
  assert.equal(speciesGlyph("Tree frogs, mourning geckos, vampire crabs & fish", "Community"), "🌿");
  assert.equal(speciesGlyph("Something unheard of", "Reptile"), "🦎");
  assert.equal(speciesGlyph("", ""), "🐾");
});

test("sex is normalised and unknowns are dropped", () => {
  assert.equal(sexLabel("male"), "♂ Male");
  assert.equal(sexLabel("Female"), "♀ Female");
  assert.equal(sexLabel("Unknown"), null);
  assert.equal(sexLabel(null), null);
});

test("age counts calendar months, not day arithmetic", () => {
  assert.equal(ageLabel("2026-07-20", "2026-08-05"), "16d");
  assert.equal(ageLabel("2025-07-03", "2026-08-05"), "13mo");
  assert.equal(ageLabel("2023-12-17", "2026-08-05"), "2y 7m");
  assert.equal(ageLabel("2024-08-05", "2026-08-05"), "2y");
  // The month only turns over on the birth day.
  assert.equal(ageLabel("2026-01-20", "2026-06-19"), "4mo");
  assert.equal(ageLabel("2026-01-20", "2026-06-20"), "5mo");
  assert.equal(ageLabel(null, "2026-08-05"), null);
  assert.equal(ageLabel("not a date", "2026-08-05"), null);
  assert.equal(ageLabel("2027-01-01", "2026-08-05"), null);
});

test("facts skip everything blank instead of printing placeholders", () => {
  assert.deepEqual(
    animalFacts({ name: "Achilles", sex: "male", weightGrams: 425, birthDate: "2025-07-03", location: "Animal Room", enclosureName: "Achilles enclosure" }, "2026-08-05"),
    ["♂ Male", "425 g", "13mo", "Animal Room"],
  );
  // Ares: no sex, no birth date, placeholder location, echoing enclosure.
  assert.deepEqual(
    animalFacts({ name: "Ares", sex: null, weightGrams: 1257, birthDate: null, location: "Indoor habitat", enclosureName: "Ares enclosure" }, "2026-08-05"),
    ["1257 g"],
  );
  assert.deepEqual(
    animalFacts({ name: "Pascal", location: "Indoor habitat", enclosureName: "Pascal enclosure" }, "2026-08-05"),
    [],
  );
  assert.deepEqual(animalFacts({ name: "Zero", weightGrams: 0 }, "2026-08-05"), []);
});
