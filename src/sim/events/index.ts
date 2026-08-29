import type { WorldEvent } from "../types.ts";

type EventLookupIndex = {
  processedLength: number;
  firstEvent?: WorldEvent;
  lastEvent?: WorldEvent;
  byKind: Map<string, WorldEvent[]>;
  bySource: Map<WorldEvent["source"], WorldEvent[]>;
  byTimelineStep: Map<string, WorldEvent[]>;
  byOrganization: Map<string, WorldEvent[]>;
  byRegion: Map<string, WorldEvent[]>;
  positionById: Map<string, number>;
  regionOrganizationQueries: Map<string, { events: WorldEvent[]; processedLength: number }>;
};

const eventLookupCache = new WeakMap<readonly WorldEvent[], EventLookupIndex>();

// Callers that compact or reorder an event array in place must invalidate its
// positional index before the next lookup.
export const invalidateEventLookupCache = (events: readonly WorldEvent[]): void => {
  eventLookupCache.delete(events);
};

const appendLookup = <K>(lookup: Map<K, WorldEvent[]>, key: K, event: WorldEvent): void => {
  const events = lookup.get(key) ?? [];
  events.push(event);
  lookup.set(key, events);
};

const directEventRegionIds = (event: WorldEvent): string[] => [
  event.payload.regionId,
  event.payload.fromRegion,
  event.payload.toRegion,
  event.evidence.regionId,
  event.evidence.fromRegion,
  event.evidence.toRegion,
].filter((value): value is string => typeof value === "string");

const lookupOrganizationIds = (event: WorldEvent): string[] => [...new Set([
  ...event.sourceIds.filter((value) => value.startsWith("organization:")),
  ...Object.values(event.payload).filter((value): value is string => typeof value === "string" && value.startsWith("organization:")),
])];

const addEventToLookup = (index: EventLookupIndex, event: WorldEvent, position: number): void => {
  appendLookup(index.byKind, event.kind, event);
  appendLookup(index.bySource, event.source, event);
  appendLookup(index.byTimelineStep, event.timelineStep ?? String(event.tick), event);
  for (const organizationId of lookupOrganizationIds(event)) appendLookup(index.byOrganization, organizationId, event);
  for (const regionId of [...new Set(directEventRegionIds(event))]) appendLookup(index.byRegion, regionId, event);
  index.positionById.set(event.id, position);
};

const buildEventLookupIndex = (events: readonly WorldEvent[]): EventLookupIndex => {
  const index: EventLookupIndex = {
    processedLength: 0,
    byKind: new Map(),
    bySource: new Map(),
    byTimelineStep: new Map(),
    byOrganization: new Map(),
    byRegion: new Map(),
    positionById: new Map(),
    regionOrganizationQueries: new Map(),
  };
  for (const event of events) addEventToLookup(index, event, index.processedLength++);
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  if (firstEvent) index.firstEvent = firstEvent;
  if (lastEvent) index.lastEvent = lastEvent;
  return index;
};

const eventLookupFor = (events: readonly WorldEvent[]): EventLookupIndex => {
  const cached = eventLookupCache.get(events);
  if (cached
    && cached.firstEvent === events[0]
    && cached.processedLength <= events.length
    && cached.lastEvent === events[cached.processedLength - 1]) {
    for (let position = cached.processedLength; position < events.length; position += 1) {
      addEventToLookup(cached, events[position]!, position);
    }
    cached.processedLength = events.length;
    const lastEvent = events.at(-1);
    if (lastEvent) cached.lastEvent = lastEvent;
    else delete cached.lastEvent;
    return cached;
  }
  const rebuilt = buildEventLookupIndex(events);
  eventLookupCache.set(events, rebuilt);
  return rebuilt;
};

const firstPositionAtOrAfter = (
  index: EventLookupIndex,
  events: readonly WorldEvent[],
  minimumPosition: number,
): number => {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const position = index.positionById.get(events[middle]!.id) ?? Number.MAX_SAFE_INTEGER;
    if (position < minimumPosition) low = middle + 1;
    else high = middle;
  }
  return low;
};

const orderedLookupEvents = (
  index: EventLookupIndex,
  lists: readonly (readonly WorldEvent[])[],
  minimumPosition = 0,
): WorldEvent[] => {
  const activeLists = lists
    .map((events) => events.slice(firstPositionAtOrAfter(index, events, minimumPosition)))
    .filter((events) => events.length > 0);
  if (activeLists.length === 0) return [];

  // Each inverted-list entry is already in source-array order. Two lists are
  // the hot path for a facility query (region + owner), so merge them without
  // allocating a cursor for every list or rescanning all lists per event.
  if (activeLists.length === 1) return [...activeLists[0]!];
  if (activeLists.length === 2) {
    const left = activeLists[0]!;
    const right = activeLists[1]!;
    const ordered: WorldEvent[] = [];
    const seen = new Set<string>();
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length || rightIndex < right.length) {
      const leftEvent = left[leftIndex];
      const rightEvent = right[rightIndex];
      const leftPosition = leftEvent ? index.positionById.get(leftEvent.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const rightPosition = rightEvent ? index.positionById.get(rightEvent.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const event = leftPosition <= rightPosition ? leftEvent : rightEvent;
      if (leftPosition <= rightPosition) leftIndex += 1;
      else rightIndex += 1;
      if (event && !seen.has(event.id)) {
        seen.add(event.id);
        ordered.push(event);
      }
    }
    return ordered;
  }

  // Multi-organization queries are uncommon. Deduplicate once, then sort by
  // the canonical source position to preserve deterministic event order.
  const unique = new Map<string, WorldEvent>();
  for (const events of activeLists) for (const event of events) unique.set(event.id, event);
  return [...unique.values()].sort((left, right) =>
    (index.positionById.get(left.id) ?? Number.MAX_SAFE_INTEGER)
    - (index.positionById.get(right.id) ?? Number.MAX_SAFE_INTEGER));
};

export const eventsForKind = (events: readonly WorldEvent[], kind: WorldEvent["kind"]): readonly WorldEvent[] =>
  eventLookupFor(events).byKind.get(kind) ?? [];

export const eventsForSource = (events: readonly WorldEvent[], source: WorldEvent["source"]): readonly WorldEvent[] =>
  eventLookupFor(events).bySource.get(source) ?? [];

export const eventsForTimelineStep = (events: readonly WorldEvent[], timelineStep: string): readonly WorldEvent[] =>
  eventLookupFor(events).byTimelineStep.get(timelineStep) ?? [];

export const eventsForOrganization = (events: readonly WorldEvent[], organizationId: string): readonly WorldEvent[] =>
  eventLookupFor(events).byOrganization.get(organizationId) ?? [];

export const eventsForRegionAndOrganizations = (
  events: readonly WorldEvent[],
  regionId: string,
  organizationIds: readonly string[] = [],
): readonly WorldEvent[] => {
  const index = eventLookupFor(events);
  const organizationKey = [...new Set(organizationIds)].sort().join("\0");
  const queryKey = `${regionId}\0${organizationKey}`;
  const cached = index.regionOrganizationQueries.get(queryKey);
  if (cached && cached.processedLength === events.length) return cached.events;
  if (cached) {
    const lists = [
      index.byRegion.get(regionId) ?? [],
      ...organizationIds.map((organizationId) => index.byOrganization.get(organizationId) ?? []),
    ];
    cached.events.push(...orderedLookupEvents(index, lists, cached.processedLength));
    cached.processedLength = events.length;
    return cached.events;
  }
  const lists = [
    index.byRegion.get(regionId) ?? [],
    ...organizationIds.map((organizationId) => index.byOrganization.get(organizationId) ?? []),
  ];
  const ordered = orderedLookupEvents(index, lists);
  const entry = { events: ordered, processedLength: events.length };
  index.regionOrganizationQueries.set(queryKey, entry);
  return entry.events;
};
