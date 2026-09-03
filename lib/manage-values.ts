/**
 * What a blank field means for a given column.
 *
 * Most columns take NULL. A few are NOT NULL with a default, and writing NULL
 * into those fails the insert outright — which is what happened the moment
 * grace_days started being sent: the form posts `graceDays: null` whenever the
 * box is empty, so every care plan created through the form was refused.
 */
export function normalizedEmptyValue(resource: string, key: string): "" | 0 | 1 | "Reptile" | "done" | null {
  if (resource === "animal" && key === "location") return "";
  if (resource === "schedule" && key === "details") return "";
  // grace_days is INTEGER NOT NULL DEFAULT 0; blank means "no window", not NULL.
  if (resource === "schedule" && key === "graceDays") return 0;
  // group_name is TEXT NOT NULL DEFAULT 'Reptile'; an unanswered group is the
  // default, not an absence.
  if (resource === "animal" && key === "group") return "Reptile";
  // outcome is TEXT NOT NULL DEFAULT 'done'; care with no stated outcome happened.
  if (resource === "event" && key === "outcome") return "done";
  // week_interval is INTEGER NOT NULL DEFAULT 1; blank means every week.
  if (resource === "schedule" && key === "weekInterval") return 1;
  return null;
}
