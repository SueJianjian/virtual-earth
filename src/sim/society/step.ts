import { forkRandom, randomFloat } from "../random.ts";
import type { AgentsDelta, CultureDelta, EcologyDelta, OrganizationState, SocietyContext, SocietyDelta, WorldDelta, WorldEvent, WorldState, OrganizationType } from "../types.ts";
import { attemptOrganizationFormation, createSocietyEligibilityIndex } from "./formation.ts";
import { applyOrganizationConflict, createGovernanceIndex, governOrganization } from "./governance.ts";
import { stepTerritories } from "./territory.ts";
import { createFoodBalanceIndex } from "../agents/food.ts";
import { stepFacilities } from "./facilities.ts";
import { stepSupplyChains } from "./supply.ts";
import { minimumMembersFor } from "./organization.ts";
import { simulationStepForWorld } from "../time.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const appendItems = <T>(target: T[], source: readonly T[]): void => {
  for (const item of source) target.push(item);
};

const agentsAfter = (state: WorldState, delta: WorldDelta): WorldState["agents"] => {
  const agents = new Map(state.agents.map((agent) => [agent.id, agent]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "agents") continue;
    if (effect.operation === "remove") agents.delete(effect.id);
    else if (effect.value) agents.set(effect.id, effect.value);
  }
  return [...agents.values()];
};

const organizationsAfter = (state: WorldState, delta: WorldDelta): WorldState["organizations"] => {
  const organizations = new Map(state.organizations.map((organization) => [organization.id, organization]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "organizations") continue;
    if (effect.operation === "remove") organizations.delete(effect.id);
    else if (effect.value) organizations.set(effect.id, effect.value);
  }
  return [...organizations.values()];
};

const facilitiesAfter = (state: WorldState, delta: WorldDelta): WorldState["facilities"] => {
  const facilities = new Map(state.facilities.map((facility) => [facility.id, facility]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "facilities") continue;
    if (effect.operation === "remove") facilities.delete(effect.id);
    else if (effect.value) facilities.set(effect.id, effect.value);
  }
  return [...facilities.values()];
};

const populationsAfter = (state: WorldState, delta: EcologyDelta): WorldState["populations"] => {
  const populations = new Map(state.populations.map((population) => [population.id, population]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "populations") continue;
    if (effect.operation === "remove") populations.delete(effect.id);
    else if (effect.value) populations.set(effect.id, effect.value);
  }
  return [...populations.values()];
};

const relationshipsAfter = (state: WorldState, delta: AgentsDelta): WorldState["relationships"] => {
  const relationships = new Map(state.relationships.map((relationship) => [relationship.id, relationship]));
  for (const effect of delta.relationshipEffects) {
    if (effect.operation === "remove") relationships.delete(effect.relationship.id);
    else relationships.set(effect.relationship.id, effect.relationship);
  }
  return [...relationships.values()];
};

const merge = (target: WorldDelta, source: WorldDelta): void => {
  appendItems(target.fieldChanges, source.fieldChanges);
  appendItems(target.chemistryChanges, source.chemistryChanges);
  appendItems(target.entityEffects, source.entityEffects);
  appendItems(target.relationshipEffects, source.relationshipEffects);
  appendItems(target.resourceTransactions, source.resourceTransactions);
  appendItems(target.worldviewEffects, source.worldviewEffects);
  appendItems(target.eventDrafts, source.eventDrafts);
};

const resourceKey = (resourceId: string, regionId: string, holderId?: string): string =>
  `${resourceId}|${regionId}|${holderId ?? "world"}`;

const entityPairKey = (leftId: string, rightId: string): string =>
  leftId < rightId ? `${leftId}\0${rightId}` : `${rightId}\0${leftId}`;

const addEconomy = (state: WorldState, delta: WorldDelta, organizations: OrganizationState[]): void => {
  const balances = new Map<string, number>();
  for (const resource of state.resources) {
    const key = resourceKey(resource.resourceId, resource.regionId, resource.holderId);
    balances.set(key, (balances.get(key) ?? 0) + resource.amount);
  }
  const balance = (resourceId: string, regionId: string, holderId?: string): number =>
    balances.get(resourceKey(resourceId, regionId, holderId)) ?? 0;
  const organizationsByRegion = new Map<string, OrganizationState[]>();
  for (const organization of organizations) {
    const local = organizationsByRegion.get(organization.regionId) ?? [];
    local.push(organization);
    organizationsByRegion.set(organization.regionId, local);
  }
  for (const regionId of [...new Set(organizations.map((organization) => organization.regionId))].sort()) {
    const candidates = (organizationsByRegion.get(regionId) ?? []).filter((organization) => organization.status === "active");
    const civic = candidates.filter((organization) => ["settlement", "city", "state", "federation", "empire"].includes(organization.type));
    const local = (civic.length > 0 ? civic : candidates).sort((left, right) => left.id.localeCompare(right.id));
    if (local.length === 0) continue;
    let worldFood = balance("food", regionId);
    const planned = new Map(local.map((organization) => [organization.id, balance("food", regionId, organization.id)]));
    for (const organization of local) {
      if (worldFood <= 0.001) break;
      const amount = Math.min(worldFood, Math.max(0.05, Math.min(1, organization.memberIds.length * 0.02)));
      delta.resourceTransactions.push({
        id: `resource:food:allocation:${simulationStepForWorld(state)}:${organization.id}`,
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
          id: `resource:food:trade:${simulationStepForWorld(state)}:${from.id}:${to.id}`,
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
        id: `resource:food:consume:${simulationStepForWorld(state)}:${organization.id}`,
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
  const rivalAgentPairs = new Set<string>();
  for (const relationship of state.relationships) {
    if (relationship.kind === "rival") rivalAgentPairs.add(entityPairKey(relationship.fromId, relationship.toId));
  }
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
      if (!leftMember || !rightMember || rivalAgentPairs.has(entityPairKey(leftMember, rightMember))) continue;
      const [roll] = randomFloat(forkRandom(state.random, `conflict:${left.id}:${right.id}:${simulationStepForWorld(state)}`));
      const probability = 0.08 + Math.min(0.2, Math.abs(left.memberIds.length - right.memberIds.length) / 200);
      if (roll >= probability) continue;
      merge(delta, applyOrganizationConflict(left, right, state.tick, simulationStepForWorld(state)));
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

export const stepSociety = (state: WorldState, culture: CultureDelta, agents: AgentsDelta, ecology: EcologyDelta = emptyDelta(), externalEvents: WorldEvent[] = []): SocietyDelta => {
  const delta = emptyDelta();
  const resourcesByHolder = new Map<string, WorldState["resources"]>();
  for (const resource of state.resources) {
    if (!resource.holderId) continue;
    const held = resourcesByHolder.get(resource.holderId) ?? [];
    held.push(resource);
    resourcesByHolder.set(resource.holderId, held);
  }
  for (const organization of state.organizations.filter((organization) => organization.status === "collapsed")) {
    for (const resource of resourcesByHolder.get(organization.id) ?? []) {
      if (resource.amount <= 0.000000001) continue;
      delta.resourceTransactions.push(
        {
          id: `resource:${resource.resourceId}:dissolve-consume:${simulationStepForWorld(state)}:${organization.id}`,
          resourceId: resource.resourceId,
          regionId: resource.regionId,
          amount: resource.amount,
          operation: "consume",
          source: "culture",
          sourceId: organization.id,
          fromHolderId: organization.id,
          causeRuleId: "society:organization-resource-recovery",
        },
        {
          id: `resource:${resource.resourceId}:dissolve-recover:${simulationStepForWorld(state)}:${organization.id}`,
          resourceId: resource.resourceId,
          regionId: resource.regionId,
          amount: resource.amount,
          operation: "mint",
          source: "culture",
          sourceId: organization.id,
          causeRuleId: "society:organization-resource-recovery",
        },
      );
    }
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
  const currentPopulations = populationsAfter(state, ecology);
  const currentRelationships = relationshipsAfter(state, agents);
  const socialState = { ...state, agents: currentAgents, populations: currentPopulations, relationships: currentRelationships };
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
  const eligibilityIndex = createSocietyEligibilityIndex(state);
  const foodIndex = createFoodBalanceIndex(socialState);
  const types: OrganizationType[] = ["clan", "tribe", "settlement", "city", "state", "federation", "empire"];
  for (const [regionId, memberIds] of [...regions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const candidateMemberIds = [...memberIds].sort() as SocietyContext["candidateMemberIds"];
    for (const type of types) {
      if (existing.has(`${type}:${regionId}`)) continue;
      if (candidateMemberIds.length < minimumMembersFor(type)) continue;
      const context: SocietyContext = {
        state,
        random: state.random,
        metrics: {} as never,
        regionId: regionId as SocietyContext["regionId"],
        candidateMemberIds,
        eligibilityIndex,
        foodIndex,
      };
      merge(delta, attemptOrganizationFormation(context, type).delta);
    }
  }
  const governanceIndex = createGovernanceIndex(socialState);
  for (const organization of state.organizations.filter((organization) => organization.status !== "collapsed")) merge(delta, governOrganization(socialState, organization, governanceIndex, foodIndex));
  const governedOrganizations = organizationsAfter(socialState, delta);
  merge(delta, stepTerritories({ ...socialState, organizations: governedOrganizations }, foodIndex));
  const territorialOrganizations = organizationsAfter(socialState, delta);
  const activeOrganizations = territorialOrganizations.filter((organization) => organization.status === "active");
  const facilityState = {
    ...socialState,
    agents: agentsAfter(socialState, delta),
    organizations: territorialOrganizations,
    facilities: facilitiesAfter(socialState, delta),
  };
  merge(delta, stepFacilities(facilityState, [...facilityState.events, ...externalEvents]));
  addEconomy(socialState, delta, activeOrganizations);
  addConflicts(socialState, delta, activeOrganizations);
  merge(delta, stepSupplyChains({ ...socialState, organizations: activeOrganizations }, delta.resourceTransactions));
  return delta;
};
