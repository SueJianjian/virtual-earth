import { hashString } from "../random.ts";
import { addPersistentTotal } from "../numeric.ts";
import { compareSimulationSteps } from "../time.ts";
import { MAX_ARCHIVED_SPECIES_SUMMARIES, retainArchivedSpeciesSummaries } from "../ecology/archive.ts";
import { MAX_ARCHIVED_ORGANIZATION_SUMMARIES, retainArchivedOrganizationSummaries } from "../society/archive.ts";
import type { EventArchive, EventMilestone, WorldEvent, WorldEventDraft, WorldHistorySample, WorldState } from "../types.ts";

export const EVENT_LOG_RETAIN_COUNT = 4_096;
export const EVENT_LOG_COMPACT_THRESHOLD = 4_608;
export const MAX_ACTIVE_USER_EVENTS = 1_024;
export const EVENT_LOG_MAX_COUNT = EVENT_LOG_RETAIN_COUNT + MAX_ACTIVE_USER_EVENTS;
export const MAX_ARCHIVE_COUNTER_KEYS = 512;
export const ARCHIVE_OTHER_KEY = "__other__";
export const MAX_EVENT_MILESTONES = 512;
export const MAX_MILESTONE_RELATED_IDS = 12;
export const MAX_HISTORY_SAMPLES = 256;

type HotTradeCache = {
  events: readonly WorldEvent[];
  processedLength: number;
  total: number;
  lastProcessedEvent?: WorldEvent;
};

const hotTradeCache = new WeakMap<EventArchive, HotTradeCache>();

const MILESTONE_KINDS = new Set([
  "protoplanetary-dust", "planetesimal-formation", "planetary-accretion", "core-differentiation", "planetary-cooling", "planet-formation-complete", "ocean-formation", "prebiotic-chemistry",
  "abiogenesis", "species-emergence", "species-divergence", "family-formation", "organization-formation", "organization-split", "organization-conflict", "organization-dissolved",
  "population-migration", "population-dispersal", "organization-migration", "territory-expansion", "territory-transfer", "war-displacement", "border-conflict", "organization-war", "diplomatic-alliance",
  "substance-formation", "substance-discovery", "substance-engineering", "substance-depletion", "knowledge-innovation", "culture-emergence", "worldview-entity-dormant", "worldview-entity-revived",
  "pathogen-emergence", "disease-outbreak", "disease-contained", "disease-regional-spread",
  "genetic-mutation",
  "aggregate-culture-innovation", "aggregate-belief-emergence", "aggregate-organization-formation", "aggregate-organization-dissolution",
]);
const MILESTONE_DETAIL_KEYS = [
  "regionId", "fromRegion", "toRegion", "originRegionId", "organizationId", "fromOrganizationId", "toOrganizationId", "leftOrganizationId", "rightOrganizationId",
  "ownerOrganizationId", "winnerOrganizationId", "loserOrganizationId", "familyId", "pathogenId", "hostSpeciesId", "speciesId", "substanceId", "name", "type", "result", "outcome", "resourceId", "amount", "intensity", "prevalence", "severity", "generation", "mutationCount", "parentDivergence", "lineageSignature", "route", "reason", "foodSecurity", "pressure", "currentHabitat", "destinationHabitat", "movedMemberCount", "movedPopulationCount", "carriedResourceAmount", "abandonedTerritoryCount", "practiceOrigin", "remainingReserve", "reserveRatio", "purpose", "extractedTotal",
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
  timelineStep?: string,
  timelineDays?: string,
): WorldEvent => {
  const { years: draftYears, ...eventDraft } = draft;
  const occurredYears = draftYears ?? years;
  return {
    ...eventDraft,
    id: `event:${hashString(`${timelineStep ?? tick}:${ordinal}:${stableDraft(draft)}`).toString(16)}`,
    tick,
    ...(timelineStep === undefined ? {} : { timelineStep }),
    ...(timelineDays === undefined ? {} : { timelineDays }),
    ...(occurredYears === undefined ? {} : { years: occurredYears }),
  };
};

const compareEvents = (left: Pick<WorldEvent, "id" | "tick" | "years" | "timelineStep"> | EventMilestone, right: Pick<WorldEvent, "id" | "tick" | "years" | "timelineStep"> | EventMilestone): number =>
  compareSimulationSteps(left.timelineStep ?? String(left.tick), right.timelineStep ?? String(right.tick))
  || (left.timelineStep === undefined && right.timelineStep === undefined ? (left.years ?? left.tick) - (right.years ?? right.tick) || left.tick - right.tick : 0)
  || left.id.localeCompare(right.id);

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
    ...(first?.timelineStep === undefined ? {} : { firstEventTimelineStep: first.timelineStep }),
    ...(first?.years === undefined ? {} : { firstEventYears: first.years }),
    ...(latest ? { latestEventTick: latest.tick } : {}),
    ...(latest?.timelineStep === undefined ? {} : { latestEventTimelineStep: latest.timelineStep }),
    ...(latest?.years === undefined ? {} : { latestEventYears: latest.years }),
    kindCounts: {},
    regionCounts: {},
    organizationCounts: {},
    organizationFormationCounts: {},
    tradeVolumeByResource: {},
    archivedSpeciesRoleCounts: {},
    archivedSpeciesSummaries: [],
    archivedOrganizationCount: 0,
    archivedOrganizationSummaries: [],
    milestones: retainMilestones(events.filter(isMilestoneEvent).map(eventMilestoneFor)),
    historySamples: [],
  };
};

const increment = (counts: Record<string, number>, key: string, amount = 1, limit = MAX_ARCHIVE_COUNTER_KEYS): void => {
  const unsafeKey = key === "__proto__" || key === "constructor" || key === "prototype";
  const hasOther = Object.prototype.hasOwnProperty.call(counts, ARCHIVE_OTHER_KEY);
  const hasKey = Object.prototype.hasOwnProperty.call(counts, key);
  const keyLimit = limit - (hasOther ? 0 : 1);
  const targetKey = unsafeKey || (!hasKey && Object.keys(counts).length >= keyLimit) ? ARCHIVE_OTHER_KEY : key;
  counts[targetKey] = addPersistentTotal(counts[targetKey] ?? 0, amount);
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
    .reduce((sum, [, amount]) => addPersistentTotal(sum, amount), otherAmount);
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
    ...(event.timelineStep === undefined ? {} : { timelineStep: event.timelineStep }),
    ...(event.timelineDays === undefined ? {} : { timelineDays: event.timelineDays }),
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
  let canonical = true;
  for (let index = 1; index < input.length; index += 1) {
    const previous = input[index - 1]!;
    const current = input[index]!;
    if (previous.id === current.id || compareEvents(previous, current) > 0) {
      canonical = false;
      break;
    }
  }
  const ordered = canonical
    ? [...input]
    : (() => {
      const unique = new Map<string, EventMilestone>();
      for (const milestone of input) unique.set(milestone.id, milestone);
      return [...unique.values()].sort(compareEvents);
    })();
  if (ordered.length <= MAX_EVENT_MILESTONES) return ordered;
  const anchorsByKind = new Map<string, EventMilestone>();
  for (const milestone of ordered) if (!anchorsByKind.has(milestone.kind)) anchorsByKind.set(milestone.kind, milestone);
  const anchors = [...anchorsByKind.values()].slice(0, MAX_EVENT_MILESTONES);
  const anchorIds = new Set(anchors.map((milestone) => milestone.id));
  const retainedIds = new Set(anchorIds);
  for (const milestone of ordered.slice(-MAX_EVENT_MILESTONES)) retainedIds.add(milestone.id);
  for (const milestone of ordered) {
    if (retainedIds.size <= MAX_EVENT_MILESTONES) break;
    if (!anchorIds.has(milestone.id)) retainedIds.delete(milestone.id);
  }
  return ordered.filter((milestone) => retainedIds.has(milestone.id));
};

export const retainHistorySamples = (input: readonly WorldHistorySample[]): WorldHistorySample[] => {
  const unique = new Map<string, WorldHistorySample>();
  for (const sample of input) unique.set(sample.timelineStep, sample);
  const ordered = [...unique.values()].sort((left, right) => compareSimulationSteps(left.timelineStep, right.timelineStep));
  if (ordered.length <= MAX_HISTORY_SAMPLES) return ordered;
  const anchor = ordered[0]!;
  const recent = ordered.slice(-(MAX_HISTORY_SAMPLES - 1));
  return anchor.timelineStep === recent[0]?.timelineStep ? recent : [anchor, ...recent];
};

const isTradeEvent = (event: WorldEvent): boolean => event.kind === "organization-trade" || event.kind === "interregional-trade";

const tradeAmount = (event: WorldEvent): number => {
  const amount = Number(event.payload.amount ?? event.evidence.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

const hotTradeVolume = (archive: EventArchive, events: readonly WorldEvent[]): number => {
  const cached = hotTradeCache.get(archive);
  const canExtend = cached
    && cached.events === events
    && events.length > cached.processedLength
    && events[cached.processedLength - 1] === cached.lastProcessedEvent;
  if (canExtend) {
    let total = cached.total;
    for (let index = cached.processedLength; index < events.length; index += 1) {
      const event = events[index]!;
      if (isTradeEvent(event)) total = addPersistentTotal(total, tradeAmount(event));
    }
    const lastProcessedEvent = events.at(-1);
    hotTradeCache.set(archive, {
      events,
      processedLength: events.length,
      total,
      ...(lastProcessedEvent ? { lastProcessedEvent } : {}),
    });
    return total;
  }
  let total = 0;
  for (const event of events) if (isTradeEvent(event)) total = addPersistentTotal(total, tradeAmount(event));
  const lastProcessedEvent = events.at(-1);
  hotTradeCache.set(archive, {
    events,
    processedLength: events.length,
    total,
    ...(lastProcessedEvent ? { lastProcessedEvent } : {}),
  });
  return total;
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
    if (first.timelineStep === undefined) delete archive.firstEventTimelineStep;
    else archive.firstEventTimelineStep = first.timelineStep;
    if (first.years !== undefined) archive.firstEventYears = first.years;
  }
  archive.totalEventCount = addPersistentTotal(archive.totalEventCount, events.length);
  const currentLatestStep = archive.latestEventTimelineStep ?? String(archive.latestEventTick ?? -1);
  if (compareSimulationSteps(latest.timelineStep ?? String(latest.tick), currentLatestStep) >= 0) {
    archive.latestEventTick = latest.tick;
    if (latest.timelineStep === undefined) delete archive.latestEventTimelineStep;
    else archive.latestEventTimelineStep = latest.timelineStep;
    if (latest.years === undefined) delete archive.latestEventYears;
    else archive.latestEventYears = latest.years;
  }
};

export const synchronizeEventArchive = (archive: EventArchive, events: readonly WorldEvent[]): void => {
  const minimumTotal = addPersistentTotal(archive.archivedEventCount, events.length);
  if (archive.totalEventCount < minimumTotal) archive.totalEventCount = minimumTotal;
  const first = events[0];
  const latest = events.at(-1);
  if (archive.firstEventTick === undefined && first) {
    archive.firstEventTick = first.tick;
    if (first.timelineStep !== undefined) archive.firstEventTimelineStep = first.timelineStep;
    if (first.years !== undefined) archive.firstEventYears = first.years;
  }
  if (archive.latestEventTick === undefined && latest) {
    archive.latestEventTick = latest.tick;
    if (latest.timelineStep !== undefined) archive.latestEventTimelineStep = latest.timelineStep;
    if (latest.years !== undefined) archive.latestEventYears = latest.years;
  }
};

const archiveEvents = (state: WorldState, events: readonly WorldEvent[]): void => {
  if (events.length === 0) return;
  const { eventArchive: archive } = state;
  archive.archivedEventCount = addPersistentTotal(archive.archivedEventCount, events.length);
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
  if (compareSimulationSteps(latest.timelineStep ?? String(latest.tick), archive.archivedThroughTimelineStep ?? String(archive.archivedThroughTick ?? 0)) >= 0) {
    archive.archivedThroughTick = latest.tick;
    if (latest.timelineStep === undefined) delete archive.archivedThroughTimelineStep;
    else archive.archivedThroughTimelineStep = latest.timelineStep;
  }
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

export const isWorldEventActive = (event: WorldEvent, timelineStep: string): boolean => {
  if (event.source !== "user") return false;
  const duration = Math.max(1, Math.trunc(Number(event.payload.duration ?? 1)));
  const currentNumber = Number(timelineStep);
  const eventNumber = Number(event.timelineStep ?? event.tick);
  if (Number.isSafeInteger(currentNumber) && Number.isSafeInteger(eventNumber)) return currentNumber >= eventNumber && currentNumber - eventNumber < duration;
  try {
    return BigInt(timelineStep) >= BigInt(event.timelineStep ?? event.tick) && BigInt(timelineStep) - BigInt(event.timelineStep ?? event.tick) < BigInt(duration);
  } catch {
    return false;
  }
};

export const compactEventLedger = (state: WorldState): WorldEvent[] => {
  if (state.events.length <= EVENT_LOG_COMPACT_THRESHOLD) return [];
  const splitAt = Math.max(0, state.events.length - EVENT_LOG_RETAIN_COUNT);
  const candidates = state.events.slice(0, splitAt);
  const activeCandidates = candidates.filter((event) => isWorldEventActive(event, state.timeline?.step ?? String(state.tick)));
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
  state.eventArchive.historySamples = retainHistorySamples(state.eventArchive.historySamples ?? []);
  if (state.eventArchive.archivedSpeciesSummaries.length > MAX_ARCHIVED_SPECIES_SUMMARIES) {
    state.eventArchive.archivedSpeciesSummaries = retainArchivedSpeciesSummaries(state.eventArchive.archivedSpeciesSummaries);
  }
  if (state.eventArchive.archivedOrganizationSummaries.length > MAX_ARCHIVED_ORGANIZATION_SUMMARIES) {
    state.eventArchive.archivedOrganizationSummaries = retainArchivedOrganizationSummaries(state.eventArchive.archivedOrganizationSummaries);
  }
};

export const appendEventsInPlace = (
  existing: WorldEvent[],
  drafts: WorldEventDraft[],
  tick: number,
  years?: number,
  timelineStep?: string,
  timelineDays?: string,
): WorldEvent[] => {
  if (drafts.length === 0) return [];
  const emitted: WorldEvent[] = [];
  const known = new Set(existing.filter((event) => event.tick === tick).map((event) => event.id));
  drafts.forEach((draft, index) => {
    const event = materializeEvent(draft, tick, index, years, timelineStep, timelineDays);
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
  timelineStep?: string,
  timelineDays?: string,
): WorldEvent[] => {
  if (incoming.length === 0) return [];
  const emitted: WorldEvent[] = [];
  const known = new Set(existing.map((event) => event.id));
  for (const event of incoming) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    const normalized = {
      ...event,
      sourceIds: [...event.sourceIds].sort(),
      ...(timelineStep === undefined || event.timelineStep !== undefined ? {} : { timelineStep }),
      ...(timelineDays === undefined || event.timelineDays !== undefined ? {} : { timelineDays }),
    };
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
  timelineStep?: string,
  timelineDays?: string,
): WorldEvent[] => {
  if (drafts.length === 0) return existing;
  const events = [...existing];
  appendEventsInPlace(events, drafts, tick, years, timelineStep, timelineDays);
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
  const archived = Object.values(state.eventArchive.tradeVolumeByResource)
    .reduce((sum, amount) => addPersistentTotal(sum, amount), 0);
  return addPersistentTotal(archived, hotTradeVolume(state.eventArchive, state.events));
};

export const eventsDigest = (events: WorldEvent[]): string =>
  hashString(JSON.stringify(events.map((event) => [event.id, event.timelineStep, event.timelineDays, event.tick, event.years, event.kind, event.ruleId]))).toString(16);
