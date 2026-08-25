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
});
