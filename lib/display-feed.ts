export const TODAY_DISPLAY_TASKS_SQL = `
  SELECT t.animal_id AS animalId,
         t.schedule_id AS scheduleId,
         a.name AS animalName,
         a.species,
         t.task_type AS taskType,
         t.title,
         t.details,
         t.due_date AS dueDate,
         t.missed_at AS missedAt,
         t.skipped_at AS skippedAt,
         e.outcome AS outcome,
         CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete
    FROM care_tasks t
    JOIN animals a ON a.id = t.animal_id
    LEFT JOIN care_schedules s ON s.id = t.schedule_id
    LEFT JOIN husbandry_events e
      ON e.task_id = t.id
     AND e.due_date = t.due_date
     AND e.voided_at IS NULL
   WHERE a.active = 1
     AND t.due_date <= ?
     AND date(t.due_date, '+' || COALESCE(s.grace_days, 0) || ' days') >= ?
   ORDER BY complete, t.due_date, a.name, t.title
`;

export type TodayDisplayDispositionRow = {
  complete: number;
  outcome: string | null;
  missedAt: string | null;
  skippedAt: string | null;
};

export function isActionableTodayDisplayTask(task: TodayDisplayDispositionRow) {
  return !task.complete && !task.missedAt && !task.skippedAt;
}

/**
 * Produce one mutually-exclusive disposition for every scheduled task.
 *
 * A completion wins over stale legacy disposition metadata. For the same
 * reason, a skip wins over a miss if an old row somehow contains both. The
 * normal task-disposition flow already prevents those combinations, but this
 * precedence keeps the public display total honest while older data is being
 * normalized.
 *
 * `refused` is intentionally a subset of `completed`: the keeper performed
 * the feeding even though the animal declined it.
 */
export function summarizeTodayDisplayTasks(rows: TodayDisplayDispositionRow[]) {
  let completed = 0;
  let refused = 0;
  let skipped = 0;
  let missed = 0;
  let remaining = 0;

  for (const row of rows) {
    if (row.complete) {
      completed += 1;
      if (row.outcome === "refused") refused += 1;
    } else if (row.skippedAt) {
      skipped += 1;
    } else if (row.missedAt) {
      missed += 1;
    } else {
      remaining += 1;
    }
  }

  return {
    total: rows.length,
    completed,
    refused,
    skipped,
    missed,
    remaining,
  };
}
