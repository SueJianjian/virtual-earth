import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { isFiniteWorld, createWorld } from "../../src/sim/world.ts";

describe("large grid stability", () => {
  it("advances the maximum supported grid without argument-stack failure", () => {
    const initial = createWorld(123, { width: 256, height: 256, formation: "formed" });
    const result = stepWorld(initial, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false });

    expect(result.state.tick).toBe(1);
    expect(result.state.fields.elevation.values.length).toBe(256 * 256);
    expect(isFiniteWorld(result.state)).toBe(true);
  }, 15_000);

  it("keeps the maximum supported grid finite across repeated steps", () => {
    let state = createWorld(124, { width: 256, height: 256, formation: "formed" });
    for (let step = 0; step < 8; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
      expect(state.years).toBe(step + 1);
      expect(isFiniteWorld(state)).toBe(true);
    }
  }, 30_000);
});
