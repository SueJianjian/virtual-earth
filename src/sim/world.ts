import { createRandom, normalizeSeed } from "./random.ts";
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
import { completedPlanetFormationState, createPlanetFormationState, formedElevation, primordialDustElevation } from "./environment/formation.ts";
import { defaultGovernanceFor } from "./society/organization.ts";
import { createEventArchive } from "./events/ledger.ts";

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

const createFields = (seed: number, width: number, height: number, formed: boolean): WorldState["fields"] => {
  const elevation = makeGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      elevation.values[y * width + x] = formed
        ? formedElevation(seed, x, y, width, height)
        : primordialDustElevation(seed, x, y);
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

const createChemistry = (width: number, height: number, formed: boolean): WorldState["chemistry"] => ({
  carbon: makeGrid(width, height, formed ? 0.2 : 0.08),
  nitrogen: makeGrid(width, height, formed ? 0.12 : 0.03),
  phosphorus: makeGrid(width, height, formed ? 0.08 : 0.04),
  organics: makeGrid(width, height),
  oxygen: makeGrid(width, height, formed ? 0.01 : 0),
});

export const createWorld = (seed: number, options: WorldOptions = {}): WorldState => {
  const width = normalizeDimension(options.width, DEFAULT_WIDTH);
  const height = normalizeDimension(options.height, DEFAULT_HEIGHT);
  const normalizedSeed = normalizeSeed(seed);
  const formed = options.formation === "formed";
  const emptyLod: LodState = { summaries: [], canonicalMicroRegionIds: [] };
  const emptyObservation: ObservationState = {};
  return {
    version: 1,
    seed: normalizedSeed,
    tick: 0,
    years: 0,
    random: createRandom(normalizedSeed),
    formation: formed ? completedPlanetFormationState(normalizedSeed) : createPlanetFormationState(normalizedSeed),
    fields: createFields(normalizedSeed, width, height, formed),
    chemistry: createChemistry(width, height, formed),
    substances: [],
    species: [],
    populations: [],
    agents: [],
    knowledge: [],
    relationships: [],
    cultures: [],
    organizations: [],
    facilities: [],
    resources: [],
    worldview: createWorldviewState(options.enabledPackIds ?? []),
    events: [],
    eventArchive: createEventArchive(),
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
  if (state.substances.length > 0) failures.push("substances");
  if (state.populations.length > 0) failures.push("populations");
  if (state.agents.length > 0) failures.push("agents");
  if (state.knowledge.length > 0) failures.push("knowledge");
  if (state.relationships.length > 0) failures.push("relationships");
  if (state.cultures.length > 0) failures.push("cultures");
  if (state.organizations.length > 0) failures.push("organizations");
  if (state.facilities.length > 0) failures.push("facilities");
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
  const finiteGrids = grids.every((grid) =>
    Array.from(grid.values).every((value) => Number.isFinite(value)),
  );
  const formationValues = Object.values(state.formation).filter((value): value is number => typeof value === "number");
  const finiteSubstances = state.substances.every((substance) => [
    substance.originTick,
    substance.originYears,
    substance.discoveryTick ?? 0,
    substance.discoveryYears ?? 0,
    ...Object.values(substance.composition),
    ...Object.values(substance.properties),
  ].every(Number.isFinite));
  const finiteWorldviews = state.worldview.practices.every((practice) => [
    practice.originTick,
    practice.lastTrainedTick,
    practice.attunement,
    practice.energy,
    practice.attempts,
    practice.failures,
  ].every(Number.isFinite)) && state.worldview.entities.every((entity) => [
    entity.influence,
    entity.supporterCount ?? 0,
    entity.activePractitionerCount ?? 0,
    entity.sponsorCount ?? 0,
    entity.viability ?? entity.influence,
    entity.lastStatusChangeTick ?? entity.originTick ?? 0,
    entity.lastActiveTick ?? 0,
    entity.dormantSinceTick ?? 0,
    entity.revivalCount ?? 0,
    ...Object.values(entity.resourceBalances),
  ].every(Number.isFinite));
  const finiteLod = state.lod.summaries.every((summary) => {
    const culture = summary.cultureSummary;
    const society = summary.societySummary;
    const summaryValues = [
      summary.version,
      summary.population,
      summary.socialPopulation ?? 0,
      summary.householdCount,
      summary.relationshipCount,
      summary.foodBalance,
      summary.foodPerAgent,
      summary.foodSecurity,
      summary.migrationRate,
      summary.random?.value,
    ];
    const cultureValues = culture ? [
      culture.beliefCount,
      culture.transmissionRate,
      culture.memoryStrength,
      culture.innovationCount,
      culture.lastChangeTick,
      ...(culture.identity?.values ? Object.values(culture.identity.values) : [Number.NaN]),
      ...(Array.isArray(culture.knowledge) ? culture.knowledge.flatMap((knowledge) => [knowledge.credibility, knowledge.transmissionCost, knowledge.forgettingRate, knowledge.originTick, knowledge.originYears]) : [Number.NaN]),
    ] : [];
    const societyValues = society ? [
      society.organizationCapacity,
      society.cohesion,
      society.stability,
      society.legitimacy,
      society.military,
      society.publicGoods,
      society.tradeVolume,
      society.conflictPressure,
      society.infrastructureLevel,
      society.lastChangeTick,
      ...Object.values(society.organizationCounts ?? {}),
    ] : [];
    return [...summaryValues, ...cultureValues, ...societyValues].every(Number.isFinite);
  });
  return finiteGrids && formationValues.every(Number.isFinite) && finiteSubstances && finiteWorldviews && finiteLod;
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
  governance: defaultGovernanceFor(type),
  diplomacy: {},
});

export type { Grid, ResourceLedgerEntry };
