import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { CompletionTimingError, resolveOccurredAt } from "@/lib/completion-timing";
import { attributedTo, requireCapability } from "@/lib/household-auth";
import { getDefaultRewardCents, memberBalance, rewardForCompletion } from "@/lib/rewards";
import { loadFeederForecast } from "@/lib/feeder-forecast-data";
import { feederGuidance } from "@/lib/feeder-guidance";
import { feederConsumptionStatements } from "@/lib/feeder-consumption";
import {
  CompletionCorrectionError,
  correctCompletionAttribution,
  undoCompletion,
} from "@/lib/completion-corrections";

type CompletionPayload = {
  taskId?: string;
  dueDate?: string;
  actorRole?: string;
  /** "done", or "refused" when a feeding was offered and the animal did not eat. */
  outcome?: string;
  /**
   * Which day the care actually happened, for a task logged after its due date.
   * Accepts only the task's own due date or today; absent means today.
   */
  occurredOn?: string;
};

type CompletionOutcome = "done" | "refused";

type CompletionRecord = {
  id: string;
  outcome: string | null;
  completedByMemberId: string | null;
  completedBy: string | null;
  occurredAt: string;
  rewardCents: number;
  feederId: string | null;
  feederSpecies: string | null;
  feederSizeClass: string | null;
  feederWeightGrams: number | null;
};

type CorrectionPayload = {
  taskId?: string;
  dueDate?: string;
  reason?: string;
};

type AttributionPayload = CorrectionPayload & {
  targetMemberId?: string;
};

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const payload = await request.json() as CompletionPayload;
    if (!payload.taskId || !payload.dueDate) {
      return Response.json({ error: "Task and due date are required" }, { status: 400, headers: noStore });
    }
    if (payload.outcome !== undefined && payload.outcome !== "done" && payload.outcome !== "refused") {
      return Response.json({ error: "Outcome must be done or refused" }, { status: 400, headers: noStore });
    }
    const outcome: CompletionOutcome = payload.outcome ?? "done";

    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "care.complete");
    if (auth.response) return auth.response;
    const member = auth.member;

    const task = await db.prepare(
      "SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, t.task_type AS taskType, t.title, t.details, s.reward_cents AS scheduleReward, s.prey_species AS preySpecies, COALESCE(s.buy_as_needed, 0) AS buyAsNeeded, COALESCE(a.earning_enabled, 1) AS animalEarningEnabled FROM care_tasks t LEFT JOIN care_schedules s ON s.id = t.schedule_id LEFT JOIN animals a ON a.id = t.animal_id WHERE t.id=? AND t.due_date=?",
    ).bind(payload.taskId, payload.dueDate).first<{ id: string; scheduleId: string | null; animalId: string; taskType: string; title: string; details: string; scheduleReward: number | null; preySpecies: string | null; buyAsNeeded: number; animalEarningEnabled: number }>();
    if (!task) return Response.json({ error: "Task not found" }, { status: 404, headers: noStore });

    const existing = await db.prepare(
      "SELECT id, voided_at AS voidedAt FROM husbandry_events WHERE task_id = ? AND due_date = ?",
    ).bind(task.id, payload.dueDate).first<{ id: string; voidedAt: string | null }>();
    if (existing && !existing.voidedAt) {
      const completion = await completionForTask(db, task.id, payload.dueDate);
      return completionResponse(completion, outcome);
    }

    const eventId = existing?.id ?? crypto.randomUUID();
    const retainedAssignment = existing ? await db.prepare(
      "SELECT fa.feeder_id AS feederId, f.prey_species AS preySpecies, f.size_class AS sizeClass, f.weight_grams AS weightGrams FROM feeding_assignments fa JOIN feeder_inventory f ON f.id = fa.feeder_id WHERE fa.husbandry_event_id = ? AND fa.status = 'consumed' LIMIT 1",
    ).bind(existing.id).first<{ feederId: string; preySpecies: string; sizeClass: string; weightGrams: number }>() : null;
    let allocatedFeeder = retainedAssignment ? {
      id: retainedAssignment.feederId,
      preySpecies: retainedAssignment.preySpecies,
      sizeClass: retainedAssignment.sizeClass,
      weightGrams: retainedAssignment.weightGrams,
    } : null;
    // Feeder inventory is best-effort bookkeeping, never a gate. The animal was
    // actually fed, so the husbandry record has to be recordable even when the
    // freezer does not match the plan — store-bought prey, an untracked feeder,
    // or a shortage. Deduct stock when something matches; otherwise record the
    // care and report that nothing was deducted so the keeper can reconcile.
    let feederShortage: string | null = null;
    if (task.preySpecies && !task.buyAsNeeded && task.scheduleId && !allocatedFeeder) {
      const forecast = await loadFeederForecast(db, payload.dueDate, 1);
      const feeding = forecast.events.find((event) => event.scheduleId === task.scheduleId && event.feedingDate === payload.dueDate);
      if (feeding?.allocatedFeeder) {
        allocatedFeeder = feeding.allocatedFeeder;
      } else {
        feederShortage = feeding ? feederGuidance(feeding) : "no matching feeder in stock";
      }
    }

    // Earnings: capture the reward as a snapshot on the completion event, so later
    // changes to the plan/default never rewrite past earnings. Earns only when the
    // keeper earns AND the animal is set to pay allowance (a child's own pet can be
    // switched off). Non-earning or anonymous completions earn 0.
    const animalEarns = task.animalEarningEnabled !== 0;
    const earningEnabled = Boolean(member?.earningEnabled) && animalEarns;
    const rewardCents = earningEnabled
      ? rewardForCompletion(true, task.scheduleReward, await getDefaultRewardCents(db))
      : 0;

    // What the keeper did is the completion; what the animal did is the outcome.
    // A refused meal is care performed — thawed, offered, feeder lost — so it
    // completes the task and consumes inventory exactly as a taken meal does.
    // Only the outcome differs, and for a snake that is the line in the record
    // that matters months later.
    if (outcome === "refused" && task.taskType !== "feeding") {
      return Response.json({ error: "Only a feeding can be refused." }, { status: 400, headers: noStore });
    }

    // Reward attribution is unaffected by this choice: contributions bucket on
    // COALESCE(due_date, occurred_at), and due_date is not what changes here.
    let occurredAt: string;
    let recordedAt: string;
    try {
      ({ occurredAt, recordedAt } = resolveOccurredAt({
        dueDate: payload.dueDate,
        occurredOn: payload.occurredOn,
      }));
    } catch (error) {
      if (error instanceof CompletionTimingError) {
        return Response.json({ error: error.message }, { status: 400, headers: noStore });
      }
      throw error;
    }
    const actorRole = member?.role ?? (payload.actorRole === "Owner" ? "Owner" : "Zookeeper");
    const statements: D1PreparedStatement[] = [];
    if (existing?.voidedAt) {
      statements.push(db.prepare(
        "UPDATE husbandry_events SET animal_id = ?, task_type = ?, title = ?, notes = ?, occurred_at = ?, recorded_at = ?, actor_role = ?, completed_by_member_id = ?, completed_by_name = ?, reward_cents = ?, outcome = ?, voided_at = NULL, voided_by_member_id = NULL, voided_by_name = NULL, void_reason = NULL WHERE id = ? AND voided_at = ?",
      ).bind(task.animalId, task.taskType, task.title, task.details, occurredAt, recordedAt, actorRole, member?.id ?? null, member?.displayName ?? null, rewardCents, outcome, existing.id, existing.voidedAt));
    } else if (!existing) {
      statements.push(db.prepare(
        "INSERT INTO husbandry_events (id, task_id, animal_id, task_type, title, notes, due_date, occurred_at, recorded_at, actor_role, completed_by_member_id, completed_by_name, reward_cents, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(eventId, task.id, task.animalId, task.taskType, task.title, task.details, payload.dueDate, occurredAt, recordedAt, actorRole, member?.id ?? null, member?.displayName ?? null, rewardCents, outcome));
    }

    // Completing a task clears any "missed" or "skipped" mark — it turned out to
    // be done after all, and it cannot be two of those at once.
    statements.push(db.prepare("UPDATE care_tasks SET missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL, skipped_at = NULL, skipped_by_member_id = NULL, skipped_by_name = NULL, skip_reason = NULL WHERE id = ? AND due_date = ?")
      .bind(task.id, payload.dueDate));
    if (allocatedFeeder && !retainedAssignment) {
      statements.push(
        ...feederConsumptionStatements(db, {
          animalId: task.animalId,
          feederId: allocatedFeeder.id,
          plannedFor: payload.dueDate,
          occurredAt,
          husbandryEventId: eventId,
        }),
      );
    }
    try {
      await db.batch(statements);
    } catch (writeError) {
      // Two family members can tap the same card at the same time. The unique
      // task/date index correctly lets only one event win; make the losing
      // request idempotent by returning that winner instead of a scary 500. If
      // the two requests disagree about the outcome, report the conflict so a
      // requested refusal is never silently presented as saved.
      const winner = await completionForTask(db, task.id, payload.dueDate);
      if (winner) {
        const racedFeeder = allocatedFeeder && !winner.feederId
          ? "no feeder deducted — another update used the matching inventory"
          : null;
        return completionResponse(winner, outcome, null, racedFeeder);
      }
      throw writeError;
    }

    const completion = await completionForTask(db, task.id, payload.dueDate);
    if (allocatedFeeder && !retainedAssignment && completion && !completion.feederId) {
      feederShortage = "no feeder deducted — another update used the matching inventory";
    }
    const balanceCents = member?.id && earningEnabled ? (await memberBalance(db, member.id)).balanceCents : null;
    const response = completionResponse(completion, outcome, balanceCents, feederShortage);
    return response;
  } catch (error) {
    return internalErrorResponse(error, { context: "Task completion write failed", message: "Unable to record task", headers: noStore });
  }
}

async function completionForTask(db: D1Database, taskId: string, dueDate: string) {
  return db.prepare(
    "SELECT e.id, e.outcome AS outcome, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.occurred_at AS occurredAt, e.reward_cents AS rewardCents, f.id AS feederId, f.prey_species AS feederSpecies, f.size_class AS feederSizeClass, f.weight_grams AS feederWeightGrams FROM husbandry_events e LEFT JOIN feeding_assignments fa ON fa.husbandry_event_id = e.id AND fa.status = 'consumed' LEFT JOIN feeder_inventory f ON f.id = fa.feeder_id WHERE e.task_id = ? AND e.due_date = ? AND e.voided_at IS NULL",
  ).bind(taskId, dueDate).first<CompletionRecord>();
}

function completionResponse(
  completion: CompletionRecord | null,
  requestedOutcome: CompletionOutcome,
  balanceCents: number | null = null,
  feederShortage: string | null = null,
) {
  if (!completion) {
    return Response.json({ error: "The completion could not be confirmed. Try again." }, { status: 409, headers: noStore });
  }
  const storedOutcome: CompletionOutcome = completion.outcome === "refused" ? "refused" : "done";
  if (storedOutcome !== requestedOutcome) {
    return Response.json(
      { error: `That task was already recorded as ${storedOutcome}. Refresh before changing its outcome.`, outcome: storedOutcome },
      { status: 409, headers: noStore },
    );
  }
  const allocatedFeeder = completion.feederId ? {
    id: completion.feederId,
    preySpecies: completion.feederSpecies,
    sizeClass: completion.feederSizeClass,
    weightGrams: completion.feederWeightGrams,
  } : null;
  return Response.json({
    saved: true,
    completion,
    outcome: storedOutcome,
    rewardCents: completion.rewardCents,
    balanceCents,
    allocatedFeeder,
    feederShortage,
  }, { headers: noStore });
}

/**
 * Correct who performed care without undoing the care itself.
 *
 * The completion, reward snapshot, consumed feeder and feeding assignment all
 * remain active. Only the member receiving credit changes, and the old row is
 * captured in the revision audit trail.
 */
export async function PATCH(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "care.correct");
    if (auth.response) return auth.response;
    const actor = attributedTo(auth.member);
    const payload = await request.json() as AttributionPayload;
    if (!payload.taskId || !payload.dueDate || !payload.targetMemberId) {
      return Response.json(
        { error: "Task, due date, and household member are required" },
        { status: 400, headers: noStore },
      );
    }

    const correction = await correctCompletionAttribution(db, {
      taskId: payload.taskId,
      dueDate: payload.dueDate,
      targetMemberId: payload.targetMemberId,
      actor,
      reason: payload.reason,
    });
    return Response.json({ saved: true, correction }, { headers: noStore });
  } catch (error) {
    return correctionFailure(error, "Unable to change completion credit");
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "care.correct");
    if (auth.response) return auth.response;
    const actor = attributedTo(auth.member);

    const payload = await request.json() as CorrectionPayload;
    if (!payload.taskId || !payload.dueDate) {
      return Response.json({ error: "Task and due date are required" }, { status: 400, headers: noStore });
    }
    const reason = payload.reason?.trim().slice(0, 500) || "Marked incomplete by the Head Keeper.";
    const correction = await undoCompletion(db, {
      taskId: payload.taskId,
      dueDate: payload.dueDate,
      actor,
      reason,
    });
    return Response.json({ saved: true, correction }, { headers: noStore });
  } catch (error) {
    return correctionFailure(error, "Unable to mark the task incomplete");
  }
}

function correctionFailure(error: unknown, fallback: string) {
  if (error instanceof CompletionCorrectionError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  return internalErrorResponse(error, { context: "Task completion correction failed", message: fallback, headers: noStore });
}
