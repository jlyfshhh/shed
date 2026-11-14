// Relative import: covered by a `node --test` suite without the bundler alias.
import { supersededSql } from "./superseded.ts";

export class TaskDispositionError extends Error {
  readonly status: 404 | 409;

  constructor(message: string, status: 404 | 409) {
    super(message);
    this.name = "TaskDispositionError";
    this.status = status;
  }
}

export type DispositionActor = { id: string | null; name: string };

type TaskDispositionState = {
  skippedAt: string | null;
  skippedBy: string | null;
  skipReason: string | null;
  missedAt: string | null;
  completed: number;
};

/**
 * Repair impossible rows written by releases that allowed skip/miss to race
 * with completion. This is intentionally idempotent so each worker can run it
 * during schema setup. A real completion wins; otherwise the newer explicit
 * disposition wins (ISO timestamps sort chronologically).
 */
export async function normalizeLegacyTaskDispositions(db: D1Database) {
  await db.batch([
    db.prepare(
      `UPDATE care_tasks
          SET missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL,
              skipped_at = NULL, skipped_by_member_id = NULL, skipped_by_name = NULL,
              skip_reason = NULL
        WHERE (missed_at IS NOT NULL OR skipped_at IS NOT NULL)
          AND EXISTS (
            SELECT 1 FROM husbandry_events e
             WHERE e.task_id = care_tasks.id
               AND e.due_date = care_tasks.due_date
               AND e.voided_at IS NULL
          )`,
    ),
    db.prepare(
      `UPDATE care_tasks
          SET skipped_at = NULL, skipped_by_member_id = NULL,
              skipped_by_name = NULL, skip_reason = NULL
        WHERE skipped_at IS NOT NULL AND missed_at IS NOT NULL
          AND missed_at > skipped_at`,
    ),
    db.prepare(
      `UPDATE care_tasks
          SET missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL
        WHERE skipped_at IS NOT NULL AND missed_at IS NOT NULL`,
    ),
  ]);
}

async function dispositionState(db: D1Database, taskId: string, dueDate: string) {
  return db.prepare(
    `SELECT t.skipped_at AS skippedAt,
            t.skipped_by_name AS skippedBy,
            t.skip_reason AS skipReason,
            t.missed_at AS missedAt,
            CASE WHEN EXISTS (
              SELECT 1 FROM husbandry_events e
               WHERE e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL
            ) THEN 1 ELSE 0 END AS completed
       FROM care_tasks t
      WHERE t.id = ? AND t.due_date = ?`,
  ).bind(taskId, dueDate).first<TaskDispositionState>();
}

/**
 * Record a skip with one conditional write.
 *
 * The event check belongs in the UPDATE rather than in a SELECT before it. Two
 * phones can act on the same card at once; a read followed by an unconditional
 * write allowed a completion to land in between and left the task both complete
 * and skipped. Repeating the same skip is idempotent and preserves the original
 * attribution instead of rewriting history with the retry.
 */
export async function skipScheduledTask(
  db: D1Database,
  input: { taskId: string; dueDate: string; reason: string | null; actor: DispositionActor; occurredAt?: string },
) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const result = await db.prepare(
    `UPDATE care_tasks
        SET skipped_at = ?, skipped_by_member_id = ?, skipped_by_name = ?, skip_reason = ?,
            missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL
      WHERE id = ? AND due_date = ? AND skipped_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM husbandry_events e
           WHERE e.task_id = care_tasks.id
             AND e.due_date = care_tasks.due_date
             AND e.voided_at IS NULL
        )`,
  ).bind(
    occurredAt,
    input.actor.id,
    input.actor.name,
    input.reason,
    input.taskId,
    input.dueDate,
  ).run();

  if (result.meta.changes) {
    return { skipped: true as const, by: input.actor.name, reason: input.reason };
  }

  const state = await dispositionState(db, input.taskId, input.dueDate);
  if (!state) throw new TaskDispositionError("That task could not be found.", 404);
  if (state.completed) {
    throw new TaskDispositionError(
      "That task is already recorded as done. Correct the completion instead.",
      409,
    );
  }
  if (state.skippedAt) {
    return { skipped: true as const, by: state.skippedBy ?? input.actor.name, reason: state.skipReason };
  }
  throw new TaskDispositionError("That task changed while you were updating it. Try again.", 409);
}

export async function unskipScheduledTask(db: D1Database, taskId: string, dueDate: string) {
  const result = await db.prepare(
    `UPDATE care_tasks
        SET skipped_at = NULL, skipped_by_member_id = NULL, skipped_by_name = NULL, skip_reason = NULL
      WHERE id = ? AND due_date = ? AND skipped_at IS NOT NULL`,
  ).bind(taskId, dueDate).run();
  if (result.meta.changes) return { skipped: false as const };

  const state = await dispositionState(db, taskId, dueDate);
  if (!state) throw new TaskDispositionError("That task could not be found.", 404);
  return { skipped: false as const };
}

/**
 * Un-miss: the keeper changed their mind, or marked the wrong one missed. It
 * returns to the active list exactly as un-skip does — but only while the
 * make-up window is still open. Once the plan has come due again (a later
 * occurrence of the same task — see lib/superseded.ts — is due on or before
 * `today`), the
 * occurrence was genuinely superseded, and `autoMissSupersededTasks` would
 * re-miss it on the next materialization anyway; restoring it would silently
 * reverse on the next date rollover or worker restart. So restoring a
 * superseded occurrence is refused, consistent with auto-miss: the care now
 * counts toward the current occurrence, and a late make-up is a completion
 * ("Actually done"), not a restoration.
 */
export async function unmissScheduledTask(db: D1Database, taskId: string, dueDate: string, today: string) {
  const superseded = await db.prepare(
    `SELECT 1 AS yes
       FROM care_tasks self
      WHERE self.id = ? AND self.due_date = ? AND ${supersededSql("self")}
      LIMIT 1`,
  ).bind(taskId, dueDate, today).first<{ yes: number }>();
  if (superseded) {
    throw new TaskDispositionError(
      "This was superseded when its plan came due again, so it can't be put back — mark it done if it actually happened.",
      409,
    );
  }

  const result = await db.prepare(
    `UPDATE care_tasks
        SET missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL
      WHERE id = ? AND due_date = ? AND missed_at IS NOT NULL`,
  ).bind(taskId, dueDate).run();
  if (result.meta.changes) return { missed: false as const };

  const state = await dispositionState(db, taskId, dueDate);
  if (!state) throw new TaskDispositionError("That task could not be found.", 404);
  return { missed: false as const };
}

/** A miss and a skip are mutually exclusive judgements about the same work. */
export async function missScheduledTask(
  db: D1Database,
  input: { taskId: string; dueDate: string; actor: DispositionActor; occurredAt?: string },
) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const result = await db.prepare(
    `UPDATE care_tasks
        SET missed_at = ?, missed_by_member_id = ?, missed_by_name = ?
      WHERE id = ? AND due_date = ? AND missed_at IS NULL AND skipped_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM husbandry_events e
           WHERE e.task_id = care_tasks.id
             AND e.due_date = care_tasks.due_date
             AND e.voided_at IS NULL
        )`,
  ).bind(occurredAt, input.actor.id, input.actor.name, input.taskId, input.dueDate).run();

  if (result.meta.changes) return { missed: true as const };

  const state = await dispositionState(db, input.taskId, input.dueDate);
  if (!state) throw new TaskDispositionError("Task not found", 404);
  if (state.completed) throw new TaskDispositionError("That task is already marked done", 409);
  if (state.skippedAt) {
    throw new TaskDispositionError("That task is skipped. Put it back before marking it missed.", 409);
  }
  if (state.missedAt) return { missed: true as const };
  throw new TaskDispositionError("That task changed while you were updating it. Try again.", 409);
}

export async function missAllOverdueTasks(
  db: D1Database,
  input: { beforeDate: string; actor: DispositionActor; occurredAt?: string },
) {
  const result = await db.prepare(
    `UPDATE care_tasks
        SET missed_at = ?, missed_by_member_id = ?, missed_by_name = ?
      WHERE date(due_date, '+' || COALESCE(
              (SELECT s.grace_days FROM care_schedules s WHERE s.id = care_tasks.schedule_id), 0
            ) || ' days') < ?
        AND missed_at IS NULL AND skipped_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM husbandry_events e
           WHERE e.task_id = care_tasks.id
             AND e.due_date = care_tasks.due_date
             AND e.voided_at IS NULL
        )`,
  ).bind(
    input.occurredAt ?? new Date().toISOString(),
    input.actor.id,
    input.actor.name,
    input.beforeDate,
  ).run();
  return result.meta.changes ?? 0;
}

/**
 * Close the books on superseded occurrences.
 *
 * A keeper can make up an overdue task only until its plan comes due again:
 * once the next occurrence is due, doing the care now counts toward that new
 * occurrence, and the earlier one was simply missed. So any still-open
 * occurrence that a later occurrence of the same task for that animal (same
 * plan, or another plan with the same type and title — see lib/superseded.ts)
 * has already overtaken — its due date reached (<= today) — is recorded missed. No keeper
 * is attributed: this is the system closing an expired make-up window, not a
 * person's judgement, so missed_by is left null.
 *
 * Completed, skipped and already-missed occurrences are untouched, and an
 * ad-hoc task (no schedule) is never superseded because it has no next time.
 * Idempotent: a second pass finds nothing new, since the rows it would act on
 * are now missed.
 */
export async function autoMissSupersededTasks(
  db: D1Database,
  today: string,
  occurredAt?: string,
): Promise<number> {
  // Only missed_at is set: the WHERE requires missed_at IS NULL, and missed_by_*
  // are only ever written alongside missed_at, so they are already null here —
  // no keeper is attributed to an automatic miss.
  const result = await db.prepare(
    `UPDATE care_tasks
        SET missed_at = ?
      WHERE missed_at IS NULL AND skipped_at IS NULL AND schedule_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM husbandry_events e
           WHERE e.task_id = care_tasks.id
             AND e.due_date = care_tasks.due_date
             AND e.voided_at IS NULL
        )
        AND ${supersededSql("care_tasks")}`,
  ).bind(occurredAt ?? new Date().toISOString(), today).run();
  return result.meta.changes ?? 0;
}
