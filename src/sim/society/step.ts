import { forkRandom, randomFloat } from "../random.ts";
import type { AgentsDelta, CultureDelta, OrganizationState, SocietyContext, SocietyDelta, WorldDelta, WorldState, OrganizationType } from "../types.ts";
import { attemptOrganizationFormation } from "./formation.ts";
import { applyOrganizationConflict, governOrganization } from "./governance.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const agentsAfter = (state: WorldState, delta: WorldDelta): WorldState["agents"] => {
  const agents = new Map(state.agents.map((agent) => [agent.id, structuredClone(agent)]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "agents") continue;
    if (effect.operation === "remove") agents.delete(effect.id);
    else if (effect.value) agents.set(effect.id, structuredClone(effect.value));
  }
  return [...agents.values()];
};

const merge = (target: WorldDelta, source: WorldDelta): void => {
  target.fieldChanges.push(...source.fieldChanges);
  target.chemistryChanges.push(...source.chemistryChanges);
  target.entityEffects.push(...source.entityEffects);
  target.relationshipEffects.push(...source.relationshipEffects);
  target.resourceTransactions.push(...source.resourceTransactions);
  target.worldviewEffects.push(...source.worldviewEffects);
  target.eventDrafts.push(...source.eventDrafts);
};

const balanceFor = (state: WorldState, resourceId: string, regionId: string, holderId?: string): number => state.resources
  .filter((resource) => resource.resourceId === resourceId && resource.regionId === regionId && resource.holderId === holderId)
  .reduce((sum, resource) => sum + resource.amount, 0);

const addEconomy = (state: WorldState, delta: WorldDelta, organizations: OrganizationState[]): void => {
  for (const regionId of [...new Set(organizations.map((organization) => organization.regionId))].sort()) {
    const local = organizations.filter((organization) => organization.regionId === regionId && organization.status === "active").sort((left, right) => left.id.localeCompare(right.id));
    if (local.length === 0) continue;
    let worldFood = balanceFor(state, "food", regionId);
    const planned = new Map(local.map((organization) => [organization.id, balanceFor(state, "food", regionId, organization.id)]));
    for (const organization of local) {
      if (worldFood <= 0.001) break;
      const amount = Math.min(worldFood, Math.max(0.05, Math.min(1, organization.memberIds.length * 0.02)));
      delta.resourceTransactions.push({
        id: `resource:food:allocation:${state.tick}:${organization.id}`,
        resourceId: "food",
        regionId: regionId as WorldState["organizations"][number]["regionId"],
        amount,
        operation: "transfer",
        source: "culture",
        sourceId: organization.id,
        toHolderId: organization.id,
        causeRuleId: "society:food-allocation",
      });
      worldFood -= amount;
      planned.set(organization.id, (planned.get(organization.id) ?? 0) + amount);
    }
    for (let index = 0; index + 1 < local.length; index += 1) {
      const from = local[index];
      const to = local[index + 1];
      if (!from || !to) continue;
      const available = planned.get(from.id) ?? 0;
      const amount = Math.min(0.25, available * 0.1);
      if (amount <= 0.001) continue;
      delta.resourceTransactions.push({
        id: `resource:food:trade:${state.tick}:${from.id}:${to.id}`,
        resourceId: "food",
        regionId: regionId as WorldState["organizations"][number]["regionId"],
        amount,
        operation: "transfer",
        source: "culture",
        sourceId: `${from.id}:${to.id}`,
        fromHolderId: from.id,
        toHolderId: to.id,
        causeRuleId: "society:organization-trade",
      });
      planned.set(from.id, available - amount);
      planned.set(to.id, (planned.get(to.id) ?? 0) + amount);
      delta.eventDrafts.push({
        kind: "organization-trade",
        ruleId: "society:organization-trade",
        sourceIds: [from.id, to.id],
        probability: 1,
        roll: 0,
        evidence: { regionId, amount, fromBalance: available },
        payload: { resourceId: "food", amount, fromOrganizationId: from.id, toOrganizationId: to.id },
        source: "natural",
      });
    }
    for (const organization of local) {
      const available = planned.get(organization.id) ?? 0;
      const amount = Math.min(available, Math.max(0.01, Math.min(0.2, organization.memberIds.length * 0.002)));
      if (amount <= 0.001) continue;
      delta.resourceTransactions.push({
        id: `resource:food:consume:${state.tick}:${organization.id}`,
        resourceId: "food",
        regionId: regionId as WorldState["organizations"][number]["regionId"],
        amount,
        operation: "consume",
        source: "culture",
        sourceId: organization.id,
        fromHolderId: organization.id,
        causeRuleId: "society:food-consumption",
      });
      planned.set(organization.id, available - amount);
    }
  }
};

const addConflicts = (state: WorldState, delta: WorldDelta, organizations: OrganizationState[]): void => {
  const byRegion = new Map<string, OrganizationState[]>();
  for (const organization of organizations.filter((candidate) => candidate.status === "active")) {
    const list = byRegion.get(organization.regionId) ?? [];
    list.push(organization);
    byRegion.set(organization.regionId, list);
  }
  for (const [regionId, local] of [...byRegion.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const peers = local.filter((organization) => ["settlement", "city", "state", "federation", "empire"].includes(organization.type)).sort((left, right) => left.id.localeCompare(right.id));
    for (let index = 0; index + 1 < peers.length; index += 1) {
      const left = peers[index];
      const right = peers[index + 1];
      if (!left || !right) continue;
      const leftMember = left.memberIds[0];
      const rightMember = right.memberIds[0];
      if (!leftMember || !rightMember || state.relationships.some((relationship) => relationship.kind === "rival" && ((relationship.fromId === leftMember && relationship.toId === rightMember) || (relationship.fromId === rightMember && relationship.toId === leftMember)))) continue;
      const [roll] = randomFloat(forkRandom(state.random, `conflict:${left.id}:${right.id}:${state.tick}`));
      const probability = 0.08 + Math.min(0.2, Math.abs(left.memberIds.length - right.memberIds.length) / 200);
      if (roll >= probability) continue;
      merge(delta, applyOrganizationConflict(left, right, state.tick));
      delta.eventDrafts.push({
        kind: "organization-conflict",
        ruleId: "society:organization-conflict",
        sourceIds: [left.id, right.id],
        probability,
        roll,
        evidence: { regionId, leftMembers: left.memberIds.length, rightMembers: right.memberIds.length, eligible: true },
        payload: { leftOrganizationId: left.id, rightOrganizationId: right.id, relation: "rival" },
        source: "natural",
      });
      break;
    }
  }
};

export const stepSociety = (state: WorldState, culture: CultureDelta, agents: AgentsDelta): SocietyDelta => {
  const delta = emptyDelta();
  for (const organization of state.organizations.filter((organization) => organization.status === "collapsed")) {
    delta.entityEffects.push({ collection: "organizations", operation: "remove", id: organization.id });
    delta.eventDrafts.push({
      kind: "organization-dissolved",
      ruleId: "society:organization-lifecycle",
      sourceIds: [...organization.memberIds],
      probability: 1,
      roll: 0,
      evidence: { organizationType: organization.type, members: organization.memberIds.length, status: "collapsed" },
      payload: { organizationId: organization.id, type: organization.type },
      source: "natural",
    });
  }
  const currentAgents = agentsAfter(state, agents);
  const regions = new Map<string, string[]>();
  for (const agent of currentAgents) {
    const ids = regions.get(agent.regionId) ?? [];
    ids.push(agent.id);
    regions.set(agent.regionId, ids);
  }
  const existing = new Set(
    state.organizations
      .filter((organization) => organization.status !== "collapsed")
      .map((organization) => `${organization.type}:${organization.regionId}`),
  );
  const types: OrganizationType[] = ["clan", "tribe", "settlement", "city", "state", "federation", "empire"];
  for (const [regionId, memberIds] of [...regions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (const type of types) {
      if (existing.has(`${type}:${regionId}`)) continue;
      const context: SocietyContext = {
        state,
        random: state.random,
        metrics: {} as never,
        regionId: regionId as SocietyContext["regionId"],
        candidateMemberIds: [...memberIds].sort() as SocietyContext["candidateMemberIds"],
      };
      merge(delta, attemptOrganizationFormation(context, type).delta);
    }
  }
  for (const organization of state.organizations.filter((organization) => organization.status !== "collapsed")) merge(delta, governOrganization(state, organization));
  const activeOrganizations = state.organizations.filter((organization) => organization.status === "active");
  addEconomy(state, delta, activeOrganizations);
  addConflicts(state, delta, activeOrganizations);
  return delta;
};
