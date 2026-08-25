import { describe, expect, it, beforeEach } from "vitest";
import { clearSimulationStages, stepWorld } from "../../src/sim/engine.ts";
import { createWorld } from "../../src/sim/world.ts";

describe("social evolution integration", () => {
  beforeEach(() => clearSimulationStages());

  it("keeps an ineligible world free of social organizations", () => {
    const world = createWorld(80, { width: 8, height: 8 });
    const result = stepWorld(world, { elapsedYears: 10_000, externalEvents: [] });
    expect(result.state.organizations).toEqual([]);
    expect(result.state.agents).toEqual([]);
  });

  it("forms relationships and families when an eligible population persists", () => {
    let state = createWorld(123, { width: 16, height: 8 });
    for (let index = 0; index < 950; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }).state;
    }

    expect(state.agents.length).toBeGreaterThanOrEqual(2);
    expect(state.relationships.some((relationship) => relationship.kind === "partner")).toBe(true);
    expect(state.organizations.some((organization) => organization.type === "family")).toBe(true);
    expect(state.events.some((event) => event.kind === "family-formation")).toBe(true);
  });
});
