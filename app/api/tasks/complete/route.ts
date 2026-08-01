import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest, requireHouseholdMember } from "@/lib/household-auth";
import { getDefaultRewardCents, memberBalance, rewardForCompletion } from "@/lib/rewards";
import { loadFeederForecast } from "@/lib/feeder-forecast-data";
import { feederGuidance } from "@/lib/feeder-guidance";

type CompletionPayload = {
  taskId?: string;
  dueDate?: string;
  actorRole?: string;
};

type CorrectionPayload = {
  taskId?: string;
  dueDate?: string;
  reason?: string;
};

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const payload = await request.json() as CompletionPayload;
    if (!payload.taskId || !payload.dueDate) {
      return Response.json({ error: "Task and due date are required" }, { status: 400, headers: noStore });
    }

    const db = await ensureDatabase();
    const member = await memberFromRequest(request, db);
    if (householdAuthRequired() && !member) {
      return Response.json({ error: "Sign in to Shed first" }, { status: 401, headers: noStore });
    }

    const task = await db.prepare(
      "SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, t.task_type AS taskType, t.title, t.details, s.reward_cents AS scheduleReward, s.prey_species AS preySpecies, COALESCE(s.buy_as_needed, 0) AS buyAsNeeded, COALESCE(a.earning_enabled, 1) AS animalEarningEnabled FROM care_tasks t LEFT JOIN care_schedules s ON s.id = t.schedule_id LEFT JOIN animals a ON a.id = t.animal_id WHERE t.id=? AND t.due_date=?",
    ).bind(payload.taskId, payload.dueDate).first<{ id: string; scheduleId: string | null; animalId: string; taskType: string; title: string; details: string; scheduleReward: number | null; preySpecies: string | null; buyAsNeeded: number; animalEarningEnabled: number }>();
    if (!task) return Response.json({ error: "Task not found" }, { status: 404, headers: noStore });

    const existing = await db.prepare(
      "SELECT id, voided_at AS voidedAt FROM husbandry_events WHERE task_id = ? AND due_date = ?",
    ).bind(task.id, payload.dueDate).first<{ id: string; voidedAt: string | null }>();
    if (existing && !existing.voidedAt) {
      const completion = await completionForTask(db, task.id, payload.dueDate);
      return Response.json({ saved: true, completion, rewardCents: completion?.rewardCents ?? 0, balanceCents: null }, { headers: noStore });
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
    if (task.preySpecies && !task.buyAsNeeded && task.scheduleId && !allocatedFeeder) {
      const forecast = await loadFeederForecast(db, payload.dueDate, 1);
      const feeding = forecast.events.find((event) => event.scheduleId === task.scheduleId && event.feedingDate === payload.dueDate);
      if (!feeding || !feeding.allocatedFeeder) {
        return Response.json({
          error: feeding
            ? `${feederGuidance(feeding)}. Add or correct feeder inventory before completing this feeding.`
            : "Shed could not match this feeding plan to feeder inventory.",
          code: "feeder-required",
        }, { status: 409, headers: noStore });
      }
      allocatedFeeder = feeding.allocatedFeeder;
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

    const occurredAt = new Date().toISOString();
    const actorRole = member?.role ?? (payload.actorRole === "Owner" ? "Owner" : "Zookeeper");
    const statements: D1PreparedStatement[] = [];
    if (existing?.voidedAt) {
      statements.push(db.prepare(
        "UPDATE husbandry_events SET animal_id = ?, task_type = ?, title = ?, notes = ?, occurred_at = ?, actor_role = ?, completed_by_member_id = ?, completed_by_name = ?, reward_cents = ?, voided_at = NULL, voided_by_member_id = NULL, voided_by_name = NULL, void_reason = NULL WHERE id = ?",
      ).bind(task.animalId, task.taskType, task.title, task.details, occurredAt, actorRole, member?.id ?? null, member?.displayName ?? null, rewardCents, existing.id));
    } else if (!existing) {
      statements.push(db.prepare(
        "INSERT INTO husbandry_events (id, task_id, animal_id, task_type, title, notes, due_date, occurred_at, actor_role, completed_by_member_id, completed_by_name, reward_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(eventId, task.id, task.animalId, task.taskType, task.title, task.details, payload.dueDate, occurredAt, actorRole, member?.id ?? null, member?.displayName ?? null, rewardCents));
    }

    // Completing a task clears any "missed" mark — it turned out to be done.
    statements.push(db.prepare("UPDATE care_tasks SET missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL WHERE id = ? AND due_date = ?")
      .bind(task.id, payload.dueDate));
    if (allocatedFeeder && !retainedAssignment) {
      statements.push(
        db.prepare("INSERT INTO feeding_assignments (id, animal_id, feeder_id, planned_for, status, created_at, consumed_at, husbandry_event_id) VALUES (?, ?, ?, ?, 'consumed', ?, ?, ?)")
          .bind(crypto.randomUUID(), task.animalId, allocatedFeeder.id, payload.dueDate, occurredAt, occurredAt, eventId),
        db.prepare("UPDATE feeder_inventory SET status = 'consumed', consumed_at = ?, animal_id = ?, husbandry_event_id = ? WHERE id = ? AND status = 'available'")
          .bind(occurredAt, task.animalId, eventId, allocatedFeeder.id),
      );
    }
    await db.batch(statements);

    const completion = await completionForTask(db, task.id, payload.dueDate);
    const balanceCents = member?.id && earningEnabled ? (await memberBalance(db, member.id)).balanceCents : null;
    return Response.json({ saved: true, completion, rewardCents, balanceCents, allocatedFeeder }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record task" }, { status: 500, headers: noStore });
  }
}

async function completionForTask(db: D1Database, taskId: string, dueDate: string) {
  return db.prepare(
    "SELECT e.id, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.occurred_at AS occurredAt, e.reward_cents AS rewardCents, f.id AS feederId, f.prey_species AS feederSpecies, f.size_class AS feederSizeClass, f.weight_grams AS feederWeightGrams FROM husbandry_events e LEFT JOIN feeding_assignments fa ON fa.husbandry_event_id = e.id AND fa.status = 'consumed' LEFT JOIN feeder_inventory f ON f.id = fa.feeder_id WHERE e.task_id = ? AND e.due_date = ? AND e.voided_at IS NULL",
  ).bind(taskId, dueDate).first<{ rewardCents: number }>();
}

export async function DELETE(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;

    const payload = await request.json() as CorrectionPayload;
    if (!payload.taskId || !payload.dueDate) {
      return Response.json({ error: "Task and due date are required" }, { status: 400, headers: noStore });
    }
    const reason = payload.reason?.trim().slice(0, 500) || "Marked incomplete by the Head Keeper.";
    const event = await db.prepare(
      "SELECT id FROM husbandry_events WHERE task_id = ? AND due_date = ? AND voided_at IS NULL",
    ).bind(payload.taskId, payload.dueDate).first<{ id: string }>();
    if (!event) {
      return Response.json({ error: "No active completion was found for this task" }, { status: 404, headers: noStore });
    }

    const voidedAt = new Date().toISOString();
    await db.prepare(
      "UPDATE husbandry_events SET voided_at = ?, voided_by_member_id = ?, voided_by_name = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL",
    ).bind(voidedAt, auth.member!.id, auth.member!.displayName, reason, event.id).run();

    return Response.json({ saved: true, correction: { eventId: event.id, taskId: payload.taskId, dueDate: payload.dueDate, voidedAt, voidedBy: auth.member!.displayName, reason } }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to mark the task incomplete" }, { status: 500, headers: noStore });
  }
}
