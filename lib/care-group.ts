/**
 * Care plans that cover several animals at once.
 *
 * Keepers who feed all their leopard geckos on the same day want one line that
 * says "Feed leopard geckos", not one per animal. The plan therefore carries a
 * list of animals, while the tasks it produces stay per-animal so that history,
 * weights, feeder consumption and who-did-what remain individual — which is the
 * whole point of the records.
 *
 * The list lives in a JSON column rather than a join table, the way weekdays
 * already do. A join table needs a composite key, which the portable backup's
 * one-key-per-resource shape cannot express, and quietly dropping a table from
 * that manifest is exactly how this app has lost data before.
 */

/** The animals a plan covers, primary first, de-duplicated. */
export function scheduleAnimalIds(schedule: { animalId: string; animalIdsJson?: string | null }): string[] {
  const primary = (schedule.animalId ?? "").trim();
  const extras = parseAnimalIds(schedule.animalIdsJson);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [primary, ...extras]) {
    const trimmed = (id ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

/** Tolerant of anything a hand-edited or restored database might hold. */
export function parseAnimalIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim());
  } catch {
    return [];
  }
}

/** Null for a single-animal plan, so those rows stay exactly as they are. */
export function serializeAnimalIds(animalIds: readonly string[], primaryAnimalId: string): string | null {
  const ids = scheduleAnimalIds({ animalId: primaryAnimalId, animalIdsJson: JSON.stringify([...animalIds]) });
  return ids.length > 1 ? JSON.stringify(ids) : null;
}

/**
 * The deterministic id for one animal's task on one date.
 *
 * The primary animal keeps the original `schedule:date` form forever. Task ids
 * are what make re-materialization idempotent, so widening the scheme for every
 * animal would have created a second task for animals that already had one the
 * moment a plan gained a second animal.
 */
export function careTaskId(scheduleId: string, animalId: string, primaryAnimalId: string, date: string): string {
  return animalId === primaryAnimalId ? `${scheduleId}:${date}` : `${scheduleId}:${animalId}:${date}`;
}

export type GroupableTask = { scheduleId?: string | null; dueDate: string; animalId: string };

/**
 * Group key for tasks that should appear as one line.
 *
 * Tasks from one plan on one date are the group; no extra column is needed to
 * mark them. Tasks with no plan behind them are always their own group, since
 * a one-off is never part of a routine.
 */
export function taskGroupKey(task: GroupableTask): string {
  return task.scheduleId ? `plan:${task.scheduleId}:${task.dueDate}` : `task:${task.animalId}:${task.dueDate}`;
}

/** Collapse tasks into groups, preserving the order the first member appeared. */
export function groupTasks<T extends GroupableTask>(tasks: readonly T[]): Array<{ key: string; tasks: T[] }> {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const key = taskGroupKey(task);
    const existing = groups.get(key);
    if (existing) existing.push(task);
    else groups.set(key, [task]);
  }
  return [...groups.entries()].map(([key, grouped]) => ({ key, tasks: grouped }));
}
