import { hashString } from "../random.ts";
import type { AgentState, EntityId, OrganizationState, RegionProjection, RegionSummary, RelationshipState } from "../types.ts";

const asEntityId = (value: string): EntityId => value as EntityId;
const asOrganizationId = (value: string): OrganizationState["id"] => value as OrganizationState["id"];

export const projectRegion = (summary: RegionSummary, version: number): RegionProjection => {
  const count = Math.max(0, Math.min(128, Math.floor(summary.population)));
  const agents: AgentState[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = asEntityId(`agent:${hashString(`${summary.canonicalDigest}:${version}:${index}`).toString(16)}`);
    agents.push({
      id,
      populationId: asEntityId(`population:${summary.regionId}`),
      regionId: summary.regionId,
      age: hashString(`${summary.canonicalDigest}:age:${index}`) % 60,
      lifespan: 45 + hashString(`${summary.canonicalDigest}:lifespan:${index}`) % 50,
      parentIds: [],
      traits: { cognitivePotential: 0.2 + (index % 7) * 0.05, sociality: 0.3 + (index % 5) * 0.1, cooperation: 0.3 + (index % 4) * 0.1 },
      skills: { observation: 0.1 + (index % 6) * 0.04, communication: 0.1 + (index % 5) * 0.05 },
      needs: { food: 0.5, safety: 0.5, belonging: 0.2 },
      memoryIds: [],
      knowledgeIds: [],
      beliefIds: [],
      relationshipIds: [],
    });
  }
  const relationships: RelationshipState[] = [];
  const familyCount = Math.min(summary.householdCount, Math.floor(agents.length / 2));
  for (let index = 0; index < familyCount * 2; index += 2) {
    const first = agents[index];
    const second = agents[index + 1];
    if (!first || !second) continue;
    const relation: RelationshipState = {
      id: `relationship:projection:${hashString(`${summary.canonicalDigest}:${index}`).toString(16)}`,
      fromId: first.id,
      toId: second.id,
      kind: "partner",
      strength: 0.4,
      createdTick: version,
      sourceEventId: `projection:${summary.canonicalDigest}`,
    };
    relationships.push(relation);
    first.relationshipIds.push(relation.id);
    second.relationshipIds.push(relation.id);
  }
  const organizations: OrganizationState[] = [];
  for (let index = 0; index + 1 < agents.length; index += 2) {
    const first = agents[index];
    const second = agents[index + 1];
    if (!first || !second) continue;
    organizations.push({
      id: asOrganizationId(`family:projection:${hashString(`${summary.canonicalDigest}:${index}`).toString(16)}`),
      type: "family",
      memberIds: [first.id, second.id],
      childOrganizationIds: [],
      regionId: summary.regionId,
      resources: {},
      status: "active",
    });
  }
  return { regionId: summary.regionId, sourceRevision: version, readOnly: true, generatedFromDigest: summary.canonicalDigest, agents, relationships, organizations };
};
