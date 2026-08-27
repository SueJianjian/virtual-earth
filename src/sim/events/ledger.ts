import { hashString } from "../random.ts";
import type { EventArchive, EventMilestone, WorldEvent, WorldEventDraft, WorldState } from "../types.ts";

export const EVENT_LOG_RETAIN_COUNT = 4_096;
export const EVENT_LOG_COMPACT_THRESHOLD = 4_608;
export const MAX_ACTIVE_USER_EVENTS = 1_024;
export const EVENT_LOG_MAX_COUNT = EVENT_LOG_RETAIN_COUNT + MAX_ACTIVE_USER_EVENTS;
export const MAX_ARCHIVE_COUNTER_KEYS = 512;
export const ARCHIVE_OTHER_KEY = "__other__";
export const MAX_EVENT_MILESTONES = 512;
export const MAX_MILESTONE_RELATED_IDS = 12;

const MILESTONE_KINDS = new Set([
  "protoplanetary-dust", "planetesimal-formation", "planetary-accretion", "core-differentiation", "planetary-cooling", "planet-formation-complete", "ocean-formation", "prebiotic-chemistry",
  "abiogenesis", "species-emergence", "species-divergence", "family-formation", "organization-formation", "organization-split", "organization-conflict", "organization-dissolved",
  "population-migration", "population-dispersal", "territory-expansion", "territory-transfer", "war-displacement", "border-conflict", "organization-war", "diplomatic-alliance",
  "substance-formation", "substance-discovery", "substance-engineering", "knowledge-innovation", "culture-emergence", "worldview-entity-dormant", "worldview-entity-revived",
  "aggregate-culture-innovation", "aggregate-belief-emergence", "aggregate-organization-formation", "aggregate-organization-dissolution",
]);
const MILESTONE_DETAIL_KEYS = [
  "regionId", "fromRegion", "toRegion", "originRegionId", "organizationId", "fromOrganizationId", "toOrganizationId", "leftOrganizationId", "rightOrganizationId",
  "ownerOrganizationId", "winnerOrganizationId", "loserOrganizationId", "familyId", "name", "type", "result", "outcome", "resourceId", "amount", "intensity", "route", "reason", "foodSecurity", "practiceOrigin",
];

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = stableValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
};

const stableDraft = (draft: WorldEventDraft): string => JSON.stringify(stableValue({
  kind: draft.kind,
  ruleId: draft.ruleId,
  years: draft.years ?? null,
  position: draft.position ?? null,
  sourceIds: [...draft.sourceIds].sort(),
  probability: draft.probability,
  roll: draft.roll,
  evidence: draft.evidence,
  payload: draft.payload,
  source: draft.source,
}));

export const materializeEvent = (
  draft: WorldEventDraft,
  tick: number,
  ordinal: number,
  years?: number,
): WorldEvent => {
  const { years: draftYears, ...eventDraft } = draft;
  const occurredYears = draftYears ?? years;
  return {
    ...eventDraft,
    id: `event:${hashString(`${tick}:${ordinal}:${stableDraft(draft)}`).toString(16)}`,
    tick,
    ...(occurredYears === undefined ? {} : { years: occurredYears }),
  };
};

const compareEvents = (left: Pick<WorldEvent, "id" | "tick" | "years"> | EventMilestone, right: Pick<WorldEvent, "id" | "tick" | "years"> | EventMilestone): number =>
  (left.years ?? left.tick) - (right.years ?? right.tick) || left.tick - right.tick || left.id.localeCompare(right.id);

export const createEventArchive = (events: readonly WorldEvent[] = []): EventArchive => {
  const first = events[0];
  const latest = events.at(-1);
  return {
    totalEventCount: events.length,
    archivedEventCount: 0,
    archivedSpeciesCount: 0,
    archivedKnowledgeCount: 0,
    archivedCultureCount: 0,
    archivedRelationshipCount: 0,
    ...(first ? { firstEventTick: first.tick } : {}),
    ...(first?.years === undefined ? {} : { firstEventYears: first.years }),
    ...(latest ? { latestEventTick: latest.tick } : {}),
    ...(latest?.years === undefined ? {} : { latestEventYears: latest.years }),
    kindCounts: {},
    regionCounts: {},
    organizationCounts: {},
    organizationFormationCounts: {},
    tradeVolumeByResource: {},
    archivedSpeciesRoleCounts: {},
    milestones: retainMilestones(events.filter(isMilestoneEvent).map(eventMilestoneFor)),
  };
};

const increment = (counts: Record<string, number>, key: string, amount = 1, limit = MAX_ARCHIVE_COUNTER_KEYS): void => {
  const unsafeKey = key === "__proto__" || key === "constructor" || key === "prototype";
  const hasOther = Object.prototype.hasOwnProperty.call(counts, ARCHIVE_OTHER_KEY);
  const hasKey = Object.prototype.hasOwnProperty.call(counts, key);
  const keyLimit = limit - (hasOther ? 0 : 1);
  const targetKey = unsafeKey || (!hasKey && Object.keys(counts).length >= keyLimit) ? ARCHIVE_OTHER_KEY : key;
  counts[targetKey] = (counts[targetKey] ?? 0) + amount;
};

const compactCounter = (counts: Record<string, number>, limit = MAX_ARCHIVE_COUNTER_KEYS): void => {
  const entries = Object.entries(counts);
  if (entries.length <= limit) return;
  const otherAmount = counts[ARCHIVE_OTHER_KEY] ?? 0;
  const candidates = entries
    .filter(([key]) => key !== ARCHIVE_OTHER_KEY)
    .sort(([leftKey, leftAmount], [rightKey, rightAmount]) => rightAmount - leftAmount || leftKey.localeCompare(rightKey));
  const retained = candidates.slice(0, Math.max(0, limit - 1));
  const retainedKeys = new Set(retained.map(([key]) => key));
  const overflow = candidates
    .filter(([key]) => !retainedKeys.has(key))
    .reduce((sum, [, amount]) => sum + amount, otherAmount);
  for (const key of Object.keys(counts)) delete counts[key];
  for (const [key, amount] of retained.sort(([left], [right]) => left.localeCompare(right))) counts[key] = amount;
  if (overflow > 0) counts[ARCHIVE_OTHER_KEY] = overflow;
};

export const compactEventArchiveCounters = (state: Pick<WorldState, "eventArchive">): void => {
  compactCounter(state.eventArchive.kindCounts);
  compactCounter(state.eventArchive.regionCounts);
  compactCounter(state.eventArchive.organizationCounts);
  compactCounter(state.eventArchive.organizationFormationCounts);
  compactCounter(state.eventArchive.tradeVolumeByResource);
  compactCounter(state.eventArchive.archivedSpeciesRoleCounts);
};

export const eventRegionIds = (event: WorldEvent): string[] => {
  const values = [
    event.payload.regionId,
    event.payload.fromRegion,
    event.payload.toRegion,
    event.payload.originRegionId,
    event.evidence.regionId,
    event.evidence.fromRegion,
    event.evidence.toRegion,
    event.evidence.originRegionId,
  ];
  if (Array.isArray(event.payload.territoryRegionIds)) {
    for (const regionId of event.payload.territoryRegionIds) values.push(regionId);
  }
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.startsWith("region:")))];
};

export const eventOrganizationIds = (event: WorldEvent): string[] => {
  const values = [
    ...event.sourceIds,
    event.payload.organizationId,
    event.payload.fromOrganizationId,
    event.payload.toOrganizationId,
    event.payload.leftOrganizationId,
    event.payload.rightOrganizationId,
    event.payload.ownerOrganizationId,
    event.payload.winnerOrganizationId,
    event.payload.loserOrganizationId,
    event.payload.familyId,
  ];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.startsWith("organization:")))];
};

const isScalar = (value: unknown): value is number | string | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

export const isMilestoneEvent = (event: WorldEvent): boolean => MILESTONE_KINDS.has(event.kind)
  || (event.kind.startsWith("worldview-original-") && !event.kind.endsWith("practice-training"));

export const eventMilestoneFor = (event: WorldEvent): EventMilestone => {
  const details: Record<string, number | string | boolean> = {};
  for (const key of MILESTONE_DETAIL_KEYS) {
    const value = event.payload[key] ?? event.evidence[key];
    if (isScalar(value)) details[key] = value;
  }
  const regionIds = eventRegionIds(event).slice(0, MAX_MILESTONE_RELATED_IDS) as EventMilestone["regionIds"];
  const organizationIds = eventOrganizationIds(event).sort().slice(0, MAX_MILESTONE_RELATED_IDS);
  return {
    id: event.id,
    tick: event.tick,
    ...(event.years === undefined ? {} : { years: event.years }),
    kind: event.kind,
    ruleId: event.ruleId,
    source: event.source,
    sourceIds: [...event.sourceIds].sort().slice(0, MAX_MILESTONE_RELATED_IDS),
    regionIds,
    organizationIds,
    probability: event.probability,
    roll: event.roll,
    ...(event.position ? { position: [...event.position] as [number, number] } : {}),
    details,
  };
};

const retainMilestones = (input: readonly EventMilestone[]): EventMilestone[] => {
  const unique = new Map<string, EventMilestone>();
  for (const milestone of input) unique.set(milestone.id, milestone);
  const ordered = [...unique.values()].sort(compareEvents);
  if (ordered.length <= MAX_EVENT_MILESTONES) return ordered;
  const anchorsByKind = new Map<string, EventMilestone>();
  for (const milestone of ordered) if (!anchorsByKind.has(milestone.kind)) anchorsByKind.set(milestone.kind, milestone);
  const anchors = [...anchorsByKind.values()].slice(0, MAX_EVENT_MILESTONES);
  const anchorIds = new Set(anchors.map((milestone) => milestone.id));
  const retained = new Map<string, EventMilestone>(anchors.map((milestone) => [milestone.id, milestone]));
  for (const milestone of ordered.slice(-MAX_EVENT_MILESTONES)) retained.set(milestone.id, milestone);
  if (retained.size > MAX_EVENT_MILESTONES) {
    const removable = [...retained.values()].filter((milestone) => !anchorIds.has(milestone.id)).sort(compareEvents);
    while (retained.size > MAX_EVENT_MILESTONES && removable.length > 0) {
      const milestone = removable.shift();
      if (milestone) retained.delete(milestone.id);
    }
  }
  return [...retained.values()].sort(compareEvents);
};

export const recordEventMilestones = (archive: EventArchive, events: readonly WorldEvent[]): void => {
  const milestones = events.filter(isMilestoneEvent).map(eventMilestoneFor);
  if (milestones.length === 0) return;
  archive.milestones = retainMilestones([...(archive.milestones ?? []), ...milestones]);
};

const recordLatestEvents = (archive: EventArchive, events: readonly WorldEvent[]): void => {
  if (events.length === 0) return;
  const first = events.reduce((result, event) => compareEvents(event, result) < 0 ? event : result);
  const latest = events.reduce((result, event) => compareEvents(result, event) < 0 ? event : result);
  if (archive.totalEventCount === 0 || archive.firstEventTick === undefined) {
    archive.firstEventTick = first.tick;
    if (first.years !== undefined) archive.firstEventYears = first.years;
  }
  archive.totalEventCount += events.length;
  const currentLatestYears = archive.latestEventYears ?? archive.latestEventTick ?? -1;
  if ((latest.years ?? latest.tick) >= currentLatestYears) {
    archive.latestEventTick = latest.tick;
    if (latest.years === undefined) delete archive.latestEventYears;
    else archive.latestEventYears = latest.years;
  }
};

export const synchronizeEventArchive = (archive: EventArchive, events: readonly WorldEvent[]): void => {
  const minimumTotal = archive.archivedEventCount + events.length;
  if (archive.totalEventCount < minimumTotal) archive.totalEventCount = minimumTotal;
  const first = events[0];
  const latest = events.at(-1);
  if (archive.firstEventTick === undefined && first) {
    archive.firstEventTick = first.tick;
    if (first.years !== undefined) archive.firstEventYears = first.years;
  }
  if (archive.latestEventTick === undefined && latest) {
    archive.latestEventTick = latest.tick;
    if (latest.years !== undefined) archive.latestEventYears = latest.years;
  }
};

const archiveEvents = (state: WorldState, events: readonly WorldEvent[]): void => {
  if (events.length === 0) return;
  const { eventArchive: archive } = state;
  archive.archivedEventCount += events.length;
  for (const event of events) {
    increment(archive.kindCounts, event.kind);
    for (const regionId of eventRegionIds(event)) increment(archive.regionCounts, regionId);
    for (const organizationId of eventOrganizationIds(event)) increment(archive.organizationCounts, organizationId);
    if ((event.kind === "organization-formation" || event.kind === "aggregate-organization-formation") && typeof event.payload.type === "string") {
      increment(archive.organizationFormationCounts, event.payload.type);
    }
    if (event.kind === "organization-trade" || event.kind === "interregional-trade") {
      const resourceId = event.payload.resourceId ?? event.evidence.resourceId;
      const amount = Number(event.payload.amount ?? event.evidence.amount ?? 0);
      if (typeof resourceId === "string" && Number.isFinite(amount) && amount > 0) {
        increment(archive.tradeVolumeByResource, resourceId, amount);
      }
    }
  }
  recordEventMilestones(archive, events);
  compactEventArchiveCounters(state);
  const latest = events.reduce((result, event) => compareEvents(result, event) < 0 ? event : result);
  archive.archivedThroughTick = Math.max(archive.archivedThroughTick ?? 0, latest.tick);
  if (latest.years !== undefined) archive.archivedThroughYears = Math.max(archive.archivedThroughYears ?? 0, latest.years);
  for (const organization of state.organizations) {
    organization.archivedHistoryCount = Math.max(
      organization.archivedHistoryCount ?? 0,
      archive.organizationCounts[organization.id] ?? 0,
    );
  }
  for (const summary of state.lod.summaries) {
    summary.archivedHistoryCount = Math.max(summary.archivedHistoryCount ?? 0, archive.regionCounts[summary.regionId] ?? 0);
    for (const organization of summary.organizations) {
      organization.archivedHistoryCount = Math.max(
        organization.archivedHistoryCount ?? 0,
        archive.organizationCounts[organization.id] ?? 0,
      );
    }
  }
};

const isActiveUserEvent = (event: WorldEvent, tick: number): boolean => {
  if (event.source !== "user") return false;
  const duration = Math.max(1, Math.trunc(Number(event.payload.duration ?? 1)));
  return tick - event.tick < duration;
};

export const compactEventLedger = (state: WorldState): WorldEvent[] => {
  if (state.events.length <= EVENT_LOG_COMPACT_THRESHOLD) return [];
  const splitAt = Math.max(0, state.events.length - EVENT_LOG_RETAIN_COUNT);
  const candidates = state.events.slice(0, splitAt);
  const activeCandidates = candidates.filter((event) => isActiveUserEvent(event, state.tick));
  const active = activeCandidates.slice(-MAX_ACTIVE_USER_EVENTS);
  const retainedActiveIds = new Set(active.map((event) => event.id));
  const archived = candidates.filter((event) => !retainedActiveIds.has(event.id));
  if (archived.length === 0) return [];
  archiveEvents(state, archived);
  state.events.splice(0, state.events.length, ...active, ...state.events.slice(splitAt));
  return archived;
};

export const compactEventArchiveIndexes = (state: WorldState): void => {
  const retainedOrganizationIds = new Set(state.organizations.map((organization) => organization.id));
  for (const organizationId of Object.keys(state.eventArchive.organizationCounts)) {
    if (organizationId === ARCHIVE_OTHER_KEY) continue;
    if (!retainedOrganizationIds.has(organizationId as WorldState["organizations"][number]["id"])) {
      delete state.eventArchive.organizationCounts[organizationId];
    }
  }
  compactEventArchiveCounters(state);
  state.eventArchive.milestones = retainMilestones(state.eventArchive.milestones ?? []);
};

export const appendEventsInPlace = (
  existing: WorldEvent[],
  drafts: WorldEventDraft[],
  tick: number,
  years?: number,
): WorldEvent[] => {
  if (drafts.length === 0) return [];
  const emitted: WorldEvent[] = [];
  const known = new Set(existing.filter((event) => event.tick === tick).map((event) => event.id));
  drafts.forEach((draft, index) => {
    const event = materializeEvent(draft, tick, index, years);
    if (known.has(event.id)) return;
    known.add(event.id);
    existing.push(event);
    emitted.push(event);
  });
  return emitted;
};

export const appendExternalEventsInPlace = (
  existing: WorldEvent[],
  incoming: WorldEvent[],
): WorldEvent[] => {
  if (incoming.length === 0) return [];
  const emitted: WorldEvent[] = [];
  const known = new Set(existing.map((event) => event.id));
  for (const event of incoming) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    const normalized = { ...event, sourceIds: [...event.sourceIds].sort() };
    existing.push(normalized);
    emitted.push(normalized);
  }
  const lastExisting = existing[existing.length - emitted.length - 1];
  if (lastExisting && emitted.some((event) => compareEvents(lastExisting, event) > 0)) existing.sort(compareEvents);
  return emitted;
};

export const appendEvents = (
  existing: WorldEvent[],
  drafts: WorldEventDraft[],
  tick: number,
  years?: number,
): WorldEvent[] => {
  if (drafts.length === 0) return existing;
  const events = [...existing];
  appendEventsInPlace(events, drafts, tick, years);
  return events.length === existing.length ? existing : events;
};

export const appendExternalEvents = (
  existing: WorldEvent[],
  incoming: WorldEvent[],
): WorldEvent[] => {
  if (incoming.length === 0) return existing;
  const events = [...existing];
  appendExternalEventsInPlace(events, incoming);
  return events.length === existing.length ? existing : events;
};

export const recordAppendedEvents = (archive: EventArchive, events: readonly WorldEvent[]): void => {
  recordLatestEvents(archive, events);
  recordEventMilestones(archive, events);
};

export const lifetimeTradeVolume = (state: Pick<WorldState, "events" | "eventArchive">): number => {
  const archived = Object.values(state.eventArchive.tradeVolumeByResource).reduce((sum, amount) => sum + amount, 0);
  return state.events
    .filter((event) => event.kind === "organization-trade" || event.kind === "interregional-trade")
    .reduce((sum, event) => {
      const amount = Number(event.payload.amount ?? event.evidence.amount ?? 0);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, archived);
};

export const eventsDigest = (events: WorldEvent[]): string =>
  hashString(JSON.stringify(events.map((event) => [event.id, event.tick, event.years, event.kind, event.ruleId]))).toString(16);
