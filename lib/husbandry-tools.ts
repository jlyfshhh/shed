import { isIsoDate } from "./date.ts";
import { previousIsoDate } from "./care-schedule.ts";
import type { VoiceAnimal, VoiceToolExecutor, VoiceToolResult } from "./voice-agent.ts";

type AnimalRow = VoiceAnimal & { groupName: string };

type PendingTask = {
  id: string;
  animalId: string;
  animalName: string;
  species: string;
  taskType: string;
  title: string;
  details: string;
  dueDate: string;
};

type AnimalResolution =
  | { ok: true; animal: AnimalRow }
  | { ok: false; error: string; candidates?: string[] };

export async function loadVoiceAnimalRoster(db: D1Database): Promise<AnimalRow[]> {
  const result = await db
    .prepare(
      "SELECT id, name, species, group_name AS groupName FROM animals ORDER BY species, name",
    )
    .all<AnimalRow>();
  return result.results;
}

export function createHusbandryToolExecutor(options: {
  db: D1Database;
  roster: AnimalRow[];
  today: string;
  now?: () => Date;
}): VoiceToolExecutor {
  const now = options.now ?? (() => new Date());

  return async (name, rawInput) => {
    if (name === "log_husbandry_task") {
      return logHusbandryTask(options.db, options.roster, rawInput, options.today, now());
    }
    if (name === "get_pending_tasks") {
      return getPendingTasks(options.db, options.roster, rawInput, options.today);
    }
    return { ok: false, error: "Shed does not recognize that action." };
  };
}

async function logHusbandryTask(
  db: D1Database,
  roster: AnimalRow[],
  input: Record<string, unknown>,
  today: string,
  now: Date,
): Promise<VoiceToolResult> {
  const animalName = cleanString(input.animal_name, 80);
  const taskType = cleanString(input.task_type, 80)?.toLowerCase();
  const notes = cleanString(input.notes, 500);
  const date = cleanString(input.date, 10) ?? today;
  if (!animalName || !taskType) {
    return { ok: false, error: "An animal name and task type are required." };
  }
  if (!isIsoDate(date)) {
    return { ok: false, error: "The date needs to be in YYYY-MM-DD format." };
  }

  const animalResolution = resolveOneAnimal(roster, animalName);
  if (!animalResolution.ok) return animalResolution;
  const animal = animalResolution.animal;
  const pending = await pendingRows(db, date, [animal.id]);
  const matchingTask = chooseMatchingTask(pending, taskType, notes);
  const taskId = matchingTask?.id ?? null;
  const occurredAt = date === today ? now.toISOString() : `${date}T12:00:00.000Z`;
  const title = titleCase(taskType);
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO husbandry_events (id, task_id, animal_id, task_type, title, notes, due_date, occurred_at, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      taskId,
      animal.id,
      taskType,
      title,
      notes ?? null,
      date,
      occurredAt,
      "Zookeeper",
    )
    .run();

  return {
    ok: true,
    saved: (result.meta.changes ?? 0) > 0,
    animal_name: animal.name,
    task_type: taskType,
    date,
    notes: notes ?? null,
    completed_scheduled_task: matchingTask?.title ?? null,
  };
}

async function getPendingTasks(
  db: D1Database,
  roster: AnimalRow[],
  input: Record<string, unknown>,
  today: string,
): Promise<VoiceToolResult> {
  const selector = cleanString(input.animal_name, 80);
  const date = cleanString(input.date, 10) ?? today;
  if (!isIsoDate(date)) {
    return { ok: false, error: "The date needs to be in YYYY-MM-DD format." };
  }

  const selected = selector ? resolveAnimalSelector(roster, selector) : roster;
  if (selected.length === 0) {
    return { ok: false, error: `No animal matches ${selector}.` };
  }
  const tasks = await pendingRows(db, date, selected.map((animal) => animal.id));
  return {
    ok: true,
    date,
    filter: selector ?? "all animals",
    count: tasks.length,
    tasks: tasks.map((task) => ({
      animal_name: task.animalName,
      task_type: task.taskType,
      title: task.title,
      details: task.details,
    })),
  };
}

async function pendingRows(
  db: D1Database,
  date: string,
  animalIds: string[],
): Promise<PendingTask[]> {
  if (animalIds.length === 0) return [];
  const placeholders = animalIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT t.id, t.animal_id AS animalId, a.name AS animalName, a.species,
        t.task_type AS taskType, t.title, t.details, t.due_date AS dueDate
       FROM care_tasks t
       JOIN animals a ON a.id = t.animal_id
       LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.due_date = t.due_date
       WHERE (t.due_date = ? OR (t.due_date = ? AND t.id NOT LIKE 'salad-dracarys:%' AND NOT (t.task_type = 'misting' AND t.animal_id IN ('pascal', 'wasabi', 'echo', 'rue'))))
         AND t.animal_id IN (${placeholders}) AND e.id IS NULL
       ORDER BY t.due_date, a.name, t.title`,
    )
    .bind(date, previousIsoDate(date), ...animalIds)
    .all<PendingTask>();
  return result.results;
}

function chooseMatchingTask(
  tasks: PendingTask[],
  taskType: string,
  notes: string | undefined,
): PendingTask | undefined {
  const type = normalize(taskType);
  const noteWords = normalize(notes ?? "").split(" ").filter((word) => word.length > 2);
  const scored = tasks.map((task) => {
    let score = normalize(task.taskType) === type ? 2 : 0;
    const searchable = normalize(`${task.title} ${task.details}`);
    score += noteWords.filter((word) => searchable.includes(word)).length;
    return { task, score };
  });
  const bestScore = Math.max(0, ...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore && entry.score > 0);
  return best.length === 1 ? best[0].task : undefined;
}

function resolveOneAnimal(
  roster: AnimalRow[],
  query: string,
): AnimalResolution {
  const normalized = normalize(query);
  const exact = roster.filter((animal) => normalize(animal.name) === normalized);
  if (exact.length === 1) return { ok: true, animal: exact[0] };

  const ranked = roster
    .map((animal) => ({ animal, distance: editDistance(normalized, normalize(animal.name)) }))
    .sort((a, b) => a.distance - b.distance);
  const threshold = Math.max(1, Math.floor(normalized.length * 0.25));
  if (
    ranked[0] &&
    ranked[0].distance <= threshold &&
    (!ranked[1] || ranked[1].distance > ranked[0].distance)
  ) {
    return { ok: true, animal: ranked[0].animal };
  }

  const possible = resolveAnimalSelector(roster, query);
  if (possible.length > 1) {
    return {
      ok: false,
      error: `${query} could mean ${possible.map((animal) => animal.name).join(", ")}.`,
      candidates: possible.map((animal) => animal.name),
    };
  }
  return { ok: false, error: `No animal matches ${query}.` };
}

function resolveAnimalSelector(roster: AnimalRow[], query: string): AnimalRow[] {
  const target = singular(normalize(query));
  const exactName = roster.filter((animal) => normalize(animal.name) === target);
  if (exactName.length) return exactName;

  const species = roster.filter((animal) => {
    const candidate = singular(normalize(animal.species));
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
  if (species.length) return species;

  const familyTerms: Record<string, string[]> = {
    gecko: ["gecko"],
    chameleon: ["chameleon"],
    python: ["python"],
    snake: ["python", "hognose"],
    frog: ["frog"],
  };
  const terms = familyTerms[target];
  if (terms) {
    return roster.filter((animal) =>
      terms.some((term) => normalize(animal.species).includes(term)),
    );
  }
  return [];
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singular(value: string): string {
  return value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function editDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let column = 1; column <= right.length; column += 1) {
    let previous = rows[0];
    rows[0] = column;
    for (let row = 1; row <= left.length; row += 1) {
      const current = rows[row];
      rows[row] = Math.min(
        rows[row] + 1,
        rows[row - 1] + 1,
        previous + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return rows[left.length];
}
