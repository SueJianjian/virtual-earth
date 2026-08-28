import { MAX_PERSISTENT_TOTAL } from "./numeric.ts";
import type { ResourceLedgerEntry, WorldState } from "./types.ts";

export const MAX_RESOURCE_RECORDS = 16_384;
const RESOURCE_EPSILON = 0.000000001;

const entryKey = (entry: Pick<ResourceLedgerEntry, "resourceId" | "regionId" | "holderId">): string =>
  `${entry.resourceId}|${entry.regionId}|${entry.holderId ?? "world"}`;

const boundedNonNegative = (value: number, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_PERSISTENT_TOTAL, value));
};

const addCapped = (current: number, amount: number, cap: number): number =>
  amount >= cap - current ? cap : current + amount;

const validResourceEntry = (entry: ResourceLedgerEntry): boolean =>
  typeof entry.id === "string"
  && typeof entry.resourceId === "string"
  && entry.resourceId.length > 0
  && typeof entry.regionId === "string"
  && typeof entry.originEventId === "string"
  && (entry.holderId === undefined || typeof entry.holderId === "string");

const holderExists = (state: WorldState, holderId: string): boolean => {
  return state.agents.some((agent) => agent.id === holderId)
    || state.organizations.some((organization) => organization.id === holderId)
    || state.lod.summaries.some((summary) => summary.organizations.some((organization) => organization.id === holderId));
};

export const isEntityHolderId = (holderId: string): boolean =>
  holderId.startsWith("agent:")
  || holderId.startsWith("organization:")
  || holderId.startsWith("aggregate:organization:");

const resourcePriority = (entry: ResourceLedgerEntry): number =>
  (entry.holderId === undefined ? 2 : 1) * 1_000_000_000
  + Math.min(MAX_PERSISTENT_TOTAL, entry.amount);

const normalizedEntry = (entry: ResourceLedgerEntry): ResourceLedgerEntry | undefined => {
  if (!validResourceEntry(entry)) return undefined;
  const amount = boundedNonNegative(entry.amount);
  if (amount <= RESOURCE_EPSILON) return undefined;
  const cap = Math.max(amount, boundedNonNegative(entry.cap, MAX_PERSISTENT_TOTAL));
  return {
    ...entry,
    amount: Math.min(cap, amount),
    cap,
  };
};

/**
 * Keeps resource state canonical at the commit boundary. A single key can
 * survive transfers and loading older saves, so duplicate entries are merged
 * before the global record limit is applied.
 */
export const compactResourceRecords = (state: WorldState, options: { removeOrphanedHolders?: boolean } = {}): number => {
  const previousCount = state.resources.length;
  const removeOrphanedHolders = options.removeOrphanedHolders ?? true;
  const byKey = new Map<string, ResourceLedgerEntry>();
  for (const raw of state.resources) {
    const entry = normalizedEntry(raw);
    if (!entry || (removeOrphanedHolders
      && entry.holderId !== undefined
      && isEntityHolderId(entry.holderId)
      && !holderExists(state, entry.holderId))) continue;
    const key = entryKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      continue;
    }
    const cap = Math.max(existing.cap, entry.cap);
    existing.cap = cap;
    existing.amount = addCapped(existing.amount, entry.amount, cap);
    if (entry.originEventId.localeCompare(existing.originEventId) > 0) existing.originEventId = entry.originEventId;
  }

  const candidates = [...byKey.values()]
    .sort((left, right) => resourcePriority(right) - resourcePriority(left) || entryKey(left).localeCompare(entryKey(right)))
    .slice(0, MAX_RESOURCE_RECORDS)
    .sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
  state.resources = candidates;
  return previousCount - candidates.length;
};
