import { addPersistentTotal } from "../numeric.ts";
import { compareSimulationSteps } from "../time.ts";
import type { ArchivedOrganizationSummary, DiplomaticStance, OrganizationArchiveReason, OrganizationState, OrganizationSummary, OrganizationType, RegionId, WorldState } from "../types.ts";

export const MAX_ORGANIZATION_RECORDS = 2_048;
export const MAX_CHILD_ORGANIZATION_IDS = 64;
export const MAX_DIPLOMATIC_RELATIONS = 64;
export const MAX_ORGANIZATIONS_PER_SUMMARY = 64;
export const MAX_ORGANIZATION_TERRITORY_REGIONS = 128;
export const MAX_ARCHIVED_ORGANIZATION_SUMMARIES = 512;
export const MAX_ARCHIVED_ORGANIZATION_MEMBERS = 64;
export const MAX_ARCHIVED_ORGANIZATION_RESOURCES = 32;

const organizationTypes = new Set<OrganizationType>(["family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"]);
const organizationStatuses = new Set<ArchivedOrganizationSummary["status"]>(["active", "migrating", "fragmenting", "collapsed"]);
const organizationArchiveReasons = new Set<OrganizationArchiveReason>(["lifecycle", "capacity"]);

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

const boundedIds = <T extends string>(ids: readonly T[], limit: number): T[] => [...new Set(ids)].sort().slice(0, limit) as T[];

const boundedTerritoryFor = (organization: OrganizationState | OrganizationSummary, fallbackRegionId?: RegionId): OrganizationState["territoryRegionIds"] => {
  const fallback = "regionId" in organization ? [organization.regionId] : fallbackRegionId ? [fallbackRegionId] : [];
  return boundedIds(
    organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : fallback,
    MAX_ORGANIZATION_TERRITORY_REGIONS,
  );
};

const boundedResourceRecord = (resources: Record<string, number>): Record<string, number> => Object.fromEntries(
  Object.entries(resources)
    .filter(([resourceId, amount]) => resourceId.length > 0 && Number.isFinite(amount) && amount >= 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_ARCHIVED_ORGANIZATION_RESOURCES),
);

const boundedArchiveDiplomacy = (diplomacy: Record<string, DiplomaticStance> | undefined): Record<string, DiplomaticStance> | undefined => {
  const entries = Object.entries(diplomacy ?? {})
    .filter(([id, stance]) => id.length > 0 && Object.prototype.hasOwnProperty.call(stanceRank, stance))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_DIPLOMATIC_RELATIONS);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const organizationMentionedByEvent = (organizationId: string, event: WorldState["events"][number]): boolean =>
  event.sourceIds.includes(organizationId) || Object.values(event.payload).some((value) => value === organizationId);

const organizationHistoryCount = (state: WorldState, organization: OrganizationState | OrganizationSummary): number => {
  const archivedEventCount = state.eventArchive.organizationCounts[organization.id] ?? 0;
  const hotEventCount = state.events.reduce((count, event) => count + (organizationMentionedByEvent(organization.id, event) ? 1 : 0), 0);
  const existingCount = "historyIds" in organization
    ? organization.historyIds.length + (organization.archivedHistoryCount ?? 0)
    : (organization.archivedHistoryCount ?? 0);
  return Math.max(existingCount, addPersistentTotal(archivedEventCount, hotEventCount));
};

const archivedOrganizationSummaryFor = (
  state: WorldState,
  organization: OrganizationState | OrganizationSummary,
  archiveReason: OrganizationArchiveReason,
  fallbackRegionId?: RegionId,
): ArchivedOrganizationSummary => {
  const isSummary = "historyIds" in organization;
  const regionId = "regionId" in organization ? organization.regionId : organization.territoryRegionIds[0] ?? fallbackRegionId;
  const memberIds = boundedIds(organization.memberIds, MAX_ARCHIVED_ORGANIZATION_MEMBERS);
  const childIds = boundedIds(
    isSummary ? organization.childIds : organization.childOrganizationIds,
    MAX_CHILD_ORGANIZATION_IDS,
  );
  const resources = boundedResourceRecord(isSummary ? {} : organization.resources);
  const diplomacy = boundedArchiveDiplomacy(organization.diplomacy);
  const resourceIds = boundedIds(
    isSummary ? organization.resourceIds : [...new Set([...Object.keys(resources), ...Object.keys(organization.resources)])],
    MAX_ARCHIVED_ORGANIZATION_RESOURCES,
  );
  return {
    id: organization.id,
    type: organization.type,
    regionId: regionId ?? ("region:0:0" as RegionId),
    memberCount: Math.max(0, Math.trunc(isSummary ? organization.memberCount : organization.memberIds.length)),
    memberIds,
    childIds,
    resourceIds,
    resources,
    territoryRegionIds: boundedTerritoryFor(organization, fallbackRegionId),
    status: isSummary ? "active" : organization.status,
    historyCount: organizationHistoryCount(state, organization),
    archiveReason,
    archivedTick: state.tick,
    ...(state.timeline?.step === undefined ? {} : { archivedTimelineStep: state.timeline.step }),
    ...(state.timeline?.days === undefined ? {} : { archivedTimelineDays: state.timeline.days }),
    archivedYears: state.years,
    ...(organization.governance ? { governance: structuredClone(organization.governance) } : {}),
    ...(diplomacy ? { diplomacy } : {}),
  };
};

const archivedOrganizationOrder = (left: ArchivedOrganizationSummary, right: ArchivedOrganizationSummary): number =>
  compareSimulationSteps(left.archivedTimelineStep ?? String(left.archivedTick), right.archivedTimelineStep ?? String(right.archivedTick))
  || left.id.localeCompare(right.id);

export const retainArchivedOrganizationSummaries = (
  summaries: readonly ArchivedOrganizationSummary[],
): ArchivedOrganizationSummary[] => {
  const latestById = new Map<string, ArchivedOrganizationSummary>();
  for (const summary of summaries) latestById.set(summary.id, summary);
  const ordered = [...latestById.values()].sort(archivedOrganizationOrder);
  return ordered.length <= MAX_ARCHIVED_ORGANIZATION_SUMMARIES
    ? ordered
    : ordered.slice(-MAX_ARCHIVED_ORGANIZATION_SUMMARIES);
};

export const archiveOrganizationRecords = (
  state: WorldState,
  organizations: readonly (OrganizationState | OrganizationSummary)[],
  archiveReason: OrganizationArchiveReason,
  fallbackRegionId?: RegionId,
): void => {
  if (organizations.length === 0) return;
  const existing = new Map((state.eventArchive.archivedOrganizationSummaries ?? []).map((summary) => [summary.id, summary]));
  let additions = 0;
  for (const organization of organizations) {
    const summary = archivedOrganizationSummaryFor(state, organization, archiveReason, fallbackRegionId);
    const prior = existing.get(summary.id);
    if (!prior || (archiveReason === "lifecycle" && prior.archiveReason === "capacity")) {
      if (!prior) additions += 1;
      existing.set(summary.id, summary);
    }
  }
  state.eventArchive.archivedOrganizationCount = addPersistentTotal(
    state.eventArchive.archivedOrganizationCount ?? 0,
    additions,
  );
  state.eventArchive.archivedOrganizationSummaries = retainArchivedOrganizationSummaries([...existing.values()]);
};

export const isArchivedOrganizationSummary = (value: unknown): value is ArchivedOrganizationSummary => {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<ArchivedOrganizationSummary>;
  const numericValues = [summary.memberCount, summary.historyCount, summary.archivedTick, summary.archivedYears];
  const resources = summary.resources;
  const diplomacy = summary.diplomacy;
  const governance = summary.governance;
  const governanceValues = governance
    ? [governance.stability, governance.legitimacy, governance.military, governance.treasury, governance.publicGoods, governance.warWeariness, governance.taxRate, governance.taxRevenue, governance.cohesion, governance.lastConflictTick]
    : [];
  return typeof summary.id === "string"
    && typeof summary.type === "string"
    && organizationTypes.has(summary.type as OrganizationType)
    && typeof summary.regionId === "string"
    && numericValues.every((number) => typeof number === "number" && Number.isFinite(number))
    && summary.memberCount! >= 0
    && summary.historyCount! >= 0
    && summary.archivedTick! >= 0
    && summary.archivedYears! >= 0
    && Array.isArray(summary.memberIds)
    && summary.memberIds.length <= MAX_ARCHIVED_ORGANIZATION_MEMBERS
    && summary.memberIds.every((id) => typeof id === "string")
    && Array.isArray(summary.childIds)
    && summary.childIds.length <= MAX_CHILD_ORGANIZATION_IDS
    && summary.childIds.every((id) => typeof id === "string")
    && Array.isArray(summary.resourceIds)
    && summary.resourceIds.length <= MAX_ARCHIVED_ORGANIZATION_RESOURCES
    && summary.resourceIds.every((id) => typeof id === "string")
    && Boolean(resources)
    && typeof resources === "object"
    && !Array.isArray(resources)
    && Object.values(resources).every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
    && Array.isArray(summary.territoryRegionIds)
    && summary.territoryRegionIds.length <= MAX_ORGANIZATION_TERRITORY_REGIONS
    && summary.territoryRegionIds.every((id) => typeof id === "string")
    && typeof summary.status === "string"
    && organizationStatuses.has(summary.status)
    && typeof summary.archiveReason === "string"
    && organizationArchiveReasons.has(summary.archiveReason)
    && (summary.archivedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(summary.archivedTimelineStep))
    && (summary.archivedTimelineDays === undefined || /^(0|[1-9]\d*)$/.test(summary.archivedTimelineDays))
    && governanceValues.every((number) => Number.isFinite(number))
    && (!governance || governance.lastConflictTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(governance.lastConflictTimelineStep))
    && (!diplomacy || (typeof diplomacy === "object" && !Array.isArray(diplomacy) && Object.values(diplomacy).every((stance) => Object.prototype.hasOwnProperty.call(stanceRank, stance))));
};

export const compactOrganizationRecords = (state: WorldState): number => {
  const previousStateCount = state.organizations.length;
  const retainedIds = previousStateCount > MAX_ORGANIZATION_RECORDS
    ? retainedStateIds(state.organizations)
    : new Set(state.organizations.map((organization) => organization.id));
  if (previousStateCount > MAX_ORGANIZATION_RECORDS) {
    archiveOrganizationRecords(
      state,
      state.organizations.filter((organization) => !retainedIds.has(organization.id)),
      "capacity",
    );
  }
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
    if (previousCount > MAX_ORGANIZATIONS_PER_SUMMARY) {
      const canonicalIds = new Set(state.organizations.map((organization) => organization.id));
      archiveOrganizationRecords(
        state,
        summary.organizations.filter((organization) => !summaryIds.has(organization.id) && !canonicalIds.has(organization.id)),
        "capacity",
        summary.regionId,
      );
    }
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
