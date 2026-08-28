import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";

const run = (seed: number, steps = 900) => {
  let state = createWorld(seed, { width: 16, height: 8 });
  for (let index = 0; index < steps; index += 1) {
    state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }).state;
  }
  return state;
};

describe("autonomous world long run", () => {
  it("produces the next world without mutating the authoritative input", () => {
    const initial = createWorld(41, { width: 16, height: 8 });
    const digest = worldDigest(initial);

    const result = stepWorld(initial, { elapsedYears: 1, externalEvents: [] });

    expect(worldDigest(initial)).toBe(digest);
    expect(initial.tick).toBe(0);
    expect(result.state).not.toBe(initial);
    expect(result.state.tick).toBe(1);
  });

  it("starts from blank entities and evolves environmental fields", () => {
    const initial = createWorld(42, { width: 16, height: 8 });
    const state = run(42);

    expect(initial.species).toHaveLength(0);
    expect(initial.populations).toHaveLength(0);
    expect(initial.agents).toHaveLength(0);
    expect(initial.organizations).toHaveLength(0);
    expect(state.tick).toBe(900);
    expect(state.fields.water.values.some((value) => value > 0)).toBe(true);
    expect(state.fields.nutrients.values.some((value) => value > 0)).toBe(true);
    expect(state.chemistry.organics.values.some((value) => value > 0)).toBe(true);
    expect(state.events.length).toBeGreaterThan(0);
  }, 45_000);

  it("replays the same long run exactly", () => {
    const first = run(42);
    const second = run(42);
    expect(worldDigest(first)).toBe(worldDigest(second));
    expect(first.events.map((event) => event.id)).toEqual(second.events.map((event) => event.id));
  }, 90_000);
});
