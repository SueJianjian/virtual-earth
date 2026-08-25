import { forkRandom, randomChance } from "../random.ts";
import type { OrganizationState, RelationshipState, WorldDelta, WorldState } from "../types.ts";
import { organizationCapacity } from "./organization.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

export const governOrganization = (state: Readonly<Omit<WorldState, "tick" | "years" | "observation">>, organization: OrganizationState): WorldDelta => {
  const delta = emptyDelta();
  const members = organization.memberIds.filter((id) => state.agents.some((agent) => agent.id === id));
  const context = { state, random: state.random, metrics: {} as never, regionId: organization.regionId, candidateMemberIds: members };
  const capacity = organizationCapacity(organization, context);
  const resourceTotal = Object.values(organization.resources).reduce((sum, value) => sum + value, 0);
  const stable = members.length >= 2 && members.length <= capacity && resourceTotal >= 0;
  const status = stable ? "active" : members.length < 2 ? "collapsed" : "fragmenting";
  if (members.length !== organization.memberIds.length || status !== organization.status) {
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...organization, memberIds: members, status } });
  }
  if (status === "fragmenting" && members.length >= 8) {
    const [split] = randomChance(forkRandom(state.random, `split:${organization.id}:${members.length}`), 0.2);
    if (split) {
      const midpoint = Math.ceil(members.length / 2);
      const child = { ...organization, id: `${organization.id}:fragment:${members[midpoint]}` as OrganizationState["id"], memberIds: members.slice(midpoint), status: "active" as const, childOrganizationIds: [] };
      delta.entityEffects.push({ collection: "organizations", operation: "create", id: child.id, value: child });
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...organization, memberIds: members.slice(0, midpoint), status: "fragmenting" } });
      delta.eventDrafts.push({ kind: "organization-split", ruleId: "organizational-fragmentation", sourceIds: members, probability: 0.2, roll: 0, evidence: { capacity, members: members.length }, payload: { organizationId: organization.id, childId: child.id }, source: "natural" });
    }
  }
  return delta;
};

export const applyOrganizationConflict = (left: OrganizationState, right: OrganizationState): WorldDelta => {
  const delta = emptyDelta();
  const fromId = left.memberIds[0];
  const toId = right.memberIds[0];
  if (!fromId || !toId) return delta;
  const relation: RelationshipState = {
    id: `conflict:${left.id}:${right.id}`,
    fromId,
    toId,
    kind: "rival",
    strength: 0.5,
    createdTick: 0,
    sourceEventId: `conflict:${left.id}:${right.id}`,
  };
  delta.relationshipEffects.push({ operation: "create", relationship: relation });
  return delta;
};
