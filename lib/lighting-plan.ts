export type LightingPlanStatus = "plan-only" | "due" | "verified" | "review";

export function lightingPlanStatus(input: {
  targetUviMin?: number | null;
  targetUviMax?: number | null;
  planUpdatedAt: string;
  latestUvi?: { value: number; measuredAt: string } | null;
}): LightingPlanStatus {
  const hasTarget = input.targetUviMin != null || input.targetUviMax != null;
  if (!hasTarget) return "plan-only";
  if (!input.latestUvi || input.latestUvi.measuredAt < input.planUpdatedAt) return "due";
  const inRange = (input.targetUviMin == null || input.latestUvi.value >= input.targetUviMin)
    && (input.targetUviMax == null || input.latestUvi.value <= input.targetUviMax);
  return inRange ? "verified" : "review";
}
