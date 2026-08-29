import { beforeAll, describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import type { WorldState } from "../../src/sim/types.ts";

const run = (seed: number) => {
  let state = createWorld(seed, { width: 16, height: 8 });
  for (let index = 0; index < 900; index += 1) {
    state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
  }
  return state;
};

describe("seed variation", () => {
  let states: WorldState[];

  beforeAll(() => {
    states = [1, 42, 123, 999].map(run);
  }, 60_000);

  it("allows different seeds to produce different histories", () => {
    const digests = new Set(states.map(worldDigest));
    const eventCounts = new Set(states.map((state) => state.events.length));
    expect(digests.size).toBeGreaterThan(1);
    expect(eventCounts.size).toBeGreaterThan(1);
  });

  it("does not require every seed to reach the same social level", () => {
    expect(states.some((state) => state.species.length === 0)).toBe(true);
    expect(states.some((state) => state.species.length > 0)).toBe(true);
    expect(states.every((state) => state.organizations.length >= 0)).toBe(true);
  });
});
