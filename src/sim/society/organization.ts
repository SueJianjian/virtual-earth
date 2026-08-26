import { hashString } from "../random.ts";
import { foodSecurityForOrganization } from "../agents/food.ts";
import type { OrganizationId, OrganizationState, OrganizationType, RegionId, SocietyContext, WorldState } from "../types.ts";

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
  resources: {},
  status: "active",
});

export const organizationCapacity = (
  organization: OrganizationState,
  context: SocietyContext,
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
  const ledgerResources = context.state.resources
    .filter((resource) => resource.regionId === organization.regionId && resource.holderId === organization.id)
    .reduce((sum, resource) => sum + resource.amount, 0);
  const foodSecurity = foodSecurityForOrganization(context.state, { ...organization, memberIds: context.candidateMemberIds });
  const resourceFactor = Math.max(0.5, Math.min(1.5, (Object.values(organization.resources).reduce((sum, value) => sum + value, 0) + ledgerResources + 1) / 10));
  const foodFactor = 0.7 + foodSecurity * 0.3;
  const socialFactor = Math.max(0.25, Math.min(1.5, context.candidateMemberIds.length / Math.max(1, organization.memberIds.length)));
  return Math.max(minimumMembersFor(organization.type), Math.floor(base[organization.type] * resourceFactor * foodFactor * socialFactor));
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
