/**
 * Presentation helpers for animal cards and profiles.
 *
 * The animals grid used to print `location` verbatim, which meant every card
 * read "Indoor habitat" — the schema default nobody ever edits. These helpers
 * pick the facts that actually distinguish one animal from another and drop the
 * ones that don't, so a card never spends a line saying nothing.
 */

/** Placeholder locations that carry no information about where an animal lives. */
const GENERIC_LOCATIONS = new Set([
  "indoor habitat", "indoor habitats", "indoors", "indoor", "inside",
  "home", "house", "n/a", "na", "none", "unknown", "tbd", "-", "—",
]);

/** Species/group keyword → glyph, first match wins, so "tree frog" beats "frog". */
const GLYPHS: Array<[RegExp, string]> = [
  [/\b(ball python|python|boa|corn snake|hognose|king ?snake|milk ?snake|snake|serpent)\b/i, "🐍"],
  [/\b(tortoise)\b/i, "🐢"],
  [/\b(slider|turtle|terrapin)\b/i, "🐢"],
  [/\b(tree frog|dart frog|pacman frog|frog|toad)\b/i, "🐸"],
  [/\b(newt|salamander|axolotl)\b/i, "🦎"],
  [/\b(bearded dragon|chameleon|gecko|skink|monitor|tegu|anole|iguana|lizard)\b/i, "🦎"],
  [/\b(isopod|springtail|roach|beetle|millipede)\b/i, "🪲"],
  [/\b(tarantula|spider|scorpion)\b/i, "🕷️"],
  [/\b(mantis)\b/i, "🦗"],
  [/\b(crab|shrimp|snail)\b/i, "🦀"],
  [/\b(fish|guppy|guppies|betta|tetra|cichlid)\b/i, "🐠"],
];

const GROUP_GLYPHS: Record<string, string> = {
  reptile: "🦎",
  amphibian: "🐸",
  invertebrate: "🪲",
  aquatic: "🐠",
  fish: "🐠",
  bird: "🐦",
  mammal: "🐁",
  community: "🌿",
};

/**
 * A glyph to stand in for a missing photo. Community records get the plant
 * glyph because they describe a habitat rather than one animal.
 */
export function speciesGlyph(species: string | null | undefined, group: string | null | undefined): string {
  const text = `${species ?? ""}`;
  if (`${group ?? ""}`.toLowerCase() === "community") return GROUP_GLYPHS.community;
  for (const [pattern, glyph] of GLYPHS) {
    if (pattern.test(text)) return glyph;
  }
  return GROUP_GLYPHS[`${group ?? ""}`.toLowerCase()] ?? "🐾";
}

/**
 * Where the animal lives, or null when we'd only be repeating ourselves.
 *
 * Prefers the enclosure name, but skips it when it's just "<Name> enclosure" —
 * the auto-generated name that adds nothing beside the animal's own heading.
 * Falls back to `location`, unless that's a placeholder like "Indoor habitat".
 */
export function habitatLabel(
  enclosureName: string | null | undefined,
  animalName: string | null | undefined,
  location: string | null | undefined,
): string | null {
  const enclosure = `${enclosureName ?? ""}`.trim();
  const name = `${animalName ?? ""}`.trim().toLowerCase();
  if (enclosure) {
    const lower = enclosure.toLowerCase();
    const echoesTheName = name.length > 0
      && (lower === name || lower === `${name} enclosure` || lower === `${name} terrarium` || lower === `${name} tank` || lower === `${name} culture`);
    if (!echoesTheName) return enclosure;
  }
  const place = `${location ?? ""}`.trim();
  if (place && !GENERIC_LOCATIONS.has(place.toLowerCase())) return place;
  return null;
}

/** ♂ / ♀ for the sexes we can recognise; null for unknown or unrecorded. */
export function sexLabel(sex: string | null | undefined): string | null {
  const value = `${sex ?? ""}`.trim().toLowerCase();
  if (value === "male" || value === "m") return "♂ Male";
  if (value === "female" || value === "f") return "♀ Female";
  return null;
}

/**
 * Compact age from a birth date: "18d", "7mo", "2y 4m".
 *
 * Months and years are counted on the calendar rather than by dividing days, so
 * an animal born on the 3rd turns a month older on the 3rd.
 */
export function ageLabel(birthDate: string | null | undefined, today: string): string | null {
  const born = `${birthDate ?? ""}`.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(born) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (born > today) return null;

  const [by, bm, bd] = born.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);

  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
  if (days < 60) return `${days}d`;

  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months < 24) return `${months}mo`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}y ${rest}m` : `${years}y`;
}

/**
 * The chip row under an animal's name — sex, weight, age, home — with the
 * blanks left out entirely rather than rendered as empty or placeholder text.
 */
export function animalFacts(
  animal: {
    name: string;
    species?: string | null;
    group?: string | null;
    sex?: string | null;
    location?: string | null;
    enclosureName?: string | null;
    weightGrams?: number | null;
    birthDate?: string | null;
  },
  today: string,
): string[] {
  const facts: string[] = [];
  const sex = sexLabel(animal.sex);
  if (sex) facts.push(sex);
  if (typeof animal.weightGrams === "number" && animal.weightGrams > 0) facts.push(`${animal.weightGrams} g`);
  const age = ageLabel(animal.birthDate, today);
  if (age) facts.push(age);
  const habitat = habitatLabel(animal.enclosureName, animal.name, animal.location);
  if (habitat) facts.push(habitat);
  return facts;
}
