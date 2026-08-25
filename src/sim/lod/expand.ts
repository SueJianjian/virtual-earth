import { hashString } from "../random.ts";
import type { AgentState, EntityId, OrganizationState, RegionProjection, RegionSummary, RelationshipState } from "../types.ts";

const asEntityId = (value: string): EntityId => value as EntityId;
const asOrganizationId = (value: string): OrganizationState["id"] => value as OrganizationState["id"];

export const projectRegion = (summary: RegionSummary, version: number): RegionProjection => {
  const count = Math.max(0, Math.min(128, Math.floor(summary.population)));
  const sourceAgentIds = [...summary.agentIds].sort();
  const sourceRecords = new Map((summary.agentRecords ?? []).map((record) => [record.id, record]));
  const agents: AgentState[] = [];
  for (let index = 0; index < count; index += 1) {
    const sourceId = sourceAgentIds[index];
    const source = sourceId ? sourceRecords.get(sourceId) : undefined;
    const id = asEntityId(`agent:${hashString(`${summary.canonicalDigest}:${version}:${index}`).toString(16)}`);
    agents.push({
      id,
      populationId: asEntityId(`population:${summary.regionId}`),
      regionId: summary.regionId,
      age: source?.age ?? hashString(`${summary.canonicalDigest}:age:${index}`) % 60,
      lifespan: 45 + hashString(`${summary.canonicalDigest}:lifespan:${index}`) % 50,
      parentIds: [],
      traits: { cognitivePotential: 0.2 + (index % 7) * 0.05, sociality: 0.3 + (index % 5) * 0.1, cooperation: 0.3 + (index % 4) * 0.1 },
      skills: source?.skills ? { ...source.skills } : { observation: 0.1 + (index % 6) * 0.04, communication: 0.1 + (index % 5) * 0.05 },
      needs: { food: 0.5, safety: 0.5, belonging: 0.2 },
      memoryIds: [],
      knowledgeIds: source?.knowledgeIds ? [...source.knowledgeIds] : [],
      beliefIds: source?.beliefIds ? [...source.beliefIds] : [],
      relationshipIds: [],
    });
  }
  const relationships: RelationshipState[] = [];
  const projectedIdFor = new Map<string, EntityId>();
  for (let index = 0; index < sourceAgentIds.length; index += 1) {
    const projected = agents[index];
    if (projected) projectedIdFor.set(sourceAgentIds[index]!, projected.id);
  }
  for (let index = 0; index < agents.length; index += 1) {
    const projected = agents[index];
    const sourceId = sourceAgentIds[index];
    const source = sourceId ? sourceRecords.get(sourceId) : undefined;
    if (projected && source) projected.parentIds = source.parentIds.map((parentId) => projectedIdFor.get(parentId)).filter((parentId): parentId is EntityId => Boolean(parentId));
  }
  if (summary.relationshipRecords.length > 0) {
    for (const source of summary.relationshipRecords) {
      const fromId = projectedIdFor.get(source.fromId);
      const toId = projectedIdFor.get(source.toId);
      if (!fromId || !toId) continue;
      const relation: RelationshipState = { ...source, fromId, toId };
      relationships.push(relation);
      agents.find((agent) => agent.id === fromId)?.relationshipIds.push(relation.id);
      agents.find((agent) => agent.id === toId)?.relationshipIds.push(relation.id);
    }
  } else {
    const relationshipCount = Math.min(summary.relationshipCount, agents.length > 1 ? agents.length * 2 : 0);
    for (let index = 0; index < relationshipCount; index += 1) {
      const first = agents[index % agents.length];
      const second = agents[(index + 1) % agents.length];
      if (!first || !second) continue;
      const relation: RelationshipState = {
        id: `relationship:projection:${hashString(`${summary.canonicalDigest}:${index}`).toString(16)}`,
        fromId: first.id,
        toId: second.id,
        kind: index < summary.householdCount ? "partner" : "friend",
        strength: 0.4,
        createdTick: version,
        sourceEventId: `projection:${summary.canonicalDigest}`,
      };
      relationships.push(relation);
      first.relationshipIds.push(relation.id);
      second.relationshipIds.push(relation.id);
    }
  }
  const organizations: OrganizationState[] = [];
  for (const summaryOrganization of summary.organizations) {
    const sourceMembers = (summaryOrganization.memberIds ?? []).map((memberId) => projectedIdFor.get(memberId)).filter((memberId): memberId is EntityId => Boolean(memberId));
    const memberCount = Math.min(summaryOrganization.memberCount, agents.length);
    const memberIds = sourceMembers.length > 0 ? sourceMembers : agents.slice(0, memberCount).map((agent) => agent.id);
    organizations.push({
      id: asOrganizationId(summaryOrganization.id),
      type: summaryOrganization.type,
      memberIds,
      childOrganizationIds: [...summaryOrganization.childIds],
      regionId: summary.regionId,
      resources: Object.fromEntries(summaryOrganization.resourceIds.map((resourceId) => [resourceId, 0])),
      status: "active",
    });
  }
  return { regionId: summary.regionId, sourceRevision: version, readOnly: true, generatedFromDigest: summary.canonicalDigest, agents, relationships, organizations };
};
