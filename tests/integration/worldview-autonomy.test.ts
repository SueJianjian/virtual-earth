import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";

describe("worldview autonomy integration", () => {
  it("does not create supernatural entities from an ineligible blank world", () => {
    const state = createWorld(110, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"] });
    const result = stepWorld(state, { elapsedYears: 100, externalEvents: [] });
    expect(result.state.worldview.entities).toEqual([]);
    expect(worldDigest(result.state)).toBe(result.digest);
  });
});
