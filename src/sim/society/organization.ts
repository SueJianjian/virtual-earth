import { hashString } from "../random.ts";
import { foodSecurityForOrganization } from "../agents/food.ts";
import { technologyProfileForRegion } from "../culture/technology.ts";
import type { DiplomaticStance, GovernanceState, OrganizationId, OrganizationState, OrganizationType, RegionId, SocietyContext, WorldState } from "../types.ts";

const governanceDefaults: Record<OrganizationType, GovernanceState> = {
  family: { stability: 0.62, legitimacy: 0.68, military: 0.05, treasury: 0.2, publicGoods: 0.3, warWeariness: 0, taxRate: 0.04, taxRevenue: 0, cohesion: 0.7, lastConflictTick: -1 },
  clan: { stability: 0.58, legitimacy: 0.58, military: 0.18, treasury: 0.25, publicGoods: 0.34, warWeariness: 0, taxRate: 0.06, taxRevenue: 0, cohesion: 0.62, lastConflictTick: -1 },
  tribe: { stability: 0.55, legitimacy: 0.52, military: 0.28, treasury: 0.3, publicGoods: 0.38, warWeariness: 0, taxRate: 0.08, taxRevenue: 0, cohesion: 0.58, lastConflictTick: -1 },
  settlement: { stability: 0.54, legitimacy: 0.5, military: 0.22, treasury: 0.32, publicGoods: 0.45, warWeariness: 0, taxRate: 0.09, taxRevenue: 0, cohesion: 0.56, lastConflictTick: -1 },
  city: { stability: 0.58, legitimacy: 0.55, military: 0.4, treasury: 0.4, publicGoods: 0.55, warWeariness: 0, taxRate: 0.11, taxRevenue: 0, cohesion: 0.55, lastConflictTick: -1 },
  state: { stability: 0.6, legitimacy: 0.58, military: 0.58, treasury: 0.48, publicGoods: 0.6, warWeariness: 0, taxRate: 0.13, taxRevenue: 0, cohesion: 0.56, lastConflictTick: -1 },
  federation: { stability: 0.64, legitimacy: 0.62, military: 0.66, treasury: 0.58, publicGoods: 0.67, warWeariness: 0, taxRate: 0.14, taxRevenue: 0, cohesion: 0.58, lastConflictTick: -1 },
  empire: { stability: 0.58, legitimacy: 0.55, military: 0.75, treasury: 0.62, publicGoods: 0.64, warWeariness: 0, taxRate: 0.16, taxRevenue: 0, cohesion: 0.5, lastConflictTick: -1 },
};

export const defaultGovernanceFor = (type: OrganizationType): GovernanceState => ({ ...governanceDefaults[type] });

export const governanceForOrganization = (organization: Pick<OrganizationState, "type" | "governance">): GovernanceState => ({
  ...defaultGovernanceFor(organization.type),
  ...(organization.governance ?? {}),
});

export const diplomacyForOrganization = (organization: Pick<OrganizationState, "diplomacy">): Record<string, DiplomaticStance> => ({
  ...(organization.diplomacy ?? {}),
});

export const organizationIdFor = (
  type: OrganizationType,
  regionId: RegionId,
  memberIds: string[],
): OrganizationId => `organization:${type}:${hashString(`${regionId}:${[...memberIds].sort().join(":")}`).toString(16)}` as OrganizationId;

export const createOrganization = (
  type: OrganizationType,
  regionId: RegionId,
  memberIds: string[],
  childOrganizationIds: OrganizationId[] = [],
): OrganizationState => ({
  id: organizationIdFor(type, regionId, memberIds),
  type,
  memberIds: [...new Set(memberIds)].sort() as OrganizationState["memberIds"],
  childOrganizationIds: [...new Set(childOrganizationIds)].sort(),
  regionId,
  territoryRegionIds: [regionId],
  resources: {},
  status: "active",
  governance: defaultGovernanceFor(type),
  diplomacy: {},
});

export type OrganizationCapacityInputs = {
  ledgerResources?: number;
  foodSecurity?: number;
  constructionLevel?: number;
};

export const organizationCapacity = (
  organization: OrganizationState,
  context: SocietyContext,
  inputs: OrganizationCapacityInputs = {},
): number => {
  const base: Record<OrganizationType, number> = {
    family: 8,
    clan: 24,
    tribe: 80,
    settlement: 512,
    city: 2_000,
    state: 20_000,
    federation: 100_000,
    empire: 500_000,
  };
  const ledgerResources = inputs.ledgerResources ?? context.state.resources
    .filter((resource) => resource.regionId === organization.regionId && resource.holderId === organization.id)
    .reduce((sum, resource) => sum + resource.amount, 0);
  const foodSecurity = inputs.foodSecurity
    ?? foodSecurityForOrganization(context.state, { ...organization, memberIds: context.candidateMemberIds }, context.foodIndex);
  const constructionLevel = inputs.constructionLevel
    ?? technologyProfileForRegion(context.state, organization.regionId).construction;
  const resourceFactor = Math.max(0.5, Math.min(1.5, (Object.values(organization.resources).reduce((sum, value) => sum + value, 0) + ledgerResources + 1) / 10));
  const foodFactor = 0.7 + foodSecurity * 0.3;
  const constructionFactor = 1 + constructionLevel * 0.22;
  const socialFactor = Math.max(0.25, Math.min(1.5, context.candidateMemberIds.length / Math.max(1, organization.memberIds.length)));
  return Math.max(minimumMembersFor(organization.type), Math.floor(base[organization.type] * resourceFactor * foodFactor * socialFactor * constructionFactor));
};

export const organizationResourceTotal = (
  state: Pick<WorldState, "resources">,
  organization: OrganizationState,
): number => state.resources
  .filter((resource) => resource.regionId === organization.regionId && resource.holderId === organization.id)
  .reduce((sum, resource) => sum + resource.amount, 0);

export const minimumMembersFor = (type: OrganizationType): number => ({
  family: 2,
  clan: 4,
  tribe: 6,
  settlement: 8,
  city: 30,
  state: 50,
  federation: 100,
  empire: 200,
}[type]);
