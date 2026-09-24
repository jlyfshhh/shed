import { ensureDatabase } from "@/db/runtime";
import { internalErrorResponse } from "@/lib/api-errors";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";
import { scheduleIsDue, type CareScheduleRow } from "@/lib/schedules";
import { careTaskId, scheduleAnimalIds } from "@/lib/care-group";
import { skipCareTask } from "@/lib/brumation";
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
  outcome: string | null;
  completedBy: string | null;
  missedAt: string | null;
  skippedAt: string | null;
  skipReason: string | null;
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
              t.task_type AS taskType, t.title, t.due_date AS dueDate, t.missed_at AS missedAt, t.skipped_at AS skippedAt, t.skip_reason AS skipReason,
              CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete, e.outcome AS outcome,
              COALESCE(e.completed_by_name, e.actor_role) AS completedBy
         FROM care_tasks t
         JOIN animals a ON a.id = t.animal_id
         LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date AND e.voided_at IS NULL
        WHERE a.active = 1 AND a.brumating = 0 AND t.due_date >= ? AND t.due_date <= ?
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
      // Project future days with the exact rules materializeTasks uses for real
      // rows: the N-week anchor (week_interval), the full covered-animal set
      // (animal_ids_json), and the per-animal brumation skip. Selecting a
      // reduced schedule shape here is what made an every-other-week plan appear
      // weekly and a grouped plan show only its first animal.
      const schedules = await db.prepare(
        `SELECT s.id, s.animal_id AS animalId, s.animal_ids_json AS animalIdsJson, s.task_type AS taskType,
                s.title, s.details, s.frequency, s.interval_days AS intervalDays, s.weekdays_json AS weekdaysJson,
                s.day_of_month AS dayOfMonth, s.week_interval AS weekInterval, s.start_date AS startDate, s.end_date AS endDate
           FROM care_schedules s
          WHERE s.active = 1`,
      ).all<CareScheduleRow & { animalIdsJson: string | null }>();

      // Per-animal name and pause status, so grouped plans expand to one row per
      // covered animal and archived or brumating members drop out — matching the
      // materialized recorded rows the past/today half of the week already reads.
      const animalRows = await db.prepare(
        "SELECT id, name, brumating, care_resume_on AS careResumeOn FROM animals WHERE active = 1",
      ).all<{ id: string; name: string; brumating: number; careResumeOn: string | null }>();
      const animals = new Map(animalRows.results.map((row) => [row.id, row]));

      for (const date of futureDates) {
        const tasks: WeekTask[] = [];
        for (const schedule of schedules.results) {
          if (!scheduleIsDue(schedule, date)) continue;
          for (const animalId of scheduleAnimalIds(schedule)) {
            const animal = animals.get(animalId);
            if (!animal || skipCareTask(animal, date)) continue;
            tasks.push({
              id: careTaskId(schedule.id, animalId, schedule.animalId, date),
              animalName: animal.name,
              taskType: schedule.taskType,
              title: schedule.title,
              complete: 0,
              outcome: null,
              completedBy: null,
              missedAt: null,
              skippedAt: null,
              skipReason: null,
            });
          }
        }
        tasks.sort((a, b) => a.animalName.localeCompare(b.animalName) || a.title.localeCompare(b.title));
        byDate.set(date, tasks);
      }
    }

    const days = dates.map((date) => {
      // dueDate is only needed to bucket the rows; the day already carries it.
      const tasks: WeekTask[] = (byDate.get(date) ?? []).map((row) => ({
        id: row.id, animalName: row.animalName, taskType: row.taskType, title: row.title,
        complete: row.complete, outcome: row.outcome, completedBy: row.completedBy, missedAt: row.missedAt,
        skippedAt: row.skippedAt, skipReason: row.skipReason,
      }));
      const done = tasks.filter((task) => task.complete).length;
      const refused = tasks.filter((task) => task.complete && task.outcome === "refused").length;
      // Skip wins over a legacy miss if an older database contains both. New
      // writes enforce exclusivity, but aggregates should remain sane while a
      // restored pre-fix backup is being read.
      const missed = tasks.filter((task) => !task.complete && task.missedAt && !task.skippedAt).length;
      // Skipped is neither done nor outstanding — it is care that was judged
      // unnecessary, so it must not read as a shortfall in the day's tally.
      const skipped = tasks.filter((task) => !task.complete && task.skippedAt).length;
      return {
        date,
        weekday: WEEKDAY_LABELS[weekdayIndex(date)],
        dayOfMonth: Number(date.slice(8, 10)),
        isToday: date === today,
        isPast: date < today,
        isFuture: date > today,
        tasks,
        counts: { total: tasks.length, done, refused, missed, skipped, pending: Math.max(0, tasks.length - done - missed - skipped) },
      };
    });

    const totals = days.reduce(
      (sum, day) => ({
        total: sum.total + day.counts.total,
        done: sum.done + day.counts.done,
        refused: sum.refused + day.counts.refused,
        missed: sum.missed + day.counts.missed,
        skipped: sum.skipped + day.counts.skipped,
        pending: sum.pending + day.counts.pending,
      }),
      { total: 0, done: 0, refused: 0, missed: 0, skipped: 0, pending: 0 },
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
    return internalErrorResponse(error, { context: "Week view query failed", message: "Unable to load the week" });
  }
}
