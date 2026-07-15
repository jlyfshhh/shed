import { env } from "cloudflare:workers";

const today = "2026-07-14";

const animalRows = [
  ["telemachus", "Telemachus", "Ball Python", "Reptile", "Indoor habitat", 576, today],
  ["achilles", "Achilles", "Ball Python", "Reptile", "Indoor habitat", 425, today],
  ["ares", "Ares", "Ball Python", "Reptile", "Indoor habitat", 1257, today],
  ["calypso", "Calypso", "Ball Python", "Reptile", "Indoor habitat", 625, today],
  ["odysseus", "Odysseus", "Ball Python", "Reptile", "Indoor habitat", 935, today],
  ["apollo", "Apollo", "Ball Python", "Reptile", "Indoor habitat", 411, today],
  ["dracarys", "Dracarys", "Bearded Dragon", "Reptile", "Indoor habitat", null, null],
  ["pascal", "Pascal", "Veiled Chameleon", "Reptile", "Indoor habitat", null, null],
  ["wasabi", "Wasabi", "Panther Chameleon", "Reptile", "Indoor habitat", null, null],
  ["mort", "Mort", "Leopard Gecko", "Reptile", "Indoor habitat", null, null],
  ["turtle", "Turtle", "Leopard Gecko", "Reptile", "Indoor habitat", null, null],
  ["blue", "Blue", "Leopard Gecko", "Reptile", "Indoor habitat", null, null],
  ["rhino", "Rhino", "Western Hognose", "Reptile", "Indoor habitat", null, null],
  ["echo", "Echo", "Crested Gecko", "Reptile", "Indoor habitat", null, null],
  ["rue", "Rue", "Crested Gecko", "Reptile", "Indoor habitat", null, null],
  ["taco", "Taco", "Pacman Frog", "Amphibian", "Indoor habitat", null, null],
  ["paludarium", "Paludarium", "Tree frogs, mourning geckos, vampire crabs & fish", "Community", "Indoor habitat", null, null],
  ["taki", "Taki", "Red-eared Slider & guppies", "Aquatic", "Indoor habitat", null, null],
  ["reef", "Reef Tank", "Clownfish, goby, shrimp, snails & corals", "Aquatic", "Indoor habitat", null, null],
  ["community-tank", "Living Room Tank", "Platys, cory catfish & gourami", "Aquatic", "Indoor habitat", null, null],
  ["tetra-frog-tank", "Dining Room Tank", "Tetras & African dwarf frogs", "Aquatic", "Indoor habitat", null, null],
  ["oscar", "Mr. Oscar", "Betta", "Aquatic", "Indoor habitat", null, null],
  ["nani", "Nani", "Betta", "Aquatic", "Indoor habitat", null, null],
  ["pond", "Porch Pond", "Ricefish", "Aquatic", "Outdoor habitat", null, null],
] as const;

const taskRows = [
  ["dracarys-salad", "dracarys", "Serve salad", "Greens, vegetables, and topper", today],
  ["dracarys-bugs", "dracarys", "Feed insects", "Dubia roaches in today’s rotation", today],
  ["echo-cgd", "echo", "Replace gecko smoothie", "Fresh crested gecko diet", today],
  ["rue-cgd", "rue", "Replace gecko smoothie", "Fresh crested gecko diet", today],
  ["paludarium-cgd", "paludarium", "Replace gecko smoothie", "Fresh CGD for the mourning geckos", today],
] as const;

const initialEvents = [
  ["seed-salad", "dracarys-salad", "dracarys", "Served salad", today, `${today}T13:10:00-04:00`, "Zookeeper"],
  ["seed-bugs", "dracarys-bugs", "dracarys", "Fed dubia roaches", today, `${today}T13:12:00-04:00`, "Zookeeper"],
  ["seed-mist-pascal", null, "pascal", "Misted enclosure", null, `${today}T18:30:00-04:00`, "Zookeeper"],
  ["seed-mist-wasabi", null, "wasabi", "Misted enclosure", null, `${today}T18:31:00-04:00`, "Zookeeper"],
  ["seed-mist-rue", null, "rue", "Misted enclosure", null, `${today}T18:32:00-04:00`, "Zookeeper"],
  ["seed-mist-echo", null, "echo", "Misted enclosure", null, `${today}T18:33:00-04:00`, "Zookeeper"],
  ["seed-mist-paludarium", null, "paludarium", "Misted enclosure", null, `${today}T18:34:00-04:00`, "Zookeeper"],
] as const;

const weightRows = [
  ["tele-prev", "telemachus", "2026-05-30", 532], ["tele-now", "telemachus", today, 576],
  ["ach-prev", "achilles", "2026-05-30", 382], ["ach-now", "achilles", today, 425],
  ["ares-prev", "ares", "2026-05-30", 1289], ["ares-now", "ares", today, 1257],
  ["cal-prev", "calypso", "2026-05-16", 555], ["cal-now", "calypso", today, 625],
  ["ody-prev", "odysseus", "2026-05-30", 924], ["ody-now", "odysseus", today, 935],
  ["apollo-prev", "apollo", "2026-05-30", 355], ["apollo-now", "apollo", today, 411],
] as const;

export async function ensureDatabase() {
  const db = env.DB;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS animals (id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL, group_name TEXT NOT NULL, location TEXT NOT NULL, weight_grams INTEGER, weight_date TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS care_tasks (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL, due_date TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS husbandry_events (id TEXT PRIMARY KEY, task_id TEXT, animal_id TEXT NOT NULL, title TEXT NOT NULL, due_date TEXT, occurred_at TEXT NOT NULL, actor_role TEXT NOT NULL)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS event_task_due_unique ON husbandry_events(task_id, due_date)"),
    db.prepare("CREATE TABLE IF NOT EXISTS weight_events (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL, recorded_on TEXT NOT NULL, weight_grams INTEGER NOT NULL)"),
  ]);

  await db.batch([
    ...animalRows.map((row) => db.prepare("INSERT OR IGNORE INTO animals (id, name, species, group_name, location, weight_grams, weight_date) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...row)),
    ...taskRows.map((row) => db.prepare("INSERT OR IGNORE INTO care_tasks (id, animal_id, title, details, due_date) VALUES (?, ?, ?, ?, ?)").bind(...row)),
    ...initialEvents.map((row) => db.prepare("INSERT OR IGNORE INTO husbandry_events (id, task_id, animal_id, title, due_date, occurred_at, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...row)),
    ...weightRows.map((row) => db.prepare("INSERT OR IGNORE INTO weight_events (id, animal_id, recorded_on, weight_grams) VALUES (?, ?, ?, ?)").bind(...row)),
  ]);
  return db;
}
