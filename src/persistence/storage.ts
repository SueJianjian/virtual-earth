import type { WorldState } from "../sim/types.ts";
import { deserializeWorld, serializeWorld } from "./serialize.ts";

export type WorldStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const saveWorld = (storage: WorldStorage, key: string, state: WorldState): void => storage.setItem(key, serializeWorld(state));
export const loadWorld = (storage: WorldStorage, key: string): WorldState | null => {
  const payload = storage.getItem(key);
  return payload === null ? null : deserializeWorld(payload);
};
