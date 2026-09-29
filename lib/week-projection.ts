// Deriving the future half of the week view from care_schedules, using the same
// rules as the materialized rows the past/today half reads. Extracted from the
// week route so the composition — N-week anchor, grouped expansion, per-animal
// brumation, active/end-date filtering — is testable without a live database.
import { scheduleIsDue, type CareScheduleRow } from "./schedules.ts";
import { careTaskId, scheduleAnimalIds } from "./care-group.ts";
import { skipCareTask } from "./brumation.ts";

export type ProjectionSchedule = CareScheduleRow & {
  animalIdsJson: string | null;
  taskType: string;
  title: string;
};

export type ProjectionAnimal = {
  id: string;
  name: string;
  brumating: boolean | number;
  careResumeOn?: string | null;
};

export type ProjectedTask = { id: string; animalName: string; taskType: string; title: string };

/**
 * The tasks one future day should show: every active schedule due that day,
 * expanded to each covered animal that is active and not brumating, ordered by
 * animal then title. `animalsById` should contain only active animals, so an
 * archived or missing member simply drops out.
 */
export function projectFutureDay(
  schedules: readonly ProjectionSchedule[],
  animalsById: ReadonlyMap<string, ProjectionAnimal>,
  date: string,
): ProjectedTask[] {
  const tasks: ProjectedTask[] = [];
  for (const schedule of schedules) {
    if (!scheduleIsDue(schedule, date)) continue;
    for (const animalId of scheduleAnimalIds(schedule)) {
      const animal = animalsById.get(animalId);
      if (!animal || skipCareTask(animal, date)) continue;
      tasks.push({
        id: careTaskId(schedule.id, animalId, schedule.animalId, date),
        animalName: animal.name,
        taskType: schedule.taskType,
        title: schedule.title,
      });
    }
  }
  tasks.sort((a, b) => a.animalName.localeCompare(b.animalName) || a.title.localeCompare(b.title));
  return tasks;
}
