import { describe, expect, it } from "vitest";
import {
  assertBlankWorld,
  cloneWorld,
  createWorld,
  isFiniteWorld,
  worldDigest,
} from "../../src/sim/world.ts";
import type { RegionId } from "../../src/sim/types.ts";

describe("world state", () => {
  it("creates a blank, finite world without pre-seeded entities", () => {
    const world = createWorld(1, { width: 16, height: 8 });

    expect(() => assertBlankWorld(world)).not.toThrow();
    expect(isFiniteWorld(world)).toBe(true);
    expect(world.worldview.enabledPackIds).toEqual([]);
    expect(world.fields.elevation.values.some((value) => value > 0)).toBe(true);
  });

  it("falls back from invalid grid dimensions", () => {
    const world = createWorld(1, { width: Number.NaN, height: Number.POSITIVE_INFINITY });

    expect(world.fields.elevation.width).toBe(96);
    expect(world.fields.elevation.height).toBe(48);
    expect(isFiniteWorld(world)).toBe(true);
  });

  it("replays the same authoritative world and varies by seed", () => {
    const first = createWorld(100, { width: 16, height: 8 });
    const second = createWorld(100, { width: 16, height: 8 });
    const different = createWorld(101, { width: 16, height: 8 });

    expect(worldDigest(first)).toBe(worldDigest(second));
    expect(worldDigest(first)).not.toBe(worldDigest(different));
  });

  it("excludes the observation projection from the authoritative digest", () => {
    const world = createWorld(5, { width: 16, height: 8 });
    const observed = cloneWorld(world);
    observed.observation = {
      focusRegionId: "region:1:1" as RegionId,
      projection: {
        regionId: "region:1:1" as RegionId,
        sourceRevision: 0,
        readOnly: true,
        generatedFromDigest: "projection",
        agents: [],
        relationships: [],
        organizations: [],
      },
    };

    expect(worldDigest(observed)).toBe(worldDigest(world));
  });
});
