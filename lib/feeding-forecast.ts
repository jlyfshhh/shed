import { scheduledTasksForDate } from "./care-schedule.ts";

export type ForecastAnimal = {
  id: string;
  name: string;
};

export type ForecastWeight = {
  animalId: string;
  recordedOn: string;
  weightGrams: number;
};

export type AvailableFeeder = {
  id: string;
  preySpecies: string;
  sizeClass: string;
  weightGrams: number;
};

type PercentageProfile = {
  animalId: string;
  taskKey: string;
  preySpecies: "rat";
  targetPercent: number;
  minimumPercent: number;
  maximumPercent: number;
};

type FixedProfile = {
  animalId: string;
  taskKey: string;
  preySpecies: "mouse";
  preyDescription: string;
};

type FeedingProfile = PercentageProfile | FixedProfile;

export type FeederForecastEvent = {
  animalId: string;
  animalName: string;
  feedingDate: string;
  preySpecies: string;
  preyDescription: string;
  latestWeightGrams: number | null;
  predictedWeightGrams: number | null;
  weightTrendGramsPerDay: number | null;
  weightTrendConfidence: "none" | "low" | "medium" | "high";
  targetPreyGrams: number | null;
  minimumPreyGrams: number | null;
  maximumPreyGrams: number | null;
  allocatedFeeder: AvailableFeeder | null;
  status: "covered" | "shortage" | "buy-as-needed" | "inventory-untracked" | "weight-missing";
};

export type FeederForecastAlert = {
  code: "feeder-shortage" | "buy-as-needed" | "inventory-untracked" | "missing-weight" | "missing-feeding-plan";
  severity: "warning" | "info";
  animalId?: string;
  animalName?: string;
  dueBy?: string;
  message: string;
};

const profiles: FeedingProfile[] = [
  { animalId: "telemachus", taskKey: "feed-telemachus", preySpecies: "rat", targetPercent: 0.055, minimumPercent: 0.045, maximumPercent: 0.06 },
  { animalId: "achilles", taskKey: "feed-achilles", preySpecies: "rat", targetPercent: 0.10, minimumPercent: 0.08, maximumPercent: 0.12 },
  { animalId: "ares", taskKey: "feed-ares", preySpecies: "rat", targetPercent: 0.05, minimumPercent: 0.04, maximumPercent: 0.06 },
  { animalId: "calypso", taskKey: "feed-calypso", preySpecies: "rat", targetPercent: 0.055, minimumPercent: 0.045, maximumPercent: 0.06 },
  { animalId: "odysseus", taskKey: "feed-odysseus", preySpecies: "rat", targetPercent: 0.05, minimumPercent: 0.04, maximumPercent: 0.06 },
  { animalId: "apollo", taskKey: "feed-apollo", preySpecies: "rat", targetPercent: 0.10, minimumPercent: 0.08, maximumPercent: 0.12 },
  { animalId: "rhino", taskKey: "feed-rhino", preySpecies: "mouse", preyDescription: "pinky mouse" },
  { animalId: "taco", taskKey: "mouse-taco", preySpecies: "mouse", preyDescription: "pinky mouse" },
];

const knownFeederAnimals = new Set([
  ...profiles.map((profile) => profile.animalId),
  "sriracha",
]);

export function buildFeederForecast(options: {
  today: string;
  horizonDays: number;
  animals: ForecastAnimal[];
  weights: ForecastWeight[];
  availableFeeders: AvailableFeeder[];
}) {
  const horizonDays = Math.min(Math.max(Math.trunc(options.horizonDays), 1), 180);
  const animalById = new Map(options.animals.map((animal) => [animal.id, animal]));
  const weightsByAnimal = new Map<string, ForecastWeight[]>();
  for (const weight of options.weights) {
    weightsByAnimal.set(weight.animalId, [
      ...(weightsByAnimal.get(weight.animalId) ?? []),
      weight,
    ]);
  }
  for (const rows of weightsByAnimal.values()) {
    rows.sort((left, right) => left.recordedOn.localeCompare(right.recordedOn));
  }

  const events = profiles.flatMap((profile) => {
    const animal = animalById.get(profile.animalId);
    if (!animal) return [];
    return feedingDates(profile, options.today, horizonDays).map((feedingDate) =>
      forecastEvent(profile, animal, feedingDate, weightsByAnimal.get(profile.animalId) ?? []),
    );
  });

  events.sort((left, right) =>
    left.feedingDate.localeCompare(right.feedingDate)
      || (right.targetPreyGrams ?? -1) - (left.targetPreyGrams ?? -1)
      || left.animalName.localeCompare(right.animalName),
  );

  const remaining = options.availableFeeders
    .filter((feeder) => feeder.preySpecies === "rat")
    .map((feeder) => ({ ...feeder }));
  for (const event of events) {
    if (event.status !== "shortage" || event.preySpecies !== "rat") continue;
    const candidates = remaining
      .map((feeder, index) => ({ feeder, index }))
      .filter(({ feeder }) =>
        feeder.weightGrams >= (event.minimumPreyGrams ?? Number.POSITIVE_INFINITY)
        && feeder.weightGrams <= (event.maximumPreyGrams ?? Number.NEGATIVE_INFINITY),
      )
      .sort((left, right) =>
        Math.abs(left.feeder.weightGrams - (event.targetPreyGrams ?? 0))
          - Math.abs(right.feeder.weightGrams - (event.targetPreyGrams ?? 0))
        || left.feeder.weightGrams - right.feeder.weightGrams,
      );
    const selected = candidates[0];
    if (!selected) continue;
    event.allocatedFeeder = selected.feeder;
    event.status = "covered";
    remaining.splice(selected.index, 1);
  }

  const alerts = buildAlerts(events, options.animals);
  return {
    generatedFor: options.today,
    horizonDays,
    throughDate: addDays(options.today, horizonDays),
    orderNeeded: alerts.some((alert) =>
      alert.code === "feeder-shortage" || alert.code === "buy-as-needed" || alert.code === "inventory-untracked"),
    nextFeedings: firstEventPerAnimal(events),
    events,
    alerts,
  };
}

function feedingDates(profile: FeedingProfile, today: string, horizonDays: number): string[] {
  const dates: string[] = [];
  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const date = addDays(today, offset);
    if (scheduledTasksForDate(date).some((task) => task.id === `${profile.taskKey}:${date}`)) {
      dates.push(date);
    }
  }
  return dates;
}

function forecastEvent(
  profile: FeedingProfile,
  animal: ForecastAnimal,
  feedingDate: string,
  weights: ForecastWeight[],
): FeederForecastEvent {
  if (profile.preySpecies === "mouse") {
    return {
      animalId: animal.id,
      animalName: animal.name,
      feedingDate,
      preySpecies: profile.preySpecies,
      preyDescription: profile.preyDescription,
      latestWeightGrams: weights.at(-1)?.weightGrams ?? null,
      predictedWeightGrams: null,
      weightTrendGramsPerDay: null,
      weightTrendConfidence: "none",
      targetPreyGrams: null,
      minimumPreyGrams: null,
      maximumPreyGrams: null,
      allocatedFeeder: null,
      status: "buy-as-needed",
    };
  }

  const prediction = predictWeight(weights, feedingDate);
  if (!prediction) {
    return {
      animalId: animal.id,
      animalName: animal.name,
      feedingDate,
      preySpecies: profile.preySpecies,
      preyDescription: "rat",
      latestWeightGrams: null,
      predictedWeightGrams: null,
      weightTrendGramsPerDay: null,
      weightTrendConfidence: "none",
      targetPreyGrams: null,
      minimumPreyGrams: null,
      maximumPreyGrams: null,
      allocatedFeeder: null,
      status: "weight-missing",
    };
  }

  return {
    animalId: animal.id,
    animalName: animal.name,
    feedingDate,
    preySpecies: profile.preySpecies,
    preyDescription: "rat",
    latestWeightGrams: prediction.latestWeightGrams,
    predictedWeightGrams: prediction.predictedWeightGrams,
    weightTrendGramsPerDay: prediction.trendGramsPerDay,
    weightTrendConfidence: prediction.confidence,
    targetPreyGrams: Math.round(prediction.predictedWeightGrams * profile.targetPercent),
    minimumPreyGrams: Math.ceil(prediction.predictedWeightGrams * profile.minimumPercent),
    maximumPreyGrams: Math.floor(prediction.predictedWeightGrams * profile.maximumPercent),
    allocatedFeeder: null,
    status: "shortage",
  };
}

export function predictWeight(weights: ForecastWeight[], targetDate: string) {
  if (weights.length === 0) return null;
  const recent = weights.slice(-6);
  const latest = recent.at(-1)!;
  if (recent.length === 1) {
    return {
      latestWeightGrams: latest.weightGrams,
      predictedWeightGrams: latest.weightGrams,
      trendGramsPerDay: 0,
      confidence: "none" as const,
    };
  }

  const origin = Date.parse(`${recent[0].recordedOn}T12:00:00Z`);
  const points = recent.map((row) => ({
    x: (Date.parse(`${row.recordedOn}T12:00:00Z`) - origin) / 86_400_000,
    y: row.weightGrams,
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const rawSlope = denominator === 0
    ? 0
    : points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator;
  const maximumDailyChange = latest.weightGrams * 0.005;
  const trendGramsPerDay = Math.max(-maximumDailyChange, Math.min(maximumDailyChange, rawSlope));
  const daysAhead = Math.max(0, daysBetween(latest.recordedOn, targetDate));
  const predictedWeightGrams = Math.max(1, Math.round(latest.weightGrams + trendGramsPerDay * daysAhead));
  const spanDays = daysBetween(recent[0].recordedOn, latest.recordedOn);
  const confidence = recent.length >= 4 && spanDays >= 60
    ? "high" as const
    : recent.length >= 3 && spanDays >= 30
      ? "medium" as const
      : "low" as const;
  return {
    latestWeightGrams: latest.weightGrams,
    predictedWeightGrams,
    trendGramsPerDay: Number(trendGramsPerDay.toFixed(3)),
    confidence,
  };
}

function buildAlerts(events: FeederForecastEvent[], animals: ForecastAnimal[]): FeederForecastAlert[] {
  const alerts: FeederForecastAlert[] = [];
  for (const event of events) {
    if (event.status === "shortage") {
      alerts.push({
        code: "feeder-shortage",
        severity: "warning",
        animalId: event.animalId,
        animalName: event.animalName,
        dueBy: event.feedingDate,
        message: `No available ${event.minimumPreyGrams}–${event.maximumPreyGrams} g rat is close enough for ${event.animalName}'s ${event.feedingDate} feeding.`,
      });
    } else if (event.status === "weight-missing" && !alerts.some((alert) => alert.code === "missing-weight" && alert.animalId === event.animalId)) {
      alerts.push({
        code: "missing-weight",
        severity: "warning",
        animalId: event.animalId,
        animalName: event.animalName,
        dueBy: event.feedingDate,
        message: `${event.animalName} needs a current weight before Shed can predict a feeder size.`,
      });
    }
  }

  for (const event of firstEventPerAnimal(events.filter((item) => item.status === "buy-as-needed"))) {
    alerts.push({
      code: "buy-as-needed",
      severity: "info",
      animalId: event.animalId,
      animalName: event.animalName,
      dueBy: event.feedingDate,
      message: `Buy 1 ${event.preyDescription} for ${event.animalName} by ${event.feedingDate}.`,
    });
  }

  const untrackedGroups = new Map<string, FeederForecastEvent[]>();
  for (const event of events.filter((item) => item.status === "inventory-untracked")) {
    untrackedGroups.set(event.preyDescription, [
      ...(untrackedGroups.get(event.preyDescription) ?? []),
      event,
    ]);
  }
  for (const [description, group] of untrackedGroups) {
    alerts.push({
      code: "inventory-untracked",
      severity: "warning",
      dueBy: group[0].feedingDate,
      message: `${description} inventory is not tracked; ${group.length} ${group.length === 1 ? "feeding" : "feedings"} are scheduled through ${group.at(-1)!.feedingDate}.`,
    });
  }

  for (const animal of animals.filter((item) => knownFeederAnimals.has(item.id))) {
    if (!profiles.some((profile) => profile.animalId === animal.id)) {
      alerts.push({
        code: "missing-feeding-plan",
        severity: "info",
        animalId: animal.id,
        animalName: animal.name,
        message: `${animal.name} needs a feeding schedule and feeder-size plan before forecasting can begin.`,
      });
    }
  }
  return alerts;
}

function firstEventPerAnimal(events: FeederForecastEvent[]): FeederForecastEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.animalId)) return false;
    seen.add(event.animalId);
    return true;
  });
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000,
  );
}
