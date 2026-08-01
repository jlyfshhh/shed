"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { equipmentAgeLabel } from "@/lib/equipment-age";

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
};
export type ResourceKey = "animal" | "enclosure" | "schedule" | "note" | "equipment" | "weight" | "event" | "feeder";
export type SetupSummary = {
  animalCount: number;
  enclosureCount: number;
  scheduleCount: number;
  eventCount: number;
  keeperCount: number;
};
type CatalogKey = keyof Catalog;

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const bool = (value: unknown): boolean => value === 1 || value === true || value === "1";
const linkedAppUrl = (port: number, sharedHabitatId: string): string => {
  const url = new URL(window.location.href);
  url.port = String(port);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("sharedHabitat", sharedHabitatId);
  return url.toString();
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
type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "boolean" | "select" | "weekdays" | "animalRef" | "enclosureRef";
type Field = {
  key: string; // camelCase write key
  column: string; // snake_case read column
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  default?: boolean; // initial value for boolean fields on a new record
  help?: string;
  step?: string;
  optional?: boolean; // ref selects that allow "none"
  showIf?: (values: Record<string, string>) => boolean;
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
const feederStatusOptions = ["available", "consumed", "discarded"];

const isFeeding = (values: Record<string, string>) => values.taskType?.toLowerCase() === "feeding";

const animalName = (catalog: Catalog, id: unknown) =>
  str(catalog.animals.find((a) => a.id === id)?.name) || "Unassigned";
const enclosureName = (catalog: Catalog, id: unknown) =>
  str(catalog.enclosures.find((enclosure) => enclosure.id === id)?.name) || "Unassigned";

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
      { key: "sharedHabitatId", column: "shared_habitat_id", label: "Shared habitat ID", type: "text", help: "Link a mixed habitat to Clarity with a shared id" },
      { key: "notes", column: "notes", label: "Notes", type: "textarea" },
    ],
    summary: (row) => ({ title: str(row.name), sub: `${str(row.enclosure_type) || "Enclosure"}${row.location ? ` · ${str(row.location)}` : ""}`, archived: !bool(row.active) }),
  },
  {
    key: "schedule", catalog: "schedules", singular: "care plan", plural: "Care plans", action: "Archive",
    fields: [
      { key: "animalId", column: "animal_id", label: "Animal", type: "animalRef", required: true },
      { key: "title", column: "title", label: "Task title", type: "text", required: true, help: "e.g. Feed, Mist, Water change" },
      { key: "taskType", column: "task_type", label: "Task type", type: "text", required: true, help: "feeding, misting, water, cleaning…" },
      { key: "details", column: "details", label: "Details", type: "text", help: "Short note shown on the task, e.g. “Every 2 weeks”" },
      { key: "frequency", column: "frequency", label: "Frequency", type: "select", options: frequencyOptions, required: true },
      { key: "weekdaysJson", column: "weekdays_json", label: "Days of week", type: "weekdays", showIf: (v) => v.frequency === "weekly" },
      { key: "intervalDays", column: "interval_days", label: "Every N days", type: "number", showIf: (v) => v.frequency === "interval", help: "1 = daily, 2 = every other day" },
      { key: "dayOfMonth", column: "day_of_month", label: "Day of month", type: "number", showIf: (v) => v.frequency === "monthly", help: "1–31" },
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
      { key: "weightGrams", column: "weight_grams", label: "Weight (grams)", type: "number", required: true, step: "0.1" },
      { key: "addedOn", column: "added_on", label: "Added on", type: "date", required: true },
      { key: "status", column: "status", label: "Status", type: "select", options: feederStatusOptions },
      { key: "notes", column: "notes", label: "Notes", type: "text" },
    ],
    summary: (row) => ({ title: `${str(row.prey_species)} · ${str(row.size_class)}`, sub: `${str(row.weight_grams)} g · ${str(row.status)}`, archived: str(row.status) !== "available" }),
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
  if (frequency === "monthly") return `Monthly · day ${str(row.day_of_month)}`;
  if (frequency === "once") return "One time";
  return "Daily";
}

// ── First-run Head Keeper setup ───────────────────────────────────────────────
export function SetupGate({ onReady }: { onReady: (viewer: Viewer) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ code: string; viewer: Viewer } | null>(null);

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
      const payload = (await response.json()) as { member?: Viewer; accessCode?: string; error?: string };
      if (!response.ok || !payload.member || !payload.accessCode) {
        throw new Error(payload.error ?? "Setup couldn’t be completed.");
      }
      setRecovery({ code: payload.accessCode, viewer: payload.member });
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
          <button onClick={() => onReady(recovery.viewer)}>Enter Shed →</button>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-gate">
      <div className="auth-card">
        <span className="mini-mark" aria-hidden="true" />
        <h1>Welcome to Shed</h1>
        <p>Let’s set up the Head Keeper — the account that manages animals, care plans, and household access. Use the one-time setup token the installer saved in your <code>.env</code>.</p>
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
        : field.type === "select" && field.options?.length ? field.options[0]
        : "";
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

function ResourceForm({ def, catalog, editing, onClose, onSaved }: {
  def: ResourceDef;
  catalog: Catalog;
  editing: Row | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => toFormValues(def, editing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save.");
      onSaved(`${editing ? "Updated" : "Added"} ${def.singular}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn’t save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <h2>{editing ? "Edit" : "New"} {def.singular}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <form className="sheet-body" onSubmit={submit}>
          {visibleFields.map((field) => (
            <label className={`field ${field.type === "textarea" ? "field-wide" : ""}`} key={field.key}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              <FieldInput field={field} value={values[field.key] ?? ""} catalog={catalog} onChange={(value) => set(field.key, value)} />
              {field.help && <small>{field.help}</small>}
            </label>
          ))}
          {error && <p className="form-error field-wide" role="alert">{error}</p>}
          <div className="sheet-actions field-wide">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : `Add ${def.singular}`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldInput({ field, value, catalog, onChange }: {
  field: Field;
  value: string;
  catalog: Catalog;
  onChange: (value: string) => void;
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
      {(field.options ?? []).map((option) => <option key={option} value={option}>{option === "" ? "—" : option}</option>)}
    </select>
  );
  if (field.type === "animalRef" || field.type === "enclosureRef") {
    const rows = field.type === "animalRef" ? catalog.animals : catalog.enclosures;
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{field.optional ? "— none —" : "Select…"}</option>
        {rows.filter((row) => bool(row.active) || row.id === value).map((row) => (
          <option key={str(row.id)} value={str(row.id)}>{str(row.name)}{bool(row.active) ? "" : " (archived)"}</option>
        ))}
      </select>
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
        <div className="guide-progress" aria-label={`${doneCount} of ${steps.length} setup milestones complete`}><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
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
            <p><b>Feeder</b><span>Prey inventory by type and weight for feeding forecasts.</span></p>
          </div>
        </section>
        <p className="guide-footer">Need installation help, backups, or phone setup? <a href="https://github.com/jlyfshhh/shed/blob/main/docs/SETUP.md" target="_blank" rel="noreferrer">Open the complete Shed guide</a>.</p>
      </div>
    </div>
  );
}

// ── Management console ─────────────────────────────────────────────────────────
export function ManageConsole({ onClose, onChanged, toast, initialResource = "animal" }: {
  onClose: () => void;
  onChanged: () => void;
  toast: (message: string) => void;
  initialResource?: ResourceKey;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ResourceKey>(initialResource);
  const [editing, setEditing] = useState<{ def: ResourceDef; row: Row | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const def = resourceDefs.find((entry) => entry.key === active)!;
  const rows = useMemo(() => {
    if (!catalog) return [];
    const list = catalog[def.catalog];
    return list.map((row) => ({ row, meta: def.summary(row, catalog) }))
      .filter((entry) => showArchived || !entry.meta.archived);
  }, [catalog, def, showArchived]);

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
        <div><b>Manage</b><span>Animals, enclosures, care plans & records</span></div>
        <button className="sheet-close" onClick={onClose} aria-label="Close manager">✕</button>
      </header>
      <div className="overlay-body">
        <nav className="manage-tabs">
          {resourceDefs.map((entry) => (
            <button key={entry.key} className={entry.key === active ? "on" : ""} onClick={() => setActive(entry.key)}>{entry.plural}</button>
          ))}
        </nav>

        <div className="manage-toolbar">
          <h2>{def.plural}</h2>
          <div>
            <label className="archived-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived</label>
            <button className="primary" onClick={() => setEditing({ def, row: null })}>+ New {def.singular}</button>
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {!catalog ? (
          <p className="member-note">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="empty-card"><span>+</span><h3>No {def.plural.toLowerCase()} yet</h3><p>Add your first {def.singular} to get started.</p></div>
        ) : (
          <div className="manage-list">
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
          catalog={catalog ?? { animals: [], enclosures: [], schedules: [], notes: [], equipment: [], weights: [], events: [], feeders: [] }}
          editing={editing.row}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); toast(message); void load(); onChanged(); }}
        />
      )}
    </div>
  );
}

// ── Animal profile (baseball card) ─────────────────────────────────────────────
type HusbandryScore = { percent: number | null; done: number; accountable: number; since: string; windowDays: number };
type AnimalProfileData = {
  animal: Row & { enclosureName?: string | null; sharedHabitatId?: string | null };
  husbandryScore?: HusbandryScore;
  weightHistory: Array<{ id: string; recordedOn: string; weightGrams: number }>;
  notes: Array<{ id: string; category: string; title: string; body: string; pinned: number; createdBy: string; updatedAt: string }>;
  equipment: Array<{ id: string; category: string; name: string; brand: string | null; installedOn: string | null; inUseDays: number | null; scope: "animal" | "enclosure"; active: number }>;
  schedules: Array<{ id: string; title: string; taskType: string; frequency: string; active: number }>;
  tasks: Array<{ id: string; title: string; dueDate: string; complete: number; completedBy: string | null }>;
  history: Array<{ id: string; title: string; taskType: string; occurredAt: string; completedBy: string; notes: string | null; voidedAt: string | null; voidReason: string | null; feederSpecies: string | null; feederSizeClass: string | null; feederWeightGrams: number | null }>;
};

export function AnimalProfile({ animalId, onClose }: { animalId: string; onClose: () => void }) {
  const [data, setData] = useState<AnimalProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWeight, setShowWeight] = useState(false);
  const [wDate, setWDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [wGrams, setWGrams] = useState("");
  const [wNotes, setWNotes] = useState("");
  const [wBusy, setWBusy] = useState(false);
  const [wError, setWError] = useState<string | null>(null);

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

  const animal = data?.animal;
  const peakWeight = data?.weightHistory.length ? Math.max(...data.weightHistory.map((w) => w.weightGrams)) : null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Animal profile">
      <header className="overlay-head">
        <div><b>{animal ? str(animal.name) : "Animal"}</b><span>{animal ? str(animal.species) : "Profile"}</span></div>
        <button className="sheet-close" onClick={onClose} aria-label="Close profile">✕</button>
      </header>
      <div className="overlay-body">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data || !animal ? (
          <p className="member-note">Loading…</p>
        ) : (
          <div className="profile">
            <div className="profile-hero">
              <span className="profile-avatar">{str(animal.name).slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{str(animal.name)}{!bool(animal.active) && <i className="archived-flag"> archived</i>}</h2>
                <p>{str(animal.scientificName) || str(animal.species)}{animal.morph ? ` · ${str(animal.morph)}` : ""}</p>
                <div className="profile-tags">
                  {animal.sex ? <span>{str(animal.sex)}</span> : null}
                  {animal.enclosureName ? <span>{str(animal.enclosureName)}</span> : null}
                  {animal.location ? <span>{str(animal.location)}</span> : null}
                  {animal.weightGrams ? <span>{str(animal.weightGrams)} g</span> : null}
                  {animal.sharedHabitatId ? <a href={linkedAppUrl(3001, str(animal.sharedHabitatId))}>Open linked tank in Clarity ↗</a> : null}
                </div>
              </div>
              {data.husbandryScore && (
                <div className={`husbandry-badge tier-${scoreTier(data.husbandryScore.percent)}`} title={data.husbandryScore.percent === null ? "No care due yet in the tracking window" : `${data.husbandryScore.done} of ${data.husbandryScore.accountable} scheduled tasks completed`}>
                  <b>{data.husbandryScore.percent === null ? "New" : `${data.husbandryScore.percent}%`}</b>
                  <small>Husbandry</small>
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
                <button className="mini-add" onClick={() => { setShowWeight((open) => !open); setWError(null); }}>{showWeight ? "Cancel" : "＋ Log weight"}</button>
              </div>
              {showWeight && (
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
                <p className="member-note">No weights recorded yet — log one to start a trend.</p>
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
                    <div className={`history-row ${event.voidedAt ? "voided" : ""}`} key={event.id}>
                      <span className="history-dot" />
                      <p>
                        <b>{event.title}</b>{event.voidedAt ? <i> · corrected</i> : ""}
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
  const [weights, setWeights] = useState("");
  const [addedOn, setAddedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedWeights = weights.trim() ? weights.trim().split(/[\s,;]+/).filter(Boolean) : [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const values = parsedWeights.map(Number);
    if (!values.length) { setError("Paste at least one feeder weight."); return; }
    if (values.some((value) => !Number.isInteger(value) || value < 1)) {
      setError("Every weight must be a whole number of grams.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/feeders/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preySpecies, sizeClass, weightsGrams: values, addedOn, notes }),
      });
      const payload = (await response.json()) as { error?: string; count?: number };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t add the feeders.");
      onSaved(`Added ${payload.count ?? values.length} ${sizeClass} ${preySpecies}${values.length === 1 ? "" : "s"}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn’t add the feeders.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Bulk add feeders" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head"><h2>Bulk add weighed feeders</h2><button className="sheet-close" onClick={onClose} aria-label="Close">✕</button></header>
        <form className="sheet-body" onSubmit={submit}>
          <label className="field"><span>Prey species *</span><input value={preySpecies} onChange={(event) => setPreySpecies(event.target.value)} placeholder="rat or mouse" /></label>
          <label className="field"><span>Size class *</span><input value={sizeClass} onChange={(event) => setSizeClass(event.target.value)} placeholder="small, hopper, large pinky…" /></label>
          <label className="field"><span>Added on</span><input type="date" value={addedOn} onChange={(event) => setAddedOn(event.target.value)} /></label>
          <label className="field"><span>Batch note</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="optional vendor or shipment note" /></label>
          <label className="field field-wide"><span>Individual weights in grams *</span><textarea rows={8} value={weights} onChange={(event) => setWeights(event.target.value)} placeholder={"40 42 41 59 43\nPaste spaces, commas, or one weight per line."} /><small>{parsedWeights.length ? `${parsedWeights.length} feeder${parsedWeights.length === 1 ? "" : "s"} ready to add` : "One inventory record will be created for each weight."}</small></label>
          {error && <p className="form-error field-wide" role="alert">{error}</p>}
          <div className="sheet-actions field-wide"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button disabled={busy}>{busy ? "Adding…" : `Add ${parsedWeights.length || ""} feeder${parsedWeights.length === 1 ? "" : "s"}`}</button></div>
        </form>
      </div>
    </div>
  );
}

type ForecastFeeder = { id: string; preySpecies: string; sizeClass: string | null; weightGrams: number };
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
        ? <span className="forecast-badge covered">{Math.round(event.allocatedFeeder!.weightGrams)} g ready</span>
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
