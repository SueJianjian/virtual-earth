import { hashString } from "../random.ts";
import type { OrganizationId, OrganizationState, OrganizationType, RegionId, SocietyContext } from "../types.ts";

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
    settlement: 160,
    city: 2_000,
    state: 20_000,
    federation: 100_000,
    empire: 500_000,
  };
  const resourceFactor = Math.max(0.1, Math.min(1, (Object.values(organization.resources).reduce((sum, value) => sum + value, 0) + 1) / 10));
  const socialFactor = Math.max(0.25, Math.min(1.5, context.candidateMemberIds.length / Math.max(1, organization.memberIds.length)));
  return Math.floor(base[organization.type] * resourceFactor * socialFactor);
};

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
