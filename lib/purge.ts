/**
 * Permanently removing an archived animal, or a history entry already voided.
 *
 * The default everywhere else is to keep: animals archive, corrections void and
 * stay marked "corrected". That is right for care actually given — a record you
 * can erase is not a record. But it leaves someone who evaluated the app with
 * test data they cannot get rid of, on the same install as their real animals.
 *
 * So this is deliberately narrow. Only an animal already archived, only an
 * entry already voided, and only ever by the Head Keeper.
 */

/**
 * Everything belonging to one animal, dependants before their parents.
 *
 * Two deliberate exceptions, both because the row is not really the animal's:
 * feeder inventory is stock history and survives with its link cleared, and
 * equipment belongs to an enclosure as much as to an occupant.
 */
export const ANIMAL_PURGE_STEPS: ReadonlyArray<{ sql: string; why: string }> = [
  { sql: "DELETE FROM husbandry_event_revisions WHERE event_id IN (SELECT id FROM husbandry_events WHERE animal_id = ?)",
    why: "revisions of that animal's history" },
  { sql: "DELETE FROM husbandry_events WHERE animal_id = ?", why: "its history" },
  { sql: "DELETE FROM care_tasks WHERE animal_id = ?", why: "its outstanding and settled tasks" },
  { sql: "DELETE FROM animal_notes WHERE animal_id = ?", why: "notes about it" },
  { sql: "DELETE FROM weight_events WHERE animal_id = ?", why: "its weights" },
  { sql: "DELETE FROM shed_events WHERE animal_id = ?", why: "its sheds" },
  { sql: "DELETE FROM animal_photos WHERE animal_id = ?", why: "its photo" },
  { sql: "DELETE FROM feeding_assignments WHERE animal_id = ?", why: "feeders set aside for it" },
  { sql: "UPDATE feeder_inventory SET animal_id = NULL, husbandry_event_id = NULL WHERE animal_id = ?",
    why: "keeps the feeder as stock history, unlinked" },
  { sql: "UPDATE equipment SET animal_id = NULL WHERE animal_id = ?",
    why: "equipment belongs to the enclosure too, so it stays" },
  { sql: "DELETE FROM care_schedules WHERE animal_id = ?", why: "plans it was the subject of" },
  { sql: "DELETE FROM animals WHERE id = ?", why: "the animal" },
] as const;

/** A voided entry and the revisions recorded against it. */
export const EVENT_PURGE_STEPS: ReadonlyArray<{ sql: string; why: string }> = [
  { sql: "DELETE FROM husbandry_event_revisions WHERE event_id = ?", why: "its correction trail" },
  { sql: "DELETE FROM husbandry_events WHERE id = ? AND voided_at IS NOT NULL", why: "the entry itself" },
] as const;

/**
 * A grouped plan covering the animal must lose that member, not be deleted:
 * the other animals on it are still on that routine. Returns the new value for
 * a plan's animal list, or null when only the primary animal is left.
 */
export function animalIdsWithout(animalIdsJson: string | null | undefined, animalId: string, primaryAnimalId: string): string | null {
  let parsed: unknown = [];
  try { parsed = JSON.parse(animalIdsJson || "[]"); } catch { parsed = []; }
  const remaining = (Array.isArray(parsed) ? parsed : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value && value !== animalId && value !== primaryAnimalId);
  return remaining.length ? JSON.stringify([primaryAnimalId, ...remaining]) : null;
}

/** A piece of equipment, and the plan fixtures that mounted it. */
export const EQUIPMENT_PURGE_STEPS: ReadonlyArray<{ sql: string; why: string }> = [
  { sql: "DELETE FROM lighting_plan_fixtures WHERE equipment_id = ?", why: "where this fixture sat in a lighting plan" },
  { sql: "DELETE FROM equipment WHERE id = ?", why: "the equipment" },
] as const;

/**
 * A lighting plan, its fixtures and its readings.
 *
 * The plan sheet is a file in object storage rather than a row, so the caller
 * deletes that separately; leaving it behind would orphan an upload nothing
 * points at any more.
 */
export const LIGHTING_PLAN_PURGE_STEPS: ReadonlyArray<{ sql: string; why: string }> = [
  { sql: "DELETE FROM lighting_measurements WHERE plan_id = ?", why: "readings taken against it" },
  { sql: "DELETE FROM lighting_plan_fixtures WHERE plan_id = ?", why: "its fixture layout" },
  { sql: "DELETE FROM lighting_plans WHERE id = ?", why: "the plan" },
] as const;

/**
 * A care plan, its tasks, and the history recorded against those tasks.
 *
 * Deleting the plan alone would leave tasks pointing at nothing. History that
 * was recorded without a task — care entered by hand — is not the plan's to
 * take, so only task-linked entries go.
 */
export const SCHEDULE_PURGE_STEPS: ReadonlyArray<{ sql: string; why: string }> = [
  { sql: "DELETE FROM husbandry_event_revisions WHERE event_id IN (SELECT id FROM husbandry_events WHERE task_id IN (SELECT id FROM care_tasks WHERE schedule_id = ?))",
    why: "corrections to care recorded against this plan" },
  { sql: "DELETE FROM husbandry_events WHERE task_id IN (SELECT id FROM care_tasks WHERE schedule_id = ?)",
    why: "care recorded against this plan's tasks" },
  { sql: "DELETE FROM care_tasks WHERE schedule_id = ?", why: "its tasks" },
  { sql: "DELETE FROM care_schedules WHERE id = ?", why: "the plan" },
] as const;
