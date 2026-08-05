export type LightMyReptileFixture = {
  fixtureKey: string;
  sourceRef: string;
  sourceRefKind: "catalog-id" | "catalog-hash";
  role: "uvb" | "heat" | "daylight";
  enabled: boolean;
  positionCm: number;
  combinedPositionCm?: number;
  mountingMode: "external" | "internal";
  domeOffsetCm?: number;
  cageEnabled: boolean;
  cageBlockagePercent: number;
};

export type LightMyReptileSnapshot = {
  formatVersion: 1 | 2 | 3 | 4;
  sourceUrl: string;
  sharePayload: string;
  unitSystem: "imperial" | "metric";
  mountingMode: "external" | "internal" | "mixed";
  view: "basking" | "uvb" | "led" | "combined";
  lightingLevel: string;
  enclosure: { widthCm: number; depthCm: number; heightCm: number };
  platformHeightCm: number;
  baskingDistanceCm: number;
  animalBackHeightCm?: number;
  meshBlockagePercent: number;
  baskingAssistEnabled: boolean;
  combinedBaskingSpacingCm: number;
  animalProfileRef: string;
  animalName?: string;
  animalOrnament?: "hearts" | "suns";
  fixtures: LightMyReptileFixture[];
};

const LIGHT_MY_REPTILE_HOSTS = new Set(["lightmyreptile.com", "www.lightmyreptile.com"]);
const VIEWS = ["basking", "uvb", "led", "combined"] as const;
const MOUNTING_MODES = ["external", "internal", "mixed"] as const;
const LIGHTING_LEVELS = ["A", "B", "C", "D", "E", "F"];

class ByteReader {
  private offset = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  get remaining() { return this.bytes.length - this.offset; }
  u8() { if (this.remaining < 1) throw new Error("The shared setup is incomplete"); return this.bytes[this.offset++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  u24() { return (this.u8() << 16) | (this.u8() << 8) | this.u8(); }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  try {
    const decoded = atob(normalized);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("The Light My Reptile share data is not valid");
  }
}

function sourceHash(value: number): string {
  return `hash:${value.toString(16).padStart(6, "0")}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseShareUrl(rawUrl: string): { url: URL; payload: string; version: 1 | 2 | 3 | 4 } {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("Enter a complete Light My Reptile share link"); }
  if (url.protocol !== "https:" || !LIGHT_MY_REPTILE_HOSTS.has(url.hostname.toLocaleLowerCase())) {
    throw new Error("Only HTTPS share links from lightmyreptile.com can be imported");
  }
  const match = url.hash.match(/^#s=(.+)$/);
  if (!match) throw new Error("This link does not contain an exact shared setup");
  let payload: string;
  try { payload = decodeURIComponent(match[1]); } catch { throw new Error("The shared setup link is malformed"); }
  const version = Number(payload.slice(0, 1));
  if (![1, 2, 3, 4].includes(version) || payload[1] !== ".") throw new Error("This Light My Reptile share format is not supported yet");
  return { url, payload, version: version as 1 | 2 | 3 | 4 };
}

function binaryFixture(reader: ByteReader, role: "heat" | "daylight", index: number): LightMyReptileFixture {
  const sourceRef = sourceHash(reader.u24());
  const flags = reader.u8();
  return {
    fixtureKey: `${role}-${index + 1}`,
    sourceRef,
    sourceRefKind: "catalog-hash",
    role,
    enabled: Boolean(flags & 1),
    positionCm: reader.u16() / 2,
    mountingMode: flags & 4 ? "internal" : "external",
    domeOffsetCm: bounded(reader.u8() / 2, 0, 13),
    cageEnabled: Boolean(flags & 2),
    cageBlockagePercent: bounded(reader.u8() / 2, 0, 60),
  };
}

function decodeBinary(sourceUrl: string, payload: string, version: 2 | 3 | 4): LightMyReptileSnapshot {
  const bytes = decodeBase64Url(payload.slice(2));
  if (bytes.length < 27) throw new Error("The shared setup is incomplete");
  const reader = new ByteReader(bytes);
  const flags = reader.u8();
  const levelFlags = reader.u8();
  const counts = reader.u8();
  const baskingCount = counts & 15;
  const ledCount = counts >> 4;
  if (baskingCount === 0) throw new Error("The shared setup has no basking fixture");
  const fixedLength = 27 + baskingCount * 8 + ledCount * 10;
  const ornamentBytes = version === 4 ? 1 : 0;
  if (version === 2 && bytes.length !== fixedLength) throw new Error("The shared setup has an unexpected length");
  if (version >= 3) {
    if (bytes.length < fixedLength + 1) throw new Error("The shared setup is incomplete");
    const nameLength = bytes[fixedLength];
    if (bytes.length !== fixedLength + 1 + nameLength + ornamentBytes) throw new Error("The shared setup has an unexpected length");
  }

  const uvbRef = sourceHash(reader.u24());
  const animalProfileRef = sourceHash(reader.u24());
  const enclosure = { widthCm: reader.u16() / 2, depthCm: reader.u16() / 2, heightCm: reader.u16() / 2 };
  const uvbPositionCm = reader.u16() / 2;
  reader.u16(); // UVB position in the combined view; retained by Light My Reptile but not an installed-fixture position.
  const platformHeightCm = reader.u16() / 2;
  const combinedBaskingSpacingCm = reader.u16() / 2;
  const meshBlockagePercent = bounded(reader.u8() / 2, 0, 60);
  const uvbCageBlockagePercent = bounded(reader.u8() / 2, 0, 60);
  const animalBackHeightRaw = reader.u16();
  const fixtures: LightMyReptileFixture[] = [];
  for (let index = 0; index < baskingCount; index += 1) fixtures.push(binaryFixture(reader, "heat", index));
  for (let index = 0; index < ledCount; index += 1) {
    const fixture = binaryFixture(reader, "daylight", index);
    fixture.combinedPositionCm = reader.u16() / 2;
    fixtures.push(fixture);
  }

  let animalName: string | undefined;
  let animalOrnament: "hearts" | "suns" | undefined;
  if (version >= 3) {
    const nameLength = reader.u8();
    animalName = new TextDecoder().decode(bytes.subarray(fixedLength + 1, fixedLength + 1 + nameLength)).trim() || undefined;
    for (let index = 0; index < nameLength; index += 1) reader.u8();
  }
  if (version === 4) {
    const ornament = reader.u8();
    if (ornament !== 1 && ornament !== 2) throw new Error("The shared setup ornament is invalid");
    animalOrnament = ornament === 1 ? "hearts" : "suns";
  }

  fixtures.unshift({
    fixtureKey: "uvb-1",
    sourceRef: uvbRef,
    sourceRefKind: "catalog-hash",
    role: "uvb",
    enabled: true,
    positionCm: uvbPositionCm,
    mountingMode: flags & 128 ? "internal" : "external",
    cageEnabled: Boolean(flags & 64),
    cageBlockagePercent: uvbCageBlockagePercent,
  });

  return {
    formatVersion: version,
    sourceUrl,
    sharePayload: payload,
    unitSystem: flags & 1 ? "imperial" : "metric",
    mountingMode: MOUNTING_MODES[(flags >> 1) & 3] ?? "external",
    view: VIEWS[(flags >> 3) & 3] ?? "combined",
    lightingLevel: LIGHTING_LEVELS[levelFlags & 15] ?? "B",
    animalBackHeightCm: levelFlags & 16 ? animalBackHeightRaw / 2 : undefined,
    enclosure,
    platformHeightCm,
    baskingDistanceCm: Math.max(0, enclosure.heightCm - platformHeightCm),
    meshBlockagePercent,
    baskingAssistEnabled: Boolean(flags & 32),
    combinedBaskingSpacingCm,
    animalProfileRef,
    animalName,
    animalOrnament,
    fixtures,
  };
}

type LegacyLamp = [string, number, number, number?, number?];
type LegacySetup = {
  v?: number; b?: LegacyLamp[]; u?: string; c?: number | number[]; C?: number; k?: number[]; Y?: number; n?: number[];
  w?: string; a?: string; l?: string; e?: number[]; x?: number; X?: number; p?: number; m?: number; g?: number; s?: number;
  U?: string; M?: string; h?: number; A?: string; O?: string; L?: LegacyLamp[]; K?: number[]; N?: number[]; P?: number[];
};

function decodeLegacy(sourceUrl: string, payload: string): LightMyReptileSnapshot {
  let setup: LegacySetup;
  try { setup = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload.slice(2)))) as LegacySetup; }
  catch { throw new Error("The legacy shared setup is not valid JSON"); }
  if (setup.v !== 1 || !Array.isArray(setup.b) || setup.b.length === 0 || typeof setup.u !== "string" || typeof setup.a !== "string" || !Array.isArray(setup.e) || setup.e.length !== 3 || !setup.e.every(finite)) {
    throw new Error("The legacy shared setup is incomplete");
  }
  const lamp = (value: LegacyLamp, index: number, role: "heat" | "daylight"): LightMyReptileFixture => ({
    fixtureKey: `${role}-${index + 1}`,
    sourceRef: value[0], sourceRefKind: "catalog-id", role, enabled: value[1] !== 0, positionCm: value[2],
    mountingMode: (role === "heat" ? setup.n?.[index] : setup.N?.[index]) ? "internal" : "external",
    domeOffsetCm: bounded(finite(value[3]) ? value[3] : 1, 0, 13),
    cageEnabled: Boolean((role === "heat" ? setup.k?.[index] : setup.K?.[index]) ?? ((value[4] ?? 0) > 0)),
    cageBlockagePercent: bounded(finite(value[4]) ? value[4] : 0, 0, 60),
    ...(role === "daylight" && finite(setup.P?.[index]) ? { combinedPositionCm: setup.P![index] } : {}),
  });
  const fixtures = [
    { fixtureKey: "uvb-1", sourceRef: setup.u, sourceRefKind: "catalog-id" as const, role: "uvb" as const, enabled: true, positionCm: setup.x ?? 0, mountingMode: setup.Y ? "internal" as const : "external" as const, cageEnabled: Boolean(setup.C ?? ((Array.isArray(setup.c) ? setup.c[0] : setup.c) ?? 0) > 0), cageBlockagePercent: bounded(Array.isArray(setup.c) ? setup.c[0] ?? 0 : setup.c ?? 0, 0, 60) },
    ...setup.b.filter((value) => Array.isArray(value) && typeof value[0] === "string" && finite(value[2])).map((value, index) => lamp(value, index, "heat")),
    ...(setup.L ?? []).filter((value) => Array.isArray(value) && typeof value[0] === "string" && finite(value[2])).map((value, index) => lamp(value, index, "daylight")),
  ];
  const enclosure = { widthCm: setup.e[0], depthCm: setup.e[1], heightCm: setup.e[2] };
  const mountingMode = setup.M === "i" ? "internal" : setup.M === "m" ? "mixed" : "external";
  return {
    formatVersion: 1, sourceUrl, sharePayload: payload, unitSystem: setup.U === "i" ? "imperial" : "metric", mountingMode,
    view: setup.w === "b" ? "basking" : setup.w === "u" ? "uvb" : setup.w === "d" ? "led" : "combined",
    lightingLevel: setup.l ?? "B", enclosure, platformHeightCm: setup.p ?? 0, baskingDistanceCm: Math.max(0, enclosure.heightCm - (setup.p ?? 0)),
    animalBackHeightCm: finite(setup.h) ? setup.h : undefined, meshBlockagePercent: bounded(setup.m ?? 0, 0, 60), baskingAssistEnabled: setup.g !== 0,
    combinedBaskingSpacingCm: setup.s ?? 0, animalProfileRef: setup.a, animalName: typeof setup.A === "string" ? setup.A.trim() || undefined : undefined,
    animalOrnament: setup.O === "h" ? "hearts" : setup.O === "s" ? "suns" : undefined, fixtures,
  };
}

export function decodeLightMyReptileUrl(rawUrl: string): LightMyReptileSnapshot {
  const { url, payload, version } = parseShareUrl(rawUrl);
  const canonicalUrl = `${url.origin}${url.pathname}${url.search}#s=${encodeURIComponent(payload)}`;
  return version === 1 ? decodeLegacy(canonicalUrl, payload) : decodeBinary(canonicalUrl, payload, version);
}

export function inches(valueCm: number): number {
  return Math.round(valueCm / 2.54 * 10) / 10;
}
