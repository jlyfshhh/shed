import { scheduleIsDue, type CareScheduleRow } from "./schedules.ts";

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
  /** Kept for feeders recorded before weights were dropped; never used to choose one. */
  weightGrams: number | null;
  addedOn: string;
};

export type FeedingProfile = {
  animalId: string;
  preySpecies: string;
  preyDescription: string;
  preySizeClass: string | null;
  buyAsNeeded: boolean;
  schedule: CareScheduleRow;
};

export type FeederForecastEvent = {
  scheduleId: string;
  animalId: string;
  animalName: string;
  feedingDate: string;
  preySpecies: string;
  preyDescription: string;
  preySizeClass: string | null;
  latestWeightGrams: number | null;
  predictedWeightGrams: number | null;
  weightTrendGramsPerDay: number | null;
  weightTrendConfidence: "none" | "low" | "medium" | "high";
  allocatedFeeder: AvailableFeeder | null;
  status: "covered" | "shortage" | "buy-as-needed";
};

export type FeederForecastAlert = {
  code: "feeder-shortage" | "buy-as-needed" | "missing-feeding-plan";
  severity: "warning" | "info";
  animalId?: string;
  animalName?: string;
  dueBy?: string;
  message: string;
};

export function buildFeederForecast(options: {
  today: string;
  horizonDays: number;
  animals: ForecastAnimal[];
  weights: ForecastWeight[];
  availableFeeders: AvailableFeeder[];
  profiles: FeedingProfile[];
  excludedFeedings?: Iterable<string>;
}) {
  const horizonDays = Math.min(Math.max(Math.trunc(options.horizonDays), 1), 180);
  const animalById = new Map(options.animals.map((animal) => [animal.id, animal]));
  const excludedFeedings = new Set(options.excludedFeedings ?? []);
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

  const events = options.profiles.flatMap((profile) => {
    const animal = animalById.get(profile.animalId);
    if (!animal) return [];
    return feedingDates(profile, options.today, horizonDays)
      .filter((feedingDate) => !excludedFeedings.has(`${profile.schedule.id}:${feedingDate}`))
      .map((feedingDate) =>
      forecastEvent(profile, animal, feedingDate, weightsByAnimal.get(profile.animalId) ?? []),
    );
  });

  events.sort((left, right) =>
    left.feedingDate.localeCompare(right.feedingDate)
      || left.animalName.localeCompare(right.animalName),
  );

  const remaining = options.availableFeeders.map((feeder) => ({ ...feeder }));
  for (const event of events) {
    if (event.status !== "shortage") continue;
    // Oldest stock first. Every feeder of a size class is interchangeable, so the
    // only thing left worth optimising is that the freezer rotates.
    const candidates = remaining
      .map((feeder, index) => ({ feeder, index }))
      .filter(({ feeder }) => feederMatchesEvent(feeder, event))
      .sort((left, right) =>
        left.feeder.addedOn.localeCompare(right.feeder.addedOn)
        || left.feeder.id.localeCompare(right.feeder.id),
      );
    const selected = candidates[0];
    if (!selected) continue;
    event.allocatedFeeder = selected.feeder;
    event.status = "covered";
    remaining.splice(selected.index, 1);
  }

  const alerts = buildAlerts(events);
  return {
    generatedFor: options.today,
    horizonDays,
    throughDate: addDays(options.today, horizonDays),
    orderNeeded: alerts.some((alert) =>
      alert.code === "feeder-shortage" || alert.code === "buy-as-needed"),
    nextFeedings: firstEventPerAnimal(events),
    events,
    alerts,
  };
}

function feedingDates(profile: FeedingProfile, today: string, horizonDays: number): string[] {
  const dates: string[] = [];
  // Include today: a feeder forecast is also the source of truth for the care
  // task that is currently on the dashboard, not only future shopping needs.
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = addDays(today, offset);
    if (scheduleIsDue(profile.schedule, date)) {
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
  const base = {
    scheduleId: profile.schedule.id,
    animalId: animal.id,
    animalName: animal.name,
    feedingDate,
    preySpecies: profile.preySpecies,
    preyDescription: profile.preyDescription,
    preySizeClass: profile.preySizeClass,
    // Weight is still recorded and still worth watching as a trend; it simply no
    // longer decides which feeder comes out of the freezer.
    latestWeightGrams: weights.at(-1)?.weightGrams ?? null,
    predictedWeightGrams: null,
    weightTrendGramsPerDay: null,
    weightTrendConfidence: "none" as const,
    allocatedFeeder: null,
  };
  // Buy-as-needed prey is bought fresh for the feeding, so it is never drawn
  // from stock and never counts as a shortage.
  return profile.buyAsNeeded
    ? { ...base, status: "buy-as-needed" as const }
    : { ...base, status: "shortage" as const };
}

function feederMatchesEvent(feeder: AvailableFeeder, event: FeederForecastEvent): boolean {
  if (normalizeLabel(feeder.preySpecies) !== normalizeLabel(event.preySpecies)) return false;
  // A plan without a size class accepts any feeder of the right species, which is
  // the honest reading of "feed a rat" — narrower than that is the keeper's call.
  if (!event.preySizeClass) return true;
  return normalizeLabel(feeder.sizeClass) === normalizeLabel(event.preySizeClass);
}

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
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

function buildAlerts(events: FeederForecastEvent[]): FeederForecastAlert[] {
  const alerts: FeederForecastAlert[] = [];
  for (const event of events) {
    if (event.status === "shortage") {
      const requirement = event.preySizeClass
        ? `${event.preySizeClass} ${event.preySpecies}`
        : event.preySpecies;
      alerts.push({
        code: "feeder-shortage",
        severity: "warning",
        animalId: event.animalId,
        animalName: event.animalName,
        dueBy: event.feedingDate,
        message: `No ${requirement} left in stock for ${event.animalName}'s ${event.feedingDate} feeding.`,
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
