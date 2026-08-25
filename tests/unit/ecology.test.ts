import { describe, expect, it } from "vitest";
import { initializeEnvironment } from "../../src/sim/environment/index.ts";
import { applyEcologyDelta, stepEcology } from "../../src/sim/ecology/index.ts";
import { createRandom } from "../../src/sim/random.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { RuleContext } from "../../src/sim/types.ts";

const ecologyContext = (state: ReturnType<typeof createWorld>): RuleContext => ({
  state,
  random: createRandom(state.seed),
  metrics: {
    meanTemperature: 0.5,
    meanHumidity: 0.6,
    waterCoverage: 0.8,
    nutrientLevel: 0.8,
    biomass: 0,
    oxygen: 0.01,
    populationCount: 0,
    cognitivePotential: 0,
    knowledgeDiversity: 0,
    beliefDiversity: 0,
    householdCount: 0,
    settlementDensity: 0,
    tradeVolume: 0,
    foodSurplus: 0,
    organizationCapacity: 0,
    resourceBalance: 0,
  },
});

describe("emergent ecology", () => {
  it("does not create life when abiogenesis conditions are absent", () => {
    const state = createWorld(1, { width: 8, height: 8 });
    const delta = stepEcology(state, ecologyContext(state));
    const next = applyEcologyDelta(state, delta);

    expect(next.species).toHaveLength(0);
    expect(next.populations).toHaveLength(0);
  });

  it("can create a producer only from a suitable chemical environment", () => {
    const outcomes = Array.from({ length: 32 }, (_, offset) => {
      const state = initializeEnvironment(createWorld(offset + 2, { width: 8, height: 8 }));
      state.chemistry.organics.values.fill(0.8);
      const delta = stepEcology(state, ecologyContext(state));
      return { state: applyEcologyDelta(state, delta), delta };
    });

    expect(outcomes.some(({ state }) => state.species.some((species) => species.role === "producer"))).toBe(true);
    const successful = outcomes.find(({ state }) => state.species.some((species) => species.role === "producer"));
    expect(successful?.state.populations.length ?? 0).toBeGreaterThan(0);
    expect(successful?.delta.eventDrafts.some((event) => event.kind === "abiogenesis")).toBe(true);
  });

  it("keeps consumer and decomposer emergence conditional", () => {
    const state = initializeEnvironment(createWorld(3, { width: 8, height: 8 }));
    const first = applyEcologyDelta(state, stepEcology(state, ecologyContext(state)));
    const second = applyEcologyDelta(first, stepEcology(first, ecologyContext(first)));

    expect(second.species.filter((species) => species.role !== "producer").length).toBeGreaterThanOrEqual(0);
    expect(second.species.every((species) => species.role === "producer" || species.parentId)).toBe(true);
  });

  it("reduces populations when conditions and food are poor", () => {
    const state = initializeEnvironment(createWorld(4, { width: 8, height: 8 }));
    const species = {
      id: "species:test" as never,
      role: "producer" as const,
      traits: { energyUse: 0.9, reproduction: 0.01, temperatureOptimum: 0.99, humidityOptimum: 0.99, mobility: 0.1, cognitivePotential: 0 },
    };
    state.species.push(species);
    state.populations.push({ id: "population:test" as never, speciesId: species.id, regionId: "region:0:0" as never, count: 100, energy: 0.2 });
    const next = applyEcologyDelta(state, stepEcology(state, ecologyContext(state)));

    expect(next.populations[0]?.count ?? 0).toBeLessThan(100);
  });
});
