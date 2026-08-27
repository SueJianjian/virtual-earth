import { hashString } from "../random.ts";
import type { AggregateKnowledgeSummary, CultureState, Distribution, FamilyLineageSummary, OrganizationSummary, OrganizationType, PopulationState, RegionAgentRecord, RegionCultureSummary, RegionId, RegionSocietySummary, RegionSummary, RelationshipState, WorldDelta, WorldState } from "../types.ts";
import { summarizeLineage } from "./lineage.ts";
import { foodSecurityFromBalance, meanFoodSecurity } from "../agents/food.ts";
import { cultureIdentityFor } from "../culture/identity.ts";
import { evolveAggregateRegion, initialAggregateCulture, initialAggregateSociety, organizationSummariesForAggregate, socialPotentialForRegion, socialPopulationForRegion } from "./aggregate.ts";
import { governanceForOrganization } from "../society/organization.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
const distribution = (values: number[]): Distribution => ({ bins: values.reduce<Record<string, number>>((bins, value) => { const key = String(Math.max(0, Math.min(9, Math.floor(value * 10)))); bins[key] = (bins[key] ?? 0) + 1; return bins; }, {}) });
const MAX_SUMMARY_HISTORY_IDS = 128;

const boundedIds = (ids: readonly string[]): string[] => [...new Set(ids)].sort().slice(-MAX_SUMMARY_HISTORY_IDS);

const organizationTypes: OrganizationType[] = ["family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"];

const aggregateKnowledgeFor = (state: WorldState, culture: CultureState): AggregateKnowledgeSummary[] => {
  const knownIds = new Set(culture.knowledgeIds);
  return state.knowledge
    .filter((knowledge) => knownIds.has(knowledge.id))
    .map((knowledge) => ({
      id: knowledge.id,
      kind: knowledge.kind,
      ...(knowledge.name === undefined ? {} : { name: knowledge.name }),
      ...(knowledge.domain === undefined ? {} : { domain: knowledge.domain }),
      credibility: knowledge.credibility,
      transmissionCost: knowledge.transmissionCost,
      forgettingRate: knowledge.forgettingRate,
      originRegionId: knowledge.originRegionId ?? culture.regionId,
      originTick: knowledge.originTick ?? 0,
      originYears: knowledge.originYears ?? 0,
      parentIds: [...(knowledge.parentIds ?? [])],
    }));
};

const cultureSummaryFor = (state: WorldState, regionId: RegionId, culture: CultureState | undefined, agents: readonly WorldState["agents"][number][]): RegionCultureSummary | undefined => {
  if (!culture) return undefined;
  const identity = cultureIdentityFor(culture);
  const knowledge = aggregateKnowledgeFor(state, culture);
  return {
    id: culture.id,
    identity,
    knowledge,
    beliefCount: culture.beliefIds.length,
    transmissionRate: culture.transmissionRate,
    memoryStrength: Math.max(0, Math.min(1, (culture.transmissionRate * 0.6) + Math.min(1, knowledge.length / 12) * 0.4)),
    innovationCount: knowledge.filter((item) => item.domain !== undefined).length,
    lastChangeTick: state.tick,
  };
};

const societySummaryFor = (state: WorldState, regionId: RegionId, organizations: readonly WorldState["organizations"][number][], facilities: readonly WorldState["facilities"][number][]): RegionSocietySummary => {
  const organizationCounts = Object.fromEntries(organizationTypes.map((type) => [type, organizations.filter((organization) => organization.type === type && organization.status !== "collapsed").length])) as Record<OrganizationType, number>;
  const governed = organizations
    .filter((organization) => organization.status !== "collapsed")
    .map((organization) => governanceForOrganization(organization));
  const mean = (key: "cohesion" | "stability" | "legitimacy" | "military" | "publicGoods"): number => governed.length === 0 ? 0.45 : governed.reduce((sum, governance) => sum + governance[key], 0) / governed.length;
  const regionalEvents = regionEventsFor(state, regionId, organizations.map((organization) => organization.id));
  const tradeVolume = regionalEvents
    .filter((event) => event.kind === "organization-trade" || event.kind === "interregional-trade")
    .reduce((sum, event) => sum + Math.max(0, Number(event.payload.amount ?? event.evidence.amount ?? 0)), 0);
  const conflictEvents = regionalEvents.filter((event) => event.kind.includes("conflict") || event.kind.includes("war")).length;
  const activeFacilities = facilities.filter((facility) => facility.regionId === regionId && (facility.status === "active" || facility.status === "damaged"));
  return {
    organizationCounts,
    organizationCapacity: organizations.reduce((sum, organization) => sum + organization.memberIds.length, 0),
    cohesion: Math.max(0, Math.min(1, mean("cohesion"))),
    stability: Math.max(0, Math.min(1, mean("stability"))),
    legitimacy: Math.max(0, Math.min(1, mean("legitimacy"))),
    military: Math.max(0, Math.min(1, mean("military"))),
    publicGoods: Math.max(0, Math.min(1, mean("publicGoods"))),
    tradeVolume: Math.min(1_000_000_000, Math.max(0, tradeVolume)),
    conflictPressure: Math.min(1, conflictEvents / 12),
    infrastructureLevel: Math.min(1, activeFacilities.reduce((sum, facility) => sum + facility.level, 0) / 12),
    lastChangeTick: state.tick,
  };
};

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
  socialPopulation: summary.socialPopulation,
  householdCount: summary.householdCount,
  organizations: summary.organizations,
  agentRecords: [...summary.agentRecords].sort((left, right) => left.id.localeCompare(right.id)),
  relationships: [...summary.relationshipRecords].sort((left, right) => left.id.localeCompare(right.id)),
  lineage: summary.lineage,
  familyLineages: summary.familyLineages,
  cultureSummary: summary.cultureSummary,
  societySummary: summary.societySummary,
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
  const culture = state.cultures.find((candidate) => candidate.regionId === regionId);
  const cultureSummary = cultureSummaryFor(state, regionId, culture, agents);
  const societySummary = societySummaryFor(state, regionId, organizations, state.facilities);
  const socialPopulation = agents.length > 0
    ? agents.length
    : mode === "aggregate" ? socialPopulationForRegion(state, regionId) : 0;
  const summary: RegionSummary = {
    regionId,
    version: state.tick,
    mode,
    population,
    socialPopulation,
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
    ...(cultureSummary ? { cultureSummary } : {}),
    societySummary,
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

export const refreshAggregateSummaryWithEvents = (
  state: WorldState,
  previous: RegionSummary,
  populations: readonly PopulationState[] = state.populations,
): { summary: RegionSummary; events: WorldDelta["eventDrafts"] } => {
  const current = summarizeRegionState(state, previous.regionId, "aggregate");
  const hadRegionalPopulation = state.populations.some((candidate) => candidate.regionId === previous.regionId);
  const hasRegionalPopulation = populations.some((candidate) => candidate.regionId === previous.regionId);
  const population = hasRegionalPopulation
    ? aggregatePopulationForRegion(state, previous.regionId, 0, populations)
    : hadRegionalPopulation ? 0 : previous.population;
  const regionEvents = regionEventsFor(state, previous.regionId, previous.organizations.map((organization) => organization.id));
  const migrationEvents = regionEvents.filter((event) => event.kind === "population-migration" || event.kind === "population-dispersal").length;
  const culture = state.cultures.find((candidate) => candidate.regionId === previous.regionId);
  const existingCultureSummary = previous.cultureSummary
    ?? cultureSummaryFor(state, previous.regionId, culture, state.agents.filter((agent) => agent.regionId === previous.regionId))
    ?? initialAggregateCulture(state, previous.regionId, previous.socialPopulation ?? previous.population);
  const existingSocietySummary = previous.societySummary ?? initialAggregateSociety(previous);
  const socialPopulationEstimate = previous.socialPopulation ?? previous.population;
  const socialFoodSecurity = foodSecurityFromBalance(current.foodBalance, socialPopulationEstimate);
  const evolution = evolveAggregateRegion(
    state,
    { ...previous, cultureSummary: existingCultureSummary, societySummary: existingSocietySummary },
    population,
    socialPotentialForRegion(state, previous.regionId, populations),
    current.foodBalance,
    socialFoodSecurity,
    regionEvents,
  );
  const evolvedOrganizations = organizationSummariesForAggregate(previous.organizations, previous.regionId, evolution.society, evolution.socialPopulation);
  const summary: RegionSummary = {
    ...current,
    version: state.tick,
    mode: "aggregate",
    population,
    socialPopulation: evolution.socialPopulation,
    populationByAge: previous.populationByAge,
    skillHistogram: previous.skillHistogram,
    cultureHistogram: previous.cultureHistogram,
    householdCount: evolution.society.organizationCounts.family,
    organizations: evolvedOrganizations,
    agentIds: [...previous.agentIds],
    agentRecords: structuredClone(previous.agentRecords),
    relationshipCount: previous.relationshipCount,
    relationshipDigest: previous.relationshipDigest,
    relationshipRecords: structuredClone(previous.relationshipRecords),
    lineage: structuredClone(previous.lineage),
    familyLineages: structuredClone(previous.familyLineages),
    cultureSummary: evolution.culture,
    societySummary: evolution.society,
    foodPerAgent: current.foodBalance / Math.max(1, population),
    foodSecurity: foodSecurityFromBalance(current.foodBalance, population),
    migrationRate: Math.min(1, previous.migrationRate * 0.85 + (migrationEvents / Math.max(1, population)) * 0.15),
    historyIds: boundedIds([...previous.historyIds, ...regionEvents.map((event) => event.id)]),
    archivedHistoryCount: Math.max(previous.archivedHistoryCount ?? 0, state.eventArchive.regionCounts[previous.regionId] ?? 0),
    random: { ...state.random },
    canonicalDigest: "",
  };
  summary.canonicalDigest = canonicalDigestFor(summary);
  return { summary, events: evolution.events };
};

export const refreshAggregateSummary = (
  state: WorldState,
  previous: RegionSummary,
  populations: readonly PopulationState[] = state.populations,
): RegionSummary => refreshAggregateSummaryWithEvents(state, previous, populations).summary;

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
