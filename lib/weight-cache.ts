// The animals table caches each animal's latest weight (`weight_grams` /
// `weight_date`) so the dashboard can show it without a per-animal query. That
// cache has to be rebuilt from weight_events whenever an animal's weights
// change — and, crucially, for EVERY animal a change touched.
//
// Reassigning a weight from one animal to another touches two animals: the
// destination gains a weight, and the source loses one. Refreshing only the
// destination (the bug behind F11) leaves the source advertising a latest
// weight that now belongs to a different animal. `weightCacheTargets` names
// both so a caller cannot forget the source.

/** Rebuild one animal's cached latest weight from its weight_events. */
export async function refreshCachedWeight(db: D1Database, animalId: string, now: string = new Date().toISOString()) {
  const latest = await db
    .prepare(
      "SELECT weight_grams AS weightGrams, recorded_on AS recordedOn FROM weight_events WHERE animal_id = ? ORDER BY recorded_on DESC, rowid DESC LIMIT 1",
    )
    .bind(animalId)
    .first<{ weightGrams: number; recordedOn: string }>();
  await db
    .prepare("UPDATE animals SET weight_grams = ?, weight_date = ?, updated_at = ? WHERE id = ?")
    .bind(latest?.weightGrams ?? null, latest?.recordedOn ?? null, now, animalId)
    .run();
}

/**
 * The animals whose cached weight must be rebuilt after a weight record moved
 * from `previousAnimalId` to `nextAnimalId`. A same-animal edit refreshes one
 * animal; a reassignment refreshes both source and destination.
 */
export function weightCacheTargets(previousAnimalId: string, nextAnimalId: string): string[] {
  return previousAnimalId === nextAnimalId ? [nextAnimalId] : [nextAnimalId, previousAnimalId];
}

/** Rebuild the cached weight for every animal a weight change touched. */
export async function refreshCachedWeights(db: D1Database, animalIds: Iterable<string>, now: string = new Date().toISOString()) {
  for (const animalId of new Set(animalIds)) {
    await refreshCachedWeight(db, animalId, now);
  }
}
