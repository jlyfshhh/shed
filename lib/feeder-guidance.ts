import type { FeederForecastEvent } from "./feeding-forecast.ts";

export function feederGuidance(event: FeederForecastEvent): string {
  const target = event.preySizeClass
    ? `${event.preySizeClass} ${event.preySpecies}`
    : event.minimumPreyGrams !== null && event.maximumPreyGrams !== null
      ? `${event.minimumPreyGrams}–${event.maximumPreyGrams} g ${event.preySpecies}`
      : event.preyDescription;

  if (event.allocatedFeeder) {
    const feeder = event.allocatedFeeder;
    return `Target ${target} · ${feeder.weightGrams} g ${feeder.sizeClass} ${feeder.preySpecies} ready`;
  }
  if (event.status === "weight-missing") {
    return "Current weight needed to calculate feeder size";
  }
  if (event.status === "buy-as-needed") {
    return `Buy 1 ${event.preyDescription}`;
  }
  if (event.status === "inventory-untracked") {
    return `Planned feeder: ${event.preyDescription} · inventory not tracked`;
  }
  return `Target ${target} · no matching feeder in stock`;
}
