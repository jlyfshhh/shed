export type ScheduledTask = {
  id: string;
  animalId: string;
  taskType: string;
  title: string;
  details: string;
  dueDate: string;
};

type Plan = Omit<ScheduledTask, "id" | "dueDate"> & {
  key: string;
  due: (date: string) => boolean;
};

const ballPythons = ["telemachus", "achilles", "ares", "calypso", "odysseus", "apollo"];
const waterBowls = [
  ...ballPythons,
  "dracarys", "mort", "turtle", "blue", "rhino", "taco",
];
const dailyMisters = ["pascal", "wasabi", "echo", "rue"];

const saturday = (date: string) => weekday(date) === 6;
const firstOfMonth = (date: string) => date.endsWith("-01");
const every = (anchor: string, days: number) => (date: string) =>
  daysBetween(anchor, date) >= 0 && daysBetween(anchor, date) % days === 0;

const plans: Plan[] = [
  ...ballPythons.map((animalId) => plan(`mist-${animalId}`, animalId, "misting", "Mist enclosure", "Saturday enclosure misting.", saturday)),
  ...waterBowls.map((animalId) => plan(`water-${animalId}`, animalId, "water bowl cleaning", "Clean water bowl", "Clean and refresh the water bowl.", saturday)),
  ...dailyMisters.map((animalId) => plan(`mist-${animalId}`, animalId, "misting", "Mist enclosure", "Daily misting provides drinking water; this enclosure has no water bowl.", () => true)),
  ...["mort", "turtle", "blue"].map((animalId) => plan(`mist-${animalId}`, animalId, "misting", "Mist enclosure", "Saturday enclosure misting.", saturday)),
  plan("feed-telemachus", "telemachus", "feeding", "Feed", "Every 14 days; choose prey from the recorded feeder plan.", every("2026-07-19", 14)),
  plan("feed-achilles", "achilles", "feeding", "Feed", "Every 14 days; growing snake target is near 10% when body condition supports it.", every("2026-07-19", 14)),
  plan("feed-calypso", "calypso", "feeding", "Feed", "Every 14 days; mature target is generally 5–6% with body-condition monitoring.", every("2026-07-19", 14)),
  plan("feed-apollo", "apollo", "feeding", "Feed", "Every 14 days; growing snake target is near 10% when body condition supports it.", every("2026-07-19", 14)),
  plan("feed-ares", "ares", "feeding", "Feed", "Monthly feeding on the first; mature target is generally 5–6%.", firstOfMonth),
  plan("feed-odysseus", "odysseus", "feeding", "Feed", "Monthly feeding on the first; mature target is generally 5–6%.", firstOfMonth),
  plan("feed-rhino", "rhino", "feeding", "Feed", "Offer one pinky mouse every 7 days.", every("2026-07-19", 7)),
  plan("feed-taco", "taco", "feeding", "Feed", "Routine Saturday meal; dust insects with Repashy Calcium Plus for the weekly dusting.", saturday),
  plan("mouse-taco", "taco", "feeding", "Feed mouse", "Offer one mouse on the first day of each month.", firstOfMonth),
  plan("salad-dracarys", "dracarys", "feeding", "Serve salad", "Varied greens and vegetables with topper.", () => true),
  plan("bugs-dracarys", "dracarys", "feeding", "Feed insects", "Every other day; rotate appropriate insects.", every("2026-07-19", 2)),
  ...["echo", "rue", "paludarium"].map((animalId) => plan(`cgd-${animalId}`, animalId, "feeding", "Replace CGD", "Replace with fresh CGD/gecko smoothie every other day.", every("2026-07-14", 2))),
  ...["community-tank", "reef", "tetra-frog-tank", "oscar", "nani", "taki"].map((animalId) => plan(`topoff-${animalId}`, animalId, "water top-off", "Replace evaporated water", "Top off evaporated water with distilled water.", saturday)),
];

const specialTasks: Record<string, Array<Omit<Plan, "due">>> = {
  "2026-07-19": [
    { key: "extra-feed-ares", animalId: "ares", taskType: "feeding", title: "Feed", details: "One-time feeding before moving to the first-of-month schedule." },
    { key: "extra-feed-odysseus", animalId: "odysseus", taskType: "feeding", title: "Feed", details: "One-time feeding before moving to the first-of-month schedule." },
    ...["wasabi", "rhino", "echo"].map((animalId) => ({ key: `uvb-${animalId}`, animalId, taskType: "equipment", title: "Install new UVB bulb", details: "Install the new UVB bulb and record completion." })),
  ],
};

export function scheduledTasksForDate(date: string): ScheduledTask[] {
  const normal = plans.filter((item) => item.due(date));
  return [...normal, ...(specialTasks[date] ?? [])].map(({ key, animalId, taskType, title, details }) => ({
    id: `${key}:${date}`,
    animalId,
    taskType,
    title,
    details,
    dueDate: date,
  }));
}

export function previousIsoDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function plan(key: string, animalId: string, taskType: string, title: string, details: string, due: Plan["due"]): Plan {
  return { key, animalId, taskType, title, details, due };
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000);
}
