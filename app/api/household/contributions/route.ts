import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { requireHouseholdMember } from "@/lib/household-auth";

type ContributionRow = {
  eventId: string;
  memberId: string;
  completedBy: string;
  animalId: string;
  animalName: string;
  taskType: string;
  title: string;
  dueDate: string | null;
  completedAt: string;
};

export async function GET(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const url = new URL(request.url);
    const today = dateInTimeZone();
    const from = validDate(url.searchParams.get("from")) ?? `${today.slice(0, 7)}-01`;
    const to = validDate(url.searchParams.get("to")) ?? today;
    if (from > to) return Response.json({ error: "The start date must not be after the end date" }, { status: 400 });

    const result = await db.prepare(
      `SELECT e.id AS eventId, e.completed_by_member_id AS memberId,
        e.completed_by_name AS completedBy, e.animal_id AS animalId,
        a.name AS animalName, e.task_type AS taskType, e.title, e.due_date AS dueDate,
        e.occurred_at AS completedAt
       FROM husbandry_events e
       JOIN animals a ON a.id = e.animal_id
       WHERE e.completed_by_member_id IS NOT NULL
         AND e.task_id IS NOT NULL
         AND COALESCE(e.due_date, substr(e.occurred_at, 1, 10)) BETWEEN ? AND ?
       ORDER BY e.occurred_at DESC`,
    ).bind(from, to).all<ContributionRow>();
    const contributions = result.results.reduce<Record<string, { memberId: string; displayName: string; taskCount: number }>>((groups, row) => {
      const group = groups[row.memberId] ?? { memberId: row.memberId, displayName: row.completedBy, taskCount: 0 };
      group.taskCount += 1;
      groups[row.memberId] = group;
      return groups;
    }, {});
    return Response.json({ from, to, contributions: Object.values(contributions), completions: result.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load household contributions" }, { status: 500 });
  }
}

function validDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
