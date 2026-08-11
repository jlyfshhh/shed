import { ensureDatabase } from "@/db/runtime";
import { overdueStartDate } from "@/lib/care-schedule";
import { getCareStartDate } from "@/lib/care-settings";
import { dateInTimeZone } from "@/lib/date";
import { binding, sharedSecretIsAuthorized } from "@/lib/env";
import { loadFeederForecast } from "@/lib/feeder-forecast-data";
import { feederGuidance } from "@/lib/feeder-guidance";

export const dynamic = "force-dynamic";

type DisplayTask = {
  animalId: string;
  scheduleId: string | null;
  animalName: string;
  species: string;
  taskType: string;
  title: string;
  details: string | null;
  dueDate: string;
};

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const token = binding("SHED_DISPLAY_TOKEN");
  if (!token) {
    return Response.json(
      { error: "The room display feed is not configured" },
      { status: 503, headers },
    );
  }
  if (!(await sharedSecretIsAuthorized(request, token, "X-Shed-Display-Token"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const careStartDate = await getCareStartDate(db);
    const overdueSince = overdueStartDate(today, careStartDate);
    const todayResult = await db.prepare(
      // Skipped work is excluded here as it is in the overdue query below: the
      // wall display exists to show what still needs doing, and a task the
      // keeper has already decided against is not that.
      "SELECT t.animal_id AS animalId, t.schedule_id AS scheduleId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate, CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS complete FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND t.due_date = ? AND t.skipped_at IS NULL ORDER BY complete, a.name, t.title",
    ).bind(today).all();
    const overdueResult = await db.prepare(
      "SELECT t.animal_id AS animalId, t.schedule_id AS scheduleId, a.name AS animalName, a.species, t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate FROM care_tasks t JOIN animals a ON a.id=t.animal_id LEFT JOIN husbandry_events e ON e.task_id=t.id AND e.due_date=t.due_date AND e.voided_at IS NULL WHERE a.active = 1 AND t.due_date < ? AND t.due_date >= ? AND e.id IS NULL AND t.missed_at IS NULL AND t.skipped_at IS NULL ORDER BY t.due_date DESC, a.name, t.title",
    ).bind(today, overdueSince).all();

    const todayRows = todayResult.results as Array<DisplayTask & { complete: number }>;
    const forecast = todayRows.some((task) => task.taskType === "feeding" && task.scheduleId)
      ? await loadFeederForecast(db, today, 1)
      : null;
    const guidanceByTask = new Map(
      (forecast?.events ?? []).map((event) => [`${event.scheduleId}:${event.feedingDate}`, feederGuidance(event)]),
    );
    const tasks = todayRows.filter((task) => !task.complete).map((task) => ({
      animalName: task.animalName,
      species: task.species,
      taskType: task.taskType,
      title: task.title,
      details: task.scheduleId
        ? guidanceByTask.get(`${task.scheduleId}:${task.dueDate}`) ?? task.details
        : task.details,
      dueDate: task.dueDate,
    }));
    // Projected to the same six fields as `tasks` above. The query selects
    // animalId/scheduleId for the join, but the display has never used them and
    // this feed should carry only what the wall dashboard renders.
    const overdue = (overdueResult.results as DisplayTask[]).map((task) => ({
      animalName: task.animalName,
      species: task.species,
      taskType: task.taskType,
      title: task.title,
      details: task.details,
      dueDate: task.dueDate,
    }));
    const completed = todayRows.length - tasks.length;

    return Response.json({
      date: today,
      generatedAt: new Date().toISOString(),
      summary: {
        total: todayRows.length,
        completed,
        remaining: tasks.length,
        overdue: overdue.length,
      },
      tasks,
      overdue,
    }, { headers });
  } catch (error) {
    console.error("Room display feed failed", error);
    return Response.json(
      { error: "Shed could not prepare the room display" },
      { status: 500, headers },
    );
  }
}
