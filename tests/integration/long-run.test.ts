import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";

describe("long-running worlds", () => {
  it("keeps advancing past the 3479-year observation point", () => {
    let state = createWorld(3479, { width: 16, height: 8 });
    for (let step = 0; step < 3_500; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }
    expect(state.years).toBe(3_500);
    expect(state.tick).toBe(3_500);
    expect(worldDigest(state)).toMatch(/^[0-9a-f]+$/);
    expect([...state.fields.elevation.values, ...state.fields.water.values].every(Number.isFinite)).toBe(true);
  });
});
