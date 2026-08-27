import type { DiplomaticStance, OrganizationState, OrganizationSummary, WorldState } from "../types.ts";

export const MAX_ORGANIZATION_RECORDS = 2_048;
export const MAX_CHILD_ORGANIZATION_IDS = 64;
export const MAX_DIPLOMATIC_RELATIONS = 64;
export const MAX_ORGANIZATIONS_PER_SUMMARY = 64;
export const MAX_ORGANIZATION_TERRITORY_REGIONS = 128;

const organizationRank: Record<OrganizationState["type"], number> = {
  family: 0,
  clan: 1,
  tribe: 2,
  settlement: 3,
  city: 4,
  state: 5,
  federation: 6,
  empire: 7,
};

const statusRank: Record<OrganizationState["status"], number> = {
  collapsed: 0,
  fragmenting: 1,
  migrating: 2,
  active: 3,
};

const stanceRank: Record<DiplomaticStance, number> = {
  neutral: 0,
  rival: 1,
  trade: 2,
  allied: 3,
};

const sameArray = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const boundedRelations = (
  diplomacy: Record<string, DiplomaticStance> | undefined,
  validIds: ReadonlySet<string>,
  ownerId?: string,
): Record<string, DiplomaticStance> => {
  const entries = Object.entries(diplomacy ?? {});
  const isValid = (id: string, stance: string): boolean => id !== ""
    && id !== ownerId
    && validIds.has(id)
    && Object.prototype.hasOwnProperty.call(stanceRank, stance);
  if (diplomacy && entries.length <= MAX_DIPLOMATIC_RELATIONS && entries.every(([id, stance]) => isValid(id, stance))) return diplomacy;
  const retained = entries
    .filter(([id, stance]) => isValid(id, stance))
    .sort(([leftId, leftStance], [rightId, rightStance]) =>
      stanceRank[rightStance] - stanceRank[leftStance] || leftId.localeCompare(rightId))
    .slice(0, MAX_DIPLOMATIC_RELATIONS);
  if (diplomacy && retained.length === entries.length && retained.every(([id, stance], index) => entries[index]?.[0] === id && entries[index]?.[1] === stance)) return diplomacy;
  return Object.fromEntries(retained);
};

const boundedTerritory = (organization: OrganizationState): OrganizationState["territoryRegionIds"] => [...new Set(
  organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId],
)].sort().slice(0, MAX_ORGANIZATION_TERRITORY_REGIONS);

const organizationPriority = (organization: OrganizationState): number =>
  statusRank[organization.status] * 1_000_000_000
  + organizationRank[organization.type] * 1_000_000
  + organization.memberIds.length * 1_000
  + organization.territoryRegionIds.length;

const summaryPriority = (organization: OrganizationSummary): number =>
  organizationRank[organization.type] * 1_000_000
  + organization.memberCount * 1_000
  + organization.territoryRegionIds.length;

const boundedOrganization = (
  organization: OrganizationState,
  validIds: ReadonlySet<string>,
): OrganizationState => {
  const childOrganizationIds = [...new Set(organization.childOrganizationIds)]
    .filter((id) => id !== organization.id && validIds.has(id))
    .sort()
    .slice(0, MAX_CHILD_ORGANIZATION_IDS);
  const territoryRegionIds = boundedTerritory(organization);
  const diplomacy = boundedRelations(organization.diplomacy, validIds, organization.id);
  const sameDiplomacy = organization.diplomacy
    ? diplomacy === organization.diplomacy
    : Object.keys(diplomacy).length === 0;
  if (sameArray(childOrganizationIds, organization.childOrganizationIds)
    && sameArray(territoryRegionIds, organization.territoryRegionIds)
    && sameDiplomacy) return organization;
  return { ...organization, childOrganizationIds, territoryRegionIds, diplomacy };
};

const boundedSummaryOrganization = (
  organization: OrganizationSummary,
  validIds: ReadonlySet<string>,
  fallbackRegionId: OrganizationSummary["territoryRegionIds"][number],
): OrganizationSummary => {
  const childIds = [...new Set(organization.childIds)].filter((id) => id !== organization.id && validIds.has(id)).sort().slice(0, MAX_CHILD_ORGANIZATION_IDS);
  const territoryRegionIds = [...new Set(organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [fallbackRegionId])]
    .sort()
    .slice(0, MAX_ORGANIZATION_TERRITORY_REGIONS);
  const diplomacy = boundedRelations(organization.diplomacy, validIds, organization.id);
  const sameDiplomacy = organization.diplomacy
    ? diplomacy === organization.diplomacy
    : Object.keys(diplomacy).length === 0;
  if (sameArray(childIds, organization.childIds)
    && sameArray(territoryRegionIds, organization.territoryRegionIds)
    && sameDiplomacy) return organization;
  return { ...organization, childIds, territoryRegionIds, diplomacy };
};

const retainedStateIds = (organizations: readonly OrganizationState[]): Set<string> => new Set(
  [...organizations]
    .sort((left, right) => organizationPriority(right) - organizationPriority(left) || left.id.localeCompare(right.id))
    .slice(0, MAX_ORGANIZATION_RECORDS)
    .map((organization) => organization.id),
);

const retainedSummaryIds = (organizations: readonly OrganizationSummary[]): Set<string> => new Set(
  [...organizations]
    .sort((left, right) => summaryPriority(right) - summaryPriority(left) || left.id.localeCompare(right.id))
    .slice(0, MAX_ORGANIZATIONS_PER_SUMMARY)
    .map((organization) => organization.id),
);

export const compactOrganizationRecords = (state: WorldState): number => {
  const previousStateCount = state.organizations.length;
  const retainedIds = previousStateCount > MAX_ORGANIZATION_RECORDS
    ? retainedStateIds(state.organizations)
    : new Set(state.organizations.map((organization) => organization.id));
  const organizations = state.organizations
    .filter((organization) => retainedIds.has(organization.id))
    .map((organization) => boundedOrganization(organization, retainedIds));
  state.organizations = organizations;

  let removed = previousStateCount - organizations.length;
  state.lod.summaries = state.lod.summaries.map((summary) => {
    const previousCount = summary.organizations.length;
    const summaryIds = previousCount > MAX_ORGANIZATIONS_PER_SUMMARY
      ? retainedSummaryIds(summary.organizations)
      : new Set(summary.organizations.map((organization) => organization.id));
    const bounded = summary.organizations
      .filter((organization) => summaryIds.has(organization.id))
      .map((organization) => boundedSummaryOrganization(organization, summaryIds, summary.regionId));
    removed += previousCount - bounded.length;
    return bounded.length === previousCount && bounded.every((organization, index) => organization === summary.organizations[index])
      ? summary
      : { ...summary, organizations: bounded };
  });
  return removed;
};
