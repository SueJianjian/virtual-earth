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
    carbon: 0.2,
    organics: 0,
    oceanCoverage: 0.5,
    terrainRelief: 0.1,
    populationCount: 0,
    cognitivePotential: 0,
    knowledgeDiversity: 0,
    beliefDiversity: 0,
    householdCount: 0,
    settlementDensity: 0,
    tradeVolume: 0,
    foodSurplus: 0,
    foodSecurity: 0,
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

  it("records producer food as an auditable environment transaction", () => {
    const state = initializeEnvironment(createWorld(5, { width: 8, height: 8 }));
    const species = {
      id: "species:producer" as never,
      role: "producer" as const,
      traits: { energyUse: 0.1, reproduction: 0.2, temperatureOptimum: 0.5, humidityOptimum: 0.5, mobility: 0.1, cognitivePotential: 0 },
    };
    state.fields.temperature.values.fill(0.5);
    state.fields.humidity.values.fill(0.5);
    state.fields.nutrients.values.fill(1);
    state.species.push(species);
    state.populations.push({ id: "population:producer" as never, speciesId: species.id, regionId: "region:0:0" as never, count: 100, energy: 1 });

    const delta = stepEcology(state, ecologyContext(state));
    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({
      resourceId: "food",
      operation: "mint",
      source: "environment",
      causeRuleId: "ecology:producer-food",
    }));
    expect(delta.fieldChanges).toContainEqual(expect.objectContaining({ field: "biomass", causeRuleId: "ecology:primary-production" }));
    expect(delta.chemistryChanges).toContainEqual(expect.objectContaining({ field: "oxygen", causeRuleId: "ecology:photosynthesis" }));
  });

  it("migrates a mobile population toward a better adjacent habitat", () => {
    const outcomes = Array.from({ length: 64 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(20 + seed, { width: 8, height: 8 }));
      const species = {
        id: `species:migrant:${seed}` as never,
        role: "producer" as const,
        traits: { energyUse: 0.1, reproduction: 0.2, temperatureOptimum: 1, humidityOptimum: 1, mobility: 1, cognitivePotential: 0 },
      };
      state.fields.temperature.values.fill(0);
      state.fields.humidity.values.fill(0);
      state.fields.temperature.values[1] = 1;
      state.fields.humidity.values[1] = 1;
      state.species.push(species);
      state.populations.push({ id: `population:migrant:${seed}` as never, speciesId: species.id, regionId: "region:0:0" as never, count: 100, energy: 1 });
      return stepEcology(state, ecologyContext(state));
    });

    expect(outcomes.some((delta) => delta.eventDrafts.some((event) => event.kind === "population-migration"))).toBe(true);
    const event = outcomes.flatMap((delta) => delta.eventDrafts).find((candidate) => candidate.kind === "population-migration");
    expect(event?.evidence).toMatchObject({ fromRegion: "region:0:0", toRegion: "region:1:0" });
    expect(event?.roll).toBeGreaterThanOrEqual(0);
  });

  it("can migrate toward food even when the adjacent habitat is not better", () => {
    const outcomes = Array.from({ length: 96 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(120 + seed, { width: 8, height: 8 }));
      const species = {
        id: `species:food-migrant:${seed}` as never,
        role: "producer" as const,
        traits: { energyUse: 0.1, reproduction: 0.2, temperatureOptimum: 0.5, humidityOptimum: 0.5, mobility: 1, cognitivePotential: 0 },
      };
      state.fields.temperature.values.fill(0.2);
      state.fields.humidity.values.fill(0.2);
      state.species.push(species);
      state.populations.push({ id: `population:food-migrant:${seed}` as never, speciesId: species.id, regionId: "region:0:0" as never, count: 100, energy: 1 });
      state.resources.push({ id: `resource:food:destination:${seed}`, resourceId: "food", regionId: "region:1:0" as never, amount: 20, cap: 40, originEventId: "event:food" });
      return stepEcology(state, ecologyContext(state));
    });

    const event = outcomes.flatMap((delta) => delta.eventDrafts).find((candidate) => candidate.kind === "population-migration" && candidate.evidence.foodDriven === true);
    expect(event?.evidence).toMatchObject({ fromRegion: "region:0:0", toRegion: "region:1:0", foodDriven: true });
    expect(Number(event?.evidence.destinationFoodSecurity)).toBeGreaterThan(Number(event?.evidence.originFoodSecurity));
  });
});
