import { performance } from "node:perf_hooks";
import { clearSimulationStages, listSimulationStages, registerSimulationStage, stepWorld } from "../src/sim/engine.ts";
import { MAX_AGENT_MEMORY_IDS, MAX_DETAILED_AGENTS, MAX_RELATIONSHIP_RECORDS, MAX_RELATIONSHIPS_PER_AGENT } from "../src/sim/agents/lifecycle.ts";
import { EVENT_LOG_MAX_COUNT, MAX_EVENT_MILESTONES, MAX_MILESTONE_RELATED_IDS } from "../src/sim/events/ledger.ts";
import { MAX_SUBSTANCES } from "../src/sim/environment/substances.ts";
import { MAX_POPULATION_RECORDS } from "../src/sim/ecology/archive.ts";
import { MAX_BELIEFS_PER_CULTURE, MAX_CULTURE_RECORDS, MAX_KNOWLEDGE_PER_AGENT, MAX_KNOWLEDGE_PER_CULTURE, MAX_KNOWLEDGE_RECORDS } from "../src/sim/culture/archive.ts";
import { MAX_WORLDVIEW_ENTITIES, MAX_WORLDVIEW_PHENOMENA, MAX_WORLDVIEW_PRACTICES } from "../src/sim/worldview/archive.ts";
import { createWorld, isFiniteWorld, worldDigest } from "../src/sim/world.ts";

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
const requestedWidth = Number(process.argv[5] ?? process.env.BENCHMARK_WIDTH ?? 16);
const requestedHeight = Number(process.argv[6] ?? process.env.BENCHMARK_HEIGHT ?? 8);
const normalizeDimension = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 8 ? Math.min(256, Math.trunc(value)) : fallback;
const width = normalizeDimension(requestedWidth, 16);
const height = normalizeDimension(requestedHeight, 8);
let state = createWorld(seed, {
  width,
  height,
  ...(scenario === "dense" ? { formation: "formed" as const, enabledPackIds: ["emergence.original-worldview"] } : {}),
});
let peakAgents = state.agents.length;
let peakOrganizations = state.organizations.length;
let peakHotspots = state.lod.summaries.length;
const recordPeaks = (): void => {
  peakAgents = Math.max(peakAgents, state.agents.length);
  peakOrganizations = Math.max(peakOrganizations, state.organizations.length);
  peakHotspots = Math.max(peakHotspots, state.lod.summaries.length);
};
for (let index = 0; index < warmupSteps; index += 1) {
  state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
  recordPeaks();
}
const started = performance.now();
let segmentStarted = started;
let segmentFromStep = 1;
const segmentSize = Math.min(500, steps);
type CollectionCounts = {
  events: number;
  milestones: number;
  populations: number;
  agents: number;
  relationships: number;
  organizations: number;
  facilities: number;
  substances: number;
  knowledge: number;
  resources: number;
  phenomena: number;
  practices: number;
  worldviewEntities: number;
};
const collectionCounts = (): CollectionCounts => ({
  events: state.events.length,
  milestones: state.eventArchive.milestones.length,
  populations: state.populations.length,
  agents: state.agents.length,
  relationships: state.relationships.length,
  organizations: state.organizations.length,
  facilities: state.facilities.length,
  substances: state.substances.length,
  knowledge: state.knowledge.length,
  resources: state.resources.length,
  phenomena: state.worldview.phenomena.length,
  practices: state.worldview.practices.length,
  worldviewEntities: state.worldview.entities.length,
});
const segments: Array<{ fromStep: number; toStep: number; elapsedMs: number; collections: CollectionCounts }> = [];
for (let index = 0; index < steps; index += 1) {
  state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
  recordPeaks();
  if ((index + 1) % segmentSize === 0 || index + 1 === steps) {
    const now = performance.now();
    segments.push({ fromStep: segmentFromStep, toStep: index + 1, elapsedMs: Number((now - segmentStarted).toFixed(2)), collections: collectionCounts() });
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
  finite: isFiniteWorld(state),
  finiteArchiveCounters: archiveCounters.every((value) => Number.isFinite(value) && value >= 0),
  eventLogBounded: state.events.length <= EVENT_LOG_MAX_COUNT,
  milestoneArchiveBounded: state.eventArchive.milestones.length <= MAX_EVENT_MILESTONES,
  milestoneReferencesBounded: state.eventArchive.milestones.every((milestone) => [
    milestone.sourceIds.length,
    milestone.regionIds.length,
    milestone.organizationIds.length,
  ].every((count) => count <= MAX_MILESTONE_RELATED_IDS)
    && [milestone.tick, milestone.years ?? 0, milestone.probability, milestone.roll].every(Number.isFinite)),
  agentCountBounded: state.agents.length <= MAX_DETAILED_AGENTS,
  populationCountBounded: state.populations.length <= MAX_POPULATION_RECORDS,
  uniquePopulationRegions: new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`)).size === state.populations.length,
  validPopulationSpecies: state.populations.every((population) => speciesIds.has(population.speciesId)),
  validAgentPopulations: state.agents.every((agent) => populationIds.has(agent.populationId)),
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
  validOrganizationMembers: state.organizations.every((organization) => organization.memberIds.every((memberId) => agentIds.has(memberId))),
  validDiplomacyReferences: state.organizations.every((organization) => Object.keys(organization.diplomacy ?? {}).every((organizationId) => organizationId !== organization.id && organizationIds.has(organizationId as never))),
  validResourceHolders: state.resources.every((resource) => !resource.holderId || agentIds.has(resource.holderId as never) || organizationIds.has(resource.holderId as never)),
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
  worldviewPhenomenaBounded: state.worldview.phenomena.length <= MAX_WORLDVIEW_PHENOMENA,
  worldviewPracticesBounded: state.worldview.practices.length <= MAX_WORLDVIEW_PRACTICES,
  worldviewEntitiesBounded: state.worldview.entities.length <= MAX_WORLDVIEW_ENTITIES,
  boundedOrganizationArchiveIndex: archivedOrganizationIds.length <= organizationIds.size && archivedOrganizationIds.every((organizationId) => organizationIds.has(organizationId as never)),
  substanceCountBounded: state.substances.length <= MAX_SUBSTANCES,
  validSubstanceParents: state.substances.every((substance) => substance.parentIds.every((parentId) => state.substances.some((candidate) => candidate.id === parentId))),
};
const healthy = Object.values(health).every(Boolean);
const withinBudget = averageStep <= stepBudgetMs;
const profile = Object.fromEntries([...stageTimings.entries()].map(([stage, milliseconds]) => [stage, Number((milliseconds / profileSteps).toFixed(4))]));
const slowestStage = Object.entries(profile).sort((left, right) => right[1] - left[1])[0];
console.log(JSON.stringify({
  scenario,
  seed,
  warmupSteps,
  steps,
  grid: `${width}x${height}`,
  stepBudgetMs,
  withinBudget,
  healthy,
  health,
  elapsedMs: Number(elapsed.toFixed(2)),
  averageStepMs: Number(averageStep.toFixed(4)),
  hotspots: state.lod.summaries.length,
  agents: state.agents.length,
  peakHotspots,
  peakAgents,
  peakOrganizations,
  species: state.species.length,
  substances: state.substances.length,
  events: state.events.length,
  milestones: state.eventArchive.milestones.length,
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

if (!healthy || !withinBudget) process.exitCode = 1;
