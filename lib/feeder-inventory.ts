export type FeederInventorySeed = {
  id: string;
  preySpecies: "rat";
  sizeClass: "pup" | "weaned" | "small";
  weightGrams: number;
};

const reportedInventory = {
  weaned: [30, 32, 32, 34, 39, 32, 39, 31, 30, 31, 33, 34, 33, 32, 42, 33, 30],
  pup: [16, 16, 16, 16, 15, 17, 16, 17, 14],
  small: [83, 40, 62, 58, 41, 59, 42, 40, 41, 40, 39],
} as const;

export const feederInventorySeed: FeederInventorySeed[] = Object.entries(
  reportedInventory,
).flatMap(([sizeClass, weights]) =>
  weights.map((weightGrams, index) => ({
    id: `rat-${sizeClass}-${String(index + 1).padStart(3, "0")}`,
    preySpecies: "rat" as const,
    sizeClass: sizeClass as FeederInventorySeed["sizeClass"],
    weightGrams,
  })),
);
