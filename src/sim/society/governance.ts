import { forkRandom, randomFloat } from "../random.ts";
import type { OrganizationState, RelationshipState, WorldDelta, WorldState } from "../types.ts";
import { minimumMembersFor, organizationCapacity } from "./organization.ts";
import { foodSecurityForOrganization } from "../agents/food.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const recruitsMembers = (organization: OrganizationState): boolean => [
  "settlement", "city", "state", "federation", "empire",
].includes(organization.type);

export const governOrganization = (state: Readonly<Omit<WorldState, "tick" | "years" | "observation">>, organization: OrganizationState): WorldDelta => {
  const delta = emptyDelta();
  const existingMembers = organization.memberIds.filter((id) => state.agents.some((agent) => agent.id === id));
  const localAgents = state.agents
    .filter((agent) => agent.regionId === organization.regionId)
    .map((agent) => agent.id)
    .sort();
  const members = recruitsMembers(organization)
    ? [...new Set([...existingMembers, ...localAgents])]
    : existingMembers;
  const context = { state, random: state.random, metrics: {} as never, regionId: organization.regionId, candidateMemberIds: members };
  const capacity = organizationCapacity(organization, context);
  const minimumMembers = minimumMembersFor(organization.type);
  const foodSecurity = foodSecurityForOrganization(state, { ...organization, memberIds: members });
  const resourceTotal = Object.values(organization.resources).reduce((sum, value) => sum + value, 0) + state.resources
    .filter((resource) => resource.regionId === organization.regionId && resource.holderId === organization.id)
    .reduce((sum, resource) => sum + resource.amount, 0);
  const foodResilient = organization.type === "family" || organization.type === "clan" || organization.type === "tribe" || members.length <= minimumMembers * 2 || foodSecurity >= 0.075;
  const stable = members.length >= minimumMembers && members.length <= capacity && resourceTotal >= 0 && foodResilient;
  const status = stable ? "active" : members.length < minimumMembers ? "collapsed" : "fragmenting";
  if (members.length !== organization.memberIds.length || status !== organization.status) {
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...organization, memberIds: members, status } });
  }
  if (status === "fragmenting" && members.length >= 8 && organization.childOrganizationIds.length === 0 && !organization.id.includes(":fragment:")) {
    const [roll] = randomFloat(forkRandom(state.random, `split:${organization.id}:${members.length}`));
    if (roll < 0.2) {
      const midpoint = Math.ceil(members.length / 2);
      const child = { ...organization, id: `${organization.id}:fragment:${members[midpoint]}` as OrganizationState["id"], memberIds: members.slice(midpoint), status: "active" as const, childOrganizationIds: [] };
      delta.entityEffects.push({ collection: "organizations", operation: "create", id: child.id, value: child });
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...organization, memberIds: members.slice(0, midpoint), status: "fragmenting", childOrganizationIds: [...organization.childOrganizationIds, child.id] } });
      delta.eventDrafts.push({ kind: "organization-split", ruleId: "organizational-fragmentation", sourceIds: members, probability: 0.2, roll, evidence: { capacity, members: members.length, foodSecurity }, payload: { organizationId: organization.id, childId: child.id }, source: "natural" });
    }
  }
  return delta;
};

export const applyOrganizationConflict = (left: OrganizationState, right: OrganizationState, tick = 0): WorldDelta => {
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
    createdTick: tick,
    sourceEventId: `conflict:${left.id}:${right.id}`,
  };
  delta.relationshipEffects.push({ operation: "create", relationship: relation });
  return delta;
};
