/**
 * Owner-only corrections to an already recorded care completion.
 *
 * These are deliberately separate operations:
 * - correcting attribution keeps the completion (and every side effect of it)
 *   active, but moves the captured reward credit to the right household member;
 * - marking a task not done voids the completion and releases any feeder that
 *   the completion consumed.
 *
 * Each operation is a single D1 batch. D1 executes a batch transactionally, so
 * a completion can never be voided while its feeder remains consumed (or the
 * reverse) because one statement failed halfway through.
 */

export class CompletionCorrectionError extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "CompletionCorrectionError";
    this.status = status;
  }
}

export type CorrectionActor = {
  id: string | null;
  name: string;
};

type ActiveCompletion = {
  id: string;
  occurred_at: string;
  completed_by_member_id: string | null;
  completed_by_name: string | null;
  actor_role: string;
  edited_at: string | null;
  reward_cents: number;
  [column: string]: unknown;
};

type AttributionTarget = {
  id: string;
  displayName: string;
  role: string;
};

export type AttributionCorrectionInput = {
  taskId: string;
  dueDate: string;
  targetMemberId: string;
  actor: CorrectionActor;
  reason?: string;
  now?: string;
  revisionId?: string;
};

export type UndoCompletionInput = {
  taskId: string;
  dueDate: string;
  actor: CorrectionActor;
  reason: string;
  now?: string;
};

const activeCompletion = (db: D1Database, taskId: string, dueDate: string) =>
  db.prepare(
    "SELECT * FROM husbandry_events WHERE task_id = ? AND due_date = ? AND voided_at IS NULL",
  ).bind(taskId, dueDate).first<ActiveCompletion>();

/** Change who receives credit without changing what happened. */
export async function correctCompletionAttribution(
  db: D1Database,
  input: AttributionCorrectionInput,
) {
  // Revisions require a real correcting member. In an accounts-disabled
  // install there is nobody to change attribution to in the first place.
  if (!input.actor.id) {
    throw new CompletionCorrectionError("Sign in as the Head Keeper to change who completed care", 403);
  }

  const [event, target] = await Promise.all([
    activeCompletion(db, input.taskId, input.dueDate),
    db.prepare(
      "SELECT id, display_name AS displayName, role FROM household_members WHERE id = ? AND active = 1",
    ).bind(input.targetMemberId).first<AttributionTarget>(),
  ]);
  if (!event) {
    throw new CompletionCorrectionError("No active completion was found for this task", 404);
  }
  if (!target) {
    throw new CompletionCorrectionError("Choose an active household member", 404);
  }

  if (event.completed_by_member_id === target.id) {
    return {
      saved: true,
      changed: false,
      eventId: event.id,
      completedByMemberId: target.id,
      completedBy: target.displayName,
      rewardCents: Number(event.reward_cents ?? 0),
    };
  }

  const changedAt = input.now ?? new Date().toISOString();
  const previousJson = JSON.stringify({
    ...event,
    // The reason belongs to this audit record, not the active completion. It is
    // kept beside the exact previous row without changing the portable schema.
    attribution_correction_reason: cleanReason(input.reason, "Corrected completion attribution."),
  });
  const expectedMemberId = event.completed_by_member_id ?? "";
  const expectedEditedAt = event.edited_at ?? "";
  const batchResults = await db.batch([
    db.prepare(
      "INSERT INTO husbandry_event_revisions (id, event_id, changed_at, changed_by_member_id, changed_by_name, previous_json) SELECT ?, id, ?, ?, ?, ? FROM husbandry_events WHERE id = ? AND voided_at IS NULL AND occurred_at = ? AND COALESCE(completed_by_member_id, '') = ? AND COALESCE(edited_at, '') = ?",
    ).bind(
      input.revisionId ?? crypto.randomUUID(),
      changedAt,
      input.actor.id,
      input.actor.name,
      previousJson,
      event.id,
      event.occurred_at,
      expectedMemberId,
      expectedEditedAt,
    ),
    db.prepare(
      "UPDATE husbandry_events SET actor_role = ?, completed_by_member_id = ?, completed_by_name = ?, edited_at = ?, edited_by_member_id = ?, edited_by_name = ? WHERE id = ? AND voided_at IS NULL AND occurred_at = ? AND COALESCE(completed_by_member_id, '') = ? AND COALESCE(edited_at, '') = ?",
    ).bind(
      target.role,
      target.id,
      target.displayName,
      changedAt,
      input.actor.id,
      input.actor.name,
      event.id,
      event.occurred_at,
      expectedMemberId,
      expectedEditedAt,
    ),
  ]);

  if (Number(batchResults[1]?.meta?.changes ?? 0) !== 1) {
    const current = await activeCompletion(db, input.taskId, input.dueDate);
    if (current?.completed_by_member_id === target.id) {
      return {
        saved: true,
        changed: false,
        eventId: current.id,
        completedByMemberId: target.id,
        completedBy: target.displayName,
        rewardCents: Number(current.reward_cents ?? 0),
      };
    }
    throw new CompletionCorrectionError(
      "This completion changed while you were editing it. Refresh and try again.",
      409,
    );
  }

  return {
    saved: true,
    changed: true,
    eventId: event.id,
    completedByMemberId: target.id,
    completedBy: target.displayName,
    // The captured rate is historical. Moving attribution moves the credit to
    // the right member without recomputing it from today's settings.
    rewardCents: Number(event.reward_cents ?? 0),
  };
}

/** Void a completion and make every feeder it consumed available again. */
export async function undoCompletion(db: D1Database, input: UndoCompletionInput) {
  const event = await activeCompletion(db, input.taskId, input.dueDate);
  if (!event) {
    throw new CompletionCorrectionError("No active completion was found for this task", 404);
  }

  const voidedAt = input.now ?? new Date().toISOString();
  const reason = cleanReason(input.reason, "Marked incomplete by the Head Keeper.");

  const batchResults = await db.batch([
    db.prepare(
      "UPDATE husbandry_events SET voided_at = ?, voided_by_member_id = ?, voided_by_name = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL AND occurred_at = ?",
    ).bind(voidedAt, input.actor.id, input.actor.name, reason, event.id, event.occurred_at),
    db.prepare(
      "UPDATE feeder_inventory SET status = 'available', consumed_at = NULL, animal_id = NULL, husbandry_event_id = NULL WHERE status = 'consumed' AND (husbandry_event_id = ? OR id IN (SELECT feeder_id FROM feeding_assignments WHERE husbandry_event_id = ? AND status = 'consumed')) AND EXISTS (SELECT 1 FROM husbandry_events WHERE id = ? AND occurred_at = ? AND voided_at = ?)",
    ).bind(event.id, event.id, event.id, event.occurred_at, voidedAt),
    db.prepare(
      "UPDATE feeding_assignments SET status = 'released', consumed_at = NULL WHERE husbandry_event_id = ? AND status = 'consumed' AND EXISTS (SELECT 1 FROM husbandry_events WHERE id = ? AND occurred_at = ? AND voided_at = ?)",
    ).bind(event.id, event.id, event.occurred_at, voidedAt),
  ]);

  if (Number(batchResults[0]?.meta?.changes ?? 0) !== 1) {
    throw new CompletionCorrectionError(
      "This completion changed while you were editing it. Refresh and try again.",
      409,
    );
  }

  return {
    saved: true,
    eventId: event.id,
    taskId: input.taskId,
    dueDate: input.dueDate,
    voidedAt,
    voidedBy: input.actor.name,
    reason,
    restoredFeederCount: Number(batchResults[1]?.meta?.changes ?? 0),
  };
}

function cleanReason(value: string | undefined, fallback: string) {
  const reason = value?.trim();
  return reason ? reason.slice(0, 500) : fallback;
}
