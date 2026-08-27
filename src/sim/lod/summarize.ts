import { hashString } from "../random.ts";
import type { Distribution, FamilyLineageSummary, OrganizationSummary, PopulationState, RegionAgentRecord, RegionId, RegionSummary, RelationshipState, WorldDelta, WorldState } from "../types.ts";
import { summarizeLineage } from "./lineage.ts";
import { foodSecurityFromBalance, meanFoodSecurity } from "../agents/food.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
const distribution = (values: number[]): Distribution => ({ bins: values.reduce<Record<string, number>>((bins, value) => { const key = String(Math.max(0, Math.min(9, Math.floor(value * 10)))); bins[key] = (bins[key] ?? 0) + 1; return bins; }, {}) });
const MAX_SUMMARY_HISTORY_IDS = 128;

const boundedIds = (ids: readonly string[]): string[] => [...new Set(ids)].sort().slice(-MAX_SUMMARY_HISTORY_IDS);

const eventTouchesRegion = (event: WorldState["events"][number], regionId: RegionId, organizationIds: ReadonlySet<string>): boolean => {
  const regionValues = [
    event.payload.regionId,
    event.payload.fromRegion,
    event.payload.toRegion,
    event.evidence.regionId,
    event.evidence.fromRegion,
    event.evidence.toRegion,
  ];
  return regionValues.includes(regionId)
    || event.sourceIds.some((sourceId) => organizationIds.has(sourceId));
};

const regionEventsFor = (state: WorldState, regionId: RegionId, organizationIds: readonly string[] = []): WorldState["events"] => {
  const organizations = new Set(organizationIds);
  return state.events.filter((event) => eventTouchesRegion(event, regionId, organizations));
};

export const aggregatePopulationForRegion = (
  state: WorldState,
  regionId: RegionId,
  fallback = 0,
  populations: readonly PopulationState[] = state.populations,
): number => {
  const local = populations.filter((population) => population.regionId === regionId);
  if (local.length === 0) return Math.max(0, fallback);
  return local.reduce((sum, population) => sum + Math.max(0, Number.isFinite(population.count) ? population.count : 0), 0);
};

const canonicalDigestFor = (summary: RegionSummary): string => hashString(JSON.stringify({
  regionId: summary.regionId,
  mode: summary.mode,
  population: summary.population,
  populationByAge: summary.populationByAge,
  skillHistogram: summary.skillHistogram,
  cultureHistogram: summary.cultureHistogram,
  householdCount: summary.householdCount,
  organizations: summary.organizations,
  agentRecords: [...summary.agentRecords].sort((left, right) => left.id.localeCompare(right.id)),
  relationships: [...summary.relationshipRecords].sort((left, right) => left.id.localeCompare(right.id)),
  lineage: summary.lineage,
  familyLineages: summary.familyLineages,
  resources: summary.resources,
})).toString(16);

export const summarizeRegionState = (state: WorldState, regionId: RegionId, mode: "aggregate" | "micro" = "aggregate"): RegionSummary => {
  const agents = state.agents.filter((agent) => agent.regionId === regionId);
  const agentIds = agents.map((agent) => agent.id).sort();
  const organizations = state.organizations.filter((organization) => organization.regionId === regionId);
  const regionEvents = regionEventsFor(state, regionId, organizations.map((organization) => organization.id));
  const historyIds = boundedIds(regionEvents.map((event) => event.id));
  const organizationSummaries: OrganizationSummary[] = organizations.map((organization) => ({
    id: organization.id,
    type: organization.type,
    memberCount: organization.memberIds.length,
    memberIds: [...organization.memberIds],
    childIds: [...organization.childOrganizationIds],
    resourceIds: Object.keys(organization.resources).sort(),
    historyIds: boundedIds(regionEvents.filter((event) => event.sourceIds.includes(organization.id) || event.payload.organizationId === organization.id).map((event) => event.id)),
    archivedHistoryCount: Math.max(organization.archivedHistoryCount ?? 0, state.eventArchive.organizationCounts[organization.id] ?? 0),
    territoryRegionIds: [...organization.territoryRegionIds],
    ...(organization.governance ? { governance: { ...organization.governance } } : {}),
    ...(organization.diplomacy ? { diplomacy: { ...organization.diplomacy } } : {}),
  }));
  const agentRecords: RegionAgentRecord[] = agents.map((agent) => ({ id: agent.id, age: agent.age, parentIds: [...agent.parentIds], skills: { ...agent.skills }, knowledgeIds: [...agent.knowledgeIds], beliefIds: [...agent.beliefIds] }));
  const relationshipRecords: RelationshipState[] = state.relationships.filter((relationship) => agentIds.includes(relationship.fromId) && agentIds.includes(relationship.toId)).map((relationship) => structuredClone(relationship));
  const relationshipIds = relationshipRecords.map((relationship) => relationship.id).sort();
  const lineage = summarizeLineage(agents, relationshipRecords);
  const familyLineages: FamilyLineageSummary[] = organizations
    .filter((organization) => organization.type === "family")
    .map((family) => {
      const memberIds = new Set(family.memberIds);
      const familyAgents = agents.filter((agent) => memberIds.has(agent.id));
      const familyRelationships = relationshipRecords.filter((relationship) => memberIds.has(relationship.fromId) && memberIds.has(relationship.toId));
      return {
        id: family.id,
        memberCount: family.memberIds.length,
        relationshipCount: familyRelationships.length,
        ...summarizeLineage(familyAgents, familyRelationships),
      };
    });
  const foodBalance = state.resources.filter((resource) => resource.resourceId === "food" && resource.regionId === regionId).reduce((sum, resource) => sum + resource.amount, 0);
  const population = agents.length;
  const foodPerAgent = foodBalance / Math.max(1, population);
  const foodSecurity = meanFoodSecurity({ resources: state.resources, organizations, agents });
  const migrationEvents = regionEvents.filter((event) => event.kind === "population-migration" || event.kind === "population-dispersal");
  const summary: RegionSummary = {
    regionId,
    version: state.tick,
    mode,
    population,
    populationByAge: distribution(agents.map((agent) => Math.min(0.99, agent.age / 100))),
    skillHistogram: distribution(agents.map((agent) => Object.values(agent.skills).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(agent.skills).length))),
    cultureHistogram: distribution(agents.map((agent) => Math.min(0.99, agent.knowledgeIds.length / 10))),
    householdCount: organizations.filter((organization) => organization.type === "family").length,
    organizations: organizationSummaries,
    agentIds,
    agentRecords,
    relationshipCount: relationshipIds.length,
    relationshipDigest: hashString(JSON.stringify(relationshipIds)).toString(16),
    relationshipRecords,
    lineage,
    familyLineages,
    foodBalance,
    foodPerAgent,
    foodSecurity,
    resources: structuredClone(state.resources.filter((resource) => resource.regionId === regionId)),
    migrationRate: Math.min(1, migrationEvents.length / Math.max(1, agents.length)),
    historyIds,
    archivedHistoryCount: state.eventArchive.regionCounts[regionId] ?? 0,
    random: { ...state.random },
    canonicalDigest: "",
  };
  summary.canonicalDigest = canonicalDigestFor(summary);
  return summary;
};

export const refreshAggregateSummary = (
  state: WorldState,
  previous: RegionSummary,
  populations: readonly PopulationState[] = state.populations,
): RegionSummary => {
  const current = summarizeRegionState(state, previous.regionId, "aggregate");
  const hadRegionalPopulation = state.populations.some((candidate) => candidate.regionId === previous.regionId);
  const hasRegionalPopulation = populations.some((candidate) => candidate.regionId === previous.regionId);
  const population = hasRegionalPopulation
    ? aggregatePopulationForRegion(state, previous.regionId, 0, populations)
    : hadRegionalPopulation ? 0 : previous.population;
  const regionEvents = regionEventsFor(state, previous.regionId, previous.organizations.map((organization) => organization.id));
  const organizationEvents = new Map<string, string[]>();
  for (const organization of previous.organizations) {
    organizationEvents.set(organization.id, regionEvents
      .filter((event) => event.sourceIds.includes(organization.id) || event.payload.organizationId === organization.id)
      .map((event) => event.id));
  }
  const organizations = previous.organizations.length > 0
    ? previous.organizations.map((organization) => ({
      ...organization,
      historyIds: boundedIds([...organization.historyIds, ...(organizationEvents.get(organization.id) ?? [])]),
    }))
    : current.organizations;
  const migrationEvents = regionEvents.filter((event) => event.kind === "population-migration" || event.kind === "population-dispersal").length;
  const summary: RegionSummary = {
    ...current,
    version: state.tick,
    mode: "aggregate",
    population,
    populationByAge: previous.populationByAge,
    skillHistogram: previous.skillHistogram,
    cultureHistogram: previous.cultureHistogram,
    householdCount: organizations.filter((organization) => organization.type === "family").length,
    organizations,
    agentIds: [...previous.agentIds],
    agentRecords: structuredClone(previous.agentRecords),
    relationshipCount: previous.relationshipCount,
    relationshipDigest: previous.relationshipDigest,
    relationshipRecords: structuredClone(previous.relationshipRecords),
    lineage: structuredClone(previous.lineage),
    familyLineages: structuredClone(previous.familyLineages),
    foodPerAgent: current.foodBalance / Math.max(1, population),
    foodSecurity: foodSecurityFromBalance(current.foodBalance, population),
    migrationRate: Math.min(1, previous.migrationRate * 0.85 + (migrationEvents / Math.max(1, population)) * 0.15),
    historyIds: boundedIds([...previous.historyIds, ...regionEvents.map((event) => event.id)]),
    archivedHistoryCount: Math.max(previous.archivedHistoryCount ?? 0, state.eventArchive.regionCounts[previous.regionId] ?? 0),
    random: { ...state.random },
    canonicalDigest: "",
  };
  summary.canonicalDigest = canonicalDigestFor(summary);
  return summary;
};

export const summarizeRegion = (state: WorldState, regionId: RegionId): WorldDelta => {
  const delta = emptyDelta();
  const agents = state.agents.filter((agent) => agent.regionId === regionId);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const relationships = state.relationships.filter((relationship) => agentIds.has(relationship.fromId) && agentIds.has(relationship.toId));
  const organizations = state.organizations.filter((organization) => organization.regionId === regionId);
  for (const agent of agents) delta.entityEffects.push({ collection: "agents", operation: "remove", id: agent.id });
  for (const relationship of relationships) delta.relationshipEffects.push({ operation: "remove", relationship });
  for (const organization of organizations) delta.entityEffects.push({ collection: "organizations", operation: "remove", id: organization.id });
  delta.lodEffects = [{ operation: "upsert-summary", summary: summarizeRegionState(state, regionId, "aggregate") }];
  delta.eventDrafts.push({ kind: "region-summarized", ruleId: "natural-deaggregation", sourceIds: agents.map((agent) => agent.id), probability: 1, roll: 0, evidence: { population: agents.length }, payload: { regionId }, source: "natural" });
  return delta;
};
