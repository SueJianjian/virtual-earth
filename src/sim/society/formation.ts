import { forkRandom, hashString, randomFloat } from "../random.ts";
import type {
  OrganizationState,
  OrganizationType,
  RuleOutcome,
  SocietyEligibilityIndex,
  SocietyContext,
  WorldDelta,
} from "../types.ts";
import { createOrganization, minimumMembersFor } from "./organization.ts";
import { foodSecurityForRegion } from "../agents/food.ts";
import { cultureIdentityFor } from "../culture/identity.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

type Eligibility = { eligible: boolean; probability: number; evidence: Record<string, number | string | boolean> };

export const createSocietyEligibilityIndex = (
  state: Pick<SocietyContext["state"], "agents" | "relationships" | "organizations" | "cultures">,
): SocietyEligibilityIndex => {
  const relationshipIdsByAgent = new Map<string, Set<string>>();
  for (const relationship of state.relationships) {
    for (const agentId of [relationship.fromId, relationship.toId]) {
      const ids = relationshipIdsByAgent.get(agentId) ?? new Set<string>();
      ids.add(relationship.id);
      relationshipIdsByAgent.set(agentId, ids);
    }
  }
  const activeOrganizations = state.organizations.filter((organization) => organization.status !== "collapsed");
  const activeOrganizationsByRegion = new Map<string, OrganizationState[]>();
  for (const organization of activeOrganizations) {
    const organizations = activeOrganizationsByRegion.get(organization.regionId) ?? [];
    organizations.push(organization);
    activeOrganizationsByRegion.set(organization.regionId, organizations);
  }
  return {
    agentsById: new Map(state.agents.map((agent) => [agent.id, agent])),
    relationshipIdsByAgent,
    activeOrganizations,
    activeOrganizationsByRegion,
    culturesByRegion: new Map(state.cultures.map((culture) => [culture.regionId, culture])),
  };
};

const eligibilityFor = (context: SocietyContext, type: OrganizationType): Eligibility => {
  const state = context.state;
  const members = context.candidateMemberIds;
  const index = context.eligibilityIndex;
  const relationshipCount = index
    ? new Set(members.flatMap((memberId) => [...(index.relationshipIdsByAgent.get(memberId) ?? [])])).size
    : state.relationships.filter((relationship) => members.includes(relationship.fromId) || members.includes(relationship.toId)).length;
  const activeOrganizations = index?.activeOrganizations
    ?? state.organizations.filter((organization) => organization.status !== "collapsed");
  const localOrganizations = index?.activeOrganizationsByRegion.get(context.regionId)
    ?? activeOrganizations.filter((organization) => organization.regionId === context.regionId);
  const families = localOrganizations.filter((organization) => organization.type === "family");
  const culture = index?.culturesByRegion.get(context.regionId)
    ?? state.cultures.find((candidate) => candidate.regionId === context.regionId);
  const knowledge = culture?.knowledgeIds.length ?? 0;
  const identity = culture ? cultureIdentityFor(culture) : undefined;
  const agentFor = (id: string) => index?.agentsById.get(id) ?? state.agents.find((agent) => agent.id === id);
  const cooperation = members.reduce((sum, id) => sum + (agentFor(id)?.traits.cooperation ?? 0), 0) / Math.max(1, members.length);
  const mobility = members.reduce((sum, id) => sum + (agentFor(id)?.traits.sociality ?? 0), 0) / Math.max(1, members.length);
  const foodSecurity = foodSecurityForRegion(state, context.regionId, members.length, context.foodIndex);
  const culturalCooperation = identity?.values.cooperation ?? cooperation;
  const culturalReciprocity = identity?.values.reciprocity ?? cooperation;
  const culturalHierarchy = identity?.values.hierarchy ?? 0.5;
  const culturalCommunication = identity?.communicationStyle ?? "none";
  const socialAlignment = Math.max(0, Math.min(1, cooperation * 0.52 + culturalCooperation * 0.28 + culturalReciprocity * 0.2));
  const evidence = {
    members: members.length,
    families: families.length,
    relationships: relationshipCount,
    knowledge,
    cooperation,
    mobility,
    foodSecurity,
    culturalCooperation,
    culturalReciprocity,
    culturalHierarchy,
    culturalCommunication,
    ...(identity ? { cultureName: identity.name, cultureLanguage: identity.languageFamily } : {}),
  };
  if (members.length < minimumMembersFor(type)) return { eligible: false, probability: 0, evidence };
  const foodFactor = 0.96 + foodSecurity * 0.04;
  const civicFactor = 0.82 + socialAlignment * 0.18;
  const hierarchyFactor = 0.88 + culturalHierarchy * 0.12;
  if (type === "clan") return { eligible: families.length >= 2 && relationshipCount >= 2, probability: Math.min(0.7, (socialAlignment * 0.5 + 0.1) * foodFactor), evidence };
  if (type === "tribe") return { eligible: families.length >= 2 && knowledge >= 1 && relationshipCount >= members.length * 0.35, probability: Math.min(0.55, (socialAlignment * 0.35 + mobility * 0.2) * foodFactor), evidence };
  if (type === "settlement") return { eligible: members.length >= 8 && knowledge >= 1 && socialAlignment >= 0.2, probability: Math.min(0.6, (0.15 + knowledge * 0.08 + socialAlignment * 0.25) * civicFactor * foodFactor), evidence };
  if (type === "city") return { eligible: members.length >= 30 && knowledge >= 2 && localOrganizations.length >= 2, probability: Math.min(0.4, (0.03 + knowledge * 0.04 + socialAlignment * 0.15) * civicFactor * foodFactor), evidence };
  if (type === "state") return { eligible: members.length >= 50 && localOrganizations.filter((organization) => organization.type === "settlement" || organization.type === "city").length >= 2 && knowledge >= 2, probability: Math.min(0.3, (0.02 + socialAlignment * 0.12) * hierarchyFactor * foodFactor), evidence };
  if (type === "federation") return { eligible: members.length >= 100 && activeOrganizations.filter((organization) => organization.type === "state" || organization.type === "city").length >= 3, probability: Math.min(0.2, (0.01 + socialAlignment * 0.08) * civicFactor * foodFactor), evidence };
  return { eligible: members.length >= 200 && activeOrganizations.filter((organization) => organization.type === "state").length >= 2 && knowledge >= 4, probability: Math.min(0.12, (0.005 + socialAlignment * 0.05) * hierarchyFactor * foodFactor), evidence };
};

const childTypesFor = (type: OrganizationType): OrganizationType[] => {
  if (type === "clan") return ["family"];
  if (type === "tribe") return ["family", "clan"];
  if (type === "settlement") return ["family", "clan", "tribe"];
  if (type === "city") return ["settlement", "tribe", "clan"];
  if (type === "state") return ["city", "settlement"];
  if (type === "federation") return ["state", "city"];
  if (type === "empire") return ["state", "federation"];
  return [];
};

export const attemptOrganizationFormation = (
  context: SocietyContext,
  type: OrganizationType,
): RuleOutcome<OrganizationState> => {
  const eligibility = eligibilityFor(context, type);
  if (!eligibility.eligible) return { status: "skipped", delta: emptyDelta() };
  const sortedMembers = [...context.candidateMemberIds].sort();
  const [roll] = randomFloat(forkRandom(context.random, `organization:${type}:${context.regionId}:${hashString(sortedMembers.join(":")).toString(16)}`));
  if (roll >= eligibility.probability) return { status: "skipped", delta: emptyDelta() };
  const childTypes = new Set(childTypesFor(type));
  const childOrganizations = context.state.organizations
    .filter((organization) => (type === "federation" || type === "empire" || organization.regionId === context.regionId) && organization.status === "active" && childTypes.has(organization.type));
  const childOrganizationIds = childOrganizations
    .map((organization) => organization.id)
    .sort();
  const organization = {
    ...createOrganization(type, context.regionId, sortedMembers, childOrganizationIds),
    territoryRegionIds: [...new Set([context.regionId, ...childOrganizations.flatMap((child) => child.territoryRegionIds)])].sort(),
  };
  const delta = emptyDelta();
  delta.entityEffects.push({ collection: "organizations", operation: "create", id: organization.id, value: organization });
  delta.eventDrafts.push({
    kind: "organization-formation",
    ruleId: `formation-${type}`,
    sourceIds: sortedMembers,
    probability: eligibility.probability,
    roll,
    evidence: { ...eligibility.evidence, eligible: true },
    payload: { organizationId: organization.id, type, childOrganizationIds },
    source: "natural",
  });
  return { status: "applied", value: organization, delta };
};
