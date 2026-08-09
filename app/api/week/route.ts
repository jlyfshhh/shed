import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";
import { scheduleIsDue, type CareScheduleRow } from "@/lib/schedules";
import { describeWeek, resolveWeekStart, shiftWeeks, weekDates, weekdayIndex, WEEKDAY_LABELS } from "@/lib/week";

export const dynamic = "force-dynamic";

// Projected to exactly what the week screen renders. The rows carry ids for the
// join and for building a stable key, but the view has never needed them, and a
// payload should not carry fields nobody reads.
type WeekTask = {
  id: string;
  animalName: string;
  taskType: string;
  title: string;
  complete: number;
  completedBy: string | null;
  missedAt: string | null;
};

export async function GET(request: Request) {
  try {
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const auth = await requireCapability(request, db, "care.read");
    if (auth.response) return auth.response;

    const requested = new URL(request.url).searchParams.get("start");
    const start = resolveWeekStart(requested, today);
    const dates = weekDates(start);
    const end = dates[6];

    // Days up to today are read from the tasks that were actually materialized
    // for them, so the week shows what was really on the list — not what
    // today's schedules say should have been. Editing a care plan does not
    // rewrite last week.
    const recorded = await db.prepare(
      `SELECT t.id, t.schedule_id AS scheduleId, t.animal_id AS animalId, a.name AS animalName,
              t.task_type AS taskType, t.title, t.due_date AS dueDate, t.missed_at AS missedAt,
              CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete,
              COALESCE(e.completed_by_name, e.actor_role) AS completedBy
         FROM care_tasks t
         JOIN animals a ON a.id = t.animal_id
         LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL
        WHERE a.active = 1 AND t.due_date >= ? AND t.due_date <= ?
        ORDER BY a.name, t.title`,
    ).bind(start, end).all<WeekTask & { dueDate: string }>();

    const byDate = new Map<string, WeekTask[]>();
    for (const row of recorded.results) {
      byDate.set(row.dueDate, [...(byDate.get(row.dueDate) ?? []), row]);
    }

    // Future days have no rows yet — ensureDatabase only materializes a
    // lookback window. Derive them instead of inserting: a task written ahead
    // of time would later be counted as overdue for a day nobody skipped.
    const futureDates = dates.filter((date) => date > today && !byDate.has(date));
    if (futureDates.length) {
      const schedules = await db.prepare(
        `SELECT s.id, s.animal_id AS animalId, s.task_type AS taskType, s.title, s.details,
                s.frequency, s.interval_days AS intervalDays, s.weekdays_json AS weekdaysJson,
                s.day_of_month AS dayOfMonth, s.start_date AS startDate, s.end_date AS endDate,
                a.name AS animalName
           FROM care_schedules s
           JOIN animals a ON a.id = s.animal_id
          WHERE s.active = 1 AND a.active = 1
          ORDER BY a.name, s.title`,
      ).all<CareScheduleRow & { animalName: string }>();

      for (const date of futureDates) {
        byDate.set(date, schedules.results.filter((schedule) => scheduleIsDue(schedule, date)).map((schedule) => ({
          id: `${schedule.id}:${date}`,
          animalName: schedule.animalName,
          taskType: schedule.taskType,
          title: schedule.title,
          complete: 0,
          completedBy: null,
          missedAt: null,
        })));
      }
    }

    const days = dates.map((date) => {
      // dueDate is only needed to bucket the rows; the day already carries it.
      const tasks: WeekTask[] = (byDate.get(date) ?? []).map((row) => ({
        id: row.id, animalName: row.animalName, taskType: row.taskType, title: row.title,
        complete: row.complete, completedBy: row.completedBy, missedAt: row.missedAt,
      }));
      const done = tasks.filter((task) => task.complete).length;
      const missed = tasks.filter((task) => !task.complete && task.missedAt).length;
      return {
        date,
        weekday: WEEKDAY_LABELS[weekdayIndex(date)],
        dayOfMonth: Number(date.slice(8, 10)),
        isToday: date === today,
        isPast: date < today,
        isFuture: date > today,
        tasks,
        counts: { total: tasks.length, done, missed, pending: tasks.length - done - missed },
      };
    });

    const totals = days.reduce(
      (sum, day) => ({
        total: sum.total + day.counts.total,
        done: sum.done + day.counts.done,
        missed: sum.missed + day.counts.missed,
        pending: sum.pending + day.counts.pending,
      }),
      { total: 0, done: 0, missed: 0, pending: 0 },
    );

    return Response.json({
      start,
      end,
      today,
      label: describeWeek(start, today),
      isCurrentWeek: start === resolveWeekStart(today, today),
      previousStart: shiftWeeks(start, -1),
      nextStart: shiftWeeks(start, 1),
      days,
      totals,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the week" }, { status: 500 });
  }
}
