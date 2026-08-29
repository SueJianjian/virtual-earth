import { performance } from "node:perf_hooks";
import { clearSimulationStages, listSimulationStages, registerSimulationStage, stepWorld } from "../src/sim/engine.ts";
import { MAX_AGENT_MEMORY_IDS, MAX_BELIEFS_PER_AGENT, MAX_DETAILED_AGENTS, MAX_RELATIONSHIP_RECORDS, MAX_RELATIONSHIPS_PER_AGENT } from "../src/sim/agents/lifecycle.ts";
import { EVENT_LOG_MAX_COUNT, MAX_EVENT_MILESTONES, MAX_MILESTONE_RELATED_IDS, MAX_STRATEGIC_ROUTE_SUMMARIES } from "../src/sim/events/ledger.ts";
import { MAX_SUBSTANCE_RESERVE, MAX_SUBSTANCES } from "../src/sim/environment/substances.ts";
import { MAX_POPULATION_RECORDS } from "../src/sim/ecology/archive.ts";
import { MAX_ECOLOGICAL_RELATIONSHIPS } from "../src/sim/ecology/interactions.ts";
import { MAX_BELIEFS_PER_CULTURE, MAX_CULTURE_RECORDS, MAX_KNOWLEDGE_PER_AGENT, MAX_KNOWLEDGE_PER_CULTURE, MAX_KNOWLEDGE_RECORDS } from "../src/sim/culture/archive.ts";
import { MAX_WORLDVIEW_ENTITIES, MAX_WORLDVIEW_INTERACTIONS, MAX_WORLDVIEW_PHENOMENA, MAX_WORLDVIEW_PRACTICES } from "../src/sim/worldview/archive.ts";
import { createWorld, finiteWorldChecks, worldDigest } from "../src/sim/world.ts";
import { initializeEnvironment } from "../src/sim/environment/index.ts";
import { MAX_IMMUNITY_IDS_PER_AGENT, MAX_INFECTIONS_PER_AGENT, MAX_PATHOGENS, MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN } from "../src/sim/health/disease.ts";
import { MAX_FACILITIES_PER_REGION } from "../src/sim/society/facilities.ts";
import { HERITABLE_AGENT_TRAITS, validAgentGenetics } from "../src/sim/agents/genetics.ts";
import { ACTIVE_ADAPTIVE_SPECIES_LIMITS } from "../src/sim/ecology/species.ts";
import { isEntityHolderId } from "../src/sim/resources.ts";
import { isTectonicState, MAX_TECTONIC_PLATES, MIN_TECTONIC_PLATES } from "../src/sim/environment/geology.ts";
import { isAtmosphereState } from "../src/sim/environment/atmosphere.ts";
import { isOceanState } from "../src/sim/environment/ocean.ts";

const requestedScenario = process.argv[4] ?? process.env.BENCHMARK_SCENARIO ?? "autonomous";
const scenario = requestedScenario === "dense" ? "dense" : "autonomous";
const requestedSeed = Number(process.argv[3] ?? process.env.BENCHMARK_SEED ?? (scenario === "dense" ? 123 : 42));
const seed = Number.isFinite(requestedSeed) ? Math.trunc(requestedSeed) : 42;
const defaultSteps = scenario === "dense" ? 100 : 900;
const requestedSteps = Number(process.argv[2] ?? process.env.BENCHMARK_STEPS ?? defaultSteps);
const steps = Number.isFinite(requestedSteps) && requestedSteps > 0 ? Math.trunc(requestedSteps) : defaultSteps;
const requestedWarmup = Number(process.env.BENCHMARK_WARMUP_STEPS ?? (scenario === "dense" ? 1_000 : 0));
const warmupSteps = Number.isFinite(requestedWarmup) && requestedWarmup >= 0 ? Math.trunc(requestedWarmup) : 0;
const requestedBudget = Number(process.env.BENCHMARK_STEP_BUDGET_MS ?? (scenario === "dense" ? 60 : 10));
const stepBudgetMs = Number.isFinite(requestedBudget) && requestedBudget > 0 ? requestedBudget : Infinity;
const requestedSlowdown = Number(process.env.BENCHMARK_MAX_SEGMENT_SLOWDOWN ?? 1.75);
const maxSegmentSlowdown = Number.isFinite(requestedSlowdown) && requestedSlowdown >= 1 ? requestedSlowdown : 1.75;
const requestedWidth = Number(process.argv[5] ?? process.env.BENCHMARK_WIDTH ?? 16);
const requestedHeight = Number(process.argv[6] ?? process.env.BENCHMARK_HEIGHT ?? 8);
const normalizeDimension = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 8 ? Math.min(256, Math.trunc(value)) : fallback;
const width = normalizeDimension(requestedWidth, 16);
const height = normalizeDimension(requestedHeight, 8);
const warmupWidth = scenario === "dense" ? Math.min(width, 16) : width;
const warmupHeight = scenario === "dense" ? Math.min(height, 8) : height;
let state = createWorld(seed, {
  width: warmupWidth,
  height: warmupHeight,
  ...(scenario === "dense" ? { formation: "formed" as const, enabledPackIds: ["emergence.original-worldview"] } : {}),
});
let peakAgents = state.agents.length;
let peakOrganizations = state.organizations.length;
let peakHotspots = state.lod.summaries.length;
let peakFacilities = state.facilities.length;
const denseCoverage = {
  ecology: false,
  individuals: false,
  culture: false,
  citiesAndStates: false,
  facilities: false,
  disease: false,
};
const recordPeaks = (): void => {
  peakAgents = Math.max(peakAgents, state.agents.length);
  peakOrganizations = Math.max(peakOrganizations, state.organizations.length);
  peakHotspots = Math.max(peakHotspots, state.lod.summaries.length);
  peakFacilities = Math.max(peakFacilities, state.facilities.length);
  denseCoverage.ecology ||= state.species.length >= 3 && (state.ecologicalRelationships?.length ?? 0) > 0;
  denseCoverage.individuals ||= state.agents.length >= 64 && state.relationships.length > 0;
  denseCoverage.culture ||= state.cultures.length > 0 && state.knowledge.length > 0;
  denseCoverage.citiesAndStates ||= state.organizations.some((organization) => organization.type === "city")
    && state.organizations.some((organization) => organization.type === "state");
  denseCoverage.facilities ||= state.facilities.length > 0;
  denseCoverage.disease ||= state.pathogens.length > 0;
};
recordPeaks();
for (let index = 0; index < warmupSteps; index += 1) {
  state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
  recordPeaks();
}
if (scenario === "dense" && (warmupWidth !== width || warmupHeight !== height)) {
  const expanded = initializeEnvironment(createWorld(seed, {
    width,
    height,
    formation: "formed",
    enabledPackIds: ["emergence.original-worldview"],
  }));
  const copyWidth = Math.min(warmupWidth, width);
  const copyHeight = Math.min(warmupHeight, height);
  for (const field of Object.keys(state.fields) as Array<keyof typeof state.fields>) {
    for (let y = 0; y < copyHeight; y += 1) {
      const sourceOffset = y * warmupWidth;
      const targetOffset = y * width;
      expanded.fields[field].values.set(state.fields[field].values.subarray(sourceOffset, sourceOffset + copyWidth), targetOffset);
    }
  }
  for (const field of Object.keys(state.chemistry) as Array<keyof typeof state.chemistry>) {
    for (let y = 0; y < copyHeight; y += 1) {
      const sourceOffset = y * warmupWidth;
      const targetOffset = y * width;
      expanded.chemistry[field].values.set(state.chemistry[field].values.subarray(sourceOffset, sourceOffset + copyWidth), targetOffset);
    }
  }
  state = {
    ...state,
    formation: expanded.formation,
    tectonics: expanded.tectonics,
    atmosphere: expanded.atmosphere,
    ocean: expanded.ocean,
    fields: expanded.fields,
    chemistry: expanded.chemistry,
  };
  recordPeaks();
}
const started = performance.now();
let segmentStarted = started;
let segmentFromStep = 1;
const segmentSize = Math.max(1, Math.min(500, Math.ceil(steps / Math.min(4, steps))));
type CollectionCounts = {
  events: number;
  milestones: number;
  strategicRoutes: number;
  tectonicPlates: number;
  populations: number;
  agents: number;
  relationships: number;
  ecologicalRelationships: number;
  organizations: number;
  facilities: number;
  substances: number;
  knowledge: number;
  resources: number;
  phenomena: number;
  practices: number;
  worldviewEntities: number;
  worldviewInteractions: number;
  pathogens: number;
};
const collectionCounts = (): CollectionCounts => ({
  events: state.events.length,
  milestones: state.eventArchive.milestones.length,
  strategicRoutes: state.eventArchive.strategicRoutes.length,
  tectonicPlates: state.tectonics.plates.length,
  populations: state.populations.length,
  agents: state.agents.length,
  relationships: state.relationships.length,
  ecologicalRelationships: state.ecologicalRelationships?.length ?? 0,
  organizations: state.organizations.length,
  facilities: state.facilities.length,
  substances: state.substances.length,
  knowledge: state.knowledge.length,
  resources: state.resources.length,
  phenomena: state.worldview.phenomena.length,
  practices: state.worldview.practices.length,
  worldviewEntities: state.worldview.entities.length,
  worldviewInteractions: state.worldview.interactions.length,
  pathogens: state.pathogens.length,
});
const segments: Array<{ fromStep: number; toStep: number; elapsedMs: number; averageStepMs: number; collections: CollectionCounts }> = [];
for (let index = 0; index < steps; index += 1) {
  state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
  recordPeaks();
  if ((index + 1) % segmentSize === 0 || index + 1 === steps) {
    const now = performance.now();
    const segmentSteps = index + 1 - segmentFromStep + 1;
    const segmentElapsed = now - segmentStarted;
    segments.push({
      fromStep: segmentFromStep,
      toStep: index + 1,
      elapsedMs: Number(segmentElapsed.toFixed(2)),
      averageStepMs: Number((segmentElapsed / segmentSteps).toFixed(4)),
      collections: collectionCounts(),
    });
    segmentStarted = now;
    segmentFromStep = index + 2;
  }
}
const elapsed = performance.now() - started;
const averageStep = elapsed / steps;
const stageTimings = new Map<string, number>();
const installedStages = listSimulationStages();
clearSimulationStages();
for (const stage of installedStages) {
  registerSimulationStage({
    ...stage,
    run: (current, input, priorDeltas) => {
      const stageStarted = performance.now();
      const result = stage.run(current, input, priorDeltas);
      stageTimings.set(stage.id, (stageTimings.get(stage.id) ?? 0) + performance.now() - stageStarted);
      return result;
    },
  });
}
const profileSteps = 10;
let profileState = structuredClone(state);
for (let index = 0; index < profileSteps; index += 1) {
  profileState = stepWorld(profileState, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
}

const resourceKeys = state.resources.map((resource) => `${resource.resourceId}|${resource.regionId}|${resource.holderId ?? "world"}`);
const agentIds = new Set(state.agents.map((agent) => agent.id));
const populationIds = new Set(state.populations.map((population) => population.id));
const speciesIds = new Set(state.species.map((species) => species.id));
const activeSpeciesIds = {
  producer: new Set<string>(),
  consumer: new Set<string>(),
  decomposer: new Set<string>(),
};
for (const population of state.populations) {
  const species = state.species.find((candidate) => candidate.id === population.speciesId);
  if (!species) continue;
  const minimumViableCount = species.role === "producer" ? 1 : 4;
  if (population.count >= minimumViableCount) activeSpeciesIds[species.role].add(species.id);
}
const ecologicalRelationships = state.ecologicalRelationships ?? [];
const ecologicalKeys = new Set<string>();
const ecologicalRelationshipsHealthy = ecologicalRelationships.every((relationship) => {
  const key = `${relationship.kind}|${relationship.regionId}|${relationship.fromSpeciesId}|${relationship.toSpeciesId}`;
  const regionMatch = /^region:(\d+):(\d+)$/.exec(relationship.regionId);
  const regionIsValid = Boolean(regionMatch)
    && Number(regionMatch![1]) < width
    && Number(regionMatch![2]) < height;
  const countersAreValid = [relationship.firstTick, relationship.lastTick, relationship.interactionCount]
    .every((value) => Number.isSafeInteger(value) && value >= 0);
  const valuesAreValid = [relationship.strength, relationship.lastImpact, relationship.cumulativeImpact]
    .every((value) => Number.isFinite(value) && value >= 0)
    && relationship.strength <= 1
    && relationship.lastImpact <= 1
    && Object.values(relationship.details).every((value) => typeof value !== "number" || Number.isFinite(value));
  const valid = !ecologicalKeys.has(key)
    && speciesIds.has(relationship.fromSpeciesId)
    && speciesIds.has(relationship.toSpeciesId)
    && regionIsValid
    && countersAreValid
    && relationship.lastTick >= relationship.firstTick
    && relationship.interactionCount > 0
    && valuesAreValid
    && (relationship.status === "active" || relationship.status === "dormant");
  ecologicalKeys.add(key);
  return valid;
});
const knowledgeIds = new Set(state.knowledge.map((knowledge) => knowledge.id));
const organizationIds = new Set(state.organizations.map((organization) => organization.id));
const archivedOrganizationIds = Object.keys(state.eventArchive.organizationCounts);
const archiveCounters = [
  state.eventArchive.totalEventCount,
  state.eventArchive.archivedEventCount,
  state.eventArchive.archivedSpeciesCount,
  state.eventArchive.archivedKnowledgeCount,
  state.eventArchive.archivedCultureCount,
  state.eventArchive.archivedRelationshipCount,
  ...Object.values(state.eventArchive.kindCounts),
  ...Object.values(state.eventArchive.regionCounts),
  ...Object.values(state.eventArchive.organizationCounts),
];
const health = {
  finite: Object.values(finiteWorldChecks(state)).every(Boolean),
  finiteFailures: Object.entries(finiteWorldChecks(state))
    .filter(([, passed]) => !passed)
    .map(([name]) => name),
  tectonicsHealthy: isTectonicState(state.tectonics, width, height)
    && state.tectonics.plates.length >= MIN_TECTONIC_PLATES
    && state.tectonics.plates.length <= MAX_TECTONIC_PLATES,
  atmosphereHealthy: isAtmosphereState(state.atmosphere, width, height),
  oceanHealthy: isOceanState(state.ocean, width, height),
  finiteArchiveCounters: archiveCounters.every((value) => Number.isFinite(value) && value >= 0),
  eventLogBounded: state.events.length <= EVENT_LOG_MAX_COUNT,
  milestoneArchiveBounded: state.eventArchive.milestones.length <= MAX_EVENT_MILESTONES,
  milestoneReferencesBounded: state.eventArchive.milestones.every((milestone) => [
    milestone.sourceIds.length,
    milestone.regionIds.length,
    milestone.organizationIds.length,
  ].every((count) => count <= MAX_MILESTONE_RELATED_IDS)
    && [milestone.tick, milestone.years ?? 0, milestone.probability, milestone.roll].every(Number.isFinite)),
  strategicRouteArchiveBounded: state.eventArchive.strategicRoutes.length <= MAX_STRATEGIC_ROUTE_SUMMARIES,
  strategicRoutesHealthy: state.eventArchive.strategicRoutes.every((route) => [
    route.cumulativeAmount,
    route.occurrenceCount,
    route.firstTick,
    route.lastTick,
  ].every((value) => Number.isFinite(value) && value >= 0)
    && route.occurrenceCount > 0
    && route.fromRegion !== route.toRegion),
  agentCountBounded: state.agents.length <= MAX_DETAILED_AGENTS,
  peakAgentCountBounded: peakAgents <= MAX_DETAILED_AGENTS,
  populationCountBounded: state.populations.length <= MAX_POPULATION_RECORDS,
  uniquePopulationRegions: new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`)).size === state.populations.length,
  validPopulationSpecies: state.populations.every((population) => speciesIds.has(population.speciesId)),
  activeSpeciesDiversityBounded: Object.entries(activeSpeciesIds).every(([role, ids]) =>
    ids.size <= ACTIVE_ADAPTIVE_SPECIES_LIMITS[role as keyof typeof ACTIVE_ADAPTIVE_SPECIES_LIMITS]),
  validAgentPopulations: state.agents.every((agent) => populationIds.has(agent.populationId)),
  agentBeliefsBounded: state.agents.every((agent) => agent.beliefIds.length <= MAX_BELIEFS_PER_AGENT),
  normalizedPopulationEnergy: state.populations.every((population) => Number.isFinite(population.energy) && population.energy >= 0 && population.energy <= 1),
  knowledgeCountBounded: state.knowledge.length <= MAX_KNOWLEDGE_RECORDS,
  cultureCountBounded: state.cultures.length <= MAX_CULTURE_RECORDS,
  cultureKnowledgeBounded: state.cultures.every((culture) => culture.knowledgeIds.length <= MAX_KNOWLEDGE_PER_CULTURE && culture.knowledgeIds.every((id) => knowledgeIds.has(id))),
  cultureBeliefsBounded: state.cultures.every((culture) => culture.beliefIds.length <= MAX_BELIEFS_PER_CULTURE),
  agentKnowledgeBounded: state.agents.every((agent) => agent.knowledgeIds.length <= MAX_KNOWLEDGE_PER_AGENT && agent.knowledgeIds.every((id) => knowledgeIds.has(id))),
  agentMemoryBounded: state.agents.every((agent) => agent.memoryIds.length <= MAX_AGENT_MEMORY_IDS),
  validKnowledgeParents: state.knowledge.every((knowledge) => (knowledge.parentIds ?? []).every((id) => knowledgeIds.has(id))),
  uniqueResourceEntries: new Set(resourceKeys).size === resourceKeys.length,
  validRelationships: state.relationships.every((relationship) => agentIds.has(relationship.fromId) && agentIds.has(relationship.toId)),
  relationshipCountBounded: state.relationships.length <= MAX_RELATIONSHIP_RECORDS,
  relationshipDegreeBounded: state.agents.every((agent) => agent.relationshipIds.length <= MAX_RELATIONSHIPS_PER_AGENT),
  ecologicalRelationshipCountBounded: ecologicalRelationships.length <= MAX_ECOLOGICAL_RELATIONSHIPS,
  ecologicalRelationshipsHealthy,
  facilityCountBounded: state.facilities.length <= width * height * MAX_FACILITIES_PER_REGION,
  validOrganizationMembers: state.organizations.every((organization) => organization.memberIds.every((memberId) => agentIds.has(memberId))),
  validDiplomacyReferences: state.organizations.every((organization) => Object.keys(organization.diplomacy ?? {}).every((organizationId) => organizationId !== organization.id && organizationIds.has(organizationId as never))),
  validResourceHolders: state.resources.every((resource) => !resource.holderId
    || !isEntityHolderId(resource.holderId)
    || agentIds.has(resource.holderId as never)
    || organizationIds.has(resource.holderId as never)),
  validWorldviewLifecycle: state.worldview.entities.every((entity) => [
    entity.influence,
    entity.viability ?? 0,
    entity.supporterCount ?? 0,
    entity.activePractitionerCount ?? 0,
    entity.sponsorCount ?? 0,
    entity.revivalCount ?? 0,
  ].every((value) => Number.isFinite(value) && value >= 0)
    && entity.influence <= 1
    && (entity.viability ?? 0) <= 1
    && (entity.memberIds ?? []).every((memberId) => agentIds.has(memberId))
     && (!entity.sponsorOrganizationId || organizationIds.has(entity.sponsorOrganizationId))),
  worldviewInteractionsBounded: state.worldview.interactions.length <= MAX_WORLDVIEW_INTERACTIONS,
  validWorldviewInteractions: state.worldview.interactions.every((interaction) => {
    const source = state.worldview.entities.find((entity) => entity.id === interaction.sourceEntityId);
    const target = state.worldview.entities.find((entity) => entity.id === interaction.targetEntityId);
    return Boolean(source && target && source.packId !== target.packId
      && source.regionId === interaction.regionId
      && target.regionId === (interaction.targetRegionId ?? interaction.regionId)
      && (!interaction.fusionEntityId || state.worldview.entities.some((entity) => entity.id === interaction.fusionEntityId))
      && [interaction.originTick, interaction.lastInteractionTick, interaction.attempts, interaction.successes, interaction.failures, interaction.compatibility, interaction.intensity].every((value) => Number.isFinite(value) && value >= 0))
      && interaction.compatibility <= 1
      && interaction.intensity <= 1;
  }),
  worldviewPhenomenaBounded: state.worldview.phenomena.length <= MAX_WORLDVIEW_PHENOMENA,
  worldviewPracticesBounded: state.worldview.practices.length <= MAX_WORLDVIEW_PRACTICES,
  worldviewEntitiesBounded: state.worldview.entities.length <= MAX_WORLDVIEW_ENTITIES,
  boundedOrganizationArchiveIndex: archivedOrganizationIds.length <= organizationIds.size && archivedOrganizationIds.every((organizationId) => organizationIds.has(organizationId as never)),
  substanceCountBounded: state.substances.length <= MAX_SUBSTANCES,
  validSubstanceParents: state.substances.every((substance) => substance.parentIds.every((parentId) => state.substances.some((candidate) => candidate.id === parentId))),
  finiteSubstanceReserves: state.substances.every((substance) => [substance.reserveCapacity, substance.remainingReserve, substance.extractedTotal, substance.depletedTick ?? 0].every((value) => Number.isFinite(value) && value >= 0)
    && substance.reserveCapacity <= MAX_SUBSTANCE_RESERVE
    && substance.remainingReserve <= substance.reserveCapacity
    && substance.extractedTotal <= substance.reserveCapacity),
  pathogenCountBounded: state.pathogens.length <= MAX_PATHOGENS,
  validPathogenHosts: state.pathogens.every((pathogen) => speciesIds.has(pathogen.hostSpeciesId)
    && [pathogen.transmission, pathogen.severity, pathogen.persistence, pathogen.prevalence].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)),
  regionalOutbreaksBounded: state.pathogens.every((pathogen) => pathogen.regionalOutbreaks.length <= MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN
    && new Set(pathogen.regionalOutbreaks.map((outbreak) => outbreak.regionId)).size === pathogen.regionalOutbreaks.length
    && pathogen.regionalOutbreaks.every((outbreak) => [outbreak.prevalence, outbreak.firstDetectedTick, outbreak.lastActiveTick].every(Number.isFinite))),
  validAgentHealth: state.agents.every((agent) => Boolean(agent.health)
    && Number.isFinite(agent.health!.vitality)
    && agent.health!.vitality >= 0
    && agent.health!.vitality <= 1
    && agent.health!.infections.length <= MAX_INFECTIONS_PER_AGENT
    && agent.health!.immunityIds.length <= MAX_IMMUNITY_IDS_PER_AGENT
    && agent.health!.infections.every((infection) => state.pathogens.some((pathogen) => pathogen.id === infection.pathogenId))
    && agent.health!.immunityIds.every((id) => state.pathogens.some((pathogen) => pathogen.id === id))),
  validAgentGenetics: state.agents.every((agent) => validAgentGenetics(agent.genetics)
    && HERITABLE_AGENT_TRAITS.every((trait) => Number.isFinite(agent.traits[trait]) && agent.traits[trait]! >= 0 && agent.traits[trait]! <= 1)),
  denseScenarioCovered: scenario !== "dense" || Object.values(denseCoverage).every(Boolean),
};
const healthy = Object.values(health).every(Boolean);
const withinBudget = averageStep <= stepBudgetMs;
const segmentMidpoint = Math.ceil(segments.length / 2);
const meanSegmentCost = (values: typeof segments): number => values.reduce((sum, segment) => sum + segment.averageStepMs, 0) / Math.max(1, values.length);
const initialSegmentCost = meanSegmentCost(segments.slice(0, segmentMidpoint));
const recentSegmentCost = meanSegmentCost(segments.slice(segmentMidpoint));
const segmentSlowdown = segments.length < 2 || initialSegmentCost <= 0 ? 1 : recentSegmentCost / initialSegmentCost;
const stableStepCost = segmentSlowdown <= maxSegmentSlowdown;
const profile = Object.fromEntries([...stageTimings.entries()].map(([stage, milliseconds]) => [stage, Number((milliseconds / profileSteps).toFixed(4))]));
const slowestStage = Object.entries(profile).sort((left, right) => right[1] - left[1])[0];
console.log(JSON.stringify({
  scenario,
  seed,
  warmupSteps,
  warmupGrid: `${warmupWidth}x${warmupHeight}`,
  steps,
  grid: `${width}x${height}`,
  stepBudgetMs,
  maxSegmentSlowdown,
  withinBudget,
  stableStepCost,
  segmentSlowdown: Number(segmentSlowdown.toFixed(4)),
  healthy,
  health,
  elapsedMs: Number(elapsed.toFixed(2)),
  averageStepMs: Number(averageStep.toFixed(4)),
  hotspots: state.lod.summaries.length,
  agents: state.agents.length,
  peakHotspots,
  peakAgents,
  peakOrganizations,
  peakFacilities,
  denseCoverage,
  species: state.species.length,
  substances: state.substances.length,
  pathogens: state.pathogens.length,
  events: state.events.length,
  milestones: state.eventArchive.milestones.length,
  strategicRoutes: state.eventArchive.strategicRoutes.length,
  tectonicPlates: state.tectonics.plates.length,
  atmosphereUpdates: state.atmosphere.updateCount,
  oceanUpdates: state.ocean.updateCount,
  archivedEvents: state.eventArchive.archivedEventCount,
  archivedSpecies: state.eventArchive.archivedSpeciesCount,
  archivedKnowledge: state.eventArchive.archivedKnowledgeCount,
  archivedCultures: state.eventArchive.archivedCultureCount,
  archivedRelationships: state.eventArchive.archivedRelationshipCount,
  totalEvents: state.eventArchive.totalEventCount,
  segments,
  profile,
  slowestStage: slowestStage ? { id: slowestStage[0], averageMs: slowestStage[1] } : null,
  digest: worldDigest(state),
}, null, 2));

if (!healthy || !withinBudget || !stableStepCost) process.exitCode = 1;
