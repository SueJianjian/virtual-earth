import { addPersistentTotal } from "../numeric.ts";
import { compareSimulationSteps } from "../time.ts";
import type { OrganizationDevelopmentSummary, OrganizationState, OrganizationType, WorldEvent, WorldState } from "../types.ts";

export const MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES = 2_048;
export const MAX_ORGANIZATION_DEVELOPMENT_RESOURCE_KEYS = 16;
export const MAX_ORGANIZATION_DEVELOPMENT_MILESTONES = 24;

const organizationTypes = new Set<OrganizationType>(["family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"]);
const milestoneKinds = new Set([
  "organization-formation", "organization-split", "organization-dissolved", "organization-conflict", "organization-trade",
  "territory-expansion", "territory-transfer", "organization-migration", "diplomatic-alliance", "border-conflict", "organization-war",
  "war-displacement", "facility-planned", "facility-constructed", "facility-upgraded", "facility-damaged", "facility-maintained",
  "facility-abandoned", "facility-retired",
]);
const organizationPayloadKeys = [
  "organizationId", "fromOrganizationId", "toOrganizationId", "leftOrganizationId", "rightOrganizationId",
  "ownerOrganizationId", "winnerOrganizationId", "loserOrganizationId", "childOrganizationId", "childId",
] as const;
const counterKeys = [
  "eventCount", "formationCount", "splitCount", "dissolutionCount", "conflictCount", "warCount", "migrationCount",
  "expansionCount", "territoryTransferCount", "allianceCount", "tradeCount", "facilityPlannedCount", "facilityConstructedCount",
  "facilityUpgradedCount", "facilityDamagedCount", "facilityMaintainedCount", "facilityAbandonedCount", "facilityRetiredCount",
] as const;
const otherResourceKey = "__other__";

const organizationIdFor = (value: unknown): string | undefined =>
  typeof value === "string" && value.startsWith("organization:") ? value : undefined;

const eventOrganizationIds = (event: WorldEvent): string[] => {
  const values: unknown[] = [...event.sourceIds];
  for (const key of organizationPayloadKeys) values.push(event.payload[key]);
  return [...new Set(values.map(organizationIdFor).filter((id): id is string => id !== undefined))];
};

const finiteNonNegative = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const boundedInteger = (value: unknown): number => Math.max(0, Math.trunc(finiteNonNegative(value)));

const boundedResourceCounts = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, amount]) => key.length > 0 && Number.isFinite(Number(amount)) && Number(amount) >= 0)
    .map(([key, amount]) => [key, finiteNonNegative(amount)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const retained = entries.slice(0, MAX_ORGANIZATION_DEVELOPMENT_RESOURCE_KEYS - 1);
  const overflow = entries.slice(MAX_ORGANIZATION_DEVELOPMENT_RESOURCE_KEYS - 1)
    .reduce((sum, [, amount]) => addPersistentTotal(sum, amount), 0);
  const result: Record<string, number> = {};
  for (const [key, amount] of retained) result[key] = amount;
  if (overflow > 0) result[otherResourceKey] = overflow;
  return result;
};

const boundedMilestones = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(-MAX_ORGANIZATION_DEVELOPMENT_MILESTONES)
  : [];

const activityStep = (tick: number, timelineStep?: string): string => timelineStep ?? String(tick);

const emptySummary = (id: string, type: OrganizationType, tick: number, timelineStep?: string, timelineDays?: string, years?: number): OrganizationDevelopmentSummary => ({
  id: id as OrganizationDevelopmentSummary["id"],
  type,
  eventCount: 0,
  memberCount: 0,
  peakMemberCount: 0,
  territoryCount: 0,
  peakTerritoryCount: 0,
  formationCount: 0,
  splitCount: 0,
  dissolutionCount: 0,
  conflictCount: 0,
  warCount: 0,
  migrationCount: 0,
  expansionCount: 0,
  territoryTransferCount: 0,
  allianceCount: 0,
  tradeCount: 0,
  tradeVolume: 0,
  tradeVolumeByResource: {},
  facilityPlannedCount: 0,
  facilityConstructedCount: 0,
  facilityUpgradedCount: 0,
  facilityDamagedCount: 0,
  facilityMaintainedCount: 0,
  facilityAbandonedCount: 0,
  facilityRetiredCount: 0,
  milestoneIds: [],
  firstActivityTick: tick,
  ...(timelineStep === undefined ? {} : { firstActivityTimelineStep: timelineStep }),
  ...(timelineDays === undefined ? {} : { firstActivityTimelineDays: timelineDays }),
  ...(years === undefined ? {} : { firstActivityYears: years }),
  latestActivityTick: tick,
  ...(timelineStep === undefined ? {} : { latestActivityTimelineStep: timelineStep }),
  ...(timelineDays === undefined ? {} : { latestActivityTimelineDays: timelineDays }),
  ...(years === undefined ? {} : { latestActivityYears: years }),
});

export const isOrganizationDevelopmentSummary = (value: unknown): value is OrganizationDevelopmentSummary => {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<OrganizationDevelopmentSummary>;
  const tradeVolumeByResource = summary.tradeVolumeByResource;
  const validTradeVolumeByResource = tradeVolumeByResource !== null
    && typeof tradeVolumeByResource === "object"
    && !Array.isArray(tradeVolumeByResource)
    && Object.keys(tradeVolumeByResource).length <= MAX_ORGANIZATION_DEVELOPMENT_RESOURCE_KEYS
    && Object.entries(tradeVolumeByResource).every(([key, amount]) => key.length > 0 && Number.isFinite(amount) && amount >= 0);
  const numeric = [
    ...counterKeys.map((key) => summary[key]), summary.memberCount, summary.peakMemberCount, summary.territoryCount,
    summary.peakTerritoryCount, summary.tradeVolume, summary.firstActivityTick, summary.latestActivityTick,
    summary.firstActivityYears, summary.latestActivityYears,
  ];
  return typeof summary.id === "string"
    && (summary.id.startsWith("organization:") || summary.id.startsWith("family:") || summary.id.startsWith("aggregate:organization:"))
    && typeof summary.type === "string"
    && organizationTypes.has(summary.type as OrganizationType)
    && numeric.every((number) => number === undefined || (Number.isFinite(number) && Number(number) >= 0))
    && Array.isArray(summary.milestoneIds)
    && summary.milestoneIds.length <= MAX_ORGANIZATION_DEVELOPMENT_MILESTONES
    && summary.milestoneIds.every((id) => typeof id === "string")
    && validTradeVolumeByResource
    && (summary.firstActivityTimelineStep === undefined || /^\d+$/.test(summary.firstActivityTimelineStep))
    && (summary.firstActivityTimelineDays === undefined || /^\d+$/.test(summary.firstActivityTimelineDays))
    && (summary.latestActivityTimelineStep === undefined || /^\d+$/.test(summary.latestActivityTimelineStep))
    && (summary.latestActivityTimelineDays === undefined || /^\d+$/.test(summary.latestActivityTimelineDays));
};

const normalizedSummary = (value: unknown, id: string): OrganizationDevelopmentSummary | undefined => {
  if (!isOrganizationDevelopmentSummary(value)) return undefined;
  const summary = value as OrganizationDevelopmentSummary;
  return {
    ...summary,
    id: id as OrganizationDevelopmentSummary["id"],
    milestoneIds: boundedMilestones(summary.milestoneIds),
    tradeVolumeByResource: boundedResourceCounts(summary.tradeVolumeByResource),
    ...Object.fromEntries(counterKeys.map((key) => [key, addPersistentTotal(0, summary[key])])) as Pick<OrganizationDevelopmentSummary, typeof counterKeys[number]>,
    memberCount: boundedInteger(summary.memberCount),
    peakMemberCount: boundedInteger(summary.peakMemberCount),
    territoryCount: boundedInteger(summary.territoryCount),
    peakTerritoryCount: boundedInteger(summary.peakTerritoryCount),
    tradeVolume: finiteNonNegative(summary.tradeVolume),
    firstActivityTick: finiteNonNegative(summary.firstActivityTick),
    latestActivityTick: finiteNonNegative(summary.latestActivityTick),
  };
};

export const normalizeOrganizationDevelopment = (
  value: unknown,
  currentIds: ReadonlySet<string> = new Set(),
): Record<string, OrganizationDevelopmentSummary> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, OrganizationDevelopmentSummary> = {};
  for (const [id, summary] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizedSummary(summary, id);
    if (normalized) result[id] = normalized;
  }
  return retainOrganizationDevelopment(result, currentIds);
};

const eventType = (event: WorldEvent, id: string, state: WorldState, records: Record<string, OrganizationDevelopmentSummary>): OrganizationType => {
  const value = event.payload.type ?? event.payload.organizationType;
  if (typeof value === "string" && organizationTypes.has(value as OrganizationType)) return value as OrganizationType;
  return state.organizations.find((organization) => organization.id === id)?.type
    ?? records[id]?.type
    ?? state.eventArchive.archivedOrganizationSummaries.find((organization) => organization.id === id)?.type
    ?? "family";
};

const ensureSummary = (
  state: WorldState,
  records: Record<string, OrganizationDevelopmentSummary>,
  id: string,
  currentIds: ReadonlySet<string>,
  capacity: { remaining: number | undefined; recordCount: number | undefined },
  changes: { added: boolean },
  event?: WorldEvent,
): OrganizationDevelopmentSummary | undefined => {
  const existing = records[id];
  if (existing) return existing;
  capacity.recordCount ??= Object.keys(records).length;
  const organization = state.organizations.find((candidate) => candidate.id === id);
  if (!organization && !currentIds.has(id)) {
    // Historical event references are capped, but the count is only needed
    // when one actually introduces a new record. Avoid scanning the full
    // archive on every simulation step after it has reached capacity.
    capacity.remaining ??= Math.max(0, MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES - capacity.recordCount);
    if (capacity.remaining <= 0) return undefined;
  }
  const summary = event
    ? emptySummary(id, eventType(event, id, state, records), event.tick, event.timelineStep, event.timelineDays, event.years)
    : emptySummary(id, organization?.type ?? "family", state.tick, state.timeline?.step, state.timeline?.days, state.years);
  records[id] = summary;
  capacity.recordCount += 1;
  changes.added = true;
  if (!organization && !currentIds.has(id) && capacity.remaining !== undefined) capacity.remaining -= 1;
  return summary;
};

const updateActivity = (summary: OrganizationDevelopmentSummary, event: WorldEvent): void => {
  const step = activityStep(event.tick, event.timelineStep);
  const first = activityStep(summary.firstActivityTick, summary.firstActivityTimelineStep);
  const latest = activityStep(summary.latestActivityTick, summary.latestActivityTimelineStep);
  if (compareSimulationSteps(step, first) < 0) {
    summary.firstActivityTick = event.tick;
    if (event.timelineStep !== undefined) summary.firstActivityTimelineStep = event.timelineStep;
    if (event.timelineDays !== undefined) summary.firstActivityTimelineDays = event.timelineDays;
    if (event.years !== undefined) summary.firstActivityYears = event.years;
  }
  if (compareSimulationSteps(step, latest) >= 0) {
    summary.latestActivityTick = event.tick;
    if (event.timelineStep !== undefined) summary.latestActivityTimelineStep = event.timelineStep;
    if (event.timelineDays !== undefined) summary.latestActivityTimelineDays = event.timelineDays;
    if (event.years !== undefined) summary.latestActivityYears = event.years;
  }
};

const bump = (summary: OrganizationDevelopmentSummary, key: typeof counterKeys[number], amount = 1): void => {
  summary[key] = addPersistentTotal(summary[key], Math.max(0, amount));
};

const recordTrade = (summary: OrganizationDevelopmentSummary, event: WorldEvent): void => {
  const amount = finiteNonNegative(event.payload.amount ?? event.evidence.amount);
  summary.tradeVolume = Math.min(Number.MAX_SAFE_INTEGER, summary.tradeVolume + amount >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : summary.tradeVolume + amount);
  const resourceId = event.payload.resourceId ?? event.evidence.resourceId;
  if (typeof resourceId !== "string" || resourceId.length === 0 || amount <= 0) return;
  const existing = summary.tradeVolumeByResource[resourceId];
  if (existing !== undefined || Object.keys(summary.tradeVolumeByResource).length < MAX_ORGANIZATION_DEVELOPMENT_RESOURCE_KEYS - 1) {
    summary.tradeVolumeByResource[resourceId] = addPersistentTotal(existing ?? 0, amount);
    return;
  }
  summary.tradeVolumeByResource[otherResourceKey] = addPersistentTotal(summary.tradeVolumeByResource[otherResourceKey] ?? 0, amount);
};

const recordEventFor = (summary: OrganizationDevelopmentSummary, event: WorldEvent): void => {
  bump(summary, "eventCount");
  updateActivity(summary, event);
  if (milestoneKinds.has(event.kind) && !summary.milestoneIds.includes(event.id)) {
    summary.milestoneIds = [...summary.milestoneIds, event.id].slice(-MAX_ORGANIZATION_DEVELOPMENT_MILESTONES);
  }
  switch (event.kind) {
    case "organization-formation": bump(summary, "formationCount"); break;
    case "organization-split": bump(summary, "splitCount"); break;
    case "organization-dissolved": bump(summary, "dissolutionCount"); break;
    case "organization-conflict":
    case "border-conflict":
      bump(summary, "conflictCount");
      break;
    case "organization-war":
      bump(summary, "conflictCount");
      bump(summary, "warCount");
      break;
    case "organization-migration":
    case "war-displacement": bump(summary, "migrationCount"); break;
    case "territory-expansion": bump(summary, "expansionCount"); break;
    case "territory-transfer": bump(summary, "territoryTransferCount"); break;
    case "diplomatic-alliance": bump(summary, "allianceCount"); break;
    case "organization-trade":
    case "interregional-trade":
      bump(summary, "tradeCount");
      recordTrade(summary, event);
      break;
    case "facility-planned": bump(summary, "facilityPlannedCount"); break;
    case "facility-constructed": bump(summary, "facilityConstructedCount"); break;
    case "facility-upgraded": bump(summary, "facilityUpgradedCount"); break;
    case "facility-damaged": bump(summary, "facilityDamagedCount"); break;
    case "facility-maintained": bump(summary, "facilityMaintainedCount"); break;
    case "facility-abandoned": bump(summary, "facilityAbandonedCount"); break;
    case "facility-retired": bump(summary, "facilityRetiredCount"); break;
    default: break;
  }
};

const updateCurrentOrganization = (summary: OrganizationDevelopmentSummary, organization: OrganizationState): void => {
  const memberCount = boundedInteger(organization.memberIds.length);
  const territoryCount = boundedInteger(new Set(organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId]).size);
  summary.memberCount = memberCount;
  summary.peakMemberCount = Math.max(summary.peakMemberCount, memberCount);
  summary.territoryCount = territoryCount;
  summary.peakTerritoryCount = Math.max(summary.peakTerritoryCount, territoryCount);
};

const compareDevelopmentPreference = (
  leftId: string,
  left: OrganizationDevelopmentSummary,
  rightId: string,
  right: OrganizationDevelopmentSummary,
  currentIds: ReadonlySet<string>,
): number =>
  Number(currentIds.has(rightId)) - Number(currentIds.has(leftId))
    || compareSimulationSteps(activityStep(right.latestActivityTick, right.latestActivityTimelineStep), activityStep(left.latestActivityTick, left.latestActivityTimelineStep))
    || right.eventCount - left.eventCount
    || leftId.localeCompare(rightId);

const MAX_INCREMENTAL_ORGANIZATION_DEVELOPMENT_PRUNE = 4;

const pruneOrganizationDevelopmentInPlace = (
  records: Record<string, OrganizationDevelopmentSummary>,
  currentIds: ReadonlySet<string>,
  overflow: number,
): void => {
  for (let count = 0; count < overflow; count += 1) {
    let leastPreferredId: string | undefined;
    for (const id in records) {
      if (!Object.hasOwn(records, id)) continue;
      if (leastPreferredId === undefined || compareDevelopmentPreference(
        id,
        records[id]!,
        leastPreferredId,
        records[leastPreferredId]!,
        currentIds,
      ) > 0) leastPreferredId = id;
    }
    if (leastPreferredId === undefined) return;
    delete records[leastPreferredId];
  }
};

export const retainOrganizationDevelopment = (
  records: Record<string, OrganizationDevelopmentSummary>,
  currentIds: ReadonlySet<string> = new Set(),
): Record<string, OrganizationDevelopmentSummary> => {
  const recordIds = Object.keys(records);
  if (recordIds.length <= MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES) return records;
  const overflow = recordIds.length - MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES;
  if (overflow <= MAX_INCREMENTAL_ORGANIZATION_DEVELOPMENT_PRUNE) {
    const discarded = new Set<string>();
    for (let count = 0; count < overflow; count += 1) {
      let leastPreferredId: string | undefined;
      for (const id of recordIds) {
        if (discarded.has(id)) continue;
        if (leastPreferredId === undefined || compareDevelopmentPreference(
          id,
          records[id]!,
          leastPreferredId,
          records[leastPreferredId]!,
          currentIds,
        ) > 0) leastPreferredId = id;
      }
      if (leastPreferredId !== undefined) discarded.add(leastPreferredId);
    }
    return Object.fromEntries(recordIds
      .filter((id) => !discarded.has(id))
      .map((id) => [id, records[id]!]));
  }
  return Object.fromEntries(recordIds
    .map((id) => [id, records[id]!] as [string, OrganizationDevelopmentSummary])
    .sort(([leftId, left], [rightId, right]) => compareDevelopmentPreference(leftId, left, rightId, right, currentIds))
    .slice(0, MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES));
};

export const recordOrganizationDevelopment = (state: WorldState, events: readonly WorldEvent[] = []): void => {
  const currentIds = new Set(state.organizations.map((organization) => organization.id));
  const records = state.eventArchive.organizationDevelopment;
  const capacity = { remaining: undefined as number | undefined, recordCount: undefined as number | undefined };
  const changes = { added: false };
  for (const event of events) {
    const ids = eventOrganizationIds(event);
    const splitChild = organizationIdFor(event.payload.childId);
    for (const id of ids) {
      const summary = ensureSummary(state, records, id, currentIds, capacity, changes, event);
      if (summary) recordEventFor(summary, event);
    }
    if (event.kind === "organization-split" && splitChild && splitChild !== event.payload.organizationId) {
      const child = ensureSummary(state, records, splitChild, currentIds, capacity, changes, event);
      if (child) bump(child, "formationCount");
    }
  }
  for (const organization of state.organizations) {
    const summary = ensureSummary(state, records, organization.id, currentIds, capacity, changes);
    if (summary) {
      summary.type = organization.type;
      updateCurrentOrganization(summary, organization);
    }
  }
  if (changes.added) {
    const recordCount = capacity.recordCount ?? Object.keys(records).length;
    const overflow = recordCount - MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES;
    if (overflow > 0) pruneOrganizationDevelopmentInPlace(records, currentIds, overflow);
  }
};
