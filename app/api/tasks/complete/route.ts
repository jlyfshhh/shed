import { ensureDatabase } from "@/db/runtime";
import { householdAuthRequired, memberFromRequest, requireHouseholdMember } from "@/lib/household-auth";
import { getDefaultRewardCents, memberBalance, rewardForCompletion } from "@/lib/rewards";

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
      "SELECT t.id, t.animal_id AS animalId, t.task_type AS taskType, t.title, t.details, s.reward_cents AS scheduleReward FROM care_tasks t LEFT JOIN care_schedules s ON s.id = t.schedule_id WHERE t.id=? AND t.due_date=?",
    ).bind(payload.taskId, payload.dueDate).first<{ id: string; animalId: string; taskType: string; title: string; details: string; scheduleReward: number | null }>();
    if (!task) return Response.json({ error: "Task not found" }, { status: 404, headers: noStore });

    // Earnings: capture the reward as a snapshot on the completion event, so later
    // changes to the plan/default never rewrite past earnings. Non-earning or
    // anonymous completions earn 0.
    const earningEnabled = Boolean(member?.earningEnabled);
    const rewardCents = earningEnabled
      ? rewardForCompletion(true, task.scheduleReward, await getDefaultRewardCents(db))
      : 0;

    const existing = await db.prepare(
      "SELECT id, voided_at AS voidedAt FROM husbandry_events WHERE task_id = ? AND due_date = ?",
    ).bind(task.id, payload.dueDate).first<{ id: string; voidedAt: string | null }>();
    const occurredAt = new Date().toISOString();
    const actorRole = member?.role ?? (payload.actorRole === "Owner" ? "Owner" : "Zookeeper");

    if (existing?.voidedAt) {
      await db.prepare(
        "UPDATE husbandry_events SET animal_id = ?, task_type = ?, title = ?, notes = ?, occurred_at = ?, actor_role = ?, completed_by_member_id = ?, completed_by_name = ?, reward_cents = ?, voided_at = NULL, voided_by_member_id = NULL, voided_by_name = NULL, void_reason = NULL WHERE id = ?",
      ).bind(task.animalId, task.taskType, task.title, task.details, occurredAt, actorRole, member?.id ?? null, member?.displayName ?? null, rewardCents, existing.id).run();
    } else if (!existing) {
      await db.prepare(
        "INSERT INTO husbandry_events (id, task_id, animal_id, task_type, title, notes, due_date, occurred_at, actor_role, completed_by_member_id, completed_by_name, reward_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), task.id, task.animalId, task.taskType, task.title, task.details, payload.dueDate, occurredAt, actorRole, member?.id ?? null, member?.displayName ?? null, rewardCents).run();
    }

    // Completing a task clears any "missed" mark — it turned out to be done.
    await db.prepare("UPDATE care_tasks SET missed_at = NULL, missed_by_member_id = NULL, missed_by_name = NULL WHERE id = ? AND due_date = ?")
      .bind(task.id, payload.dueDate).run();

    const completion = await db.prepare(
      "SELECT e.id, e.completed_by_member_id AS completedByMemberId, COALESCE(e.completed_by_name, e.actor_role) AS completedBy, e.occurred_at AS occurredAt, e.reward_cents AS rewardCents FROM husbandry_events e WHERE e.task_id = ? AND e.due_date = ? AND e.voided_at IS NULL",
    ).bind(task.id, payload.dueDate).first();
    const balanceCents = member?.id && earningEnabled ? (await memberBalance(db, member.id)).balanceCents : null;
    return Response.json({ saved: true, completion, rewardCents, balanceCents }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record task" }, { status: 500, headers: noStore });
  }
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
