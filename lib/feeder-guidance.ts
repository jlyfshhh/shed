import type { FeederForecastEvent } from "./feeding-forecast.ts";

export function feederGuidance(event: FeederForecastEvent): string {
  const target = event.preySizeClass
    ? `${event.preySizeClass} ${event.preySpecies}`
    : event.preyDescription;

  if (event.allocatedFeeder) {
    const feeder = event.allocatedFeeder;
    // A blank-size plan matches on species alone, so it drew whatever size was
    // oldest in stock. Say so plainly instead of presenting it as a verified or
    // computed size — there is no body-weight-percentage sizing.
    return event.preySizeClass
      ? `${target} ready · ${feeder.sizeClass} ${feeder.preySpecies}`
      : `${feeder.sizeClass} ${feeder.preySpecies} ready · any size (no size class set)`;
  }
  if (event.status === "buy-as-needed") {
    return `Buy 1 ${event.preyDescription}`;
  }
  return `${target} · none left in stock`;
}
