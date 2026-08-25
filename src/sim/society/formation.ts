import { forkRandom, hashString, randomFloat } from "../random.ts";
import type {
  OrganizationState,
  OrganizationType,
  RuleOutcome,
  SocietyContext,
  WorldDelta,
} from "../types.ts";
import { createOrganization, minimumMembersFor } from "./organization.ts";
import { foodSecurityForRegion } from "../agents/food.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

type Eligibility = { eligible: boolean; probability: number; evidence: Record<string, number | string | boolean> };

const eligibilityFor = (context: SocietyContext, type: OrganizationType): Eligibility => {
  const state = context.state;
  const members = context.candidateMemberIds;
  const relationships = state.relationships.filter((relationship) => members.includes(relationship.fromId) || members.includes(relationship.toId));
  const activeOrganizations = state.organizations.filter((organization) => organization.status !== "collapsed");
  const families = activeOrganizations.filter((organization) => organization.type === "family" && organization.regionId === context.regionId);
  const culture = state.cultures.find((candidate) => candidate.regionId === context.regionId);
  const knowledge = culture?.knowledgeIds.length ?? 0;
  const cooperation = members.reduce((sum, id) => sum + (state.agents.find((agent) => agent.id === id)?.traits.cooperation ?? 0), 0) / Math.max(1, members.length);
  const mobility = members.reduce((sum, id) => sum + (state.agents.find((agent) => agent.id === id)?.traits.sociality ?? 0), 0) / Math.max(1, members.length);
  const foodSecurity = foodSecurityForRegion(state, context.regionId, members.length);
  const evidence = { members: members.length, families: families.length, relationships: relationships.length, knowledge, cooperation, mobility, foodSecurity };
  if (members.length < minimumMembersFor(type)) return { eligible: false, probability: 0, evidence };
  const foodFactor = 0.96 + foodSecurity * 0.04;
  if (type === "clan") return { eligible: families.length >= 2 && relationships.length >= 2, probability: Math.min(0.7, (cooperation * 0.5 + 0.1) * foodFactor), evidence };
  if (type === "tribe") return { eligible: families.length >= 2 && knowledge >= 1 && relationships.length >= members.length * 0.35, probability: Math.min(0.55, (cooperation * 0.35 + mobility * 0.2) * foodFactor), evidence };
  if (type === "settlement") return { eligible: members.length >= 8 && knowledge >= 1 && cooperation >= 0.2, probability: Math.min(0.6, (0.15 + knowledge * 0.08 + cooperation * 0.25) * foodFactor), evidence };
  if (type === "city") return { eligible: members.length >= 30 && knowledge >= 2 && activeOrganizations.filter((organization) => organization.regionId === context.regionId).length >= 2, probability: Math.min(0.4, (0.03 + knowledge * 0.04 + cooperation * 0.15) * foodFactor), evidence };
  if (type === "state") return { eligible: members.length >= 50 && activeOrganizations.filter((organization) => organization.regionId === context.regionId && (organization.type === "settlement" || organization.type === "city")).length >= 2 && knowledge >= 2, probability: Math.min(0.3, (0.02 + cooperation * 0.12) * foodFactor), evidence };
  if (type === "federation") return { eligible: members.length >= 100 && activeOrganizations.filter((organization) => organization.type === "state" || organization.type === "city").length >= 3, probability: Math.min(0.2, (0.01 + cooperation * 0.08) * foodFactor), evidence };
  return { eligible: members.length >= 200 && activeOrganizations.filter((organization) => organization.type === "state").length >= 2 && knowledge >= 4, probability: Math.min(0.12, (0.005 + cooperation * 0.05) * foodFactor), evidence };
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
  const childOrganizationIds = context.state.organizations
    .filter((organization) => organization.regionId === context.regionId && organization.status === "active" && childTypes.has(organization.type))
    .map((organization) => organization.id)
    .sort();
  const organization = createOrganization(type, context.regionId, sortedMembers, childOrganizationIds);
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
