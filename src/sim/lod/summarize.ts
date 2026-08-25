import { hashString } from "../random.ts";
import type { Distribution, EntityEffect, OrganizationSummary, RegionId, RegionSummary, WorldDelta, WorldState } from "../types.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
const distribution = (values: number[]): Distribution => ({ bins: values.reduce<Record<string, number>>((bins, value) => { const key = String(Math.max(0, Math.min(9, Math.floor(value * 10)))); bins[key] = (bins[key] ?? 0) + 1; return bins; }, {}) });

export const summarizeRegionState = (state: WorldState, regionId: RegionId, mode: "aggregate" | "micro" = "aggregate"): RegionSummary => {
  const agents = state.agents.filter((agent) => agent.regionId === regionId);
  const organizations = state.organizations.filter((organization) => organization.regionId === regionId);
  const organizationSummaries: OrganizationSummary[] = organizations.map((organization) => ({ id: organization.id, type: organization.type, memberCount: organization.memberIds.length, childIds: [...organization.childOrganizationIds], resourceIds: Object.keys(organization.resources).sort(), historyIds: [] }));
  const relationshipIds = state.relationships.filter((relationship) => agents.some((agent) => agent.id === relationship.fromId || agent.id === relationship.toId)).map((relationship) => relationship.id).sort();
  const canonical = { regionId, mode, agents: agents.map((agent) => ({ id: agent.id, age: agent.age, skills: agent.skills, knowledgeIds: agent.knowledgeIds })).sort((left, right) => left.id.localeCompare(right.id)), organizations: organizationSummaries, relationships: relationshipIds, resources: state.resources.filter((resource) => resource.regionId === regionId) };
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
    relationshipDigest: hashString(JSON.stringify(relationshipIds)).toString(16),
    resources: structuredClone(state.resources.filter((resource) => resource.regionId === regionId)),
    migrationRate: 0,
    historyIds: [],
    random: { ...state.random },
    canonicalDigest: hashString(JSON.stringify(canonical)).toString(16),
  };
};

export const summarizeRegion = (state: WorldState, regionId: RegionId): WorldDelta => {
  const delta = emptyDelta();
  const agents = state.agents.filter((agent) => agent.regionId === regionId);
  const relationships = state.relationships.filter((relationship) => agents.some((agent) => agent.id === relationship.fromId || agent.id === relationship.toId));
  const organizations = state.organizations.filter((organization) => organization.regionId === regionId);
  for (const agent of agents) delta.entityEffects.push({ collection: "agents", operation: "remove", id: agent.id });
  for (const relationship of relationships) delta.relationshipEffects.push({ operation: "remove", relationship });
  for (const organization of organizations) delta.entityEffects.push({ collection: "organizations", operation: "remove", id: organization.id });
  delta.lodEffects = [{ operation: "upsert-summary", summary: summarizeRegionState(state, regionId, "aggregate") }];
  delta.eventDrafts.push({ kind: "region-summarized", ruleId: "natural-deaggregation", sourceIds: agents.map((agent) => agent.id), probability: 1, roll: 0, evidence: { population: agents.length }, payload: { regionId }, source: "natural" });
  return delta;
};
