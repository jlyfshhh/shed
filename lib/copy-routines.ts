/**
 * What makes two care plans "the same plan" when copying between animals.
 *
 * Shared by the interface, which groups siblings' plans into one suggestion,
 * and by the bulk-copy route, which skips plans the animal already has. They
 * must agree: if the interface thinks two plans are the same and the server
 * does not, copying twice silently creates duplicates.
 */

/** Every column carried from a source plan to a copy. */
export const COPYABLE_SCHEDULE_COLUMNS = [
  "task_type",
  "title",
  "details",
  "frequency",
  "interval_days",
  "weekdays_json",
  "day_of_month",
  "prey_species",
  "prey_description",
  "prey_size_class",
  "target_percent",
  "minimum_percent",
  "maximum_percent",
  "buy_as_needed",
  "reward_cents",
  // A copied weekend chore that loses its window goes overdue a day early, and
  // a plan meant to stop in January runs forever without its end date. Both
  // were dropped simply by not being listed here.
  "grace_days",
  "end_date",
] as const;

/**
 * Columns deliberately NOT copied, and why. Held to the schema by a test, so a
 * column added to care_schedules has to be classified rather than forgotten.
 */
export const DELIBERATELY_NOT_COPIED = [
  "id",           // the copy is a new plan
  "animal_id",    // the copy is for a different animal — that is the point
  "animal_ids_json", // likewise: a copy must not inherit the source's other animals
  "start_date",   // the copy starts when it is made, not when the original did
  "active",       // a copy is always created active
  "created_at",
  "updated_at",
] as const;

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim().toLowerCase();

/**
 * Feeding is deliberately looser. Portion and cadence are matched to the
 * animal receiving the plan, so two feeding plans with the same title are the
 * same job even when their numbers differ — that is the whole point of the
 * matching. For everything else the cadence is part of the plan's identity: a
 * weekly and a daily "Mist enclosure" are different jobs, and treating them as
 * one collapsed them into whichever came first.
 */
export function copySignature(row: Record<string, unknown>): string {
  const taskType = text(row.task_type);
  if (taskType === "feeding") return `feeding::${text(row.title)}`;
  return [
    taskType,
    text(row.title),
    text(row.frequency),
    text(row.interval_days),
    text(row.weekdays_json),
    text(row.day_of_month),
    text(row.details),
  ].join("::");
}
