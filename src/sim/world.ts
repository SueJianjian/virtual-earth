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
import { createOrbitalState, isOrbitalState } from "./environment/orbit.ts";
import { defaultGovernanceFor } from "./society/organization.ts";
import { createEventArchive, MAX_STRATEGIC_ROUTE_SUMMARIES } from "./events/ledger.ts";
import { MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN } from "./health/disease.ts";
import { validAgentGenetics } from "./agents/genetics.ts";
import { MAX_BELIEFS_PER_AGENT } from "./agents/lifecycle.ts";
import { MAX_FACILITY_RECORDS } from "./society/facilities.ts";
import { MAX_RESOURCE_RECORDS } from "./resources.ts";
import { MAX_ARCHIVED_SPECIES_REGIONS, MAX_ARCHIVED_SPECIES_SUMMARIES } from "./ecology/archive.ts";
import { isArchivedOrganizationSummary, MAX_ARCHIVED_ORGANIZATION_SUMMARIES } from "./society/archive.ts";
import { isSimulationTimeline } from "./time.ts";
import { MAX_SUBSTANCE_RESERVE } from "./environment/substances.ts";
import { MAX_WORLDVIEW_INTERACTIONS, MAX_WORLDVIEW_PRACTICES } from "./worldview/archive.ts";
import { createClimateCycleState, isClimateCycleState } from "./environment/cycle.ts";
import { createTectonicState, isTectonicState } from "./environment/geology.ts";
import { createAtmosphereState, isAtmosphereState } from "./environment/atmosphere.ts";

const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 48;
const MIN_GRID_SIZE = 8;
const MAX_GRID_SIZE = 256;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const validTimelineStep = (value: unknown): boolean => value === undefined
  || (typeof value === "string" && /^\d+$/.test(value));

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
  const fields = createFields(normalizedSeed, width, height, formed);
  return {
    version: 1,
    seed: normalizedSeed,
    tick: 0,
    years: 0,
    orbital: createOrbitalState(normalizedSeed),
    climateCycle: createClimateCycleState(),
    random: createRandom(normalizedSeed),
    formation: formed ? completedPlanetFormationState(normalizedSeed) : createPlanetFormationState(normalizedSeed),
    tectonics: createTectonicState(normalizedSeed, width, height),
    atmosphere: createAtmosphereState(normalizedSeed, width, height),
    fields,
    chemistry: createChemistry(width, height, formed),
    substances: [],
    pathogens: [],
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

const digestText = (value: unknown): string => {
  let hash = 2166136261;
  const append = (input: string): void => {
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  const appendValue = (candidate: unknown, arrayItem = false): boolean => {
    if (candidate === null) {
      append("null");
      return true;
    }
    if (typeof candidate === "string") {
      append(JSON.stringify(candidate));
      return true;
    }
    if (typeof candidate === "number") {
      append(Number.isFinite(candidate) ? String(candidate) : "null");
      return true;
    }
    if (typeof candidate === "boolean") {
      append(candidate ? "true" : "false");
      return true;
    }
    if (typeof candidate === "undefined" || typeof candidate === "function" || typeof candidate === "symbol") {
      if (arrayItem) append("null");
      return arrayItem;
    }
    if (typeof candidate === "bigint") throw new TypeError("Cannot digest a BigInt value");
    if (candidate instanceof Float32Array || Array.isArray(candidate)) {
      append("[");
      for (let index = 0; index < candidate.length; index += 1) {
        if (index > 0) append(",");
        appendValue(candidate[index], true);
      }
      append("]");
      return true;
    }
    const record = candidate as Record<string, unknown>;
    append("{");
    let appended = 0;
    for (const key of Object.keys(record).filter((key) => key !== "observation" && !(key === "ecologicalRelationships" && Array.isArray(record[key]) && record[key].length === 0)).sort()) {
      const entry = record[key];
      if (typeof entry === "undefined" || typeof entry === "function" || typeof entry === "symbol") continue;
      if (appended > 0) append(",");
      append(JSON.stringify(key));
      append(":");
      appendValue(entry);
      appended += 1;
    }
    append("}");
    return true;
  };
  appendValue(value);
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const worldDigest = (state: WorldState): string => digestText(state);

export const cloneWorld = (state: WorldState): WorldState => structuredClone(state);

export const assertBlankWorld = (state: WorldState): void => {
  const failures: string[] = [];
  if (state.species.length > 0) failures.push("species");
  if (state.substances.length > 0) failures.push("substances");
  if (state.pathogens.length > 0) failures.push("pathogens");
  if (state.populations.length > 0) failures.push("populations");
  if (state.agents.length > 0) failures.push("agents");
  if (state.knowledge.length > 0) failures.push("knowledge");
  if (state.relationships.length > 0) failures.push("relationships");
  if ((state.ecologicalRelationships ?? []).length > 0) failures.push("ecologicalRelationships");
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
  const finiteClock = state.simulationDays === undefined
    || (Number.isSafeInteger(state.simulationDays) && state.simulationDays >= 0 && state.simulationDays <= Number.MAX_SAFE_INTEGER);
  const exactTimeline = state.timeline === undefined || isSimulationTimeline(state.timeline);
  const finiteOrbital = state.orbital === undefined || isOrbitalState(state.orbital);
  const finiteClimateCycle = state.climateCycle === undefined || isClimateCycleState(state.climateCycle);
  const finiteTectonics = isTectonicState(
    state.tectonics,
    state.fields.elevation.width,
    state.fields.elevation.height,
  );
  const finiteAtmosphere = isAtmosphereState(
    state.atmosphere,
    state.fields.elevation.width,
    state.fields.elevation.height,
  );
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
    substance.reserveCapacity,
    substance.remainingReserve,
    substance.extractedTotal,
    substance.depletedTick ?? 0,
    ...Object.values(substance.composition),
    ...Object.values(substance.properties),
  ].every(Number.isFinite)
    && (substance.originTimelineStep === undefined || /^\d+$/.test(substance.originTimelineStep))
    && (substance.discoveryTimelineStep === undefined || /^\d+$/.test(substance.discoveryTimelineStep))
    && substance.reserveCapacity >= 0
    && substance.reserveCapacity <= MAX_SUBSTANCE_RESERVE
    && substance.remainingReserve >= 0
    && substance.remainingReserve <= substance.reserveCapacity
    && substance.extractedTotal >= 0
    && substance.extractedTotal <= substance.reserveCapacity
    && (substance.depletedTimelineStep === undefined || /^\d+$/.test(substance.depletedTimelineStep)));
  const finitePathogens = state.pathogens.every((pathogen) => [
    pathogen.originTick,
    pathogen.originYears,
    pathogen.transmission,
    pathogen.severity,
    pathogen.persistence,
    pathogen.prevalence,
    pathogen.cumulativeCases,
    pathogen.cumulativeRecoveries,
    pathogen.cumulativeDeaths,
    pathogen.lastActiveTick,
  ].every(Number.isFinite)
    && (pathogen.originTimelineStep === undefined || /^\d+$/.test(pathogen.originTimelineStep))
    && (pathogen.lastActiveTimelineStep === undefined || /^\d+$/.test(pathogen.lastActiveTimelineStep))
    && Array.isArray(pathogen.regionalOutbreaks)
    && pathogen.regionalOutbreaks.length > 0
    && pathogen.regionalOutbreaks.length <= MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN
    && pathogen.regionalOutbreaks.every((outbreak) => [outbreak.prevalence, outbreak.firstDetectedTick, outbreak.lastActiveTick].every(Number.isFinite)
      && (outbreak.firstDetectedTimelineStep === undefined || /^\d+$/.test(outbreak.firstDetectedTimelineStep))
      && (outbreak.lastActiveTimelineStep === undefined || /^\d+$/.test(outbreak.lastActiveTimelineStep)))) && state.agents.every((agent) => [
    ...Object.values(agent.traits),
    agent.health?.vitality ?? 1,
    ...(agent.health?.infections.flatMap((infection) => [infection.infectedTick, infection.severity]) ?? []),
  ].every(Number.isFinite)
    && agent.beliefIds.length <= MAX_BELIEFS_PER_AGENT
    && agent.beliefIds.every((beliefId) => typeof beliefId === "string")
    && (agent.health?.infections ?? []).every((infection) => infection.infectedTimelineStep === undefined || /^\d+$/.test(infection.infectedTimelineStep))
    && (!agent.genetics || validAgentGenetics(agent.genetics)));
  const finiteSpecies = state.species.every((species) => validTimelineStep(species.originTimelineStep));
  const finiteKnowledge = state.knowledge.every((knowledge) => validTimelineStep(knowledge.originTimelineStep));
  const finiteCultures = state.cultures.every((culture) => !culture.identity || validTimelineStep(culture.identity.originTimelineStep));
  const finiteEcologicalRelationships = (state.ecologicalRelationships ?? []).every((relationship) => [
    relationship.strength,
    relationship.firstTick,
    relationship.lastTick,
    relationship.interactionCount,
    relationship.cumulativeImpact,
    relationship.lastImpact,
    ...Object.values(relationship.details),
  ].every((value) => typeof value !== "number" || Number.isFinite(value)));
  const finiteRelationships = state.relationships.every((relationship) => [
    relationship.createdTick,
    relationship.strength,
  ].every(Number.isFinite)
    && (relationship.createdTimelineStep === undefined || /^\d+$/.test(relationship.createdTimelineStep)));
  const resourceKeys = new Set<string>();
  const finiteResources = state.resources.length <= MAX_RESOURCE_RECORDS && state.resources.every((resource) => {
    const key = `${resource.resourceId}|${resource.regionId}|${resource.holderId ?? "world"}`;
    const unique = !resourceKeys.has(key);
    resourceKeys.add(key);
    return unique
      && Number.isFinite(resource.amount)
      && Number.isFinite(resource.cap)
      && resource.amount >= 0
      && resource.cap >= resource.amount
      && resource.cap <= Number.MAX_SAFE_INTEGER;
  });
  const finiteFacilities = state.facilities.length <= MAX_FACILITY_RECORDS && state.facilities.every((facility) => [
    facility.condition,
    facility.materialInvested,
    facility.plannedTick,
    facility.builtTick,
    facility.lastMaintainedTick,
    facility.lastIncidentTick,
    facility.lastInspectedEventTick ?? 0,
    facility.abandonedTick ?? 0,
  ].every(Number.isFinite));
  const finiteHistorySamples = state.eventArchive.historySamples.length <= 256 && state.eventArchive.historySamples.every((sample) => [
    sample.tick,
    sample.years,
    sample.meanTemperature,
    sample.oceanCoverage,
    sample.biomass,
    sample.oxygen,
    sample.organics,
    sample.populationCount,
    sample.speciesCount,
    sample.organizationCount,
    sample.facilityCount,
    sample.knowledgeCount,
    sample.foodSecurity,
    sample.diseasePrevalence,
    sample.annualMeanTemperature,
    sample.annualMeanHumidity,
    sample.annualMeanWater,
    sample.annualMeanSolarFlux,
    sample.annualMinimumTemperature,
    sample.annualMaximumTemperature,
    sample.annualSeasonalRange,
  ].every((value) => value === undefined || Number.isFinite(value)) && /^[0-9]+$/.test(sample.timelineStep) && /^[0-9]+$/.test(sample.timelineDays));
  const finiteArchivedSpecies = state.eventArchive.archivedSpeciesSummaries.length <= MAX_ARCHIVED_SPECIES_SUMMARIES
    && state.eventArchive.archivedSpeciesSummaries.every((summary) => [
      summary.lastKnownPopulation,
      summary.archivedTick,
      summary.archivedYears,
      ...Object.values(summary.traits),
      summary.blueprint.lifespanYears,
      summary.blueprint.adultScale,
      summary.blueprint.metabolicEfficiency,
      summary.blueprint.fecundity,
      summary.blueprint.thermalTolerance,
      summary.blueprint.hydrationRetention,
      summary.blueprint.mutationRate,
      summary.blueprint.inheritanceFidelity,
    ].every(Number.isFinite)
      && summary.lastKnownPopulation >= 0
      && summary.lastKnownRegionIds.length <= MAX_ARCHIVED_SPECIES_REGIONS
      && validTimelineStep(summary.originTimelineStep)
      && validTimelineStep(summary.archivedTimelineStep)
      && validTimelineStep(summary.archivedTimelineDays));
  const finiteArchivedOrganizations = state.eventArchive.archivedOrganizationSummaries.length <= MAX_ARCHIVED_ORGANIZATION_SUMMARIES
    && state.eventArchive.archivedOrganizationSummaries.every(isArchivedOrganizationSummary);
  const finiteStrategicRoutes = state.eventArchive.strategicRoutes.length <= MAX_STRATEGIC_ROUTE_SUMMARIES
    && state.eventArchive.strategicRoutes.every((route) => [
      route.cumulativeAmount,
      route.occurrenceCount,
      route.firstTick,
      route.firstYears,
      route.lastTick,
      route.lastYears,
    ].every((value) => value === undefined || Number.isFinite(value))
      && route.cumulativeAmount >= 0
      && Number.isInteger(route.occurrenceCount)
      && route.occurrenceCount > 0
      && route.fromId.length > 0
      && route.toId.length > 0
      && /^region:\d+:\d+$/.test(route.fromRegion)
      && /^region:\d+:\d+$/.test(route.toRegion)
      && route.fromRegion !== route.toRegion
      && (route.kind !== "trade" || route.resourceId !== undefined)
      && validTimelineStep(route.firstTimelineStep)
      && validTimelineStep(route.firstTimelineDays)
      && validTimelineStep(route.lastTimelineStep)
      && validTimelineStep(route.lastTimelineDays));
  const worldviewEntitiesById = new Map(state.worldview.entities.map((entity) => [entity.id, entity]));
  const finiteWorldviews = state.worldview.practices.length <= MAX_WORLDVIEW_PRACTICES && state.worldview.practices.every((practice) => [
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
    entity.propagationCount ?? 0,
    entity.conflictCount ?? 0,
    entity.fusionCount ?? 0,
    entity.lastInteractionTick ?? 0,
    ...Object.values(entity.resourceBalances),
  ].every(Number.isFinite)) && state.worldview.interactions.length <= MAX_WORLDVIEW_INTERACTIONS && state.worldview.interactions.every((interaction) => [
    interaction.originTick,
    interaction.lastInteractionTick,
    interaction.attempts,
    interaction.successes,
    interaction.failures,
    interaction.compatibility,
    interaction.intensity,
  ].every(Number.isFinite)
    && (interaction.targetRegionId === undefined || typeof interaction.targetRegionId === "string")
    && (interaction.transmittedBeliefId === undefined || typeof interaction.transmittedBeliefId === "string")
    && (interaction.transmittedPracticeId === undefined || typeof interaction.transmittedPracticeId === "string")
    && (interaction.governanceEffect === undefined || ["stabilizing", "destabilizing", "integrating"].includes(interaction.governanceEffect))
    && worldviewEntitiesById.get(interaction.sourceEntityId)?.regionId === interaction.regionId
    && worldviewEntitiesById.get(interaction.targetEntityId)?.regionId === (interaction.targetRegionId ?? interaction.regionId)
    && interaction.attempts >= 0
    && interaction.successes >= 0
    && interaction.failures >= 0
    && interaction.compatibility >= 0 && interaction.compatibility <= 1
    && interaction.intensity >= 0 && interaction.intensity <= 1);
  const finiteLod = state.lod.summaries.every((summary) => {
    const culture = summary.cultureSummary;
    const society = summary.societySummary;
    const summaryValues = [
      summary.version,
      summary.population,
      summary.socialPopulation ?? 0,
      summary.householdCount,
      summary.relationshipCount,
      summary.ecologicalRelationshipCount ?? 0,
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
    const finiteAgentRecords = summary.agentRecords.every((record) => [
      ...Object.values(record.traits ?? {}),
      ...Object.values(record.skills),
    ].every(Number.isFinite) && (!record.genetics || validAgentGenetics(record.genetics)));
    const finiteEcologyRecords = (summary.ecologicalRelationships ?? []).every((relationship) => [
      relationship.strength,
      relationship.firstTick,
      relationship.lastTick,
      relationship.interactionCount,
      relationship.cumulativeImpact,
      relationship.lastImpact,
    ].every(Number.isFinite));
    return [...summaryValues, ...cultureValues, ...societyValues].every(Number.isFinite) && finiteAgentRecords && finiteEcologyRecords;
  });
  return finiteClock && exactTimeline && finiteOrbital && finiteClimateCycle && finiteTectonics && finiteAtmosphere && finiteGrids && formationValues.every(Number.isFinite) && finiteSubstances && finitePathogens && finiteRelationships && finiteSpecies && finiteKnowledge && finiteCultures && finiteEcologicalRelationships && finiteResources && finiteFacilities && finiteHistorySamples && finiteArchivedSpecies && finiteArchivedOrganizations && finiteStrategicRoutes && finiteWorldviews && finiteLod;
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
