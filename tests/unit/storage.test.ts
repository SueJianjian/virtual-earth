import { describe, expect, it } from "vitest";
import { AUTO_SAVE_KEY, loadWorld, readIndexedWorldPayload, readPersistentWorldPayload, readWorldPayload, removeIndexedWorldPayload, removePersistentWorldPayload, removeWorldPayload, saveWorld, writeIndexedWorldPayload, writePersistentWorldPayload, writeWorldPayload } from "../../src/persistence/storage.ts";
import { createWorld } from "../../src/sim/world.ts";

const storage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

describe("browser world storage", () => {
  it("round-trips a world and exposes the auto-save key", () => {
    const target = storage();
    const world = createWorld(4242, { width: 8, height: 8 });

    saveWorld(target, AUTO_SAVE_KEY, world);

    expect(loadWorld(target, AUTO_SAVE_KEY)?.seed).toBe(world.seed);
    expect(readWorldPayload(target, AUTO_SAVE_KEY)).toContain('"schemaVersion":1');
  });

  it("treats unavailable or full browser storage as a non-fatal condition", () => {
    const unavailable = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const world = createWorld(4243, { width: 8, height: 8 });

    expect(readWorldPayload(unavailable, AUTO_SAVE_KEY)).toBeNull();
    expect(writeWorldPayload(unavailable, AUTO_SAVE_KEY, "payload")).toBe(false);
    expect(() => removeWorldPayload(unavailable, AUTO_SAVE_KEY)).not.toThrow();
    expect(() => saveWorld(unavailable, AUTO_SAVE_KEY, world)).toThrow("blocked");
  });

  it("keeps the previous checkpoint when a replacement cannot be stored", () => {
    const values = new Map<string, string>([[AUTO_SAVE_KEY, "previous-checkpoint"]]);
    const full = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => { throw new Error("quota exceeded"); },
    };

    expect(writeWorldPayload(full, AUTO_SAVE_KEY, "replacement-checkpoint")).toBe(false);
    expect(readWorldPayload(full, AUTO_SAVE_KEY)).toBe("previous-checkpoint");
  });

  it("removes a stored checkpoint without affecting other keys", () => {
    const target = storage();
    writeWorldPayload(target, AUTO_SAVE_KEY, "checkpoint");
    writeWorldPayload(target, "other", "keep");

    removeWorldPayload(target, AUTO_SAVE_KEY);

    expect(readWorldPayload(target, AUTO_SAVE_KEY)).toBeNull();
    expect(readWorldPayload(target, "other")).toBe("keep");
  });

  it("falls back to local browser storage when IndexedDB is unavailable", async () => {
    const target = storage();

    await expect(readIndexedWorldPayload(AUTO_SAVE_KEY)).resolves.toBeNull();
    await expect(writeIndexedWorldPayload(AUTO_SAVE_KEY, "checkpoint")).resolves.toBe(false);
    await expect(removeIndexedWorldPayload(AUTO_SAVE_KEY)).resolves.toBe(false);
    await expect(writePersistentWorldPayload(target, AUTO_SAVE_KEY, "checkpoint")).resolves.toBe("localStorage");
    await expect(readPersistentWorldPayload(target, AUTO_SAVE_KEY)).resolves.toBe("checkpoint");
    await expect(removePersistentWorldPayload(target, AUTO_SAVE_KEY)).resolves.toBeUndefined();
    expect(readWorldPayload(target, AUTO_SAVE_KEY)).toBeNull();
  });
});
