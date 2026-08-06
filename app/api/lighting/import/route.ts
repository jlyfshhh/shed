import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone, isIsoDate } from "@/lib/date";
import { requireHouseholdMember } from "@/lib/household-auth";
import { decodeLightMyReptileUrl, inches, unnamedFixtures, type LightMyReptileSnapshot } from "@/lib/light-my-reptile";

type FixtureResolution = {
  fixtureKey?: string;
  equipmentId?: string;
  name?: string;
  brand?: string;
  model?: string;
  installedOn?: string;
  skip?: boolean;
};

type DerivedResults = {
  simulatorVersion?: string;
  capturedAt?: string;
  modeledUvi?: number;
  modeledLux?: number;
  modeledPowerDensity?: number;
  targetUviMin?: number;
  targetUviMax?: number;
  targetLuxMin?: number;
  targetLuxMax?: number;
  targetPowerDensityMin?: number;
  targetPowerDensityMax?: number;
};

type ImportPayload = {
  action?: "preview" | "import";
  sourceUrl?: string;
  enclosureId?: string;
  planName?: string;
  species?: string;
  plannedOn?: string;
  notes?: string;
  updateEnclosureDimensions?: boolean;
  fixtures?: FixtureResolution[];
  derived?: DerivedResults;
};

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireHouseholdMember(request, db, ["Owner"]);
    if (auth.response) return auth.response;
    const payload = await request.json() as ImportPayload;
    const sourceUrl = text(payload.sourceUrl, "Light My Reptile share link", 4096);
    const snapshot = decodeLightMyReptileUrl(sourceUrl);
    const enclosure = payload.enclosureId
      ? await db.prepare("SELECT id, name, width, depth, height, dimension_unit AS dimensionUnit FROM enclosures WHERE id = ? AND active = 1").bind(payload.enclosureId).first<Record<string, unknown>>()
      : null;
    if (payload.enclosureId && !enclosure) return Response.json({ error: "Choose an active enclosure" }, { status: 400 });
    const warnings = previewWarnings(snapshot, enclosure);

    if ((payload.action ?? "preview") === "preview") {
      return Response.json({ preview: snapshot, warnings }, { headers: { "Cache-Control": "no-store" } });
    }

    const enclosureId = text(payload.enclosureId, "Enclosure", 100);
    const planName = text(payload.planName, "Plan name", 160);
    const plannedOn = payload.plannedOn?.trim() || dateInTimeZone();
    if (!isIsoDate(plannedOn)) return Response.json({ error: "Planned-on date must use YYYY-MM-DD" }, { status: 400 });
    const derived = normalizeDerived(payload.derived);
    const resolutions = new Map((payload.fixtures ?? []).map((resolution) => [resolution.fixtureKey?.trim(), resolution]));
    const enabledFixtures = snapshot.fixtures.filter((fixture) => fixture.enabled);
    const missing = enabledFixtures.filter((fixture) => !resolutions.has(fixture.fixtureKey));
    if (missing.length) {
      return Response.json({ error: `Review every enabled fixture before importing (${missing.map((fixture) => fixture.fixtureKey).join(", ")})` }, { status: 400 });
    }

    const now = new Date().toISOString();
    const planId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    const usedEquipment = new Set<string>();
    const fixtureLinks: Array<{ fixtureKey: string; equipmentId: string }> = [];

    for (const fixture of enabledFixtures) {
      const resolution = resolutions.get(fixture.fixtureKey)!;
      if (resolution.skip) continue;
      let equipmentId = resolution.equipmentId?.trim();
      if (equipmentId) {
        const existing = await db.prepare("SELECT q.id, q.enclosure_id AS enclosureId, q.animal_id AS animalId, a.enclosure_id AS animalEnclosureId, q.active FROM equipment q LEFT JOIN animals a ON a.id = q.animal_id WHERE q.id = ?")
          .bind(equipmentId).first<{ id: string; enclosureId: string | null; animalId: string | null; animalEnclosureId: string | null; active: number }>();
        if (!existing?.active) return Response.json({ error: `The equipment selected for ${fixture.fixtureKey} is unavailable` }, { status: 400 });
        if (existing.enclosureId && existing.enclosureId !== enclosureId) return Response.json({ error: `The equipment selected for ${fixture.fixtureKey} belongs to another enclosure` }, { status: 400 });
        if (existing.animalId && existing.animalEnclosureId !== enclosureId) return Response.json({ error: `The equipment selected for ${fixture.fixtureKey} belongs to an animal in another enclosure` }, { status: 400 });
      } else {
        // The catalog names the fixture; an explicit value from review still wins.
        const name = optionalText(resolution.name, 180) ?? fixture.product?.name;
        if (!name) throw new Error(`Equipment name for ${fixture.fixtureKey} is required`);
        const brand = optionalText(resolution.brand, 100) ?? fixture.product?.brand ?? null;
        const model = optionalText(resolution.model, 160) ?? fixture.product?.model ?? null;
        equipmentId = crypto.randomUUID();
        statements.push(db.prepare("INSERT INTO equipment (id, enclosure_id, category, name, brand, model, installed_on, source_name, source_ref, active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'Light My Reptile', ?, 1, ?, ?, ?)")
          .bind(equipmentId, enclosureId, fixtureCategory(fixture.role), name, brand, model, validOptionalDate(resolution.installedOn), fixture.sourceRef, `Imported from ${snapshot.sourceUrl}`, now, now));
      }
      if (usedEquipment.has(equipmentId)) return Response.json({ error: "Choose a separate equipment record for each physical fixture" }, { status: 400 });
      usedEquipment.add(equipmentId);
      fixtureLinks.push({ fixtureKey: fixture.fixtureKey, equipmentId });
    }

    const storedSnapshot = JSON.stringify({ configuration: snapshot, derived, warnings, importedBy: auth.member!.displayName });
    statements.unshift(db.prepare("INSERT INTO lighting_plans (id, enclosure_id, name, species, source_name, source_url, source_version, planned_on, reviewed_on, mounting_mode, mesh_loss_percent, basking_height, height_unit, target_uvi_min, target_uvi_max, target_lux_min, target_lux_max, target_power_density_min, target_power_density_max, source_snapshot_json, import_status, imported_at, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'Light My Reptile', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reviewed', ?, ?, 1, ?, ?)")
      .bind(planId, enclosureId, planName, optionalText(payload.species, 160), snapshot.sourceUrl, `share-v${snapshot.formatVersion}${derived.simulatorVersion ? ` / ${derived.simulatorVersion}` : ""}`, plannedOn, plannedOn, displayMounting(snapshot.mountingMode), snapshot.meshBlockagePercent, snapshot.unitSystem === "imperial" ? inches(snapshot.baskingDistanceCm) : snapshot.baskingDistanceCm, snapshot.unitSystem === "imperial" ? "in" : "cm", derived.targetUviMin, derived.targetUviMax, derived.targetLuxMin, derived.targetLuxMax, derived.targetPowerDensityMin, derived.targetPowerDensityMax, storedSnapshot, now, optionalText(payload.notes, 2000), now, now));

    for (const link of fixtureLinks) {
      const fixture = snapshot.fixtures.find((candidate) => candidate.fixtureKey === link.fixtureKey)!;
      const placementNotes = [
        `${fixture.mountingMode} mounting`,
        fixture.cageEnabled ? `cage blockage ${fixture.cageBlockagePercent}%` : null,
        fixture.domeOffsetCm != null ? `dome offset ${fixture.domeOffsetCm} cm` : null,
        fixture.combinedPositionCm != null ? `combined-view position ${fixture.combinedPositionCm} cm` : null,
      ].filter(Boolean).join(" · ");
      statements.push(db.prepare("INSERT INTO lighting_plan_fixtures (id, plan_id, equipment_id, role, position_cm, mounting_height_cm, quantity, source_ref, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), planId, link.equipmentId, fixture.role, fixture.positionCm, snapshot.baskingDistanceCm, fixture.sourceRef, placementNotes, now, now));
    }

    if (payload.updateEnclosureDimensions) {
      const useInches = snapshot.unitSystem === "imperial";
      statements.push(db.prepare("UPDATE enclosures SET width = ?, depth = ?, height = ?, dimension_unit = ?, updated_at = ? WHERE id = ?")
        .bind(useInches ? inches(snapshot.enclosure.widthCm) : snapshot.enclosure.widthCm, useInches ? inches(snapshot.enclosure.depthCm) : snapshot.enclosure.depthCm, useInches ? inches(snapshot.enclosure.heightCm) : snapshot.enclosure.heightCm, useInches ? "in" : "cm", now, enclosureId));
    }

    await db.batch(statements);
    await queueVerification(db, enclosureId, planName);
    return Response.json({ imported: true, planId, equipmentCount: fixtureLinks.length, warnings }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import this lighting setup" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

function previewWarnings(snapshot: LightMyReptileSnapshot, enclosure: Record<string, unknown> | null) {
  const warnings: string[] = [];
  const unnamed = unnamedFixtures(snapshot);
  if (unnamed.length) {
    warnings.push(`Shed doesn't recognise the catalog reference for ${unnamed.map((fixture) => fixture.fixtureKey).join(", ")} — name ${unnamed.length === 1 ? "it" : "them"} during review. ${unnamed.length === 1 ? "It is" : "They are"} probably newer than Shed's product list.`);
  }
  warnings.push("Calculated UVI, lux, and W/m² are not carried in the link — open the setup to read them, or measure them once the lamps are in.");
  if (enclosure) {
    const unit = enclosure.dimensionUnit === "cm" ? "cm" : "in";
    const expected = unit === "cm" ? snapshot.enclosure : { widthCm: inches(snapshot.enclosure.widthCm), depthCm: inches(snapshot.enclosure.depthCm), heightCm: inches(snapshot.enclosure.heightCm) };
    const actual = [Number(enclosure.width), Number(enclosure.depth), Number(enclosure.height)];
    const imported = [expected.widthCm, expected.depthCm, expected.heightCm];
    if (actual.every(Number.isFinite) && actual.some((value, index) => Math.abs(value - imported[index]) > 0.6)) warnings.push(`The shared ${imported.join(" × ")} ${unit} dimensions differ from the saved enclosure.`);
  }
  return warnings;
}

function normalizeDerived(input: DerivedResults | undefined): Required<DerivedResults> & Record<string, number | string | null> {
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const output = {
    simulatorVersion: optionalText(input?.simulatorVersion, 80), capturedAt: optionalText(input?.capturedAt, 80),
    modeledUvi: number(input?.modeledUvi), modeledLux: number(input?.modeledLux), modeledPowerDensity: number(input?.modeledPowerDensity),
    targetUviMin: number(input?.targetUviMin), targetUviMax: number(input?.targetUviMax), targetLuxMin: number(input?.targetLuxMin), targetLuxMax: number(input?.targetLuxMax),
    targetPowerDensityMin: number(input?.targetPowerDensityMin), targetPowerDensityMax: number(input?.targetPowerDensityMax),
  };
  for (const [minimum, maximum] of [["targetUviMin", "targetUviMax"], ["targetLuxMin", "targetLuxMax"], ["targetPowerDensityMin", "targetPowerDensityMax"]] as const) {
    if (output[minimum] != null && output[maximum] != null && output[minimum] > output[maximum]) throw new Error(`${minimum} cannot exceed ${maximum}`);
  }
  return output as Required<DerivedResults> & Record<string, number | string | null>;
}

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  if (value.trim().length > maximum) throw new Error(`${label} is too long`);
  return value.trim();
}

function optionalText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, maximum);
}

function validOptionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (!isIsoDate(value.trim())) throw new Error("Equipment installation dates must use YYYY-MM-DD");
  return value.trim();
}

function fixtureCategory(role: "uvb" | "heat" | "daylight") {
  return role === "uvb" ? "uvb" : role === "heat" ? "heat" : "lighting";
}

function displayMounting(value: LightMyReptileSnapshot["mountingMode"]) {
  return value === "external" ? "above mesh" : value;
}

async function queueVerification(db: D1Database, enclosureId: string, planName: string) {
  const residents = await db.prepare("SELECT id FROM animals WHERE enclosure_id = ? AND active = 1").bind(enclosureId).all<{ id: string }>();
  const dueDate = dateInTimeZone();
  for (const resident of residents.results) {
    const pending = await db.prepare("SELECT t.id FROM care_tasks t LEFT JOIN husbandry_events e ON e.task_id = t.id AND e.voided_at IS NULL WHERE t.animal_id = ? AND t.task_type = 'lighting' AND t.title = 'Verify lighting' AND e.id IS NULL LIMIT 1").bind(resident.id).first();
    if (!pending) await db.prepare("INSERT INTO care_tasks (id, animal_id, task_type, title, details, due_date) VALUES (?, ?, 'lighting', 'Verify lighting', ?, ?)")
      .bind(crypto.randomUUID(), resident.id, `Measure UVI after importing ${planName}`, dueDate).run();
  }
}
