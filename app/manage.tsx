"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { equipmentAgeLabel } from "@/lib/equipment-age";
import { parseAnimalIds } from "@/lib/care-group";
import { animalFacts, speciesGlyph } from "@/lib/animal-traits";
import type { Capability } from "@/lib/capabilities";
import { SHED_QUALITIES, SHED_QUALITY_LABELS, isPoorShed, shedIntervalDays, type ShedQuality } from "@/lib/shed-quality";
import { AnimalPhotoControls, animalPhotoUrl } from "./animal-photo";

// ── Shared types ─────────────────────────────────────────────────────────────
export type Role = "Owner" | "Zookeeper";
export type Viewer = { id: string; displayName: string; role: Role };

type Row = Record<string, unknown>;
type Catalog = {
  animals: Row[];
  enclosures: Row[];
  schedules: Row[];
  notes: Row[];
  equipment: Row[];
  weights: Row[];
  events: Row[];
  feeders: Row[];
  lightingPlans: Row[];
  lightingFixtures: Row[];
  lightingMeasurements: Row[];
};
export type ResourceKey = "animal" | "enclosure" | "schedule" | "note" | "equipment" | "weight" | "event" | "feeder" | "lightingPlan" | "lightingFixture" | "lightingMeasurement";
export type SetupSummary = {
  animalCount: number;
  enclosureCount: number;
  scheduleCount: number;
  eventCount: number;
  keeperCount: number;
};
type CatalogKey = keyof Catalog;
type LightingImportFixture = {
  fixtureKey: string; sourceRef: string; sourceRefKind: "catalog-id" | "catalog-hash"; role: "uvb" | "heat" | "daylight";
  enabled: boolean; positionCm: number; mountingMode: string; cageEnabled: boolean; cageBlockagePercent: number;
  /** Resolved from Light My Reptile's product list; null when the hash is newer than ours. */
  product?: { name: string; brand: string | null; model: string | null } | null;
};
type LightingImportPreview = {
  formatVersion: number; sourceUrl: string; unitSystem: "imperial" | "metric"; mountingMode: string; lightingLevel: string;
  enclosure: { widthCm: number; depthCm: number; heightCm: number }; baskingDistanceCm: number; meshBlockagePercent: number;
  animalName?: string; fixtures: LightingImportFixture[];
};

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const bool = (value: unknown): boolean => value === 1 || value === true || value === "1";
/** Local calendar date, for age maths on the client. */
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const scoreTier = (percent: number | null): string =>
  percent === null ? "new" : percent >= 90 ? "great" : percent >= 75 ? "good" : "low";

const relativeTime = (value: string) => {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
};

// ── Field configuration (mirrors app/api/manage/route.ts columns) ─────────────
type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "boolean" | "select" | "weekdays" | "animalMulti" | "animalRef" | "enclosureRef" | "lightingPlanRef" | "equipmentRef";
type Field = {
  key: string; // camelCase write key
  column: string; // snake_case read column
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  default?: boolean; // initial value for boolean fields on a new record
  defaultValue?: string;
  help?: string;
  step?: string;
  optional?: boolean; // ref selects that allow "none"
  showIf?: (values: Record<string, string>) => boolean;
  /** Says something about the answer given, when it deserves saying. */
  warn?: (values: Record<string, string>) => string | null;
  /** Plain-language names for select options; the stored value is unchanged. */
  optionLabels?: Record<string, string>;
};
type ResourceDef = {
  key: ResourceKey;
  catalog: CatalogKey;
  singular: string;
  plural: string;
  action: "Archive" | "Delete" | "Void";
  fields: Field[];
  summary: (row: Row, catalog: Catalog) => { title: string; sub: string; archived: boolean };
};

const groupOptions = ["Reptile", "Amphibian", "Invertebrate", "Fish", "Community", "Other"];
const sexOptions = ["", "male", "female", "unknown"];
const frequencyOptions = ["daily", "weekly", "interval", "monthly", "once"];
// "interval" is what the column stores, but nobody setting up a gecko thinks in
// those words. A keeper asked for an every-other-week option that already
// existed — as "interval" with 14 days — and could not find it.
const frequencyLabels: Record<string, string> = {
  daily: "Every day",
  weekly: "Certain days of the week",
  interval: "Every N days (2 = every other day, 14 = every other week)",
  monthly: "Monthly",
  once: "One time only",
};
const feederStatusOptions = ["available", "consumed", "discarded"];

const isFeeding = (values: Record<string, string>) => values.taskType?.toLowerCase() === "feeding";

const animalName = (catalog: Catalog, id: unknown) =>
  str(catalog.animals.find((a) => a.id === id)?.name) || "Unassigned";
const enclosureName = (catalog: Catalog, id: unknown) =>
  str(catalog.enclosures.find((enclosure) => enclosure.id === id)?.name) || "Unassigned";
const lightingPlanName = (catalog: Catalog, id: unknown) =>
  str(catalog.lightingPlans.find((plan) => plan.id === id)?.name) || "Unknown plan";
const equipmentName = (catalog: Catalog, id: unknown) =>
  str(catalog.equipment.find((item) => item.id === id)?.name) || "Unknown equipment";

const resourceDefs: ResourceDef[] = [
  {
    key: "animal", catalog: "animals", singular: "animal", plural: "Animals", action: "Archive",
    fields: [
      { key: "name", column: "name", label: "Name", type: "text", required: true },
      { key: "species", column: "species", label: "Common species", type: "text", required: true },
      { key: "scientificName", column: "scientific_name", label: "Scientific name", type: "text" },
      { key: "morph", column: "morph", label: "Morph / trait", type: "text" },
      { key: "sex", column: "sex", label: "Sex", type: "select", options: sexOptions },
      { key: "group", column: "group_name", label: "Group", type: "select", options: groupOptions },
      { key: "enclosureId", column: "enclosure_id", label: "Enclosure", type: "enclosureRef", optional: true },
      { key: "location", column: "location", label: "Room / location", type: "text" },
      { key: "birthDate", column: "birth_date", label: "Birth date", type: "date" },
      { key: "acquiredDate", column: "acquired_date", label: "Acquired date", type: "date" },
      { key: "source", column: "source", label: "Source / breeder", type: "text" },
      { key: "notes", column: "notes", label: "Notes", type: "textarea" },
      { key: "earningEnabled", column: "earning_enabled", label: "Earns allowance", type: "boolean", default: true, help: "On by default. Turn off for a child’s own pet so completing its tasks doesn’t pay allowance." },
    ],
    summary: (row) => ({ title: str(row.name), sub: `${str(row.species)}${row.morph ? ` · ${str(row.morph)}` : ""}`, archived: !bool(row.active) }),
  },
  {
    key: "enclosure", catalog: "enclosures", singular: "enclosure", plural: "Enclosures", action: "Archive",
    fields: [
      { key: "name", column: "name", label: "Name", type: "text", required: true },
      { key: "enclosureType", column: "enclosure_type", label: "Type", type: "text", help: "e.g. PVC, glass terrarium, tub" },
      { key: "manufacturer", column: "manufacturer", label: "Manufacturer", type: "text" },
      { key: "model", column: "model", label: "Model", type: "text" },
      { key: "width", column: "width", label: "Width", type: "number", step: "0.1" },
      { key: "depth", column: "depth", label: "Depth", type: "number", step: "0.1" },
      { key: "height", column: "height", label: "Height", type: "number", step: "0.1" },
      { key: "dimensionUnit", column: "dimension_unit", label: "Unit", type: "select", options: ["in", "cm"] },
      { key: "location", column: "location", label: "Room / location", type: "text" },
      { key: "substrate", column: "substrate", label: "Substrate", type: "text" },
      { key: "bioactive", column: "bioactive", label: "Bioactive", type: "boolean" },
      { key: "notes", column: "notes", label: "Notes", type: "textarea" },
    ],
    summary: (row) => ({ title: str(row.name), sub: `${str(row.enclosure_type) || "Enclosure"}${row.location ? ` · ${str(row.location)}` : ""}`, archived: !bool(row.active) }),
  },
  {
    key: "schedule", catalog: "schedules", singular: "care plan", plural: "Care plans", action: "Archive",
    fields: [
      { key: "animalId", column: "animal_id", label: "Animal", type: "animalRef", required: true },
      { key: "animalIdsJson", column: "animal_ids_json", label: "Also covers", type: "animalMulti", help: "Pick others on the same routine and they share one line on Today. Each animal still gets its own history, weights and feeder record." },
      { key: "title", column: "title", label: "Task title", type: "text", required: true, help: "e.g. Feed, Mist, Water change" },
      { key: "taskType", column: "task_type", label: "Task type", type: "text", required: true, help: "feeding, misting, water, cleaning…" },
      { key: "details", column: "details", label: "Details", type: "text", help: "Short note shown on the task, e.g. “Every 2 weeks”" },
      { key: "frequency", column: "frequency", label: "Frequency", type: "select", options: frequencyOptions, optionLabels: frequencyLabels, required: true },
      { key: "weekdaysJson", column: "weekdays_json", label: "Days of week", type: "weekdays", showIf: (v) => v.frequency === "weekly" || v.frequency === "monthly", help: "For monthly care, choose one weekday to schedule its first, second, third, fourth, or fifth occurrence." },
      { key: "intervalDays", column: "interval_days", label: "Every N days", type: "number", showIf: (v) => v.frequency === "interval", help: "1 = daily, 2 = every other day, 7 = weekly, 14 = every other week" },
      { key: "dayOfMonth", column: "day_of_month", label: "Day / occurrence in month", type: "number", showIf: (v) => v.frequency === "monthly", help: "With no weekday selected: calendar day 1–31. With a weekday selected: 1 = first, 2 = second … 5 = fifth.",
        // A calendar day that some months do not have simply produces no task
        // in those months. That is what the number means, but it is worth
        // saying out loud at the moment it is typed.
        warn: (v) => {
          if (v.frequency !== "monthly") return null;
          let weekdays: unknown = [];
          try { weekdays = JSON.parse(v.weekdaysJson || "[]"); } catch { weekdays = []; }
          // With a weekday chosen the number is an occurrence, not a date.
          if (Array.isArray(weekdays) && weekdays.length) return null;
          const day = Number(v.dayOfMonth);
          if (!Number.isInteger(day)) return null;
          if (day === 31) return "April, June, September and November have no 31st, so this plan skips those four months. For something every month, use “Every N days” or pick a weekday occurrence instead.";
          if (day === 30) return "February has no 30th, so this plan skips February.";
          if (day === 29) return "February only has a 29th in leap years, so this plan skips it in most years.";
          return null;
        } },
      { key: "graceDays", column: "grace_days", label: "Extra days to finish", type: "number", help: "Blank or 0 = due on the day. 1 = a Saturday task stays on the list through Sunday instead of going overdue. Use it for chores that just need doing that weekend, not for feedings." },
      { key: "startDate", column: "start_date", label: "Start date", type: "date", required: true },
      { key: "endDate", column: "end_date", label: "End date", type: "date", help: "Optional — leave blank to run indefinitely" },
      { key: "rewardCents", column: "reward_cents", label: "Reward per task (cents)", type: "number", help: "Blank = household default. e.g. 25 = 25¢, 50 = 50¢" },
      { key: "preySpecies", column: "prey_species", label: "Prey species", type: "text", showIf: isFeeding, help: "e.g. rat, mouse" },
      { key: "preyDescription", column: "prey_description", label: "Prey description", type: "text", showIf: isFeeding },
      { key: "preySizeClass", column: "prey_size_class", label: "Tracked prey size", type: "text", showIf: isFeeding, help: "Exact inventory size class, e.g. hopper or large pinky. Leave blank when sizing by body-weight percentage." },
      { key: "targetPercent", column: "target_percent", label: "Target % of body weight", type: "number", step: "0.001", showIf: isFeeding, help: "Decimal: 5% = 0.05" },
      { key: "minimumPercent", column: "minimum_percent", label: "Minimum %", type: "number", step: "0.001", showIf: isFeeding, help: "Decimal 0–1" },
      { key: "maximumPercent", column: "maximum_percent", label: "Maximum %", type: "number", step: "0.001", showIf: isFeeding, help: "Decimal 0–1" },
      { key: "buyAsNeeded", column: "buy_as_needed", label: "Buy as needed (don't track inventory)", type: "boolean", showIf: isFeeding },
    ],
    summary: (row, catalog) => ({ title: str(row.title), sub: `${animalName(catalog, row.animal_id)} · ${describeFrequency(row)}`, archived: !bool(row.active) }),
  },
  {
    key: "note", catalog: "notes", singular: "note", plural: "Notes", action: "Delete",
    fields: [
      { key: "title", column: "title", label: "Title", type: "text", required: true },
      { key: "body", column: "body", label: "Note", type: "textarea", required: true },
      { key: "animalId", column: "animal_id", label: "About animal", type: "animalRef", optional: true },
      { key: "enclosureId", column: "enclosure_id", label: "About enclosure", type: "enclosureRef", optional: true },
      { key: "category", column: "category", label: "Category", type: "text", help: "general, vet, behavior…" },
      { key: "pinned", column: "pinned", label: "Pin to top", type: "boolean" },
    ],
    summary: (row, catalog) => ({ title: str(row.title), sub: `${row.animal_id ? animalName(catalog, row.animal_id) : str(row.category) || "General"}${bool(row.pinned) ? " · pinned" : ""}`, archived: false }),
  },
  {
    key: "equipment", catalog: "equipment", singular: "equipment item", plural: "Equipment", action: "Archive",
    fields: [
      { key: "name", column: "name", label: "Name", type: "text", required: true },
      { key: "category", column: "category", label: "Category", type: "text", help: "heat, uvb, humidity, filter…" },
      { key: "brand", column: "brand", label: "Brand", type: "text" },
      { key: "model", column: "model", label: "Model", type: "text" },
      { key: "animalId", column: "animal_id", label: "For animal", type: "animalRef", optional: true },
      { key: "enclosureId", column: "enclosure_id", label: "In enclosure", type: "enclosureRef", optional: true },
      { key: "installedOn", column: "installed_on", label: "Installed on", type: "date", help: "Set this to track how long the item has been in use." },
      { key: "notes", column: "notes", label: "Notes", type: "textarea" },
    ],
    summary: (row, catalog) => ({ title: str(row.name), sub: `${str(row.category) || "Equipment"}${row.animal_id ? ` · ${animalName(catalog, row.animal_id)}` : row.enclosure_id ? ` · ${enclosureName(catalog, row.enclosure_id)}` : ""}${row.installed_on ? ` · since ${str(row.installed_on)}` : ""}`, archived: !bool(row.active) }),
  },
  {
    key: "lightingPlan", catalog: "lightingPlans", singular: "lighting plan", plural: "Lighting plans", action: "Archive",
    fields: [
      { key: "name", column: "name", label: "Plan name", type: "text", required: true, help: "e.g. Dracarys summer lighting plan" },
      { key: "enclosureId", column: "enclosure_id", label: "Enclosure", type: "enclosureRef", required: true },
      { key: "species", column: "species", label: "Species / community", type: "text" },
      { key: "plannedOn", column: "planned_on", label: "Planned on", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
      { key: "reviewedOn", column: "reviewed_on", label: "Last reviewed", type: "date" },
      { key: "sourceName", column: "source_name", label: "Planning source", type: "text", defaultValue: "Light My Reptile" },
      { key: "sourceUrl", column: "source_url", label: "Source URL", type: "text", defaultValue: "https://lightmyreptile.com/" },
      { key: "sourceVersion", column: "source_version", label: "Simulator version", type: "text", help: "Record the version shown by the simulator so this plan remains reproducible." },
      { key: "mountingMode", column: "mounting_mode", label: "Mounting", type: "select", options: ["", "above mesh", "internal", "mixed"] },
      { key: "meshLossPercent", column: "mesh_loss_percent", label: "Mesh loss (%)", type: "number", step: "0.1" },
      { key: "baskingHeight", column: "basking_height", label: "Basking surface below ceiling", type: "number", step: "0.1" },
      { key: "heightUnit", column: "height_unit", label: "Height unit", type: "select", options: ["cm", "in"] },
      { key: "targetUviMin", column: "target_uvi_min", label: "Target UVI minimum", type: "number", step: "0.01" },
      { key: "targetUviMax", column: "target_uvi_max", label: "Target UVI maximum", type: "number", step: "0.01" },
      { key: "targetLuxMin", column: "target_lux_min", label: "Target lux minimum", type: "number", step: "1" },
      { key: "targetLuxMax", column: "target_lux_max", label: "Target lux maximum", type: "number", step: "1" },
      { key: "targetPowerDensityMin", column: "target_power_density_min", label: "Power density minimum (W/m²)", type: "number", step: "0.1" },
      { key: "targetPowerDensityMax", column: "target_power_density_max", label: "Power density maximum (W/m²)", type: "number", step: "0.1" },
      { key: "notes", column: "notes", label: "Plan notes", type: "textarea", help: "Record the target zone, platform placement, and anything the exported sheet does not show." },
    ],
    summary: (row, catalog) => ({ title: str(row.name), sub: `${enclosureName(catalog, row.enclosure_id)}${row.source_version ? ` · ${str(row.source_name)} ${str(row.source_version)}` : ` · ${str(row.source_name)}`}${row.plan_sheet_name ? " · sheet attached" : ""}`, archived: !bool(row.active) }),
  },
  {
    key: "lightingFixture", catalog: "lightingFixtures", singular: "plan fixture", plural: "Plan fixtures", action: "Delete",
    fields: [
      { key: "planId", column: "plan_id", label: "Lighting plan", type: "lightingPlanRef", required: true },
      { key: "equipmentId", column: "equipment_id", label: "Installed equipment", type: "equipmentRef", required: true },
      { key: "role", column: "role", label: "Role", type: "select", options: ["uvb", "heat", "daylight", "plant growth", "other"], required: true },
      { key: "positionCm", column: "position_cm", label: "Position across enclosure (cm)", type: "number", step: "0.1" },
      { key: "mountingHeightCm", column: "mounting_height_cm", label: "Mounting height (cm)", type: "number", step: "0.1" },
      { key: "quantity", column: "quantity", label: "Quantity", type: "number", step: "1", defaultValue: "1" },
      { key: "notes", column: "notes", label: "Placement notes", type: "textarea" },
    ],
    summary: (row, catalog) => ({ title: equipmentName(catalog, row.equipment_id), sub: `${lightingPlanName(catalog, row.plan_id)} · ${str(row.role)}${Number(row.quantity) > 1 ? ` × ${str(row.quantity)}` : ""}`, archived: false }),
  },
  {
    key: "lightingMeasurement", catalog: "lightingMeasurements", singular: "lighting measurement", plural: "Lighting measurements", action: "Delete",
    fields: [
      { key: "planId", column: "plan_id", label: "Lighting plan", type: "lightingPlanRef", required: true },
      { key: "metric", column: "metric", label: "Metric", type: "select", options: ["UVI", "lux", "surface temperature", "power density"], required: true },
      { key: "value", column: "value", label: "Measured value", type: "number", step: "0.01", required: true },
      { key: "unit", column: "unit", label: "Unit", type: "select", options: ["UVI", "lux", "°F", "°C", "W/m²"], required: true },
      { key: "measuredAt", column: "measured_at", label: "Measured at", type: "datetime", required: true, defaultValue: new Date().toISOString().slice(0, 16) },
      { key: "position", column: "position", label: "Measurement position", type: "text", help: "e.g. center of basking surface" },
      { key: "height", column: "height", label: "Distance / height", type: "number", step: "0.1" },
      { key: "heightUnit", column: "height_unit", label: "Height unit", type: "select", options: ["cm", "in"] },
      { key: "instrument", column: "instrument", label: "Instrument", type: "text", help: "e.g. Solarmeter 6.5R" },
      { key: "notes", column: "notes", label: "Notes", type: "textarea" },
    ],
    summary: (row, catalog) => ({ title: `${str(row.value)} ${str(row.unit)}`, sub: `${lightingPlanName(catalog, row.plan_id)} · ${str(row.metric)} · ${relativeTime(str(row.measured_at))}`, archived: false }),
  },
  {
    key: "weight", catalog: "weights", singular: "weight", plural: "Weights", action: "Delete",
    fields: [
      { key: "animalId", column: "animal_id", label: "Animal", type: "animalRef", required: true },
      { key: "recordedOn", column: "recorded_on", label: "Date", type: "date", required: true },
      { key: "weightGrams", column: "weight_grams", label: "Weight (grams)", type: "number", required: true, step: "0.1" },
      { key: "notes", column: "notes", label: "Notes", type: "text" },
    ],
    summary: (row, catalog) => ({ title: `${str(row.weight_grams)} g`, sub: `${animalName(catalog, row.animal_id)} · ${str(row.recorded_on)}`, archived: false }),
  },
  {
    key: "event", catalog: "events", singular: "history entry", plural: "History", action: "Void",
    fields: [
      { key: "animalId", column: "animal_id", label: "Animal", type: "animalRef", required: true },
      { key: "title", column: "title", label: "What happened", type: "text", required: true },
      { key: "taskType", column: "task_type", label: "Type", type: "text", required: true, help: "feeding, misting, vet, enclosure…" },
      { key: "occurredAt", column: "occurred_at", label: "When", type: "datetime", required: true },
      { key: "notes", column: "notes", label: "Notes", type: "textarea" },
    ],
    summary: (row, catalog) => ({ title: str(row.title), sub: `${animalName(catalog, row.animal_id)} · ${relativeTime(str(row.occurred_at))}`, archived: Boolean(row.voided_at) }),
  },
  {
    key: "feeder", catalog: "feeders", singular: "feeder item", plural: "Feeders", action: "Delete",
    fields: [
      { key: "preySpecies", column: "prey_species", label: "Prey species", type: "text", required: true, help: "rat, mouse…" },
      { key: "sizeClass", column: "size_class", label: "Size class", type: "text", required: true, help: "pinky, weaned, small…" },
      { key: "addedOn", column: "added_on", label: "Added on", type: "date", required: true },
      { key: "status", column: "status", label: "Status", type: "select", options: feederStatusOptions },
      { key: "notes", column: "notes", label: "Notes", type: "text" },
    ],
    summary: (row) => ({ title: `${str(row.prey_species)} · ${str(row.size_class)}`, sub: `added ${str(row.added_on)} · ${str(row.status)}`, archived: str(row.status) !== "available" }),
  },
];

function describeFrequency(row: Row): string {
  const frequency = str(row.frequency);
  if (frequency === "weekly") {
    try {
      const days = JSON.parse(str(row.weekdays_json) || "[]") as number[];
      return `Weekly · ${days.map((d) => weekdayNames[d]).join(", ")}`;
    } catch { return "Weekly"; }
  }
  if (frequency === "interval") return `Every ${str(row.interval_days)} days`;
  if (frequency === "monthly") {
    try {
      const days = JSON.parse(str(row.weekdays_json) || "[]") as number[];
      if (days.length === 1) {
        const occurrence = Number(row.day_of_month);
        const suffix = occurrence === 1 ? "st" : occurrence === 2 ? "nd" : occurrence === 3 ? "rd" : "th";
        return `Monthly · ${occurrence}${suffix} ${weekdayNames[days[0]]}`;
      }
    } catch { /* fall through to fixed calendar day */ }
    return `Monthly · day ${str(row.day_of_month)}`;
  }
  if (frequency === "once") return "One time";
  return "Daily";
}

// ── First-run Head Keeper setup ───────────────────────────────────────────────
export function SetupGate({ onReady }: { onReady: (viewer: Viewer, capabilities: Capability[]) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ code: string; viewer: Viewer; capabilities: Capability[] } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    const setupToken = token.trim();
    setToken("");
    if (!name || !setupToken) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Shed-Bootstrap-Token": setupToken },
        body: JSON.stringify({ displayName: name }),
      });
      const payload = (await response.json()) as { member?: Viewer; capabilities?: Capability[]; accessCode?: string; error?: string };
      if (!response.ok || !payload.member || !payload.capabilities || !payload.accessCode) {
        throw new Error(payload.error ?? "Setup couldn’t be completed.");
      }
      setRecovery({ code: payload.accessCode, viewer: payload.member, capabilities: payload.capabilities });
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup couldn’t be completed.");
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    return (
      <section className="auth-gate">
        <div className="auth-card">
          <span className="mini-mark" aria-hidden="true" />
          <h1>You’re the Head Keeper</h1>
          <p>Save this recovery access code somewhere safe. It’s shown once and lets you sign back in.</p>
          <div className="invite-reveal" role="status" style={{ textAlign: "left" }}>
            <b>Your recovery access code</b>
            <code>{recovery.code}</code>
            <small>Store it in a password manager. You can issue a new one later from Household access.</small>
          </div>
          <button onClick={() => onReady(recovery.viewer, recovery.capabilities)}>Enter Shed →</button>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-gate">
      <div className="auth-card">
        <span className="mini-mark" aria-hidden="true" />
        <h1>Welcome to Shed</h1>
        <p>Let’s set up the Head Keeper — the account that manages animals, care plans, and household access. The installer saved a one-time setup token in a hidden file. On the machine running Shed, print it with <code>grep SHED_BOOTSTRAP_TOKEN ~/shed/.env</code>.</p>
        <form onSubmit={submit}>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" aria-label="Your name" maxLength={40} />
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="One-time setup token" aria-label="One-time setup token" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <button disabled={busy}>{busy ? "Setting up…" : "Create Head Keeper"}</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

// ── Generic resource form ─────────────────────────────────────────────────────
function toFormValues(def: ResourceDef, row: Row | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of def.fields) {
    if (!row) {
      // New record: booleans off, plain selects default to their first option so
      // the control always shows a valid value (ref selects stay on "none").
      values[field.key] = field.type === "boolean" ? (field.default ? "true" : "false")
        : field.defaultValue ??
        (field.type === "select" && field.options?.length ? field.options[0]
        : "");
      continue;
    }
    const raw = row[field.column];
    if (field.type === "boolean") values[field.key] = bool(raw) ? "true" : "false";
    else if (field.type === "datetime") values[field.key] = raw ? toLocalDatetime(str(raw)) : "";
    else values[field.key] = str(raw);
  }
  return values;
}

function toLocalDatetime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Way back in when the Head Keeper access code is lost.
 *
 * The code is shown once and stored only as a hash, and every other recovery
 * route in the app runs through the Head Keeper, so there was no way back short
 * of editing the database by hand. The setup token is the right credential:
 * it already creates the Head Keeper, it sits in the install's own .env where
 * the keeper can read it, and whoever can read it can reach the database
 * anyway.
 */
export function RecoverAccessGate({ onRecovered }: { onRecovered: (viewer: Viewer, capabilities: Capability[]) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; viewer: Viewer; capabilities: Capability[] } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const setupToken = token.trim();
    setToken("");
    if (!setupToken) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Shed-Bootstrap-Token": setupToken },
        body: JSON.stringify({ recover: true }),
      });
      const payload = (await response.json()) as { member?: Viewer; capabilities?: Capability[]; accessCode?: string; error?: string };
      if (!response.ok || !payload.member || !payload.capabilities || !payload.accessCode) {
        throw new Error(payload.error ?? "That setup token was not accepted.");
      }
      setIssued({ code: payload.accessCode, viewer: payload.member, capabilities: payload.capabilities });
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "That setup token was not accepted.");
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <div className="invite-reveal" role="status" style={{ textAlign: "left" }}>
        <b>Your new Head Keeper access code</b>
        <code>{issued.code}</code>
        <small>Shown once. Save it, then continue. The previous code no longer works.</small>
        <button onClick={() => onRecovered(issued.viewer, issued.capabilities)}>Enter Shed →</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        Lost the Head Keeper access code?
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="recover-form">
      <p>
        Enter the setup token from your install to be issued a new Head Keeper
        access code. On the machine running Shed:
      </p>
      <code className="recover-hint">grep SHED_BOOTSTRAP_TOKEN ~/shed/.env</code>
      <input
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="Setup token"
        aria-label="Setup token"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button disabled={busy}>{busy ? "Checking…" : "Issue a new access code"}</button>
      <button type="button" className="ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

function ResourceForm({ def, catalog, editing, onClose, onSaved, defaults, presentation = "sheet", onCatalogRefresh }: {
  def: ResourceDef;
  catalog: Catalog;
  editing: Row | null;
  onClose: () => void;
  onSaved: (message: string, savedId?: string) => void;
  /** Pre-filled values for a new record, e.g. the animal you're already managing. */
  defaults?: Record<string, string>;
  /** "inline" drops the modal chrome so the form can sit inside a tab. */
  presentation?: "sheet" | "inline";
  /** Reload the catalog so a record created from inside this form appears. */
  onCatalogRefresh?: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...toFormValues(def, editing), ...(editing ? {} : defaults ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [removePlanSheet, setRemovePlanSheet] = useState(false);
  // Which field asked for a new related record, so the result can be selected.
  const [creatingFor, setCreatingFor] = useState<Field | null>(null);
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const visibleFields = def.fields.filter((field) => !field.showIf || field.showIf(values));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    for (const field of visibleFields) {
      if (field.required && !values[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }
    const data: Record<string, unknown> = {};
    for (const field of def.fields) {
      const visible = !field.showIf || field.showIf(values);
      const raw = values[field.key] ?? "";
      if (field.type === "boolean") { if (visible) data[field.key] = raw === "true"; continue; }
      if (!visible) continue;
      if (field.type === "number") data[field.key] = raw === "" ? null : Number(raw);
      else if (field.type === "datetime") data[field.key] = raw === "" ? null : new Date(raw).toISOString();
      else data[field.key] = raw.trim() === "" ? null : raw.trim();
    }
    setBusy(true);
    try {
      const response = await fetch("/api/manage", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource: def.key, id: editing ? str(editing.id) : undefined, data }),
      });
      const payload = (await response.json()) as { error?: string; id?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save.");
      const savedId = payload.id ?? (editing ? str(editing.id) : "");
      if (def.key === "lightingPlan" && savedId && planFile) {
        const upload = new FormData();
        upload.set("file", planFile);
        const uploadResponse = await fetch(`/api/lighting/plans/${encodeURIComponent(savedId)}/sheet`, { method: "POST", body: upload });
        const uploadPayload = (await uploadResponse.json()) as { error?: string };
        if (!uploadResponse.ok) throw new Error(uploadPayload.error ?? "The plan was saved, but its plan sheet could not be attached.");
      } else if (def.key === "lightingPlan" && savedId && removePlanSheet) {
        const removeResponse = await fetch(`/api/lighting/plans/${encodeURIComponent(savedId)}/sheet`, { method: "DELETE" });
        if (!removeResponse.ok) throw new Error("The plan was saved, but its old plan sheet could not be removed.");
      }
      onSaved(`${editing ? "Updated" : "Added"} ${def.singular}.`, savedId || undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn’t save.");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form className="sheet-body" onSubmit={submit}>
      {visibleFields.map((field) => (
        <label className={`field ${field.type === "textarea" ? "field-wide" : ""}`} key={field.key}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          <FieldInput
            field={field}
            value={values[field.key] ?? ""}
            values={values}
            catalog={catalog}
            onChange={(value) => set(field.key, value)}
            onCreateNew={field.type === "enclosureRef" ? () => setCreatingFor(field) : undefined}
          />
          {field.help && <small>{field.help}</small>}
          {field.warn?.(values) && <small className="field-warning">{field.warn(values)}</small>}
        </label>
      ))}
      {def.key === "lightingPlan" && (
        <div className="field field-wide">
          <span>Exported plan sheet</span>
          {editing?.plan_sheet_name && !removePlanSheet ? <a className="file-link" href={`/api/lighting/plans/${encodeURIComponent(str(editing.id))}/sheet`} target="_blank" rel="noreferrer">Open {str(editing.plan_sheet_name)} ↗</a> : null}
          <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { setPlanFile(event.target.files?.[0] ?? null); setRemovePlanSheet(false); }} />
          {editing?.plan_sheet_name && !planFile ? <label className="remove-file"><input type="checkbox" checked={removePlanSheet} onChange={(event) => setRemovePlanSheet(event.target.checked)} /> Remove the current attachment</label> : null}
          <small>PDF or image, up to 5 MB. Export the sheet from Light My Reptile and keep it with the plan.</small>
        </div>
      )}
      {error && <p className="form-error field-wide" role="alert">{error}</p>}
      <div className="sheet-actions field-wide">
        {/* Inline forms live in a tab, so there is nothing to cancel back to. */}
        {presentation === "sheet" && <button type="button" className="ghost" onClick={onClose}>Cancel</button>}
        <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : `Add ${def.singular}`}</button>
      </div>
    </form>
  );

  // A nested form for a record this one references. Rendered above the parent
  // so the parent's own values survive untouched while it is open.
  const nestedCreate = creatingFor && (
    <ResourceForm
      def={resourceDefs.find((entry) => entry.key === "enclosure")!}
      catalog={catalog}
      editing={null}
      onClose={() => setCreatingFor(null)}
      onSaved={async (_message, savedId) => {
        const field = creatingFor;
        setCreatingFor(null);
        // Pull the catalog forward so the new row is selectable, then select it.
        await onCatalogRefresh?.();
        if (field && savedId) set(field.key, savedId);
      }}
    />
  );

  if (presentation === "inline") return <div className="inline-form">{body}{nestedCreate}</div>;

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={`${editing ? "Edit" : "New"} ${def.singular}`} onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <h2>{editing ? "Edit" : "New"} {def.singular}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {body}
      </div>
      {nestedCreate}
    </div>
  );
}

const CREATE_NEW = "__create_new__";

function FieldInput({ field, value, values, catalog, onChange, onCreateNew }: {
  field: Field;
  value: string;
  /** The whole form, for fields that depend on another answer. */
  values: Record<string, string>;
  catalog: Catalog;
  onChange: (value: string) => void;
  /** Offered on reference pickers so a missing record can be made in place. */
  onCreateNew?: () => void;
}) {
  if (field.type === "textarea") return <textarea value={value} rows={3} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "boolean") return (
    <span className="toggle">
      <input type="checkbox" checked={value === "true"} onChange={(event) => onChange(event.target.checked ? "true" : "false")} />
      <i>{value === "true" ? "Yes" : "No"}</i>
    </span>
  );
  if (field.type === "select") return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {(field.options ?? []).map((option) => <option key={option} value={option}>{option === "" ? "—" : field.optionLabels?.[option] ?? option}</option>)}
    </select>
  );
  if (field.type === "animalRef" || field.type === "enclosureRef" || field.type === "lightingPlanRef" || field.type === "equipmentRef") {
    const rows = field.type === "animalRef" ? catalog.animals : field.type === "enclosureRef" ? catalog.enclosures : field.type === "lightingPlanRef" ? catalog.lightingPlans : catalog.equipment;
    return (
      <select
        value={value}
        onChange={(event) => {
          // Adding the first animal usually means the enclosure does not exist
          // yet. Rather than making the keeper abandon the form, build it here.
          if (event.target.value === CREATE_NEW) { onCreateNew?.(); return; }
          onChange(event.target.value);
        }}
      >
        <option value="">{field.optional ? "— none —" : "Select…"}</option>
        {rows.filter((row) => row.active === undefined || bool(row.active) || row.id === value).map((row) => (
          <option key={str(row.id)} value={str(row.id)}>{str(row.name)}{bool(row.active) ? "" : " (archived)"}</option>
        ))}
        {onCreateNew && <option value={CREATE_NEW}>+ Add a new {field.type === "enclosureRef" ? "enclosure" : "record"}…</option>}
      </select>
    );
  }
  if (field.type === "animalMulti") {
    // The animals this plan covers besides the one chosen above. Kept as a
    // list of toggles rather than a multi-select because a keeper is picking
    // "which of my geckos", and needs to see them all at once.
    const selected = parseAnimalIds(value);
    const primary = str(values.animalId ?? "");
    const toggle = (id: string) => {
      const next = selected.includes(id) ? selected.filter((current) => current !== id) : [...selected, id];
      onChange(next.length ? JSON.stringify(next) : "");
    };
    const choices = catalog.animals.filter((row) => bool(row.active) && str(row.id) !== primary);
    if (!choices.length) return <small>Add another animal first to cover more than one here.</small>;
    return (
      <span className="animal-picker">
        {choices.map((row) => (
          <button
            type="button"
            key={str(row.id)}
            className={selected.includes(str(row.id)) ? "on" : ""}
            onClick={() => toggle(str(row.id))}
          >
            {str(row.name)}
          </button>
        ))}
      </span>
    );
  }
  if (field.type === "weekdays") {
    let selected: number[] = [];
    try { selected = JSON.parse(value || "[]"); } catch { selected = []; }
    const toggle = (day: number) => {
      const next = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day].sort();
      onChange(JSON.stringify(next));
    };
    return (
      <span className="weekday-picker">
        {weekdayNames.map((name, day) => (
          <button type="button" key={name} className={selected.includes(day) ? "on" : ""} onClick={() => toggle(day)}>{name}</button>
        ))}
      </span>
    );
  }
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text";
  return <input type={inputType} value={value} step={field.step} onChange={(event) => onChange(event.target.value)} />;
}

// ── Getting-started guide ────────────────────────────────────────────────────
export function GettingStartedGuide({ summary, onOpenManager, onClose, onOpenHousehold }: {
  summary: SetupSummary;
  onOpenManager: (resource: ResourceKey) => void;
  onClose: () => void;
  onOpenHousehold: () => void;
}) {
  const steps = [
    { done: summary.enclosureCount > 0, title: "Add an enclosure", copy: "Record the physical habitat, its size, location, substrate, and bioactive status. You can skip this for now and attach it later.", action: "Add enclosure", resource: "enclosure" as ResourceKey },
    { done: summary.animalCount > 0, title: "Add an animal or community", copy: "Use one animal record per individual. For a shared habitat, you can also make a community record such as “Tree frog habitat.”", action: "Add animal", resource: "animal" as ResourceKey },
    { done: summary.scheduleCount > 0, title: "Create a care plan", copy: "Care plans are repeating routines. Choose daily, selected weekdays, every N days, monthly, or one time. They become tasks on Today.", action: "Add care plan", resource: "schedule" as ResourceKey },
    { done: summary.eventCount > 0, title: "Record the first care or measurement", copy: "Mark a Today task done, or add a History entry for care that already happened. Weights have their own record type so Shed can chart trends.", action: "Add history", resource: "event" as ResourceKey },
    { done: summary.keeperCount > 0, title: "Invite another keeper", copy: "Each person gets a private access code. Their completed tasks are credited by name, while only the Head Keeper can change records and schedules.", action: "Household access", onAction: onOpenHousehold },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Getting started with Shed">
      <header className="overlay-head">
        <div><b>Getting started</b><span>Build your first care list</span></div>
        <button className="sheet-close" onClick={onClose} aria-label="Close guide">✕</button>
      </header>
      <div className="overlay-body guide-body">
        <section className="guide-intro">
          <span className="mini-mark" aria-hidden="true" />
          <div><p className="eyebrow">{doneCount} of {steps.length} milestones</p><h1>From empty Shed to today’s care list</h1><p>Start with where an animal lives, add who lives there, then tell Shed what repeats. You can fill in detailed notes and equipment whenever you’re ready.</p></div>
        </section>
        <div
          className="guide-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-valuetext={`${doneCount} of ${steps.length} setup milestones complete`}
        ><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
        <div className="guide-steps">
          {steps.map((step, index) => (
            <article className={step.done ? "done" : ""} key={step.title}>
              <span className="guide-number">{step.done ? "✓" : index + 1}</span>
              <div><h2>{step.title}</h2><p>{step.copy}</p></div>
              <button onClick={() => step.onAction ? step.onAction() : onOpenManager(step.resource!)}>{step.done ? "View or add more" : step.action}</button>
            </article>
          ))}
        </div>
        <section className="record-cheatsheet">
          <h2>Where does each kind of information go?</h2>
          <div>
            <p><b>Care plan</b><span>Something expected to repeat, such as feeding every Wednesday.</span></p>
            <p><b>History</b><span>Something that happened once, such as a vet visit or enclosure change.</span></p>
            <p><b>Note</b><span>Reference information you want to keep, such as temperament or acquisition details.</span></p>
            <p><b>Equipment</b><span>UVB, heating, lighting, filters, and replacement dates.</span></p>
            <p><b>Weight</b><span>A dated measurement in grams, kept separately for trend tracking.</span></p>
            <p><b>Feeder</b><span>Prey inventory by species and size class for feeding forecasts.</span></p>
          </div>
        </section>
        <p className="guide-footer">Need installation help, backups, or phone setup? <a href="https://github.com/jlyfshhh/shed/blob/main/docs/SETUP.md" target="_blank" rel="noreferrer">Open the complete Shed guide</a>.</p>
      </div>
    </div>
  );
}

function LightingImportSheet({ catalog, onClose, onSaved }: { catalog: Catalog; onClose: () => void; onSaved: (message: string) => void }) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [enclosureId, setEnclosureId] = useState("");
  const [planName, setPlanName] = useState("");
  const [species, setSpecies] = useState("");
  const [plannedOn, setPlannedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<LightingImportPreview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fixtureValues, setFixtureValues] = useState<Record<string, { equipmentId: string; name: string; brand: string; model: string; installedOn: string; skip: boolean }>>({});
  const [derived, setDerived] = useState<Record<string, string>>({});
  const [updateDimensions, setUpdateDimensions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEnclosure = catalog.enclosures.find((item) => str(item.id) === enclosureId);
  const enclosureAnimalIds = new Set(catalog.animals.filter((animal) => str(animal.enclosure_id) === enclosureId).map((animal) => str(animal.id)));
  const availableEquipment = catalog.equipment.filter((item) => bool(item.active) && (
    str(item.enclosure_id) === enclosureId || enclosureAnimalIds.has(str(item.animal_id)) || (!item.enclosure_id && !item.animal_id)
  ));
  const setFixture = (key: string, field: string, value: string | boolean) => setFixtureValues((current) => ({
    ...current,
    [key]: { ...(current[key] ?? { equipmentId: "", name: "", brand: "", model: "", installedOn: "", skip: false }), [field]: value },
  }));

  const loadPreview = async () => {
    setBusy(true); setError(null); setPreview(null);
    try {
      const response = await fetch("/api/lighting/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", sourceUrl, enclosureId: enclosureId || undefined }) });
      const payload = await response.json() as { preview?: LightingImportPreview; warnings?: string[]; error?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.error ?? "Couldn’t read this shared setup.");
      setPreview(payload.preview); setWarnings(payload.warnings ?? []);
      if (!planName) setPlanName(`${selectedEnclosure ? str(selectedEnclosure.name) : payload.preview.animalName || "Enclosure"} lighting plan`);
      const next: typeof fixtureValues = {};
      for (const fixture of payload.preview.fixtures.filter((item) => item.enabled)) {
        // Re-use the equipment a previous import of this same lamp created,
        // matching on the catalog reference rather than on a typed name.
        const alreadySaved = availableEquipment.find((item) => str(item.source_ref) === fixture.sourceRef);
        next[fixture.fixtureKey] = {
          equipmentId: alreadySaved ? str(alreadySaved.id) : "",
          name: fixture.product?.name ?? "",
          brand: fixture.product?.brand ?? "",
          model: fixture.product?.model ?? "",
          installedOn: "",
          skip: false,
        };
      }
      setFixtureValues(next);
    } catch (previewError) { setError(previewError instanceof Error ? previewError.message : "Couldn’t read this shared setup."); }
    finally { setBusy(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || !enclosureId || !planName.trim()) { setError("Preview the link, then choose an enclosure and plan name."); return; }
    const fixtures = preview.fixtures.filter((fixture) => fixture.enabled).map((fixture) => ({ fixtureKey: fixture.fixtureKey, ...fixtureValues[fixture.fixtureKey] }));
    for (const fixture of fixtures) if (!fixture.skip && !fixture.equipmentId && !fixture.name.trim()) { setError(`Name or match the ${fixture.fixtureKey} fixture.`); return; }
    const derivedPayload = Object.fromEntries(Object.entries(derived).map(([key, value]) => [key, value === "" ? undefined : key === "simulatorVersion" ? value : Number(value)]));
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/lighting/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import", sourceUrl, enclosureId, planName: planName.trim(), species: species.trim() || undefined, plannedOn, updateEnclosureDimensions: updateDimensions, fixtures, derived: derivedPayload }) });
      const payload = await response.json() as { imported?: boolean; equipmentCount?: number; error?: string };
      if (!response.ok || !payload.imported) throw new Error(payload.error ?? "Couldn’t import this setup.");
      onSaved(`Imported the lighting plan and linked ${payload.equipmentCount ?? 0} fixtures.`);
    } catch (importError) { setError(importError instanceof Error ? importError.message : "Couldn’t import this setup."); }
    finally { setBusy(false); }
  };

  const inch = (cm: number) => Math.round(cm / 2.54 * 10) / 10;
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Import Light My Reptile setup" onClick={onClose}>
      <div className="sheet lighting-import-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head"><div><h2>Import lighting setup</h2><small>From a Light My Reptile exact-setup link</small></div><button className="sheet-close" onClick={onClose} aria-label="Close">✕</button></header>
        <form className="sheet-body" onSubmit={submit}>
          {!preview && <section className="import-guide field-wide">
            <p className="import-guide-lede">Shed reads the layout straight from a Light My Reptile share link. Don’t have one yet? Build the setup there first — it opens in a new tab, so Shed stays open behind it.</p>
            <a className="import-guide-open" href="https://lightmyreptile.com/" target="_blank" rel="noreferrer">Open Light My Reptile ↗</a>
            <ol className="import-guide-steps">
              <li>Enter your enclosure size and animal, then add each lamp until the layout matches the real enclosure.</li>
              <li>Tap <b>FINISH</b> at the bottom, then choose <b>Link to this exact setup</b>.</li>
              <li>Copy the link, come back to this tab, and paste it below.</li>
            </ol>
          </section>}
          <label className="field field-wide"><span>Exact setup link *</span><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://lightmyreptile.com/#s=…" required /><small>The link looks like <code>lightmyreptile.com/#s=…</code>. A plain <code>lightmyreptile.com</code> address has no setup in it.</small></label>
          <label className="field"><span>Enclosure *</span><select value={enclosureId} onChange={(event) => { setEnclosureId(event.target.value); setPreview(null); }}><option value="">Select…</option>{catalog.enclosures.filter((item) => bool(item.active)).map((item) => <option key={str(item.id)} value={str(item.id)}>{str(item.name)}</option>)}</select></label>
          <div className="field preview-action"><span>Read configuration</span><button type="button" disabled={busy || !sourceUrl.trim()} onClick={() => void loadPreview()}>{busy && !preview ? "Reading…" : "Preview shared setup"}</button></div>
          {preview && <div className="import-preview field-wide">
            <header><div><b>{preview.enclosure.widthCm} × {preview.enclosure.depthCm} × {preview.enclosure.heightCm} cm</b><small>{inch(preview.enclosure.widthCm)} × {inch(preview.enclosure.depthCm)} × {inch(preview.enclosure.heightCm)} in · Level {preview.lightingLevel}</small></div><a href={preview.sourceUrl} target="_blank" rel="noreferrer">Open exact setup ↗</a></header>
            <div><span><small>Mounting</small><b>{preview.mountingMode === "external" ? "Above mesh" : preview.mountingMode}</b></span><span><small>Mesh blockage</small><b>{preview.meshBlockagePercent}%</b></span><span><small>Basking distance</small><b>{inch(preview.baskingDistanceCm)} in</b></span><span><small>Share format</small><b>v{preview.formatVersion}</b></span></div>
          </div>}
          {warnings.length > 0 && <div className="import-warnings field-wide">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          {preview && <>
            <label className="field"><span>Plan name *</span><input value={planName} onChange={(event) => setPlanName(event.target.value)} required /></label>
            <label className="field"><span>Species / community</span><input value={species} onChange={(event) => setSpecies(event.target.value)} /></label>
            <label className="field"><span>Planned on</span><input type="date" value={plannedOn} onChange={(event) => setPlannedOn(event.target.value)} /></label>
            <label className="field"><span>Simulator version</span><input value={derived.simulatorVersion ?? ""} onChange={(event) => setDerived((current) => ({ ...current, simulatorVersion: event.target.value }))} placeholder="e.g. v0.4.6" /></label>
            <section className="fixture-review field-wide"><h3>Match installed equipment</h3><p>Shed names each fixture from Light My Reptile’s own product list. Check them over — anything Shed didn’t recognise is flagged above and needs a name.</p>{preview.fixtures.filter((fixture) => fixture.enabled).map((fixture) => {
              const value = fixtureValues[fixture.fixtureKey] ?? { equipmentId: "", name: "", brand: "", model: "", installedOn: "", skip: false };
              return <article key={fixture.fixtureKey}><header><b>{fixture.role === "daylight" ? "LED / daylight" : fixture.role.toUpperCase()}</b><small>{fixture.product ? <b className="fixture-product">{fixture.product.name}</b> : null}{fixture.positionCm} cm across · {fixture.sourceRef}</small></header><label><span>Use saved equipment</span><select value={value.equipmentId} onChange={(event) => setFixture(fixture.fixtureKey, "equipmentId", event.target.value)} disabled={value.skip}><option value="">Create a new equipment record</option>{availableEquipment.map((item) => <option key={str(item.id)} value={str(item.id)}>{str(item.name)}</option>)}</select></label>{!value.equipmentId && !value.skip && <><label><span>Product name *</span><input value={value.name} onChange={(event) => setFixture(fixture.fixtureKey, "name", event.target.value)} /></label><label><span>Brand</span><input value={value.brand} onChange={(event) => setFixture(fixture.fixtureKey, "brand", event.target.value)} /></label><label><span>Model</span><input value={value.model} onChange={(event) => setFixture(fixture.fixtureKey, "model", event.target.value)} /></label><label><span>Installed on</span><input type="date" value={value.installedOn} onChange={(event) => setFixture(fixture.fixtureKey, "installedOn", event.target.value)} /></label></>}<label className="skip-fixture"><input type="checkbox" checked={value.skip} onChange={(event) => setFixture(fixture.fixtureKey, "skip", event.target.checked)} /> Don’t add this fixture</label></article>;
            })}</section>
            <details className="derived-review field-wide"><summary>Record the modeled results shown by Light My Reptile (optional)</summary><div>{[["modeledUvi", "Modeled UVI"], ["targetUviMin", "Target UVI minimum"], ["targetUviMax", "Target UVI maximum"], ["modeledLux", "Modeled lux"], ["targetLuxMin", "Target lux minimum"], ["targetLuxMax", "Target lux maximum"], ["modeledPowerDensity", "Modeled W/m²"], ["targetPowerDensityMin", "Target W/m² minimum"], ["targetPowerDensityMax", "Target W/m² maximum"]].map(([key, label]) => <label key={key}><span>{label}</span><input type="number" step="0.01" min="0" value={derived[key] ?? ""} onChange={(event) => setDerived((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div></details>
            <label className="field field-wide remove-file"><input type="checkbox" checked={updateDimensions} onChange={(event) => setUpdateDimensions(event.target.checked)} /> Update the saved enclosure dimensions to match this setup</label>
          </>}
          {error && <p className="form-error field-wide" role="alert">{error}</p>}
          <div className="sheet-actions field-wide"><button type="button" className="ghost" onClick={onClose}>Cancel</button>{preview && <button disabled={busy}>{busy ? "Importing…" : "Import reviewed setup"}</button>}</div>
        </form>
      </div>
    </div>
  );
}

// ── Management console ─────────────────────────────────────────────────────────
export function ManageConsole({ onClose, onChanged, toast, initialResource = "animal", focusAnimalId }: {
  onClose: () => void;
  onChanged: () => void;
  toast: (message: string) => void;
  initialResource?: ResourceKey;
  /**
   * Scope the whole console to one animal. "Edit" on a profile lands here, so
   * the keeper arrives at everything recorded for that animal — details, care
   * plans, lighting, notes — rather than on a form they have to cancel out of
   * before they can reach anything else.
   */
  focusAnimalId?: string;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ResourceKey>(initialResource);
  const [editing, setEditing] = useState<{ def: ResourceDef; row: Row | null } | null>(null);
  const [importingLighting, setImportingLighting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Animal id awaiting the "copy care plans from the same species" offer.
  const [suggestingFor, setSuggestingFor] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/manage", { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn’t load your records.");
      setCatalog((await response.json()) as Catalog);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn’t load your records.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const focusAnimal = focusAnimalId && catalog ? catalog.animals.find((row) => str(row.id) === focusAnimalId) ?? null : null;
  const focusEnclosureId = focusAnimal ? str(focusAnimal.enclosure_id) : "";
  const focusName = focusAnimal ? str(focusAnimal.name) : "";

  // Plain computation, not useMemo: these are tens of rows, and the React
  // Compiler memoizes it better than a hand-written dependency list would.
  const focusPlanIds = new Set(
    !catalog || !focusEnclosureId ? [] : catalog.lightingPlans.filter((row) => str(row.enclosure_id) === focusEnclosureId).map((row) => str(row.id)),
  );

  const tabs = !focusAnimalId ? resourceDefs : resourceDefs.filter((entry) => {
    // Feeders are a household-wide freezer, not one animal's record.
    if (entry.key === "feeder") return false;
    // Fixtures and measurements hang off a lighting plan; with no plan on this
    // animal's enclosure they could only ever be empty, so don't offer them.
    if (entry.key === "lightingFixture" || entry.key === "lightingMeasurement") return focusPlanIds.size > 0;
    return true;
  });
  const def = (tabs.find((entry) => entry.key === active) ?? tabs[0])!;

  /** Does this row belong to the animal we're scoped to? */
  const inFocus = (key: ResourceKey, row: Row): boolean => {
    if (!focusAnimalId) return true;
    switch (key) {
      case "animal": return str(row.id) === focusAnimalId;
      case "enclosure": return Boolean(focusEnclosureId) && str(row.id) === focusEnclosureId;
      case "schedule": case "weight": case "event": return str(row.animal_id) === focusAnimalId;
      // Notes and equipment attach to either the animal or the room it lives in.
      case "note": case "equipment":
        return str(row.animal_id) === focusAnimalId || (Boolean(focusEnclosureId) && str(row.enclosure_id) === focusEnclosureId);
      case "lightingPlan": return Boolean(focusEnclosureId) && str(row.enclosure_id) === focusEnclosureId;
      case "lightingFixture": case "lightingMeasurement": return focusPlanIds.has(str(row.plan_id));
      default: return true;
    }
  };

  /** Pre-fill a new record with the animal (and enclosure) already in hand. */
  const newDefaults = (key: ResourceKey): Record<string, string> | undefined => {
    if (!focusAnimalId) return undefined;
    switch (key) {
      case "schedule": case "weight": case "event": return { animalId: focusAnimalId };
      case "note": case "equipment": return { animalId: focusAnimalId, ...(focusEnclosureId ? { enclosureId: focusEnclosureId } : {}) };
      case "lightingPlan": return focusEnclosureId ? { enclosureId: focusEnclosureId } : undefined;
      default: return undefined;
    }
  };

  const rows = !catalog ? [] : catalog[def.catalog]
    .map((row) => ({ row, meta: def.summary(row, catalog) }))
    .filter((entry) => showArchived || !entry.meta.archived)
    .filter((entry) => inFocus(def.key, entry.row));

  // Grouped from the whole catalog rather than from `rows`, so hiding archived
  // entries cannot change a count of what is actually available.
  const feederCounts = !catalog || def.key !== "feeder" ? [] : Object.values(
    catalog.feeders
      .filter((row) => str(row.status) === "available")
      .reduce<Record<string, { label: string; count: number }>>((groups, row) => {
        const label = `${str(row.prey_species)} · ${str(row.size_class)}`;
        groups[label] = { label, count: (groups[label]?.count ?? 0) + 1 };
        return groups;
      }, {}),
  ).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  // The animal's own details are the landing tab, shown as the form itself —
  // a one-row list with an Edit button would just be another click.
  const showDetailsForm = Boolean(focusAnimal) && def.key === "animal";
  // Lighting hangs off the enclosure, so without one there is nothing to show.
  const needsEnclosure = Boolean(focusAnimalId) && !focusEnclosureId && (def.key === "enclosure" || def.key === "lightingPlan" || def.key === "lightingFixture" || def.key === "lightingMeasurement");

  const remove = async (row: Row) => {
    const meta = def.summary(row, catalog!);
    const verb = def.action.toLowerCase();
    let reason: string | null = "";
    if (def.action === "Void") {
      reason = window.prompt(`Void “${meta.title}”? This keeps it in history, marked as corrected. Optional reason:`, "");
      if (reason === null) return;
    } else if (!window.confirm(`${def.action} “${meta.title}”?${def.action === "Archive" ? " It’s hidden but kept for history." : " This can’t be undone."}`)) {
      return;
    }
    setBusyId(str(row.id));
    try {
      const response = await fetch("/api/manage", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource: def.key, id: str(row.id), reason: reason || undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t update.");
      toast(`${def.singular} ${verb}d.`);
      await load();
      onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Couldn’t update.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Manage records">
      <header className="overlay-head">
        <div>
          <b>{focusName || "Manage"}</b>
          <span>{focusAnimal ? "Details, care plans, lighting & records" : "Animals, enclosures, care plans & records"}</span>
        </div>
        <button className="sheet-close" onClick={onClose} aria-label="Close manager">✕</button>
      </header>
      <div className="overlay-body">
        <nav className="manage-tabs">
          {tabs.map((entry) => (
            <button key={entry.key} className={entry.key === def.key ? "on" : ""} onClick={() => setActive(entry.key)}>
              {focusAnimal && entry.key === "animal" ? "Details" : entry.plural}
            </button>
          ))}
        </nav>

        <div className="manage-toolbar">
          <h2>{showDetailsForm ? `${focusName}’s details` : def.plural}</h2>
          <div>
            {!showDetailsForm && <label className="archived-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived</label>}
            {/* Lighting plans only ever come from a Light My Reptile import, so
                that is the single way to add one. Existing plans stay editable. */}
            {showDetailsForm || needsEnclosure ? null : def.key === "lightingPlan"
              ? <button className="primary" onClick={() => setImportingLighting(true)}>+ Import lighting setup</button>
              : <button className="primary" onClick={() => setEditing({ def, row: null })}>+ New {def.singular}</button>}
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {!catalog ? (
          <p className="member-note">Loading…</p>
        ) : showDetailsForm ? (
          <ResourceForm
            key={str(focusAnimal!.id)}
            def={def}
            catalog={catalog}
            editing={focusAnimal}
            presentation="inline"
            onClose={() => undefined}
            onSaved={(message) => { toast(message); void load(); onChanged(); }}
          />
        ) : needsEnclosure ? (
          <div className="empty-card"><span>+</span><h3>No enclosure yet</h3><p>{focusName} isn’t attached to an enclosure. Add one under <b>Enclosures</b> in the full manager, then set it on the <b>Details</b> tab — lighting plans and enclosure records hang off it.</p></div>
        ) : rows.length === 0 ? (
          <div className="empty-card">
            <span>+</span>
            <h3>No {def.plural.toLowerCase()} yet{focusName ? ` for ${focusName}` : ""}</h3>
            <p>{def.key === "lightingPlan" ? "Import a Light My Reptile exact-setup link to add your first one." : `Add your first ${def.singular} to get started.`}</p>
            {/* An animal added before this offer existed — or one whose plans were
                all archived — can still pull its species' routines across. */}
            {def.key === "schedule" && focusAnimal && (
              <button className="primary" style={{ marginTop: 14 }} onClick={() => setSuggestingFor(str(focusAnimal.id))}>
                Copy routines from another {str(focusAnimal.species) || "animal"}
              </button>
            )}
          </div>
        ) : (
          <div className="manage-list">
            {/* Feeders are interchangeable within a size class now that weights
                are gone, so the useful question is "how many small rats are in
                the freezer", not which twenty rows they are. The rows stay
                below for editing a specific record. */}
            {def.key === "feeder" && feederCounts.length > 0 && (
              <div className="manage-row feeder-counts">
                <div className="manage-row-copy">
                  <b>In the freezer</b>
                  <small>
                    {feederCounts.map(({ label, count }) => `${count} × ${label}`).join(" · ")}
                  </small>
                </div>
              </div>
            )}
            {rows.map(({ row, meta }) => (
              <div className={`manage-row ${meta.archived ? "archived" : ""}`} key={str(row.id)}>
                <div className="manage-row-copy">
                  <b>{meta.title}{meta.archived && <i> · {def.action === "Void" ? "voided" : "archived"}</i>}</b>
                  <small>{meta.sub}</small>
                </div>
                <div className="manage-row-actions">
                  {def.action !== "Void" && <button disabled={busyId === str(row.id)} onClick={() => setEditing({ def, row })}>Edit</button>}
                  <button className="danger" disabled={busyId === str(row.id) || meta.archived} onClick={() => void remove(row)}>{def.action}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ResourceForm
          def={editing.def}
          catalog={catalog ?? { animals: [], enclosures: [], schedules: [], notes: [], equipment: [], weights: [], events: [], feeders: [], lightingPlans: [], lightingFixtures: [], lightingMeasurements: [] }}
          editing={editing.row}
          defaults={newDefaults(editing.def.key)}
          onClose={() => setEditing(null)}
          onCatalogRefresh={load}
          onSaved={(message, savedId) => {
            const created = !editing.row && editing.def.key === "animal" && savedId;
            setEditing(null);
            toast(message);
            // Deliberately not awaited: the sheet below opens straight away and
            // shows its own waiting state until this lands. Waiting here
            // instead would just move the empty gap earlier, leaving the keeper
            // staring at a closed form and no confirmation at all.
            void load();
            onChanged();
            // A brand-new animal has no care plans yet, and the household almost
            // certainly already keeps this species. Offer to copy those over
            // rather than leaving a blank Today list.
            if (created) setSuggestingFor(savedId);
          }}
        />
      )}
      {suggestingFor && catalog && (
        <CareRoutineSuggestions
          animalId={suggestingFor}
          catalog={catalog}
          toast={toast}
          onClose={() => setSuggestingFor(null)}
          onCreated={() => { void load(); onChanged(); }}
        />
      )}
      {importingLighting && catalog && <LightingImportSheet catalog={catalog} onClose={() => setImportingLighting(false)} onSaved={(message) => { setImportingLighting(false); toast(message); void load(); onChanged(); }} />}
    </div>
  );
}

// ── Animal profile (baseball card) ─────────────────────────────────────────────
type HusbandryScore = { percent: number | null; done: number; accountable: number; skipped: number; since: string; windowDays: number };
type AnimalProfileData = {
  animal: Row & { enclosureName?: string | null };
  husbandryScore?: HusbandryScore;
  weightHistory: Array<{ id: string; recordedOn: string; weightGrams: number }>;
  shedHistory: Array<{ id: string; recordedOn: string; quality: string; notes: string | null; recordedBy: string | null }>;
  notes: Array<{ id: string; category: string; title: string; body: string; pinned: number; createdBy: string; updatedAt: string }>;
  equipment: Array<{ id: string; category: string; name: string; brand: string | null; installedOn: string | null; inUseDays: number | null; scope: "animal" | "enclosure"; active: number }>;
  lighting: Array<{
    id: string; name: string; sourceName: string; sourceUrl: string; sourceVersion: string | null; plannedOn: string; mountingMode: string | null;
    meshLossPercent: number | null; baskingHeight: number | null; heightUnit: string; targetUviMin: number | null; targetUviMax: number | null;
    targetLuxMin: number | null; targetLuxMax: number | null; targetPowerDensityMin: number | null; targetPowerDensityMax: number | null;
    planSheetName: string | null; importStatus: string | null; importedAt: string | null; notes: string | null; status: "plan-only" | "due" | "verified" | "review";
    latestUvi: { value: number; unit: string; measuredAt: string } | null;
    fixtures: Array<{ id: string; role: string; equipmentName: string; brand: string | null; model: string | null; quantity: number; positionCm: number | null; mountingHeightCm: number | null }>;
    measurements: Array<{ id: string; metric: string; value: number; unit: string; measuredAt: string; position: string | null; instrument: string | null; measuredBy: string | null }>;
  }>;
  schedules: Array<{ id: string; title: string; taskType: string; frequency: string; active: number }>;
  tasks: Array<{ id: string; title: string; dueDate: string; complete: number; completedBy: string | null }>;
  history: Array<{ id: string; title: string; taskType: string; occurredAt: string; completedBy: string; notes: string | null; voidedAt: string | null; voidReason: string | null; outcome?: string | null; feederSpecies: string | null; feederSizeClass: string | null; feederWeightGrams: number | null }>;
};

export function AnimalProfile({
  animalId,
  onClose,
  onEdit,
  onPhotoChange,
  canWritePhoto = false,
  canRecordWeight = false,
  canRecordShed = false,
}: {
  animalId: string;
  onClose: () => void;
  onEdit?: () => void;
  onPhotoChange?: () => void;
  canWritePhoto?: boolean;
  canRecordWeight?: boolean;
  canRecordShed?: boolean;
}) {
  const [data, setData] = useState<AnimalProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWeight, setShowWeight] = useState(false);
  const [wDate, setWDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [wGrams, setWGrams] = useState("");
  const [wNotes, setWNotes] = useState("");
  const [wBusy, setWBusy] = useState(false);
  const [wError, setWError] = useState<string | null>(null);
  const [showShed, setShowShed] = useState(false);
  const [sDate, setSDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sQuality, setSQuality] = useState<ShedQuality>("complete");
  const [sNotes, setSNotes] = useState("");
  const [sBusy, setSBusy] = useState(false);
  const [sError, setSError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch(`/api/animals/${encodeURIComponent(animalId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn’t load this animal.");
      setData((await response.json()) as AnimalProfileData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn’t load this animal.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animalId]);

  const logWeight = async (event: FormEvent) => {
    event.preventDefault();
    const grams = Number(wGrams);
    if (!Number.isFinite(grams) || grams <= 0) { setWError("Enter a weight in grams."); return; }
    setWBusy(true);
    setWError(null);
    try {
      const response = await fetch("/api/weights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ animalId, recordedOn: wDate, weightGrams: grams, notes: wNotes.trim() || undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save the weight.");
      setWGrams("");
      setWNotes("");
      setShowWeight(false);
      await load();
    } catch (saveError) {
      setWError(saveError instanceof Error ? saveError.message : "Couldn’t save the weight.");
    } finally {
      setWBusy(false);
    }
  };

  const logShed = async (event: FormEvent) => {
    event.preventDefault();
    setSBusy(true);
    setSError(null);
    try {
      const response = await fetch("/api/sheds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ animalId, recordedOn: sDate, quality: sQuality, notes: sNotes.trim() || undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save the shed.");
      setSNotes("");
      setSQuality("complete");
      setShowShed(false);
      await load();
    } catch (saveError) {
      setSError(saveError instanceof Error ? saveError.message : "Couldn’t save the shed.");
    } finally {
      setSBusy(false);
    }
  };

  const animal = data?.animal;
  const peakWeight = data?.weightHistory.length ? Math.max(...data.weightHistory.map((w) => w.weightGrams)) : null;
  const lastShed = data?.shedHistory?.[0] ?? null;
  const photoUrl = animal ? animalPhotoUrl(animalId, animal.photoUpdatedAt ? str(animal.photoUpdatedAt) : null) : null;
  const profileFacts = animal
    ? animalFacts({
      name: str(animal.name),
      species: str(animal.species),
      group: str(animal.group),
      sex: animal.sex ? str(animal.sex) : null,
      location: animal.location ? str(animal.location) : null,
      enclosureName: animal.enclosureName ? str(animal.enclosureName) : null,
      weightGrams: typeof animal.weightGrams === "number" ? animal.weightGrams : Number(animal.weightGrams) || null,
      birthDate: animal.birthDate ? str(animal.birthDate) : null,
    }, todayIso())
    : [];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Animal profile">
      <header className="overlay-head">
        <div><b>{animal ? str(animal.name) : "Animal"}</b><span>{animal ? str(animal.species) : "Profile"}</span></div>
        <div className="overlay-head-actions">
          {onEdit && animal && <button className="profile-edit" onClick={onEdit}>Edit</button>}
          <button className="sheet-close" onClick={onClose} aria-label="Close profile">✕</button>
        </div>
      </header>
      <div className="overlay-body">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data || !animal ? (
          <p className="member-note">Loading…</p>
        ) : (
          <div className="profile">
            {/* With a real portrait the hero leads with it at full width. Without
                one there is only a species glyph, and blowing that up to banner
                size would be a lot of empty gradient, so the compact layout
                stays for animals that have no photo yet. */}
            <div className={photoUrl ? "profile-hero has-photo" : "profile-hero"}>
              <div className="profile-portrait">
                {photoUrl
                  // Served from our own API at a fixed small size; next/image would only add a hop.
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="profile-photo" src={photoUrl} alt={str(animal.name)} />
                  : <span className="profile-avatar" aria-hidden>{speciesGlyph(str(animal.species), str(animal.group))}</span>}
                {canWritePhoto && <AnimalPhotoControls animalId={animalId} hasPhoto={Boolean(photoUrl)} onChanged={async () => { await load(); onPhotoChange?.(); }} />}
              </div>
              {/* The name is already in the header above, which stays on screen
                  while this scrolls, so repeating it here just pushed the real
                  detail further down. What is left is what the header does not
                  say: the scientific name, the morph, and the chips. */}
              <div>
                <p className="profile-latin">
                  {str(animal.scientificName) || str(animal.species)}{animal.morph ? ` · ${str(animal.morph)}` : ""}
                  {!bool(animal.active) && <i className="archived-flag"> archived</i>}
                </p>
                <div className="profile-tags">
                  {profileFacts.map((fact) => <span key={fact.label}>{fact.symbol && <i className="chip-mark" aria-hidden>{fact.symbol}</i>}{fact.label}</span>)}
                </div>
              </div>
              {data.husbandryScore && (
                <div className={`husbandry-badge tier-${scoreTier(data.husbandryScore.percent)}`} title={data.husbandryScore.percent === null ? `No accountable care due yet in the tracking window${data.husbandryScore.skipped ? ` · ${data.husbandryScore.skipped} skipped` : ""}` : `${data.husbandryScore.done} of ${data.husbandryScore.accountable} accountable tasks completed${data.husbandryScore.skipped ? ` · ${data.husbandryScore.skipped} skipped` : ""}`}>
                  <b>{data.husbandryScore.percent === null ? "New" : `${data.husbandryScore.percent}%`}</b>
                  <small>Husbandry</small>
                  {data.husbandryScore.skipped ? <small>{data.husbandryScore.skipped} skipped</small> : null}
                </div>
              )}
            </div>

            <div className="profile-facts">
              {animal.birthDate ? <div><small>Born</small><b>{str(animal.birthDate)}</b></div> : null}
              {animal.acquiredDate ? <div><small>Acquired</small><b>{str(animal.acquiredDate)}</b></div> : null}
              {animal.source ? <div><small>Source</small><b>{str(animal.source)}</b></div> : null}
              {peakWeight ? <div><small>Peak weight</small><b>{peakWeight} g</b></div> : null}
            </div>

            {animal.notes ? <p className="profile-notes">{str(animal.notes)}</p> : null}

            {data.schedules.length > 0 && (
              <section className="profile-section">
                <h3>Care plans</h3>
                <div className="chip-list">{data.schedules.filter((s) => s.active).map((s) => <span key={s.id}>{s.title}</span>)}</div>
              </section>
            )}

            <section className="profile-section">
              <div className="profile-section-head">
                <h3>Weight history</h3>
                {canRecordWeight && <button className="mini-add" onClick={() => { setShowWeight((open) => !open); setWError(null); }}>{showWeight ? "Cancel" : "＋ Log weight"}</button>}
              </div>
              {canRecordWeight && showWeight && (
                <form className="weight-form" onSubmit={logWeight}>
                  <label>Date<input type="date" value={wDate} onChange={(event) => setWDate(event.target.value)} /></label>
                  <label>Weight (g)<input type="number" step="0.1" min="0" value={wGrams} onChange={(event) => setWGrams(event.target.value)} placeholder="grams" autoFocus /></label>
                  <label className="wide">Notes<input value={wNotes} onChange={(event) => setWNotes(event.target.value)} placeholder="optional" /></label>
                  <button disabled={wBusy}>{wBusy ? "Saving…" : "Save weight"}</button>
                </form>
              )}
              {wError && <p className="form-error">{wError}</p>}
              {data.weightHistory.length > 0 ? (
                <div className="profile-rows">
                  {data.weightHistory.slice(0, 12).map((w) => <div key={w.id}><b>{w.weightGrams} g</b><small>{w.recordedOn}</small></div>)}
                </div>
              ) : (
                <p className="member-note">{canRecordWeight ? "No weights recorded yet — log one to start a trend." : "No weights recorded yet."}</p>
              )}
            </section>

            <section className="profile-section">
              <div className="profile-section-head">
                <h3>Shed history</h3>
                {canRecordShed && <button className="mini-add" onClick={() => { setShowShed((open) => !open); setSError(null); }}>{showShed ? "Cancel" : "＋ Log shed"}</button>}
              </div>
              {canRecordShed && showShed && (
                <form className="weight-form" onSubmit={logShed}>
                  <label>Date<input type="date" value={sDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setSDate(event.target.value)} /></label>
                  <label>How did it come off?
                    <select value={sQuality} onChange={(event) => setSQuality(event.target.value as ShedQuality)} autoFocus>
                      {SHED_QUALITIES.map((quality) => <option key={quality} value={quality}>{SHED_QUALITY_LABELS[quality]}</option>)}
                    </select>
                  </label>
                  <label className="wide">Notes<input value={sNotes} onChange={(event) => setSNotes(event.target.value)} placeholder="optional" /></label>
                  <button disabled={sBusy}>{sBusy ? "Saving…" : "Save shed"}</button>
                </form>
              )}
              {sError && <p className="form-error">{sError}</p>}
              {data.shedHistory?.length ? (
                <div className="profile-rows">
                  {data.shedHistory.slice(0, 12).map((shed) => (
                    <div key={shed.id}>
                      <b>{SHED_QUALITY_LABELS[shed.quality as ShedQuality] ?? shed.quality}{isPoorShed(shed.quality) ? " ⚠" : ""}</b>
                      <small>{shed.recordedOn}{shed.recordedBy ? ` · ${shed.recordedBy}` : ""}{shed.notes ? ` · ${shed.notes}` : ""}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="member-note">{canRecordShed ? "No sheds logged yet — log one when you spot it." : "No sheds logged yet."}</p>
              )}
              {/* Intervals are the useful signal, but two dates are the minimum
                  needed to have one, so this only appears once there are two. */}
              {data.shedHistory?.length > 1 && (
                <p className="member-note">Last shed {lastShed?.recordedOn}, {shedIntervalDays(data.shedHistory)} days after the one before.</p>
              )}
            </section>

            {data.equipment.length > 0 && (
              <section className="profile-section">
                <h3>Equipment</h3>
                <div className="profile-rows">
                  {data.equipment.filter((e) => e.active).map((e) => {
                    const age = equipmentAgeLabel(e.inUseDays);
                    return <div key={e.id}><b>{e.name}</b><small>{e.category}{e.brand ? ` · ${e.brand}` : ""} · {e.scope}{age ? ` · ${age}` : " · install date unknown"}</small></div>;
                  })}
                </div>
              </section>
            )}

            {data.lighting.length > 0 && (
              <section className="profile-section">
                <h3>Lighting</h3>
                <div className="lighting-plans">
                  {data.lighting.map((plan) => (
                    <article className="lighting-plan" key={plan.id}>
                      <header>
                        <div><b>{plan.name}</b><small>{plan.sourceName}{plan.sourceVersion ? ` · ${plan.sourceVersion}` : ""}{plan.importStatus === "reviewed" ? " · imported & reviewed" : plan.importStatus === "modified" ? " · imported snapshot + local changes" : ""} · planned {plan.plannedOn}</small></div>
                        <span className={`lighting-status ${plan.status}`}>{plan.status === "verified" ? "Verified" : plan.status === "review" ? "Needs review" : plan.status === "due" ? "Measure now" : "Plan only"}</span>
                      </header>
                      <div className="lighting-targets">
                        {(plan.targetUviMin != null || plan.targetUviMax != null) && <span><small>Target UVI</small><b>{plan.targetUviMin ?? "—"}–{plan.targetUviMax ?? "—"}</b></span>}
                        {plan.latestUvi && <span><small>Latest UVI</small><b>{plan.latestUvi.value}</b></span>}
                        {(plan.targetLuxMin != null || plan.targetLuxMax != null) && <span><small>Target lux</small><b>{plan.targetLuxMin?.toLocaleString() ?? "—"}–{plan.targetLuxMax?.toLocaleString() ?? "—"}</b></span>}
                        {(plan.targetPowerDensityMin != null || plan.targetPowerDensityMax != null) && <span><small>Power density</small><b>{plan.targetPowerDensityMin ?? "—"}–{plan.targetPowerDensityMax ?? "—"} W/m²</b></span>}
                        {plan.baskingHeight != null && <span><small>Basking distance</small><b>{plan.baskingHeight} {plan.heightUnit}</b></span>}
                        {plan.meshLossPercent != null && <span><small>Mesh loss</small><b>{plan.meshLossPercent}%</b></span>}
                        {plan.mountingMode && <span><small>Mounting</small><b>{plan.mountingMode}</b></span>}
                      </div>
                      {plan.fixtures.length > 0 && <div className="lighting-fixtures">{plan.fixtures.map((fixture) => <span key={fixture.id}><b>{fixture.equipmentName}</b><small>{fixture.role}{fixture.quantity > 1 ? ` × ${fixture.quantity}` : ""}{fixture.positionCm != null ? ` · ${fixture.positionCm} cm position` : ""}</small></span>)}</div>}
                      <div className="lighting-actions">
                        <a href={plan.sourceUrl || "https://lightmyreptile.com/"} target="_blank" rel="noreferrer">View or edit exact setup ↗</a>
                        {plan.planSheetName && <a href={`/api/lighting/plans/${encodeURIComponent(plan.id)}/sheet`} target="_blank" rel="noreferrer">Open plan sheet ↗</a>}
                      </div>
                      {plan.notes && <p>{plan.notes}</p>}
                      {plan.measurements.length > 0 && <details><summary>Measurement history · {plan.measurements.length}</summary><div className="profile-rows">{plan.measurements.slice(0, 12).map((measurement) => <div key={measurement.id}><b>{measurement.value} {measurement.unit}</b><small>{measurement.metric} · {relativeTime(measurement.measuredAt)}{measurement.position ? ` · ${measurement.position}` : ""}</small></div>)}</div></details>}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {data.notes.length > 0 && (
              <section className="profile-section">
                <h3>Notes</h3>
                {data.notes.map((note) => (
                  <div className="profile-note-card" key={note.id}><b>{note.pinned ? "📌 " : ""}{note.title}</b><p>{note.body}</p><small>{note.createdBy} · {relativeTime(note.updatedAt)}</small></div>
                ))}
              </section>
            )}

            <section className="profile-section">
              <h3>History</h3>
              {data.history.length === 0 ? <p className="member-note">No recorded husbandry yet.</p> : (
                <div className="history-list">
                  {data.history.slice(0, 30).map((event) => (
                    <div className={`history-row ${event.voidedAt ? "voided" : ""}${event.outcome === "refused" ? " refused" : ""}`} key={event.id}>
                      <span className="history-dot" />
                      <p>
                        <b>{event.title}</b>{event.voidedAt ? <i> · corrected</i> : ""}{event.outcome === "refused" ? <em className="refused-tag">refused</em> : ""}
                        <small>{event.completedBy} · {relativeTime(event.occurredAt)}{event.feederWeightGrams ? ` · ${event.feederWeightGrams} g ${event.feederSizeClass ?? ""} ${event.feederSpecies ?? "feeder"}` : ""}{event.notes ? ` · ${event.notes}` : ""}{event.voidReason ? ` · ${event.voidReason}` : ""}</small>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Feeder forecast (read-only) ────────────────────────────────────────────────
export function BulkFeederIntake({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [preySpecies, setPreySpecies] = useState("rat");
  const [sizeClass, setSizeClass] = useState("small");
  const [count, setCount] = useState("");
  const [addedOn, setAddedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedCount = Number(count.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 500) {
      setError("Enter how many feeders you added, from 1 to 500.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/feeders/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preySpecies, sizeClass, count: parsedCount, addedOn, notes }),
      });
      const payload = (await response.json()) as { error?: string; count?: number };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t add the feeders.");
      onSaved(`Added ${payload.count ?? parsedCount} ${sizeClass} ${preySpecies}${parsedCount === 1 ? "" : "s"}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn’t add the feeders.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Bulk add feeders" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head"><h2>Add feeders</h2><button className="sheet-close" onClick={onClose} aria-label="Close">✕</button></header>
        <form className="sheet-body" onSubmit={submit}>
          <label className="field"><span>Prey species *</span><input value={preySpecies} onChange={(event) => setPreySpecies(event.target.value)} placeholder="rat or mouse" /></label>
          <label className="field"><span>Size class *</span><input value={sizeClass} onChange={(event) => setSizeClass(event.target.value)} placeholder="small, hopper, large pinky…" /></label>
          <label className="field"><span>Added on</span><input type="date" value={addedOn} onChange={(event) => setAddedOn(event.target.value)} /></label>
          <label className="field"><span>Batch note</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="optional vendor or shipment note" /></label>
          <label className="field"><span>How many *</span><input type="number" min={1} max={500} value={count} onChange={(event) => setCount(event.target.value)} placeholder="20" /><small>Feeders are counted by size class — no need to weigh them.</small></label>
          {error && <p className="form-error field-wide" role="alert">{error}</p>}
          <div className="sheet-actions field-wide"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button disabled={busy}>{busy ? "Adding…" : `Add ${Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : ""} feeder${parsedCount === 1 ? "" : "s"}`}</button></div>
        </form>
      </div>
    </div>
  );
}

type ForecastFeeder = { id: string; preySpecies: string; sizeClass: string | null };
type ForecastEvent = {
  animalId: string; animalName: string; feedingDate: string;
  preySpecies: string; preyDescription: string; preySizeClass: string | null;
  latestWeightGrams: number | null; predictedWeightGrams: number | null;
  weightTrendGramsPerDay: number | null; weightTrendConfidence: "none" | "low" | "medium" | "high";
  targetPreyGrams: number | null; minimumPreyGrams: number | null; maximumPreyGrams: number | null;
  allocatedFeeder: ForecastFeeder | null;
  status: "covered" | "shortage" | "buy-as-needed" | "inventory-untracked" | "weight-missing";
};
type ForecastAlert = { code: string; severity: "warning" | "info"; animalId?: string; animalName?: string; dueBy?: string; message: string };
export type FeederForecastData = {
  generatedFor: string; horizonDays: number; throughDate: string; orderNeeded: boolean;
  nextFeedings: ForecastEvent[]; events: ForecastEvent[]; alerts: ForecastAlert[];
  // Set while an order has been marked as placed and hasn't arrived yet.
  reorderAcknowledged?: boolean;
};

const forecastStatusLabel: Record<ForecastEvent["status"], string> = {
  covered: "In stock", shortage: "Short", "buy-as-needed": "Buy as needed",
  "inventory-untracked": "Not tracked", "weight-missing": "Needs weight",
};

const forecastDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

function ForecastRow({ event }: { event: ForecastEvent }) {
  const covered = event.status === "covered" && event.allocatedFeeder;
  return (
    <div className={`forecast-row status-${event.status}`}>
      <div className="forecast-when"><b>{forecastDate(event.feedingDate)}</b><small>{event.animalName}</small></div>
      <div className="forecast-what">
        <span>{event.preyDescription}</span>
        {event.targetPreyGrams != null && <small>~{Math.round(event.targetPreyGrams)} g target</small>}
      </div>
      {covered
        ? <span className="forecast-badge covered">{event.allocatedFeeder!.sizeClass} ready</span>
        : <span className={`forecast-badge ${event.status}`}>{forecastStatusLabel[event.status]}</span>}
    </div>
  );
}

export function FeederForecast({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<FeederForecastData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/feeders/forecast", { cache: "no-store" });
      if (response.status === 401) { setError("Sign in to Shed to see the feeder forecast."); return; }
      if (!response.ok) throw new Error("Couldn’t load the feeder forecast.");
      setData((await response.json()) as FeederForecastData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn’t load the feeder forecast.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Feeder forecast">
      <header className="overlay-head">
        <div><b>Feeding forecast</b><span>{data ? `Feeder needs · next ${data.horizonDays} days` : "Upcoming feeds & feeder stock"}</span></div>
        <button className="sheet-close" onClick={onClose} aria-label="Close forecast">✕</button>
      </header>
      <div className="overlay-body">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data && !error ? (
          <p className="member-note">Loading…</p>
        ) : data ? (
          <div className="forecast">
            <div className={`forecast-banner ${data.orderNeeded ? "warn" : "ok"}`}>
              <b>{data.orderNeeded ? "Reorder feeders soon" : "Inventory covers the forecast"}</b>
              <span>
                {data.orderNeeded
                  ? "Some scheduled feeds aren’t covered by current inventory — see below."
                  : `Every scheduled feed through ${forecastDate(data.throughDate)} has a feeder ready.`}
              </span>
            </div>

            {data.alerts.length > 0 && (
              <section className="profile-section">
                <h3>Attention</h3>
                <div className="forecast-alerts">
                  {data.alerts.map((alert, index) => (
                    <div key={`${alert.code}-${alert.animalId ?? "all"}-${alert.dueBy ?? ""}-${index}`} className={`forecast-alert ${alert.severity}`}>
                      <span>{alert.message}</span>
                      {alert.dueBy && <small>by {forecastDate(alert.dueBy)}</small>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="profile-section">
              <h3>Next feed per animal</h3>
              {data.nextFeedings.length ? (
                <div className="forecast-list">
                  {data.nextFeedings.map((event) => <ForecastRow key={event.animalId} event={event} />)}
                </div>
              ) : (
                <p className="member-note">No feeding plans with a prey type are set up yet. Add a feeding schedule and set its prey to forecast feeder needs.</p>
              )}
            </section>

            {data.events.length > data.nextFeedings.length && (
              <details className="report-details forecast-full">
                <summary>Full schedule · {data.events.length} feeds through {forecastDate(data.throughDate)}</summary>
                <div className="forecast-list">
                  {data.events.map((event, index) => <ForecastRow key={`${event.animalId}-${event.feedingDate}-${index}`} event={event} />)}
                </div>
              </details>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Backup restore ─────────────────────────────────────────────────────────────
export function RestorePanel({ onDone, toast }: { onDone: () => void; toast: (message: string) => void }) {
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Record<string, unknown> | null>(null);

  const readFile = async (file: File) => {
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (Number(parsed.schemaVersion) < 8) throw new Error("That file isn’t a Shed schema v8+ JSON export.");
      setBundle(parsed);
      setFileName(file.name);
    } catch (parseError) {
      setBundle(null);
      setFileName(null);
      setError(parseError instanceof Error ? parseError.message : "Couldn’t read that file.");
    }
  };

  const submit = async () => {
    if (!bundle) return;
    if (mode === "replace" && confirmation !== "REPLACE") { setError("Type REPLACE to confirm."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, confirmation: mode === "replace" ? confirmation : undefined, bundle }),
      });
      const payload = (await response.json()) as { imported?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Restore failed.");
      toast(`Restored ${payload.imported ?? 0} records (${mode}).`);
      setBundle(null);
      setFileName(null);
      setConfirmation("");
      onDone();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="restore">
      <label className="file-drop">
        <input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); }} />
        <span>{fileName ? `Selected: ${fileName}` : "Choose a Shed JSON backup…"}</span>
      </label>
      {bundle && (
        <>
          <div className="restore-modes">
            <label className={mode === "merge" ? "on" : ""}><input type="radio" name="restore-mode" checked={mode === "merge"} onChange={() => setMode("merge")} /><div><b>Merge</b><small>Add/update records from the backup, keep everything else.</small></div></label>
            <label className={mode === "replace" ? "on" : ""}><input type="radio" name="restore-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /><div><b>Replace</b><small>Wipe current husbandry data, then load the backup. Household credentials are kept.</small></div></label>
          </div>
          {mode === "replace" && (
            <input className="confirm-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Type REPLACE to confirm" aria-label="Type REPLACE to confirm" />
          )}
          <button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Restoring…" : "Restore backup"}</button>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

// ── Care routines for a newly added animal ───────────────────────────────────
// Adding an animal used to end on a blank Today list: the keeper had to rebuild
// every routine by hand, even though the household already keeps the species and
// the plans exist on its siblings. This offers those plans as a checklist.

/** Fields copied from a sibling's plan. Dates and identity are deliberately not. */


/** Human summary of when a plan repeats, so the checklist is readable. */
function scheduleCadence(row: Row): string {
  const frequency = str(row.frequency);
  if (frequency === "daily") return "every day";
  if (frequency === "interval") return `every ${str(row.interval_days) || "?"} days`;
  if (frequency === "once") return `once on ${str(row.start_date)}`;
  if (frequency === "weekly" || frequency === "monthly") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let days: number[] = [];
    try { days = JSON.parse(str(row.weekdays_json) || "[]"); } catch { days = []; }
    const listed = days.map((day) => names[day] ?? "?").join(", ");
    if (frequency === "weekly") return listed ? `weekly on ${listed}` : "weekly";
    return listed ? `monthly on ${listed}` : `monthly on day ${str(row.day_of_month) || "?"}`;
  }
  return frequency || "custom";
}

/**
 * Distinct care plans kept for other animals of the same species.
 *
 * Deduplicated on title + task type: six ball pythons share one "Feed" routine
 * conceptually, and the keeper wants to see it once, not six times.
 */
const numberOr = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const ageInDays = (birthDate: unknown, today: string): number | null => {
  const born = str(birthDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(born)) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${born}T00:00:00Z`)) / 86_400_000);
  return days >= 0 ? days : null;
};

/**
 * Which sibling's feeding plan suits this animal.
 *
 * A feeding plan encodes how much and how often for the animal it was written
 * for, and in this household those differ sharply by size — the light snakes eat
 * every 14 days at 10% of body weight, the heavy ones monthly at 5%. Copying an
 * arbitrary sibling's plan would hand a yearling an adult's schedule.
 *
 * So pick the sibling closest in weight; if the new animal has not been weighed
 * yet, closest in age. Both come from the household's own decisions rather than
 * any assumption of ours about the species.
 */
function closestSibling(
  candidates: Array<{ plan: Row; animal: Row }>,
  target: Row,
  today: string,
): { plan: Row; animal: Row; reason: string | null } {
  const targetWeight = numberOr(target.weight_grams);
  if (targetWeight) {
    const weighed = candidates.filter((c) => numberOr(c.animal.weight_grams));
    if (weighed.length) {
      const best = weighed.reduce((a, b) =>
        Math.abs(numberOr(a.animal.weight_grams)! - targetWeight) <= Math.abs(numberOr(b.animal.weight_grams)! - targetWeight) ? a : b);
      return { ...best, reason: `closest in weight to ${str(best.animal.name)}` };
    }
  }
  const targetAge = ageInDays(target.birth_date, today);
  if (targetAge !== null) {
    const aged = candidates.filter((c) => ageInDays(c.animal.birth_date, today) !== null);
    if (aged.length) {
      const best = aged.reduce((a, b) =>
        Math.abs(ageInDays(a.animal.birth_date, today)! - targetAge) <= Math.abs(ageInDays(b.animal.birth_date, today)! - targetAge) ? a : b);
      return { ...best, reason: `closest in age to ${str(best.animal.name)}` };
    }
  }
  return { ...candidates[0], reason: null };
}

function suggestedSchedules(catalog: Catalog, animal: Row): Array<{ row: Row; sharedBy: string[]; matchReason: string | null }> {
  const species = str(animal.species).trim().toLowerCase();
  if (!species) return [];
  const siblings = catalog.animals.filter(
    (other) => str(other.id) !== str(animal.id)
      && bool(other.active)
      && str(other.species).trim().toLowerCase() === species,
  );
  if (!siblings.length) return [];
  const today = todayIso();
  const siblingById = new Map(siblings.map((other) => [str(other.id), other]));
  const grouped = new Map<string, Array<{ plan: Row; animal: Row }>>();
  for (const plan of catalog.schedules) {
    const owner = siblingById.get(str(plan.animal_id));
    if (!bool(plan.active) || !owner) continue;
    // Feeding is grouped loosely on purpose: every sibling's feeding plan is a
    // candidate, and closestSibling picks the one that fits this animal. For
    // every other task the cadence IS the plan — a weekly and a daily "Mist
    // enclosure" are different jobs — and keying on the title alone collapsed
    // them into whichever happened to come first in the catalog.
    const key = str(plan.task_type) === "feeding"
      ? `feeding::${str(plan.title).trim().toLowerCase()}`
      : [
          str(plan.task_type),
          str(plan.title).trim().toLowerCase(),
          str(plan.frequency),
          str(plan.interval_days),
          str(plan.weekdays_json),
          str(plan.day_of_month),
          str(plan.details).trim().toLowerCase(),
        ].join("::");
    grouped.set(key, [...(grouped.get(key) ?? []), { plan, animal: owner }]);
  }
  return [...grouped.values()].map((candidates) => {
    const sharedBy = [...new Set(candidates.map((c) => str(c.animal.name)))];
    // Only feeding is size-dependent; the rest are the same job on any animal.
    if (str(candidates[0].plan.task_type) !== "feeding") {
      // Every candidate in this group is now identical in cadence and detail,
      // so any of them copies the same plan. Sorting keeps the choice stable
      // between renders rather than leaving it to catalog order.
      const stable = [...candidates].sort((a, b) => str(a.plan.id).localeCompare(str(b.plan.id)));
      return { row: stable[0].plan, sharedBy, matchReason: null };
    }
    const best = closestSibling(candidates, animal, today);
    return { row: best.plan, sharedBy, matchReason: best.reason };
  }).sort((a, b) => str(a.row.title).localeCompare(str(b.row.title)));
}

export function CareRoutineSuggestions({ animalId, catalog, onClose, onCreated, toast }: {
  animalId: string;
  catalog: Catalog;
  onClose: () => void;
  onCreated: () => void;
  toast: (message: string) => void;
}) {
  const animal = catalog.animals.find((row) => str(row.id) === animalId);
  const suggestions = animal ? suggestedSchedules(catalog, animal) : [];
  // Track what the keeper has *un*ticked rather than what they have ticked.
  // A "chosen" set would have to be seeded from `suggestions`, which is empty on
  // the first render — the catalog reload that adds the new animal lands a beat
  // later — leaving every box unchecked. Inverting removes the sync entirely.
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable for the life of this sheet, so a retry after a failed or lost
  // response is recognised as the same request rather than a new one. It has to
  // sit above the early return — hooks must run in the same order every render.
  const requestKey = useRef(crypto.randomUUID());

  if (!animal) {
    // Reached when the catalog reload is still in flight, or failed. Rendering
    // nothing is indistinguishable from the save having silently failed, so
    // stay on screen and stay closable.
    return (
      <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Care routines">
        <div className="sheet suggest-sheet" onClick={(event) => event.stopPropagation()}>
          <header className="sheet-head">
            <h2>Setting up care</h2>
            <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </header>
          <div className="sheet-body">
            <p>Saved. Loading the care routines you can copy…</p>
            <div className="sheet-actions field-wide">
              <button type="button" className="ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const name = str(animal.name);
  const isChosen = (id: string) => !deselected.has(id);
  const chosenCount = suggestions.filter(({ row }) => isChosen(str(row.id))).length;
  const feeding = suggestions.some(({ row }) => str(row.task_type) === "feeding" && isChosen(str(row.id)));
  const unweighed = !numberOr(animal.weight_grams);

  const toggle = (id: string) => setDeselected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const create = async () => {
    const picked = suggestions.filter(({ row }) => isChosen(str(row.id)));
    if (!picked.length) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      // One request, one transaction. This used to be a POST per plan, so a
      // failure part way through left some plans created and some not, and
      // pressing the button again duplicated the ones that had already worked.
      // The idempotency key makes a repeat return the first outcome instead of
      // copying a second time.
      const response = await fetch("/api/care/copy-routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          animalId,
          scheduleIds: picked.map(({ row }) => str(row.id)),
          idempotencyKey: requestKey.current,
        }),
      });
      const payload = (await response.json()) as { error?: string; created?: string[]; skipped?: string[] };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t create those care plans.");
      const added = payload.created?.length ?? 0;
      const already = payload.skipped?.length ?? 0;
      toast(
        already
          ? `Added ${added} care plan${added === 1 ? "" : "s"} for ${name}; ${already} already existed.`
          : `Added ${added} care plan${added === 1 ? "" : "s"} for ${name}.`,
      );
      onCreated();
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn’t create those care plans.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={`Care routines for ${name}`}>
      <div className="sheet suggest-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <div><h2>Set up care for {name}</h2><small>{str(animal.species)}</small></div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {suggestions.length === 0 ? (
          <div className="suggest-body">
            <p className="member-note">
              {name} is your first {str(animal.species) || "animal"} in Shed, so there are no
              existing routines to copy. Add care plans under <b>Care plans</b> whenever you’re ready —
              until then {name} won’t appear on Today.
            </p>
            <div className="sheet-actions"><button type="button" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <div className="suggest-body">
            <p className="suggest-lede">
              Your other {str(animal.species)}{suggestions[0].sharedBy.length > 1 ? "s" : ""} already
              have these routines. Tick the ones {name} needs and Shed will create them, starting today.
            </p>
            <ul className="suggest-list">
              {suggestions.map(({ row, sharedBy, matchReason }) => {
                const id = str(row.id);
                return (
                  <li key={id}>
                    <label>
                      <input type="checkbox" checked={isChosen(id)} onChange={() => toggle(id)} />
                      <span>
                        <b>{str(row.title)}</b>
                        <small>{scheduleCadence(row)} · {matchReason ? `sized to match — ${matchReason}` : `kept for ${sharedBy.slice(0, 3).join(", ")}${sharedBy.length > 3 ? ` +${sharedBy.length - 3}` : ""}`}</small>
                        {row.details ? <em>{str(row.details)}</em> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {feeding && (
              <p className="suggest-warn">
                {unweighed
                  ? <>No weight is recorded for {name} yet, so the feeding plan was matched on age instead
                      and its portions cannot be calculated until you weigh {name}. Log a weight from the
                      animal’s profile before the first feed.</>
                  : <>The feeding plan was matched to the {str(animal.species).toLowerCase()} closest to {name} in
                      size, and its portions are a percentage of body weight, so they follow {name}’s own
                      weight. Confirm the amount before the first feed.</>}
              </p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={onClose} disabled={busy}>Skip for now</button>
              <button type="button" onClick={() => void create()} disabled={busy}>
                {busy ? "Creating…" : chosenCount ? `Create ${chosenCount} care plan${chosenCount === 1 ? "" : "s"}` : "Skip"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
