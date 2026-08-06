/**
 * Light My Reptile fixture catalog — hash to product name.
 *
 * Binary share links (v2+) carry a 3-byte hash per fixture instead of a name,
 * so Shed used to make the keeper type each product in by hand. The Light My
 * Reptile developer supplied this mapping directly (2026-08-06), which lets the
 * import name every fixture itself.
 *
 * This is a point-in-time snapshot of someone else's catalog, not a live feed.
 * A hash we don't recognise is expected — probably a product added since — and
 * must degrade to manual entry rather than guessing or failing the import.
 */

export const LIGHT_MY_REPTILE_CATALOG_UPDATED = "2026-08-06";

/** Multi-word brands, matched longest-first so "Reptile Systems" wins over "Repti…". */
const BRANDS = [
  "Reptile Systems",
  "White Python",
  "Sol Reptile",
  "Exo Terra",
  "Zoo Med",
  "Faunalux",
  "LEDPAR30",
  "ReptiZoo",
  "Arcadia",
  "ProRep",
  "MENGS",
].sort((a, b) => b.length - a.length);

/** Keys are the bare 6-digit lowercase hex from the share payload. */
const PRODUCTS: Record<string, string> = {
  // UVB
  "87a6cb": "Arcadia D3 6% UVB T5 24W",
  "b3dd3f": "Arcadia ProT5 ShadeDweller Arboreal 2.4% UVB 8W",
  "88a6b8": "Arcadia ProT5 ShadeDweller 7% UVB 8W",
  "ae72be": "Arcadia ProT5 D3+ 12% UVB 24W",
  "e64c80": "Arcadia ProT5 D3+ 12% UVB 39W",
  "22912b": "Zoo Med ReptiSun 5.0 UVB T5 HO 24W",
  "b7e5d4": "Zoo Med ReptiSun 10.0 UVB T5 HO 24W",

  // Basking / heat
  "d49b9e": "Exo Terra 50W Intense Basking Spot",
  "24b983": "Exo Terra 75W Intense Basking Spot",
  "de4f29": "Exo Terra 100W Intense Basking Spot",
  "6d8137": "Exo Terra 150W Intense Basking Spot",
  "984d5c": "Exo Terra 100W Daylight Basking Spot",
  "9ec995": "ProRep 100W Flood Spot",
  "cdf85b": "Reptile Systems Eco Halogen 25W",
  "f8e309": "Reptile Systems Eco Halogen 40W",
  "48e2fa": "Reptile Systems Eco Halogen 50W",
  "4527e0": "Reptile Systems Eco Halogen 60W",
  "f23f49": "Reptile Systems Eco Halogen 75W",
  "76199e": "Reptile Systems Eco Halogen 100W",
  "58e5d1": "Reptile Systems Basking Halo Spot 100W",
  "55abad": "Reptile Systems Gold Infrared Lamp Unit 75W",
  "f6aa28": "Reptile Systems Gold Infrared Lamp Unit 100W",
  "3588bb": "Reptile Systems Gold Infrared Lamp Unit 200W",
  "75b282": "Reptile Systems Gold Infrared Lamp Unit 400W",
  "99c1fc": "ReptiZoo 50W Intense Basking Spot",
  "0895f5": "ReptiZoo 75W Intense Basking Spot",
  "12f9b4": "ReptiZoo 100W Intense Basking Spot",
  "fc36e0": "ReptiZoo 150W Intense Basking Spot",
  "e47b9f": "White Python 50W Intense Basking Spot",
  "a00651": "White Python 75W Intense Basking Spot",
  "267983": "White Python 100W Intense Basking Spot",
  "fcb3ae": "White Python 150W Intense Basking Spot",
  "3197c6": "Zoo Med Nano Basking Spot 25W",
  "43e4ae": "Zoo Med Repti Basking Spot 25W",
  "50f729": "Zoo Med Nano Halogen 35W",
  "d0602c": "Zoo Med Nano Basking Spot 40W",
  "fa2c42": "Zoo Med Repti Basking Spot 40W",
  "a19b3f": "Zoo Med Repti Basking Spot 75W",
  "a409de": "Zoo Med Repti Basking Spot 100W",
  "81f21c": "Zoo Med Repti Basking Spot 125W",
  "25fd2f": "Zoo Med Repti Basking Spot 150W",
  "769755": "Zoo Med Repti Tuff Halogen 90W",
  "278c34": "Zoo Med Repti Tuff Splashproof Halogen 75W",

  // Daylight / LED
  "a51c3f": "Faunalux TrueChroma Spot LED 20W",
  "69723f": "Faunalux TrueChroma Spot LED 30W",
  "841f4c": "Faunalux TrueChroma Spot LED 35W",
  "bb81a0": "LEDPAR30 PAR30 E27 LED 35W",
  "c245bc": "MENGS PAR30 E27 LED 40W",
  "418705": "Reptile Systems New Dawn Spot LED 10W",
  "b2fcf5": "Reptile Systems New Dawn Spot LED 25W",
  "3c3beb": "Reptile Systems New Dawn Flood LED 35W",
  "dff5b3": "Sol Reptile VisionLED 54W",
};

export type CatalogProduct = { name: string; brand: string | null; model: string | null };

/** Split "Zoo Med Repti Basking Spot 75W" into its brand and the rest. */
export function splitProductName(name: string): { brand: string | null; model: string | null } {
  const brand = BRANDS.find((candidate) => name.toLowerCase().startsWith(`${candidate.toLowerCase()} `)) ?? null;
  if (!brand) return { brand: null, model: null };
  return { brand, model: name.slice(brand.length).trim() || null };
}

/**
 * Look up a fixture's product from the `sourceRef` the decoder produced.
 * Accepts "hash:88a6b8", "0x88A6B8", or a bare "88a6b8"; returns null for
 * anything we don't hold, including the legacy v1 string catalog ids.
 */
export function lookupCatalogProduct(sourceRef: string | null | undefined): CatalogProduct | null {
  if (typeof sourceRef !== "string") return null;
  const key = sourceRef.trim().toLowerCase().replace(/^hash:/, "").replace(/^0x/, "");
  if (!/^[0-9a-f]{6}$/.test(key)) return null;
  const name = PRODUCTS[key];
  if (!name) return null;
  return { name, ...splitProductName(name) };
}

/** Every hash we know, for tests and for reporting catalog coverage. */
export function catalogSize(): number {
  return Object.keys(PRODUCTS).length;
}

export { PRODUCTS as LIGHT_MY_REPTILE_PRODUCTS };
