import { hashString } from "../random.ts";
import type { WorldEvent, WorldEventDraft } from "../types.ts";

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
): WorldEvent => ({
  ...draft,
  id: `event:${hashString(`${tick}:${ordinal}:${stableDraft(draft)}`).toString(16)}`,
  tick,
});

export const appendEvents = (
  existing: WorldEvent[],
  drafts: WorldEventDraft[],
  tick: number,
): WorldEvent[] => {
  const events = [...existing];
  const known = new Set(events.map((event) => event.id));
  drafts.forEach((draft, index) => {
    const event = materializeEvent(draft, tick, index);
    if (!known.has(event.id)) {
      known.add(event.id);
      events.push(event);
    }
  });
  return events.sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id));
};

export const appendExternalEvents = (
  existing: WorldEvent[],
  incoming: WorldEvent[],
): WorldEvent[] => {
  const events = [...existing];
  const known = new Set(events.map((event) => event.id));
  for (const event of incoming) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    events.push({ ...event, sourceIds: [...event.sourceIds].sort() });
  }
  return events.sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id));
};

export const eventsDigest = (events: WorldEvent[]): string =>
  hashString(JSON.stringify(events.map((event) => [event.id, event.tick, event.kind, event.ruleId]))).toString(16);
