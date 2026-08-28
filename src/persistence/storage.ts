import type { WorldState } from "../sim/types.ts";
import { deserializeWorld, serializeWorld } from "./serialize.ts";

export type WorldStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const AUTO_SAVE_KEY = "virtual-earth:auto-save:v1";
export const CHECKPOINT_DATABASE_NAME = "virtual-earth";
export const CHECKPOINT_DATABASE_VERSION = 1;
export const CHECKPOINT_STORE_NAME = "checkpoints";

export const saveWorld = (storage: WorldStorage, key: string, state: WorldState): void => storage.setItem(key, serializeWorld(state));
export const loadWorld = (storage: WorldStorage, key: string): WorldState | null => {
  const payload = storage.getItem(key);
  return payload === null ? null : deserializeWorld(payload);
};

export const browserWorldStorage = (): WorldStorage | undefined => {
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function" ? storage : undefined;
  } catch {
    return undefined;
  }
};

export const readWorldPayload = (storage: WorldStorage | undefined, key: string): string | null => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const writeWorldPayload = (storage: WorldStorage | undefined, key: string, payload: string): boolean => {
  if (!storage) return false;
  try {
    storage.setItem(key, payload);
    return true;
  } catch {
    return false;
  }
};

export const removeWorldPayload = (storage: WorldStorage | undefined, key: string): void => {
  if (!storage) return;
  try {
    const removable = storage as WorldStorage & { removeItem?: (storageKey: string) => void };
    removable.removeItem?.(key);
  } catch {
    // Storage cleanup is best effort and must not interrupt simulation controls.
  }
};

type IndexedDbFactory = { open(name: string, version?: number): IDBOpenDBRequest };

const browserIndexedDb = (): IndexedDbFactory | undefined => {
  try {
    const indexedDb = globalThis.indexedDB;
    return indexedDb && typeof indexedDb.open === "function" ? indexedDb : undefined;
  } catch {
    return undefined;
  }
};

const openCheckpointDatabase = async (): Promise<IDBDatabase | undefined> => {
  const indexedDb = browserIndexedDb();
  if (!indexedDb) return undefined;
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDb.open(CHECKPOINT_DATABASE_NAME, CHECKPOINT_DATABASE_VERSION);
    } catch {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CHECKPOINT_STORE_NAME)) request.result.createObjectStore(CHECKPOINT_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
};

export type PersistentStorageResult = "localStorage" | "indexedDB" | "both" | "none";

export const readIndexedWorldPayload = async (key: string): Promise<string | null> => {
  const database = await openCheckpointDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(CHECKPOINT_STORE_NAME, "readonly");
        const request = transaction.objectStore(CHECKPOINT_STORE_NAME).get(key);
        request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
        request.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } finally {
    database.close();
  }
};

export const writeIndexedWorldPayload = async (key: string, payload: string): Promise<boolean> => {
  const database = await openCheckpointDatabase();
  if (!database) return false;
  try {
    return await new Promise((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(CHECKPOINT_STORE_NAME, "readwrite");
        transaction.objectStore(CHECKPOINT_STORE_NAME).put(payload, key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } finally {
    database.close();
  }
};

export const removeIndexedWorldPayload = async (key: string): Promise<boolean> => {
  const database = await openCheckpointDatabase();
  if (!database) return false;
  try {
    return await new Promise((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(CHECKPOINT_STORE_NAME, "readwrite");
        transaction.objectStore(CHECKPOINT_STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } finally {
    database.close();
  }
};

export const readPersistentWorldPayload = async (storage: WorldStorage | undefined, key: string): Promise<string | null> => {
  const localPayload = readWorldPayload(storage, key);
  return localPayload ?? readIndexedWorldPayload(key);
};

export const writePersistentWorldPayload = async (
  storage: WorldStorage | undefined,
  key: string,
  payload: string,
): Promise<PersistentStorageResult> => {
  const localStored = writeWorldPayload(storage, key, payload);
  const indexedStored = await writeIndexedWorldPayload(key, payload);
  if (localStored && indexedStored) return "both";
  if (localStored) return "localStorage";
  if (indexedStored) return "indexedDB";
  return "none";
};

export const removePersistentWorldPayload = async (storage: WorldStorage | undefined, key: string): Promise<void> => {
  removeWorldPayload(storage, key);
  await removeIndexedWorldPayload(key);
};
