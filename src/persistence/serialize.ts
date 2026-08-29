import { SAVE_SCHEMA_VERSION, isSaveEnvelope } from "./schema.ts";
import type { ArchivedOrganizationSummary, ArchivedSpeciesSummary, ClimateCycleState, EcologicalRelationshipState, EventMilestone, Grid, PathogenState, PlanetFormationState, SpeciesRole, StrategicRouteSummary, SubstanceState, WorldHistorySample, WorldState } from "../sim/types.ts";
import { completedPlanetFormationState } from "../sim/environment/formation.ts";
import { ensureSpeciesIdentity, isSpeciesBlueprint } from "../sim/ecology/blueprints.ts";
import { MAX_ARCHIVED_SPECIES_REGIONS, MAX_ARCHIVED_SPECIES_SUMMARIES, retainArchivedSpeciesSummaries } from "../sim/ecology/archive.ts";
import { ensureCultureIdentity } from "../sim/culture/identity.ts";
import { defaultGovernanceFor } from "../sim/society/organization.ts";
import { createEventArchive, MAX_EVENT_MILESTONES, MAX_HISTORY_SAMPLES, MAX_STRATEGIC_ROUTE_SUMMARIES, retainHistorySamples, retainStrategicRoutes } from "../sim/events/ledger.ts";
import { isSimulationTimeline, simulationDaysFromYears } from "../sim/time.ts";
import { MAX_PATHOGENS, normalizeAgentHealth, normalizePathogenState } from "../sim/health/disease.ts";
import { normalizeAgentGenetics, normalizeGeneticRecord } from "../sim/agents/genetics.ts";
import { MAX_ECOLOGICAL_RELATIONSHIPS } from "../sim/ecology/interactions.ts";
import { compactResourceRecords } from "../sim/resources.ts";
import { compactFacilityRecords } from "../sim/society/facilities.ts";
import { isArchivedOrganizationSummary, MAX_ARCHIVED_ORGANIZATION_SUMMARIES, retainArchivedOrganizationSummaries } from "../sim/society/archive.ts";
import { normalizeOrganizationDevelopment } from "../sim/society/development.ts";
import { addPersistentTotal, boundedPersistentTotal } from "../sim/numeric.ts";
import { MAX_SUBSTANCE_RESERVE, normalizeSubstanceReserve } from "../sim/environment/substances.ts";
import { createOrbitalState, isOrbitalState } from "../sim/environment/orbit.ts";
import { createClimateCycleState, isClimateCycleState } from "../sim/environment/cycle.ts";
import { createTectonicState, isTectonicState } from "../sim/environment/geology.ts";
import { isAtmosphereState, restoreAtmosphereState } from "../sim/environment/atmosphere.ts";
import { isOceanCoreState, isOceanState, restoreOceanState } from "../sim/environment/ocean.ts";

const encode = (value: unknown): unknown => {
  if (value instanceof Float32Array) return { __type: "Float32Array", values: Array.from(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).reduce<Record<string, unknown>>((result, key) => {
      result[key] = encode((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
};

const normalizedTimelineStep = (value: unknown, fallback: unknown): string => {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return value;
  if (typeof fallback === "string" && /^(0|[1-9]\d*)$/.test(fallback)) return fallback;
  if (typeof fallback === "number" && Number.isSafeInteger(fallback) && fallback >= 0) return String(fallback);
  return "0";
};

const decode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.__type === "Float32Array" && Array.isArray(record.values)) return new Float32Array(record.values.map(Number));
    return Object.keys(record).reduce<Record<string, unknown>>((result, key) => {
      result[key] = decode(record[key]);
      return result;
    }, {});
  }
  return value;
};

const isGrid = (value: unknown): value is Grid => {
  if (!value || typeof value !== "object") return false;
  const grid = value as Partial<Grid>;
  const width = grid.width;
  const height = grid.height;
  return typeof width === "number" && typeof height === "number" && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && grid.values instanceof Float32Array && grid.values.length === width * height;
};

const formationPhases = new Set<PlanetFormationState["phase"]>(["dust-cloud", "planetesimals", "accretion", "differentiation", "cooling", "stable-crust"]);
const isFormationState = (value: unknown): value is PlanetFormationState => {
  if (!value || typeof value !== "object") return false;
  const formation = value as Partial<PlanetFormationState>;
  const values = [formation.progress, formation.dustDensity, formation.bodyCount, formation.planetaryMass, formation.collisionEnergy, formation.coreFraction, formation.surfaceHeat, formation.atmosphere, formation.volatileFraction];
  return typeof formation.phase === "string"
    && formationPhases.has(formation.phase as PlanetFormationState["phase"])
    && values.every((item) => Number.isFinite(item));
};

const countRecord = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>((result, [key, count]) => {
    if (Number.isFinite(count) && Number(count) >= 0) result[key] = boundedPersistentTotal(Number(count));
    return result;
  }, {});
};

const validTimelineStep = (value: unknown): boolean => value === undefined
  || (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value));

const speciesRoles = new Set<SpeciesRole>(["producer", "consumer", "decomposer"]);
const isArchivedSpeciesSummary = (value: unknown): value is ArchivedSpeciesSummary => {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<ArchivedSpeciesSummary>;
  const traits = summary.traits;
  return typeof summary.id === "string"
    && (summary.name === undefined || typeof summary.name === "string")
    && typeof summary.role === "string"
    && speciesRoles.has(summary.role as SpeciesRole)
    && Boolean(traits)
    && typeof traits === "object"
    && !Array.isArray(traits)
    && Object.values(traits).every((trait) => Number.isFinite(trait))
    && (summary.parentId === undefined || typeof summary.parentId === "string")
    && (summary.originRegionId === undefined || typeof summary.originRegionId === "string")
    && (summary.originTick === undefined || Number.isFinite(summary.originTick))
    && validTimelineStep(summary.originTimelineStep)
    && (summary.originYears === undefined || Number.isFinite(summary.originYears))
    && isSpeciesBlueprint(summary.blueprint)
    && Number.isFinite(summary.lastKnownPopulation)
    && (summary.lastKnownPopulation ?? 0) >= 0
    && Array.isArray(summary.lastKnownRegionIds)
    && summary.lastKnownRegionIds.length <= MAX_ARCHIVED_SPECIES_REGIONS
    && summary.lastKnownRegionIds.every((regionId) => typeof regionId === "string")
    && Number.isFinite(summary.archivedTick)
    && validTimelineStep(summary.archivedTimelineStep)
    && validTimelineStep(summary.archivedTimelineDays)
    && Number.isFinite(summary.archivedYears)
      && (summary.archivedYears ?? 0) >= 0;
};

const normalizeArchivedOrganizationSummary = (value: ArchivedOrganizationSummary): ArchivedOrganizationSummary => ({
  ...value,
  memberIds: [...value.memberIds],
  childIds: [...value.childIds],
  resourceIds: [...value.resourceIds],
  resources: { ...value.resources },
  territoryRegionIds: [...value.territoryRegionIds],
  ...(value.governance ? { governance: { ...value.governance } } : {}),
  ...(value.diplomacy ? { diplomacy: { ...value.diplomacy } } : {}),
});

const isEventMilestone = (value: unknown): value is EventMilestone => {
  if (!value || typeof value !== "object") return false;
  const milestone = value as Partial<EventMilestone>;
  const details = milestone.details;
  return typeof milestone.id === "string"
    && Number.isFinite(milestone.tick)
    && (milestone.timelineStep === undefined || (typeof milestone.timelineStep === "string" && /^(0|[1-9]\d*)$/.test(milestone.timelineStep)))
    && (milestone.timelineDays === undefined || (typeof milestone.timelineDays === "string" && /^(0|[1-9]\d*)$/.test(milestone.timelineDays)))
    && (milestone.years === undefined || Number.isFinite(milestone.years))
    && typeof milestone.kind === "string"
    && typeof milestone.ruleId === "string"
    && (milestone.source === "natural" || milestone.source === "user")
    && Array.isArray(milestone.sourceIds)
    && milestone.sourceIds.every((id) => typeof id === "string")
    && Array.isArray(milestone.regionIds)
    && milestone.regionIds.every((id) => typeof id === "string")
    && Array.isArray(milestone.organizationIds)
    && milestone.organizationIds.every((id) => typeof id === "string")
    && Number.isFinite(milestone.probability)
    && Number.isFinite(milestone.roll)
    && (milestone.position === undefined || (Array.isArray(milestone.position) && milestone.position.length === 2 && milestone.position.every(Number.isFinite)))
    && Boolean(details)
    && typeof details === "object"
    && !Array.isArray(details)
    && Object.values(details).every((detail) => typeof detail === "string" || typeof detail === "number" || typeof detail === "boolean");
};

const strategicRouteKinds = new Set<StrategicRouteSummary["kind"]>(["trade", "alliance", "migration", "border-conflict"]);
const strategicRouteResources = new Set<NonNullable<StrategicRouteSummary["resourceId"]>>(["food", "materials", "energy"]);
const isStrategicRouteSummary = (value: unknown): value is StrategicRouteSummary => {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<StrategicRouteSummary>;
  return typeof route.kind === "string"
    && strategicRouteKinds.has(route.kind as StrategicRouteSummary["kind"])
    && typeof route.fromId === "string"
    && typeof route.toId === "string"
    && typeof route.fromRegion === "string"
    && /^region:\d+:\d+$/.test(route.fromRegion)
    && typeof route.toRegion === "string"
    && /^region:\d+:\d+$/.test(route.toRegion)
    && route.fromRegion !== route.toRegion
    && (route.resourceId === undefined || strategicRouteResources.has(route.resourceId as NonNullable<StrategicRouteSummary["resourceId"]>))
    && (route.kind !== "trade" || route.resourceId !== undefined)
    && Number.isFinite(route.cumulativeAmount)
    && (route.cumulativeAmount ?? -1) >= 0
    && Number.isFinite(route.occurrenceCount)
    && Number.isInteger(route.occurrenceCount)
    && (route.occurrenceCount ?? 0) > 0
    && Number.isFinite(route.firstTick)
    && Number.isFinite(route.lastTick)
    && validTimelineStep(route.firstTimelineStep)
    && validTimelineStep(route.firstTimelineDays)
    && validTimelineStep(route.lastTimelineStep)
    && validTimelineStep(route.lastTimelineDays)
    && (route.firstYears === undefined || Number.isFinite(route.firstYears))
    && (route.lastYears === undefined || Number.isFinite(route.lastYears));
};

const isWorldHistorySample = (value: unknown): value is WorldHistorySample => {
  if (!value || typeof value !== "object") return false;
  const sample = value as Partial<WorldHistorySample>;
  return Number.isFinite(sample.tick)
    && Number.isFinite(sample.years)
    && typeof sample.timelineStep === "string"
    && /^(0|[1-9]\d*)$/.test(sample.timelineStep)
    && typeof sample.timelineDays === "string"
    && /^(0|[1-9]\d*)$/.test(sample.timelineDays)
    && [sample.meanTemperature, sample.oceanCoverage, sample.biomass, sample.oxygen, sample.organics, sample.populationCount, sample.speciesCount, sample.organizationCount, sample.facilityCount, sample.knowledgeCount, sample.foodSecurity, sample.diseasePrevalence, sample.annualMeanTemperature, sample.annualMeanHumidity, sample.annualMeanWater, sample.annualMeanSolarFlux, sample.annualMinimumTemperature, sample.annualMaximumTemperature, sample.annualSeasonalRange].every((item) => item === undefined || Number.isFinite(item));
};

const averageGrid = (grid: Grid): number => grid.values.length === 0
  ? 0
  : Array.from(grid.values).reduce((sum, value) => sum + value, 0) / grid.values.length;

const hydrateClimateCycle = (timelineDays: string, fields: WorldState["fields"]): ClimateCycleState => {
  const cycle = createClimateCycleState(timelineDays);
  const currentYearDays = Number(BigInt(timelineDays) % 365n);
  if (currentYearDays === 0) return cycle;
  const temperature = averageGrid(fields.temperature);
  const humidity = averageGrid(fields.humidity);
  const water = averageGrid(fields.water);
  cycle.currentYearDays = currentYearDays;
  cycle.temperatureTotal = temperature * currentYearDays;
  cycle.humidityTotal = humidity * currentYearDays;
  cycle.waterTotal = water * currentYearDays;
  cycle.solarFluxTotal = currentYearDays;
  cycle.minimumTemperature = temperature;
  cycle.maximumTemperature = temperature;
  return cycle;
};

const substanceKinds = new Set<SubstanceState["kind"]>(["mineral", "crystal", "organic-compound", "engineered-composite"]);
const substanceFormations = new Set<SubstanceState["formation"]>(["geological", "hydrothermal", "biochemical", "engineered"]);
const isSubstanceState = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const substance = value as Partial<SubstanceState>;
  return typeof substance.id === "string"
    && typeof substance.name === "string"
    && typeof substance.kind === "string"
    && substanceKinds.has(substance.kind as SubstanceState["kind"])
    && typeof substance.formation === "string"
    && substanceFormations.has(substance.formation as SubstanceState["formation"])
    && (substance.status === "latent" || substance.status === "known")
    && typeof substance.regionId === "string"
    && Number.isFinite(substance.originTick)
    && (substance.originTimelineStep === undefined || (typeof substance.originTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(substance.originTimelineStep)))
    && Number.isFinite(substance.originYears)
    && Array.isArray(substance.parentIds)
    && substance.parentIds.every((id) => typeof id === "string")
    && Array.isArray(substance.discoveredByIds)
    && substance.discoveredByIds.every((id) => typeof id === "string")
    && (substance.discoveryTick === undefined || Number.isFinite(substance.discoveryTick))
    && (substance.discoveryTimelineStep === undefined || (typeof substance.discoveryTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(substance.discoveryTimelineStep)))
    && (substance.discoveryYears === undefined || Number.isFinite(substance.discoveryYears))
    && (substance.reserveCapacity === undefined || (Number.isFinite(substance.reserveCapacity) && substance.reserveCapacity >= 0 && substance.reserveCapacity <= MAX_SUBSTANCE_RESERVE))
    && (substance.remainingReserve === undefined || (Number.isFinite(substance.remainingReserve) && substance.remainingReserve >= 0))
    && (substance.extractedTotal === undefined || (Number.isFinite(substance.extractedTotal) && substance.extractedTotal >= 0))
    && (substance.depletedTick === undefined || (Number.isFinite(substance.depletedTick) && substance.depletedTick >= 0))
    && (substance.depletedTimelineStep === undefined || (typeof substance.depletedTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(substance.depletedTimelineStep)))
    && Boolean(substance.composition)
    && Object.values(substance.composition ?? {}).every(Number.isFinite)
    && Boolean(substance.properties)
    && Object.values(substance.properties ?? {}).every(Number.isFinite);
};

const pathogenKinds = new Set<PathogenState["kind"]>(["virus-like", "bacterial-colony", "fungal-spore", "parasitic-cell"]);
const pathogenStatuses = new Set<PathogenState["status"]>(["outbreak", "endemic", "dormant"]);
const isPathogenState = (value: unknown): value is PathogenState => {
  if (!value || typeof value !== "object") return false;
  const pathogen = value as Partial<PathogenState>;
  const normalized = [pathogen.transmission, pathogen.severity, pathogen.persistence, pathogen.prevalence];
  const counters = [pathogen.cumulativeCases, pathogen.cumulativeRecoveries, pathogen.cumulativeDeaths];
  return typeof pathogen.id === "string"
    && typeof pathogen.name === "string"
    && typeof pathogen.kind === "string"
    && pathogenKinds.has(pathogen.kind as PathogenState["kind"])
    && typeof pathogen.status === "string"
    && pathogenStatuses.has(pathogen.status as PathogenState["status"])
    && typeof pathogen.regionId === "string"
    && typeof pathogen.hostSpeciesId === "string"
    && Number.isFinite(pathogen.originTick)
    && (pathogen.originTimelineStep === undefined || (typeof pathogen.originTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(pathogen.originTimelineStep)))
    && Number.isFinite(pathogen.originYears)
    && normalized.every((number) => Number.isFinite(number) && Number(number) >= 0 && Number(number) <= 1)
    && counters.every((number) => Number.isFinite(number) && Number(number) >= 0)
    && Number.isFinite(pathogen.lastActiveTick)
    && (pathogen.lastActiveTimelineStep === undefined || (typeof pathogen.lastActiveTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(pathogen.lastActiveTimelineStep)))
    && (pathogen.regionalOutbreaks === undefined || (Array.isArray(pathogen.regionalOutbreaks)
      && pathogen.regionalOutbreaks.every((outbreak) => validTimelineStep(outbreak.firstDetectedTimelineStep) && validTimelineStep(outbreak.lastActiveTimelineStep))))
    && typeof pathogen.noveltySignature === "string";
};

const ecologicalRelationshipKinds = new Set<EcologicalRelationshipState["kind"]>(["predation", "competition", "mutualism", "parasitism"]);
const isEcologicalRelationshipState = (value: unknown): value is EcologicalRelationshipState => {
  if (!value || typeof value !== "object") return false;
  const relationship = value as Partial<EcologicalRelationshipState>;
  const numericValues = [relationship.strength, relationship.firstTick, relationship.lastTick, relationship.interactionCount, relationship.cumulativeImpact, relationship.lastImpact];
  return typeof relationship.id === "string"
    && typeof relationship.kind === "string"
    && ecologicalRelationshipKinds.has(relationship.kind as EcologicalRelationshipState["kind"])
    && typeof relationship.fromSpeciesId === "string"
    && typeof relationship.toSpeciesId === "string"
    && typeof relationship.regionId === "string"
    && (relationship.status === "active" || relationship.status === "dormant")
    && numericValues.every((number) => Number.isFinite(number))
    && Boolean(relationship.details)
    && typeof relationship.details === "object"
    && !Array.isArray(relationship.details)
    && Object.values(relationship.details).every((detail) => typeof detail === "string" || typeof detail === "number" || typeof detail === "boolean");
};

const validateWorld = (value: unknown): WorldState => {
  if (!value || typeof value !== "object") throw new Error("Save world must be an object");
  const world = value as Partial<WorldState>;
  const fields = world.fields;
  const chemistry = world.chemistry;
  if (world.version !== 1 || !Number.isFinite(world.seed) || typeof world.tick !== "number" || !Number.isSafeInteger(world.tick) || world.tick < 0 || !world.random || !fields || !chemistry) throw new Error("Save world is missing required fields");
  if (world.simulationDays !== undefined
    && (!Number.isSafeInteger(world.simulationDays) || world.simulationDays < 0)) throw new Error("Save contains invalid simulation time");
  if (world.timeline !== undefined && !isSimulationTimeline(world.timeline)) throw new Error("Save contains invalid simulation timeline");
  try {
    simulationDaysFromYears(world.years as number, "Save world time");
  } catch {
    throw new Error("Save contains invalid simulation time");
  }
  if (world.orbital !== undefined && !isOrbitalState(world.orbital)) throw new Error("Save contains invalid orbital state");
  const timelineDays = world.timeline?.days
    ?? String(world.simulationDays ?? simulationDaysFromYears(world.years as number, "Save world time"));
  const orbital = world.orbital === undefined
    ? createOrbitalState(world.seed!, timelineDays)
    : world.orbital;
  const fieldValues = Object.values(fields);
  const chemistryValues = Object.values(chemistry);
  if (!fieldValues.every(isGrid) || !chemistryValues.every(isGrid)) throw new Error("Save contains invalid grids");
  const elevationGrid = (fields as WorldState["fields"]).elevation;
  const tectonics = world.tectonics === undefined
    ? createTectonicState(world.seed!, elevationGrid.width, elevationGrid.height, {
      elapsedYears: world.years!,
      lastUpdatedTick: world.tick,
      timelineStep: world.timeline?.step ?? String(world.tick),
    })
    : world.tectonics;
  if (!isTectonicState(tectonics, elevationGrid.width, elevationGrid.height)) {
    throw new Error("Save contains invalid tectonic state");
  }
  const atmosphere = world.atmosphere === undefined
    ? restoreAtmosphereState(world.seed!, fields as WorldState["fields"], {
      elapsedYears: world.years!,
      lastUpdatedTick: world.tick,
      timelineStep: world.timeline?.step ?? String(world.tick),
    })
    : world.atmosphere;
  if (!isAtmosphereState(atmosphere, elevationGrid.width, elevationGrid.height)) {
    throw new Error("Save contains invalid atmosphere state");
  }
  const savedOcean = world.ocean as unknown;
  const ocean = savedOcean === undefined
    ? restoreOceanState(world.seed!, fields as WorldState["fields"], atmosphere, {
      elapsedYears: world.years!,
      lastUpdatedTick: world.tick,
      timelineStep: world.timeline?.step ?? String(world.tick),
    }, undefined, chemistry as WorldState["chemistry"])
    : isOceanState(savedOcean, elevationGrid.width, elevationGrid.height)
      ? savedOcean
      : isOceanCoreState(savedOcean, elevationGrid.width, elevationGrid.height)
        ? restoreOceanState(world.seed!, fields as WorldState["fields"], atmosphere, {
          ...((savedOcean as Partial<WorldState["ocean"]>).lastUpdatedYears === undefined ? {} : { elapsedYears: (savedOcean as Partial<WorldState["ocean"]>).lastUpdatedYears }),
          ...((savedOcean as Partial<WorldState["ocean"]>).lastUpdatedTick === undefined ? {} : { lastUpdatedTick: (savedOcean as Partial<WorldState["ocean"]>).lastUpdatedTick }),
          ...((savedOcean as Partial<WorldState["ocean"]>).lastUpdatedTimelineStep === undefined ? {} : { timelineStep: (savedOcean as Partial<WorldState["ocean"]>).lastUpdatedTimelineStep }),
        }, savedOcean as Pick<WorldState["ocean"], "seaTemperature" | "salinity" | "currentX" | "currentY" | "seaIce">, chemistry as WorldState["chemistry"])
        : savedOcean;
  if (!isOceanState(ocean, elevationGrid.width, elevationGrid.height)) {
    throw new Error("Save contains invalid ocean state");
  }
  if (world.climateCycle !== undefined && !isClimateCycleState(world.climateCycle)) throw new Error("Save contains invalid climate cycle state");
  const climateCycle = world.climateCycle === undefined
    ? hydrateClimateCycle(timelineDays, fields as WorldState["fields"])
    : world.climateCycle;
  const requiredArrays: Array<keyof WorldState> = ["species", "populations", "agents", "knowledge", "relationships", "cultures", "organizations", "resources", "events"];
  if (!requiredArrays.every((key) => Array.isArray(world[key]))) throw new Error("Save contains invalid entity collections");
  if (!world.worldview || !world.lod) throw new Error("Save is missing worldview or LOD state");
  const lod = world.lod as WorldState["lod"];
  const summaries = lod.summaries.map((summary) => {
    const partial = summary as Partial<WorldState["lod"]["summaries"][number]>;
    const agentIds = Array.isArray(partial.agentIds) ? partial.agentIds : [];
    const agentRecords = Array.isArray(partial.agentRecords)
      ? partial.agentRecords.map((record) => ({ ...record, genetics: normalizeGeneticRecord(record, 0.98, String(partial.regionId ?? "legacy-region")) }))
      : [];
    const relationshipRecords = Array.isArray(partial.relationshipRecords) ? partial.relationshipRecords : [];
    const ecologicalRelationships = Array.isArray(partial.ecologicalRelationships) ? partial.ecologicalRelationships.filter(isEcologicalRelationshipState).slice(0, MAX_ECOLOGICAL_RELATIONSHIPS) : [];
    const relationshipCounts = relationshipRecords.reduce<WorldState["lod"]["summaries"][number]["lineage"]["relationshipCounts"]>((counts, relationship) => {
      counts[relationship.kind] = (counts[relationship.kind] ?? 0) + 1;
      return counts;
    }, {});
    const descendantIds = new Set(relationshipRecords.filter((relationship) => relationship.kind === "parent").map((relationship) => relationship.toId));
    const defaultLineage = {
      descendantCount: descendantIds.size,
      generationDepth: agentIds.length === 0 ? 0 : descendantIds.size > 0 ? 2 : 1,
      knowledgeCarrierCount: 0,
      knowledgeInheritanceCount: 0,
      beliefCarrierCount: 0,
      relationshipCounts,
    };
    const lineage = {
      ...(partial.lineage ?? defaultLineage),
      knowledgeInheritanceCount: typeof partial.lineage?.knowledgeInheritanceCount === "number" ? partial.lineage.knowledgeInheritanceCount : 0,
    };
    const organizations = (partial.organizations ?? []).map((organization) => ({
      ...organization,
      territoryRegionIds: Array.isArray(organization.territoryRegionIds) ? organization.territoryRegionIds : [partial.regionId!],
      governance: { ...defaultGovernanceFor(organization.type), ...(organization.governance ?? {}) },
      diplomacy: organization.diplomacy && typeof organization.diplomacy === "object" ? organization.diplomacy : {},
    }));
    const cultureSummary = partial.cultureSummary === undefined ? undefined : {
      ...partial.cultureSummary,
      lastChangeTimelineStep: normalizedTimelineStep(
        partial.cultureSummary.lastChangeTimelineStep,
        partial.versionStep ?? partial.cultureSummary.lastChangeTick ?? partial.version,
      ),
    };
    const societySummary = partial.societySummary === undefined ? undefined : {
      ...partial.societySummary,
      lastChangeTimelineStep: normalizedTimelineStep(
        partial.societySummary.lastChangeTimelineStep,
        partial.versionStep ?? partial.societySummary.lastChangeTick ?? partial.version,
      ),
    };
    return {
      ...summary,
      versionStep: normalizedTimelineStep(partial.versionStep, partial.version),
      organizations,
      agentIds,
      agentRecords,
      relationshipRecords,
      ecologicalRelationshipCount: typeof partial.ecologicalRelationshipCount === "number" ? partial.ecologicalRelationshipCount : ecologicalRelationships.length,
      ecologicalRelationships,
      lineage,
      familyLineages: Array.isArray(partial.familyLineages) ? partial.familyLineages : [],
      foodBalance: typeof partial.foodBalance === "number" ? partial.foodBalance : 0,
      foodPerAgent: typeof partial.foodPerAgent === "number" ? partial.foodPerAgent : 0,
      foodSecurity: typeof partial.foodSecurity === "number" ? partial.foodSecurity : 0,
      healthSummary: partial.healthSummary && [partial.healthSummary.infectedCount, partial.healthSummary.immuneCount, partial.healthSummary.prevalence, partial.healthSummary.meanVitality].every(Number.isFinite)
        ? partial.healthSummary
        : { activePathogenIds: [], infectedCount: 0, immuneCount: 0, prevalence: 0, meanVitality: 1 },
      ...(cultureSummary === undefined ? {} : { cultureSummary }),
      ...(societySummary === undefined ? {} : { societySummary }),
    };
  });
  const focusRegionId = world.observation && typeof world.observation === "object" && typeof (world.observation as { focusRegionId?: unknown }).focusRegionId === "string"
    ? (world.observation as { focusRegionId: WorldState["observation"]["focusRegionId"] }).focusRegionId
    : undefined;
  const organizations = world.organizations!.map((organization) => ({
    ...organization,
    territoryRegionIds: Array.isArray(organization.territoryRegionIds) ? organization.territoryRegionIds : [organization.regionId],
    governance: { ...defaultGovernanceFor(organization.type), ...(organization.governance ?? {}) },
    diplomacy: organization.diplomacy && typeof organization.diplomacy === "object" ? organization.diplomacy : {},
    ...(typeof organization.archivedHistoryCount === "number" ? { archivedHistoryCount: organization.archivedHistoryCount } : {}),
  }));
  const facilities = Array.isArray(world.facilities) ? world.facilities : [];
  const substances = Array.isArray(world.substances)
    ? world.substances
      .filter(isSubstanceState)
      .map((substance) => normalizeSubstanceReserve(substance as SubstanceState))
    : [];
  const normalizedSpecies = world.species!.map((species) => ensureSpeciesIdentity(species));
  const speciesById = new Map(normalizedSpecies.map((species) => [species.id, species]));
  const populationById = new Map(world.populations!.map((population) => [population.id, population]));
  const pathogens = Array.isArray(world.pathogens)
    ? world.pathogens.filter(isPathogenState).slice(0, MAX_PATHOGENS).map(normalizePathogenState)
    : [];
  const ecologicalRelationships = Array.isArray(world.ecologicalRelationships)
    ? world.ecologicalRelationships.filter(isEcologicalRelationshipState).slice(0, MAX_ECOLOGICAL_RELATIONSHIPS)
    : [];
  const pathogenIds = new Set(pathogens.map((pathogen) => pathogen.id));
  const agents = world.agents!.map((agent) => {
    const population = populationById.get(agent.populationId);
    const species = population ? speciesById.get(population.speciesId) : undefined;
    return {
      ...agent,
      genetics: normalizeAgentGenetics(agent, species),
      health: normalizeAgentHealth(agent, pathogenIds),
    };
  });
  const worldview = world.worldview as Partial<WorldState["worldview"]>;
  const formation = world.formation ?? completedPlanetFormationState(world.seed!);
  if (!isFormationState(formation)) throw new Error("Save contains invalid planet formation state");
  const defaultArchive = createEventArchive(world.events!);
  const savedArchive = world.eventArchive as Partial<WorldState["eventArchive"]> | undefined;
  const archivedEventCount = Number.isFinite(savedArchive?.archivedEventCount)
    ? boundedPersistentTotal(Number(savedArchive?.archivedEventCount))
    : 0;
  const eventArchive: WorldState["eventArchive"] = {
    ...defaultArchive,
    ...(savedArchive?.firstEventTick === undefined ? {} : { firstEventTick: savedArchive.firstEventTick }),
    ...(typeof savedArchive?.firstEventTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(savedArchive.firstEventTimelineStep) ? { firstEventTimelineStep: savedArchive.firstEventTimelineStep } : {}),
    ...(savedArchive?.firstEventYears === undefined ? {} : { firstEventYears: savedArchive.firstEventYears }),
    ...(savedArchive?.latestEventTick === undefined ? {} : { latestEventTick: savedArchive.latestEventTick }),
    ...(typeof savedArchive?.latestEventTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(savedArchive.latestEventTimelineStep) ? { latestEventTimelineStep: savedArchive.latestEventTimelineStep } : {}),
    ...(savedArchive?.latestEventYears === undefined ? {} : { latestEventYears: savedArchive.latestEventYears }),
    ...(savedArchive?.archivedThroughTick === undefined ? {} : { archivedThroughTick: savedArchive.archivedThroughTick }),
    ...(typeof savedArchive?.archivedThroughTimelineStep === "string" && /^(0|[1-9]\d*)$/.test(savedArchive.archivedThroughTimelineStep) ? { archivedThroughTimelineStep: savedArchive.archivedThroughTimelineStep } : {}),
    ...(savedArchive?.archivedThroughYears === undefined ? {} : { archivedThroughYears: savedArchive.archivedThroughYears }),
    totalEventCount: Math.max(
      addPersistentTotal(world.events!.length, archivedEventCount),
      boundedPersistentTotal(Number(savedArchive?.totalEventCount ?? 0)),
    ),
    archivedEventCount,
    archivedSpeciesCount: boundedPersistentTotal(Number(savedArchive?.archivedSpeciesCount ?? 0)),
    archivedKnowledgeCount: boundedPersistentTotal(Number(savedArchive?.archivedKnowledgeCount ?? 0)),
    archivedCultureCount: boundedPersistentTotal(Number(savedArchive?.archivedCultureCount ?? 0)),
    archivedRelationshipCount: boundedPersistentTotal(Number(savedArchive?.archivedRelationshipCount ?? 0)),
    archivedOrganizationCount: boundedPersistentTotal(Number(savedArchive?.archivedOrganizationCount ?? 0)),
    kindCounts: countRecord(savedArchive?.kindCounts),
    regionCounts: countRecord(savedArchive?.regionCounts),
    organizationCounts: countRecord(savedArchive?.organizationCounts),
    organizationFormationCounts: countRecord(savedArchive?.organizationFormationCounts),
    tradeVolumeByResource: countRecord(savedArchive?.tradeVolumeByResource),
    archivedSpeciesRoleCounts: countRecord(savedArchive?.archivedSpeciesRoleCounts),
    archivedSpeciesSummaries: Array.isArray(savedArchive?.archivedSpeciesSummaries)
      ? retainArchivedSpeciesSummaries(savedArchive.archivedSpeciesSummaries.filter(isArchivedSpeciesSummary).slice(-MAX_ARCHIVED_SPECIES_SUMMARIES))
      : [],
    archivedOrganizationSummaries: Array.isArray(savedArchive?.archivedOrganizationSummaries)
      ? retainArchivedOrganizationSummaries(savedArchive.archivedOrganizationSummaries
        .filter(isArchivedOrganizationSummary)
        .map(normalizeArchivedOrganizationSummary)
        .slice(-MAX_ARCHIVED_ORGANIZATION_SUMMARIES))
      : [],
    organizationDevelopment: normalizeOrganizationDevelopment(
      savedArchive?.organizationDevelopment,
      new Set(organizations.map((organization) => organization.id)),
    ),
    milestones: Array.isArray(savedArchive?.milestones)
      ? savedArchive.milestones.filter(isEventMilestone).slice(-MAX_EVENT_MILESTONES)
      : defaultArchive.milestones,
    strategicRoutes: Array.isArray(savedArchive?.strategicRoutes)
      ? retainStrategicRoutes(savedArchive.strategicRoutes.filter(isStrategicRouteSummary).slice(0, MAX_STRATEGIC_ROUTE_SUMMARIES))
      : [],
    historySamples: Array.isArray(savedArchive?.historySamples)
      ? retainHistorySamples(savedArchive.historySamples.filter(isWorldHistorySample).slice(-MAX_HISTORY_SAMPLES))
      : [],
  };
  const normalizedWorld = {
    ...world,
    formation,
    tectonics,
    atmosphere,
    ocean,
    orbital,
    climateCycle,
    species: normalizedSpecies,
    agents,
    cultures: world.cultures!.map((culture) => ensureCultureIdentity(culture)),
    organizations,
    facilities,
    substances,
    pathogens,
    ecologicalRelationships,
    eventArchive,
    worldview: {
      ...world.worldview,
      enabledPackIds: Array.isArray(worldview.enabledPackIds) ? worldview.enabledPackIds : [],
      discoveredRuleIds: Array.isArray(worldview.discoveredRuleIds) ? worldview.discoveredRuleIds : [],
      entities: Array.isArray(worldview.entities) ? worldview.entities : [],
      phenomena: Array.isArray(worldview.phenomena) ? worldview.phenomena : [],
      practices: Array.isArray(worldview.practices) ? worldview.practices : [],
      interactions: Array.isArray(worldview.interactions) ? worldview.interactions : [],
    },
    lod: { ...lod, summaries },
    observation: focusRegionId ? { focusRegionId } : {},
  } as WorldState;
  compactFacilityRecords(normalizedWorld);
  compactResourceRecords(normalizedWorld);
  return normalizedWorld;
};

export const serializeWorld = (state: WorldState): string => JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, world: encode({ ...state, observation: state.observation.focusRegionId ? { focusRegionId: state.observation.focusRegionId } : {} }) });

export const deserializeWorld = (input: string): WorldState => {
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new Error("Save is not valid JSON"); }
  if (!isSaveEnvelope(parsed)) throw new Error("Unsupported or malformed save schema");
  return validateWorld(decode(parsed.world));
};
