import { createRandom, hashString, normalizeSeed } from "./random.ts";
import type {
  Grid,
  LodState,
  ObservationState,
  OrganizationState,
  RegionId,
  ResourceLedgerEntry,
  WorldOptions,
  WorldState,
} from "./types.ts";
import { createWorldviewState } from "./worldview/registry.ts";

const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 48;
const MIN_GRID_SIZE = 8;
const MAX_GRID_SIZE = 256;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalizeDimension = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(Math.trunc(value), MIN_GRID_SIZE, MAX_GRID_SIZE);
};

const makeGrid = (width: number, height: number, fill = 0): Grid => ({
  width,
  height,
  values: new Float32Array(width * height).fill(fill),
});

const hashCell = (seed: number, x: number, y: number): number => {
  const mixed =
    normalizeSeed(seed) ^
    Math.imul(x + 1, 0x45d9f3b) ^
    Math.imul(y + 1, 0x119de1f3);
  return hashString(String(mixed));
};

const baseElevation = (
  seed: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number => {
  const coarse = hashCell(seed, Math.floor(x / 4), Math.floor(y / 4)) / 0xffffffff;
  const fine = hashCell(seed ^ 0x9e3779b9, x, y) / 0xffffffff;
  const latitude = Math.abs(y / Math.max(1, height - 1) - 0.5) * 2;
  const longitudinalWave = Math.sin((x / width) * Math.PI * 4 + seed * 0.00001);
  return clamp(0.44 + coarse * 0.28 + fine * 0.12 + longitudinalWave * 0.06 - latitude * 0.06, 0, 1);
};

const createFields = (seed: number, width: number, height: number): WorldState["fields"] => {
  const elevation = makeGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      elevation.values[y * width + x] = baseElevation(seed, x, y, width, height);
    }
  }
  return {
    elevation,
    temperature: makeGrid(width, height),
    humidity: makeGrid(width, height),
    water: makeGrid(width, height),
    nutrients: makeGrid(width, height),
    biomass: makeGrid(width, height),
  };
};

const createChemistry = (width: number, height: number): WorldState["chemistry"] => ({
  carbon: makeGrid(width, height, 0.2),
  nitrogen: makeGrid(width, height, 0.12),
  phosphorus: makeGrid(width, height, 0.08),
  organics: makeGrid(width, height),
  oxygen: makeGrid(width, height, 0.01),
});

export const createWorld = (seed: number, options: WorldOptions = {}): WorldState => {
  const width = normalizeDimension(options.width, DEFAULT_WIDTH);
  const height = normalizeDimension(options.height, DEFAULT_HEIGHT);
  const normalizedSeed = normalizeSeed(seed);
  const emptyLod: LodState = { summaries: [], canonicalMicroRegionIds: [] };
  const emptyObservation: ObservationState = {};
  return {
    version: 1,
    seed: normalizedSeed,
    tick: 0,
    years: 0,
    random: createRandom(normalizedSeed),
    fields: createFields(normalizedSeed, width, height),
    chemistry: createChemistry(width, height),
    species: [],
    populations: [],
    agents: [],
    knowledge: [],
    relationships: [],
    cultures: [],
    organizations: [],
    resources: [],
    worldview: createWorldviewState(options.enabledPackIds ?? []),
    events: [],
    lod: emptyLod,
    observation: emptyObservation,
  };
};

const canonicalize = (value: unknown): unknown => {
  if (value instanceof Float32Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .filter((key) => key !== "observation")
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize(record[key]);
        return result;
      }, {});
  }
  return value;
};

const digestText = (value: unknown): string => {
  const input = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const worldDigest = (state: WorldState): string => digestText(state);

export const cloneWorld = (state: WorldState): WorldState => structuredClone(state);

export const assertBlankWorld = (state: WorldState): void => {
  const failures: string[] = [];
  if (state.species.length > 0) failures.push("species");
  if (state.populations.length > 0) failures.push("populations");
  if (state.agents.length > 0) failures.push("agents");
  if (state.knowledge.length > 0) failures.push("knowledge");
  if (state.relationships.length > 0) failures.push("relationships");
  if (state.cultures.length > 0) failures.push("cultures");
  if (state.organizations.length > 0) failures.push("organizations");
  if (state.worldview.entities.length > 0) failures.push("worldview.entities");
  if (state.resources.length > 0) failures.push("resources");
  if (failures.length > 0) {
    throw new Error(`World is not blank: ${failures.join(", ")}`);
  }
};

export const isFiniteWorld = (state: WorldState): boolean => {
  const grids = [
    ...Object.values(state.fields),
    ...Object.values(state.chemistry),
  ];
  return grids.every((grid) =>
    Array.from(grid.values).every((value) => Number.isFinite(value)),
  );
};

export const regionIdForCell = (x: number, y: number): RegionId =>
  `region:${x}:${y}` as RegionId;

export const emptyOrganization = (
  id: string,
  type: OrganizationState["type"],
  regionId: RegionId,
): OrganizationState => ({
  id: id as OrganizationState["id"],
  type,
  memberIds: [],
  childOrganizationIds: [],
  regionId,
  territoryRegionIds: [regionId],
  resources: {},
  status: "active",
});

export type { Grid, ResourceLedgerEntry };
