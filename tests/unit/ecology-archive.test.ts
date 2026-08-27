import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import { compactPopulationRecords, MAX_POPULATION_RECORDS } from "../../src/sim/ecology/archive.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { PopulationState, SpeciesState } from "../../src/sim/types.ts";

const species: SpeciesState = {
  id: "species:archive" as never,
  role: "producer",
  traits: { cognitivePotential: 0.5 },
};

describe("ecology archive bounds", () => {
  it("coalesces duplicate regional populations without losing counts or agent references", () => {
    const state = createWorld(601, { width: 8, height: 8, formation: "formed" });
    const first: PopulationState = { id: "population:first" as never, speciesId: species.id, regionId: "region:1:1" as never, count: 10, energy: 0.2 };
    const second: PopulationState = { id: "population:second" as never, speciesId: species.id, regionId: first.regionId, count: 30, energy: 0.8 };
    state.species = [species];
    state.populations = [first, second];
    state.agents = [createAgent(first, species, 0, "archive-test")];

    expect(compactPopulationRecords(state)).toBe(1);

    expect(state.populations).toHaveLength(1);
    expect(state.populations[0]).toMatchObject({ id: first.id, count: 40, energy: 0.65 });
    expect(state.agents[0]?.populationId).toBe(first.id);
  });

  it("bounds detailed population records while conserving each species total", () => {
    const state = createWorld(602, { width: 8, height: 8, formation: "formed" });
    state.species = [species];
    state.populations = Array.from({ length: MAX_POPULATION_RECORDS + 1 }, (_, index): PopulationState => ({
      id: `population:bounded:${index}` as never,
      speciesId: species.id,
      regionId: `region:${index}:0` as never,
      count: index + 1,
      energy: 0.5,
    }));
    state.agents = [createAgent(state.populations[0]!, species, 0, "bounded-test")];
    const total = state.populations.reduce((sum, population) => sum + population.count, 0);

    expect(compactPopulationRecords(state)).toBe(1);

    expect(state.populations).toHaveLength(MAX_POPULATION_RECORDS);
    expect(state.populations.reduce((sum, population) => sum + population.count, 0)).toBe(total);
    expect(state.populations.some((population) => population.id === state.agents[0]?.populationId)).toBe(true);
    expect(new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`)).size).toBe(state.populations.length);
  });
});
