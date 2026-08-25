import { hashString } from "../random.ts";
import type { Distribution, OrganizationSummary, RegionId, RegionSummary, RelationshipState, WorldDelta, WorldState } from "../types.ts";
import { summarizeLineage } from "./lineage.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
const distribution = (values: number[]): Distribution => ({ bins: values.reduce<Record<string, number>>((bins, value) => { const key = String(Math.max(0, Math.min(9, Math.floor(value * 10)))); bins[key] = (bins[key] ?? 0) + 1; return bins; }, {}) });

export const summarizeRegionState = (state: WorldState, regionId: RegionId, mode: "aggregate" | "micro" = "aggregate"): RegionSummary => {
  const agents = state.agents.filter((agent) => agent.regionId === regionId);
  const agentIds = agents.map((agent) => agent.id).sort();
  const organizations = state.organizations.filter((organization) => organization.regionId === regionId);
  const regionEvents = state.events.filter((event) => {
    const eventRegion = event.payload.regionId ?? event.evidence.regionId;
    return eventRegion === regionId || event.payload.fromRegion === regionId || event.payload.toRegion === regionId || event.sourceIds.some((sourceId) => organizations.some((organization) => organization.id === sourceId));
  });
  const historyIds = regionEvents.map((event) => event.id).sort();
  const organizationSummaries: OrganizationSummary[] = organizations.map((organization) => ({ id: organization.id, type: organization.type, memberCount: organization.memberIds.length, childIds: [...organization.childOrganizationIds], resourceIds: Object.keys(organization.resources).sort(), historyIds: regionEvents.filter((event) => event.sourceIds.includes(organization.id) || event.payload.organizationId === organization.id).map((event) => event.id).sort() }));
  const relationshipRecords: RelationshipState[] = state.relationships.filter((relationship) => agentIds.includes(relationship.fromId) && agentIds.includes(relationship.toId)).map((relationship) => structuredClone(relationship));
  const relationshipIds = relationshipRecords.map((relationship) => relationship.id).sort();
  const lineage = summarizeLineage(agents, relationshipRecords);
  const canonical = { regionId, mode, agents: agents.map((agent) => ({ id: agent.id, age: agent.age, parentIds: agent.parentIds, skills: agent.skills, knowledgeIds: agent.knowledgeIds, beliefIds: agent.beliefIds })).sort((left, right) => left.id.localeCompare(right.id)), organizations: organizationSummaries, relationships: relationshipIds, lineage, resources: state.resources.filter((resource) => resource.regionId === regionId) };
  return {
    regionId,
    version: state.tick,
    mode,
    population: agents.length,
    populationByAge: distribution(agents.map((agent) => Math.min(0.99, agent.age / 100))),
    skillHistogram: distribution(agents.map((agent) => Object.values(agent.skills).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(agent.skills).length))),
    cultureHistogram: distribution(agents.map((agent) => Math.min(0.99, agent.knowledgeIds.length / 10))),
    householdCount: organizations.filter((organization) => organization.type === "family").length,
    organizations: organizationSummaries,
    agentIds,
    relationshipCount: relationshipIds.length,
    relationshipDigest: hashString(JSON.stringify(relationshipIds)).toString(16),
    relationshipRecords,
    lineage,
    resources: structuredClone(state.resources.filter((resource) => resource.regionId === regionId)),
    migrationRate: regionEvents.filter((event) => event.kind === "agent-migration").length / Math.max(1, agents.length),
    historyIds,
    random: { ...state.random },
    canonicalDigest: hashString(JSON.stringify(canonical)).toString(16),
  };
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
