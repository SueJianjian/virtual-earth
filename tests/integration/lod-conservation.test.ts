import { describe, expect, it } from "vitest";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { focusRegion } from "../../src/sim/lod/index.ts";

describe("LOD conservation integration", () => {
  it("observation projection is not authoritative state", () => {
    const state = createWorld(91, { width: 8, height: 8 });
    const digest = worldDigest(state);
    focusRegion(state, "region:1:1" as never);
    expect(worldDigest(state)).toBe(digest);
  });
});
