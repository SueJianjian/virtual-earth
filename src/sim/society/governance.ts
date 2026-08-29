import { forkRandom, randomFloat } from "../random.ts";
import type { AgentState, EntityId, FoodBalanceIndex, GovernanceState, OrganizationState, RelationshipState, WorldDelta, WorldState } from "../types.ts";
import { diplomacyForOrganization, governanceForOrganization, minimumMembersFor, organizationCapacity } from "./organization.ts";
import { createFoodBalanceIndex, foodSecurityForOrganization } from "../agents/food.ts";
import { technologyProfileForRegion, technologyProfilesForState, type TechnologyProfile } from "../culture/technology.ts";
import { cultureIdentityFor } from "../culture/identity.ts";
import { facilityEffectProfileForRegion, facilityEffectProfilesForState, type FacilityEffectProfile } from "./facilities.ts";

export type GovernanceIndex = {
  agentIds: ReadonlySet<EntityId>;
  agentsByRegion: ReadonlyMap<string, WorldState["agents"]>;
  agentsById: ReadonlyMap<EntityId, AgentState>;
  relationshipIncidenceByAgent: ReadonlyMap<EntityId, number>;
  knowledgeByRegion: ReadonlyMap<string, number>;
  culturesByRegion: ReadonlyMap<string, NonNullable<WorldState["cultures"]>[number]>;
  resourceByOrganization: ReadonlyMap<string, number>;
  localResourceByOrganization: ReadonlyMap<string, number>;
  cultureValuesByRegion: ReadonlyMap<string, ReturnType<typeof cultureIdentityFor>["values"]>;
  technologyByRegion: ReadonlyMap<string, TechnologyProfile>;
  facilityEffectsByRegion: ReadonlyMap<string, FacilityEffectProfile>;
  memberAggregatesByKey: Map<string, GovernanceMemberAggregate>;
  territoryAgentIds: Map<string, OrganizationState["memberIds"]>;
};

type GovernanceMemberAggregate = {
  cooperationTotal: number;
  socialityTotal: number;
  relationshipIncidence: number;
};

const organizationRegionKey = (organizationId: string, regionId: string): string => `${organizationId}|${regionId}`;

export const createGovernanceIndex = (
  state: Pick<WorldState, "agents" | "relationships" | "cultures" | "resources" | "knowledge" | "facilities" | "organizations">,
): GovernanceIndex => {
  const agentsByRegion = new Map<string, WorldState["agents"]>();
  const agentsById = new Map<EntityId, AgentState>();
  for (const agent of state.agents) {
    const agents = agentsByRegion.get(agent.regionId) ?? [];
    agents.push(agent);
    agentsByRegion.set(agent.regionId, agents);
    agentsById.set(agent.id, agent);
  }
  const relationshipIncidenceByAgent = new Map<EntityId, number>();
  for (const relationship of state.relationships) {
    relationshipIncidenceByAgent.set(relationship.fromId, (relationshipIncidenceByAgent.get(relationship.fromId) ?? 0) + 1);
    relationshipIncidenceByAgent.set(relationship.toId, (relationshipIncidenceByAgent.get(relationship.toId) ?? 0) + 1);
  }
  const knowledgeByRegion = new Map<string, number>();
  const culturesByRegion = new Map<string, NonNullable<WorldState["cultures"]>[number]>();
  const cultureValuesByRegion = new Map<string, ReturnType<typeof cultureIdentityFor>["values"]>();
  for (const culture of state.cultures) {
    knowledgeByRegion.set(culture.regionId, (knowledgeByRegion.get(culture.regionId) ?? 0) + culture.knowledgeIds.length);
    culturesByRegion.set(culture.regionId, culture);
    cultureValuesByRegion.set(culture.regionId, cultureIdentityFor(culture).values);
  }
  const resourceByOrganization = new Map<string, number>();
  const localResourceByOrganization = new Map<string, number>();
  for (const resource of state.resources) {
    if (!resource.holderId) continue;
    resourceByOrganization.set(resource.holderId, (resourceByOrganization.get(resource.holderId) ?? 0) + resource.amount);
    const key = organizationRegionKey(resource.holderId, resource.regionId);
    localResourceByOrganization.set(key, (localResourceByOrganization.get(key) ?? 0) + resource.amount);
  }
  const memberAggregatesByKey = new Map<string, GovernanceMemberAggregate>();
  const cacheMemberAggregate = (memberIds: readonly EntityId[]): void => {
    const key = memberIds.join("\0");
    if (memberAggregatesByKey.has(key)) return;
    let cooperationTotal = 0;
    let socialityTotal = 0;
    let relationshipIncidence = 0;
    for (const memberId of memberIds) {
      const member = agentsById.get(memberId);
      cooperationTotal += member?.traits.cooperation ?? 0;
      socialityTotal += member?.traits.sociality ?? 0;
      relationshipIncidence += relationshipIncidenceByAgent.get(memberId) ?? 0;
    }
    memberAggregatesByKey.set(key, { cooperationTotal, socialityTotal, relationshipIncidence });
  };
  for (const organization of state.organizations) cacheMemberAggregate(organization.memberIds);
  return {
    agentIds: new Set(agentsById.keys()),
    agentsByRegion,
    agentsById,
    relationshipIncidenceByAgent,
    knowledgeByRegion,
    culturesByRegion,
    resourceByOrganization,
    localResourceByOrganization,
    cultureValuesByRegion,
    technologyByRegion: technologyProfilesForState(state),
    facilityEffectsByRegion: facilityEffectProfilesForState(state),
    memberAggregatesByKey,
    territoryAgentIds: new Map(),
  };
};

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const recruitsMembers = (organization: OrganizationState): boolean => [
  "settlement", "city", "state", "federation", "empire",
].includes(organization.type);

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

const governanceChanged = (before: GovernanceState | undefined, after: GovernanceState): boolean => {
  if (!before) return true;
  return Object.keys(after).some((key) => Math.abs(Number(before[key as keyof GovernanceState]) - Number(after[key as keyof GovernanceState])) > 0.0001);
};

const nextGovernance = (
  state: Readonly<Omit<WorldState, "tick" | "years" | "observation">>,
  organization: OrganizationState,
  members: OrganizationState["memberIds"],
  capacity: number,
  foodSecurity: number,
  resourceTotal: number,
  index: GovernanceIndex,
): GovernanceState => {
  const previous = governanceForOrganization(organization);
  const territorySize = Math.max(1, organization.territoryRegionIds.length || 1);
  const memberKey = members.join("\0");
  let aggregate = index.memberAggregatesByKey.get(memberKey);
  if (!aggregate) {
    let cooperationTotal = 0;
    let socialityTotal = 0;
    let relationshipIncidence = 0;
    for (const memberId of members) {
      const member = index.agentsById.get(memberId);
      cooperationTotal += member?.traits.cooperation ?? 0;
      socialityTotal += member?.traits.sociality ?? 0;
      relationshipIncidence += index.relationshipIncidenceByAgent.get(memberId) ?? 0;
    }
    aggregate = { cooperationTotal, socialityTotal, relationshipIncidence };
    index.memberAggregatesByKey.set(memberKey, aggregate);
  }
  const { cooperationTotal, socialityTotal, relationshipIncidence } = aggregate;
  const cooperation = members.length > 0 ? cooperationTotal / members.length : 0;
  const sociality = members.length > 0 ? socialityTotal / members.length : 0;
  const relationshipDensity = clamp(relationshipIncidence / Math.max(1, members.length * 2.8));
  const knowledge = index.knowledgeByRegion.get(organization.regionId) ?? 0;
  const cultureValues = index.cultureValuesByRegion.get(organization.regionId);
  const culturalCooperation = cultureValues?.cooperation ?? cooperation;
  const culturalReciprocity = cultureValues?.reciprocity ?? cooperation;
  const culturalHierarchy = cultureValues?.hierarchy ?? 0.5;
  const culturalCuriosity = cultureValues?.curiosity ?? 0.5;
  const culturalTradition = cultureValues?.tradition ?? 0.5;
  const culturalStewardship = cultureValues?.stewardship ?? 0.5;
  const knowledgeFactor = clamp(knowledge / 8);
  const technology = index.technologyByRegion.get(organization.regionId)
    ?? technologyProfileForRegion(state, organization.regionId);
  const facilities = index.facilityEffectsByRegion.get(organization.regionId)
    ?? facilityEffectProfileForRegion(state, organization.regionId);
  const resourceFactor = clamp(resourceTotal / Math.max(1, members.length * 0.12));
  const populationPressure = clamp(members.length / Math.max(1, capacity));
  const taxRate = clamp(
    previous.taxRate
      + (previous.stability < 0.35 ? -0.004 : 0.0005)
      + (previous.publicGoods > 0.7 ? 0.0005 : 0),
    0.02,
    0.28,
  );
  const taxRevenue = clamp(taxRate * (0.35 + populationPressure * 0.4 + foodSecurity * 0.25) * (0.65 + previous.stability * 0.35) * (1 + facilities.energy * 0.08));
  const maintenance = clamp(0.012 + territorySize * 0.003 + populationPressure * 0.025 + previous.military * 0.012);
  const treasury = clamp(previous.treasury * 0.94 + taxRevenue * 0.45 - maintenance - previous.warWeariness * 0.018);
  const publicGoodsTarget = clamp(foodSecurity * 0.38 + resourceFactor * 0.2 + knowledgeFactor * 0.14 + treasury * 0.12 + relationshipDensity * 0.08 + culturalReciprocity * 0.08 + culturalStewardship * 0.07 + technology.construction * 0.12 + facilities.construction * 0.07 + facilities.governance * 0.08);
  const publicGoods = clamp(previous.publicGoods * 0.9 + publicGoodsTarget * 0.1 - previous.warWeariness * 0.012);
  const legitimacyTarget = clamp(publicGoods * 0.36 + foodSecurity * 0.23 + cooperation * 0.12 + culturalCooperation * 0.08 + culturalTradition * 0.06 + knowledgeFactor * 0.1 + previous.cohesion * 0.07 + technology.governance * 0.1 + facilities.governance * 0.08 - taxRate * 0.12);
  const legitimacy = clamp(previous.legitimacy * 0.93 + legitimacyTarget * 0.07 - previous.warWeariness * 0.018);
  const cohesionTarget = clamp(0.21 + cooperation * 0.26 + culturalReciprocity * 0.1 + culturalTradition * 0.07 + relationshipDensity * 0.2 + sociality * 0.12 + legitimacy * 0.09 + technology.governance * 0.08 + facilities.governance * 0.06 - previous.warWeariness * 0.2);
  const cohesion = clamp(previous.cohesion * 0.9 + cohesionTarget * 0.1);
  const militaryTarget = clamp(cohesion * 0.4 + treasury * 0.22 + populationPressure * 0.17 + sociality * 0.12 + culturalHierarchy * 0.08 + (1 - culturalStewardship) * 0.04);
  const military = clamp(previous.military * 0.95 + militaryTarget * 0.05 - previous.warWeariness * 0.01);
  const stabilityTarget = clamp(legitimacy * 0.31 + cohesion * 0.26 + publicGoods * 0.19 + foodSecurity * 0.17 + culturalStewardship * 0.05 + culturalCuriosity * 0.02 - previous.warWeariness * 0.18);
  const stability = clamp(previous.stability * 0.9 + stabilityTarget * 0.1);
  return {
    stability,
    legitimacy,
    military,
    treasury,
    publicGoods,
    warWeariness: clamp(previous.warWeariness * 0.985),
    taxRate,
    taxRevenue,
    cohesion,
    lastConflictTick: previous.lastConflictTick,
  };
};

export const governOrganization = (
  state: Readonly<Omit<WorldState, "tick" | "years" | "observation">>,
  organization: OrganizationState,
  suppliedIndex?: GovernanceIndex,
  suppliedFoodIndex?: FoodBalanceIndex,
): WorldDelta => {
  const delta = emptyDelta();
  const index = suppliedIndex ?? createGovernanceIndex(state);
  const foodIndex = suppliedFoodIndex ?? createFoodBalanceIndex(state);
  const existingMembers = organization.memberIds.filter((id) => index.agentIds.has(id));
  if (organization.type === "family") {
    const status = existingMembers.length >= minimumMembersFor("family") ? "active" : "collapsed";
    const governance = governanceForOrganization(organization);
    if (existingMembers.length !== organization.memberIds.length || status !== organization.status || governanceChanged(organization.governance, governance)) {
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...organization, memberIds: existingMembers, status, governance, diplomacy: diplomacyForOrganization(organization) } });
    }
    return delta;
  }
  const territory = new Set(organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId]);
  const territoryKey = [...territory].sort().join("|");
  let localAgents = index.territoryAgentIds.get(territoryKey);
  if (!localAgents) {
    localAgents = [...territory]
      .flatMap((regionId) => index.agentsByRegion.get(regionId) ?? [])
      .map((agent) => agent.id)
      .sort();
    index.territoryAgentIds.set(territoryKey, localAgents);
  }
  const members = recruitsMembers(organization)
    ? [...new Set([...existingMembers, ...localAgents])]
    : existingMembers;
  const context = { state, random: state.random, metrics: {} as never, regionId: organization.regionId, candidateMemberIds: members, foodIndex };
  const minimumMembers = minimumMembersFor(organization.type);
  const foodSecurity = foodSecurityForOrganization(state, { ...organization, memberIds: members }, foodIndex);
  const localResourceTotal = index.localResourceByOrganization.get(organizationRegionKey(organization.id, organization.regionId)) ?? 0;
  const constructionLevel = index.technologyByRegion.get(organization.regionId)?.construction
    ?? technologyProfileForRegion(state, organization.regionId).construction;
  const capacity = organizationCapacity(organization, context, {
    ledgerResources: localResourceTotal,
    foodSecurity,
    constructionLevel,
  });
  const resourceTotal = Object.values(organization.resources).reduce((sum, value) => sum + value, 0)
    + (index.resourceByOrganization.get(organization.id) ?? 0);
  const foodResilient = organization.type === "clan" || organization.type === "tribe" || members.length <= minimumMembers * 2 || foodSecurity >= 0.075;
  const stable = members.length >= minimumMembers && members.length <= capacity && resourceTotal >= 0 && foodResilient;
  const status = stable ? "active" : members.length < minimumMembers ? "collapsed" : "fragmenting";
  const governance = nextGovernance(state, organization, members, capacity, foodSecurity, resourceTotal, index);
  const governedOrganization: OrganizationState = {
    ...organization,
    memberIds: members as OrganizationState["memberIds"],
    status,
    governance,
    diplomacy: diplomacyForOrganization(organization),
  };
  if (members.length !== organization.memberIds.length || status !== organization.status || governanceChanged(organization.governance, governance) || !organization.diplomacy) {
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: governedOrganization });
  }
  if (status === "fragmenting" && members.length >= 8 && organization.childOrganizationIds.length === 0 && !organization.id.includes(":fragment:")) {
    const [roll] = randomFloat(forkRandom(state.random, `split:${organization.id}:${members.length}`));
    if (roll < 0.2) {
      const midpoint = Math.ceil(members.length / 2);
      const child: OrganizationState = { ...governedOrganization, id: `${organization.id}:fragment:${members[midpoint]}` as OrganizationState["id"], memberIds: members.slice(midpoint) as OrganizationState["memberIds"], status: "active", childOrganizationIds: [] };
      delta.entityEffects.push({ collection: "organizations", operation: "create", id: child.id, value: child });
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...child, id: organization.id, memberIds: members.slice(0, midpoint), status: "fragmenting", childOrganizationIds: [...organization.childOrganizationIds, child.id] } });
      delta.eventDrafts.push({ kind: "organization-split", ruleId: "organizational-fragmentation", sourceIds: members, probability: 0.2, roll, evidence: { capacity, members: members.length, foodSecurity }, payload: { organizationId: organization.id, childId: child.id }, source: "natural" });
    }
  }
  return delta;
};

export const applyOrganizationConflict = (left: OrganizationState, right: OrganizationState, tick = 0, timelineStep?: string): WorldDelta => {
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
    ...(timelineStep === undefined ? {} : { createdTimelineStep: timelineStep }),
    sourceEventId: `conflict:${left.id}:${right.id}`,
  };
  delta.relationshipEffects.push({ operation: "create", relationship: relation });
  return delta;
};
