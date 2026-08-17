import type { FeederForecastEvent } from "./feeding-forecast.ts";

export function feederGuidance(event: FeederForecastEvent): string {
  const target = event.preySizeClass
    ? `${event.preySizeClass} ${event.preySpecies}`
    : event.preyDescription;

  if (event.allocatedFeeder) {
    const feeder = event.allocatedFeeder;
    return `${target} ready · ${feeder.sizeClass} ${feeder.preySpecies}`;
  }
  if (event.status === "buy-as-needed") {
    return `Buy 1 ${event.preyDescription}`;
  }
  return `${target} · none left in stock`;
}
