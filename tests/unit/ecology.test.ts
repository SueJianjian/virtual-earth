import { describe, expect, it } from "vitest";
import { initializeEnvironment } from "../../src/sim/environment/index.ts";
import { applyEcologyDelta, stepEcology } from "../../src/sim/ecology/index.ts";
import { createRandom } from "../../src/sim/random.ts";
import { nextPopulationCount } from "../../src/sim/ecology/populations.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { RuleContext } from "../../src/sim/types.ts";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";

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

  it("can attempt a new origin after every producer population has gone extinct", () => {
    const outcomes = Array.from({ length: 32 }, (_, offset) => {
      const state = initializeEnvironment(createWorld(offset + 2, { width: 8, height: 8, formation: "formed" }));
      state.chemistry.organics.values.fill(0.8);
      state.species.push({ id: "species:extinct" as never, role: "producer", traits: { energyUse: 0.2, reproduction: 0.5 } });
      const delta = stepEcology(state, ecologyContext(state));
      return applyEcologyDelta(state, delta);
    });

    expect(outcomes.some((state) => state.species.length > 1 && state.populations.length > 0)).toBe(true);
  });

  it("branches trophic species from the largest living producer in a real region", () => {
    const outcomes = Array.from({ length: 64 }, (_, offset) => {
      const state = initializeEnvironment(createWorld(offset + 700, { width: 8, height: 8, formation: "formed" }));
      const extinct = { id: "species:first-extinct" as never, role: "producer" as const, traits: { reproduction: 0.5 } };
      const living = { id: "species:living-parent" as never, role: "producer" as const, traits: { reproduction: 0.5 } };
      state.species = [extinct, living];
      state.populations = [{ id: "population:living-parent" as never, speciesId: living.id, regionId: "region:3:2" as never, count: 100, energy: 1 }];
      return stepEcology(state, ecologyContext(state));
    });
    const created = outcomes
      .flatMap((delta) => delta.entityEffects)
      .find((effect) => effect.collection === "species" && effect.operation === "create" && effect.value?.role === "consumer");
    const population = created
      ? outcomes.flatMap((delta) => delta.entityEffects).find((effect) => effect.collection === "populations" && effect.operation === "create" && effect.value?.speciesId === created.id)
      : undefined;
    const createdSpecies = created?.collection === "species" ? created.value : undefined;
    const createdPopulation = population?.collection === "populations" ? population.value : undefined;

    expect(createdSpecies?.parentId).toBe("species:living-parent");
    expect(createdPopulation?.regionId).toBe("region:3:2");
  });

  it("keeps consumer and decomposer emergence conditional", () => {
    const state = initializeEnvironment(createWorld(3, { width: 8, height: 8 }));
    const first = applyEcologyDelta(state, stepEcology(state, ecologyContext(state)));
    const second = applyEcologyDelta(first, stepEcology(first, ecologyContext(first)));

    expect(second.species.filter((species) => species.role !== "producer").length).toBeGreaterThanOrEqual(0);
    expect(second.species.every((species) => species.role === "producer" || species.parentId)).toBe(true);
  });

  it("replays the indexed ecological step deterministically", () => {
    const source = initializeEnvironment(createWorld(307, { width: 8, height: 8, formation: "formed" }));
    const producer = { id: "species:indexed-producer" as never, role: "producer" as const, traits: { energyUse: 0.2, reproduction: 0.3, temperatureOptimum: 0.5, humidityOptimum: 0.5, mobility: 0.8, cognitivePotential: 0 } };
    const consumer = { id: "species:indexed-consumer" as never, role: "consumer" as const, traits: { energyUse: 0.2, reproduction: 0.3, temperatureOptimum: 0.5, humidityOptimum: 0.5, mobility: 0.6, cognitivePotential: 0 } };
    source.species = [producer, consumer];
    source.populations = [
      { id: "population:indexed-producer" as never, speciesId: producer.id, regionId: "region:2:2" as never, count: 1_000, energy: 1 },
      { id: "population:indexed-consumer" as never, speciesId: consumer.id, regionId: "region:2:2" as never, count: 200, energy: 1 },
    ];
    source.resources = [{ id: "resource:indexed-food", resourceId: "food", regionId: "region:3:2" as never, amount: 12, cap: 20, originEventId: "test" }];

    const left = structuredClone(source);
    const right = structuredClone(source);
    expect(stepEcology(left, ecologyContext(left))).toEqual(stepEcology(right, ecologyContext(right)));
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

  it("increases food output only while a subsistence facility is operational", () => {
    const base = initializeEnvironment(createWorld(506, { width: 8, height: 8, formation: "formed" }));
    const regionId = "region:0:0" as never;
    const species = {
      id: "species:facility-producer" as never,
      role: "producer" as const,
      traits: { energyUse: 0.1, reproduction: 0.2, temperatureOptimum: 0.5, humidityOptimum: 0.5, mobility: 0.1, cognitivePotential: 0 },
    };
    base.fields.temperature.values.fill(0.5);
    base.fields.humidity.values.fill(0.5);
    base.fields.nutrients.values.fill(1);
    base.species = [species];
    base.populations = [{ id: "population:facility-producer" as never, speciesId: species.id, regionId, count: 100, energy: 1 }];
    const amountFor = (state: typeof base): number => stepEcology(state, ecologyContext(state)).resourceTransactions
      .find((transaction) => transaction.causeRuleId === "ecology:producer-food")?.amount ?? 0;
    const withoutFacility = amountFor(base);
    const active = structuredClone(base);
    active.facilities = [{ id: "facility:farm", type: "subsistence", regionId, ownerOrganizationId: "organization:city:test" as never, level: 3, condition: 1, status: "active", workforceIds: ["agent:farmer:1" as never, "agent:farmer:2" as never], workforceRequired: 2, workforceEfficiency: 1, materialInvested: 10, plannedTick: 1, builtTick: 2, lastMaintainedTick: 2, lastIncidentTick: 2 }];
    const abandoned = structuredClone(active);
    abandoned.facilities[0]!.status = "abandoned";

    expect(amountFor(active)).toBeCloseTo(withoutFacility * 1.65, 8);
    expect(amountFor(abandoned)).toBeCloseTo(withoutFacility, 8);
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

  it("chooses the best habitat from every adjacent direction", () => {
    const event = Array.from({ length: 64 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(220 + seed, { width: 8, height: 8 }));
      const species = {
        id: `species:directional-migrant:${seed}` as never,
        role: "producer" as const,
        traits: { energyUse: 0.1, reproduction: 0.2, temperatureOptimum: 1, humidityOptimum: 1, mobility: 1, cognitivePotential: 0 },
      };
      state.fields.temperature.values.fill(0);
      state.fields.humidity.values.fill(0);
      const northIndex = 2 * 8 + 3;
      state.fields.temperature.values[northIndex] = 1;
      state.fields.humidity.values[northIndex] = 1;
      state.species = [species];
      state.populations = [{ id: `population:directional-migrant:${seed}` as never, speciesId: species.id, regionId: "region:3:3" as never, count: 100, energy: 1 }];
      return stepEcology(state, ecologyContext(state)).eventDrafts.find((candidate) => candidate.kind === "population-migration");
    }).find(Boolean);

    expect(event?.payload.toRegion).toBe("region:3:2");
  });

  it("migrates across the horizontally wrapped planetary boundary", () => {
    const event = Array.from({ length: 64 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(320 + seed, { width: 8, height: 8 }));
      const species = {
        id: `species:wrapped-migrant:${seed}` as never,
        role: "producer" as const,
        traits: { energyUse: 0.1, reproduction: 0.2, temperatureOptimum: 1, humidityOptimum: 1, mobility: 1, cognitivePotential: 0 },
      };
      state.fields.temperature.values.fill(0);
      state.fields.humidity.values.fill(0);
      const wrappedWestIndex = 3 * 8 + 7;
      state.fields.temperature.values[wrappedWestIndex] = 1;
      state.fields.humidity.values[wrappedWestIndex] = 1;
      state.species = [species];
      state.populations = [{ id: `population:wrapped-migrant:${seed}` as never, speciesId: species.id, regionId: "region:0:3" as never, count: 100, energy: 1 }];
      return stepEcology(state, ecologyContext(state)).eventDrafts.find((candidate) => candidate.kind === "population-migration");
    }).find(Boolean);

    expect(event?.payload).toMatchObject({ fromRegion: "region:0:3", toRegion: "region:7:3" });
  });

  it("diverges a large population into an adapted child species with conserved counts", () => {
    const outcome = Array.from({ length: 256 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(1_000 + seed, { width: 8, height: 8, formation: "formed" }));
      const species = {
        id: `species:adaptive-parent:${seed}` as never,
        role: "consumer" as const,
        traits: { energyUse: 0.2, reproduction: 0.3, temperatureOptimum: 1, humidityOptimum: 1, mobility: 0, cognitivePotential: 0.2 },
      };
      const population = { id: `population:adaptive-parent:${seed}` as never, speciesId: species.id, regionId: "region:3:3" as never, count: 10_000, energy: 1 };
      state.fields.temperature.values.fill(0);
      state.fields.humidity.values.fill(0);
      state.species = [species];
      state.populations = [population];
      state.agents = [createAgent(population, species, 0, "adaptive-sample"), createAgent(population, species, 1, "adaptive-sample")];
      for (const agent of state.agents) {
        agent.traits.metabolicEfficiency = 0.9;
        agent.traits.thermalTolerance = 0.85;
        agent.traits.hydrationRetention = 0.8;
      }
      const delta = stepEcology(state, ecologyContext(state));
      return { state, species, population, delta };
    }).find(({ delta }) => delta.eventDrafts.some((event) => event.kind === "species-divergence"));

    expect(outcome).toBeDefined();
    const childSpeciesEffect = outcome?.delta.entityEffects.find((effect) => effect.collection === "species" && effect.operation === "create");
    const childPopulationEffect = outcome?.delta.entityEffects.find((effect) => effect.collection === "populations" && effect.operation === "create");
    const parentUpdate = outcome?.delta.entityEffects.find((effect) => effect.collection === "populations" && effect.operation === "update" && effect.id === outcome.population.id);
    const childSpecies = childSpeciesEffect?.collection === "species" ? childSpeciesEffect.value : undefined;
    const childPopulation = childPopulationEffect?.collection === "populations" ? childPopulationEffect.value : undefined;
    const retainedPopulation = parentUpdate?.collection === "populations" ? parentUpdate.value : undefined;
    const expectedCount = nextPopulationCount(outcome!.population, outcome!.species, 0, 0);

    expect(childSpecies).toMatchObject({ parentId: outcome?.species.id, role: "consumer" });
    expect(childSpecies?.traits).not.toEqual(outcome?.species.traits);
    expect(childPopulation).toMatchObject({ speciesId: childSpecies?.id, regionId: outcome?.population.regionId });
    expect((childPopulation?.count ?? 0) + (retainedPopulation?.count ?? 0)).toBeCloseTo(expectedCount, 6);
    expect(outcome?.delta.eventDrafts).toContainEqual(expect.objectContaining({
      kind: "species-divergence",
      ruleId: "ecology:adaptive-speciation",
      evidence: expect.objectContaining({ branchCount: childPopulation?.count, selectedSampleSize: 2, selectedMetabolicEfficiency: 0.9 }),
    }));
  });

  it("stops adaptive divergence at the consumer lineage limit", () => {
    const outcomes = Array.from({ length: 128 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(1_400 + seed, { width: 8, height: 8, formation: "formed" }));
      state.fields.temperature.values.fill(0);
      state.fields.humidity.values.fill(0);
      state.species = Array.from({ length: 5 }, (_, index) => ({
        id: `species:capped-consumer:${seed}:${index}` as never,
        role: "consumer" as const,
        traits: { energyUse: 0.2, reproduction: 0.3, temperatureOptimum: 1, humidityOptimum: 1, mobility: 0, cognitivePotential: 0.2 },
      }));
      state.populations = state.species.map((species, index) => ({
        id: `population:capped-consumer:${seed}:${index}` as never,
        speciesId: species.id,
        regionId: `region:${index + 1}:3` as never,
        count: index === 0 ? 10_000 : 4,
        energy: 1,
      }));
      return stepEcology(state, ecologyContext(state));
    });

    expect(outcomes.every((delta) => delta.eventDrafts.every((event) => event.kind !== "species-divergence"))).toBe(true);
  });

  it("refills an open ecological niche after historical lineages go extinct", () => {
    const outcome = Array.from({ length: 256 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(1_800 + seed, { width: 8, height: 8, formation: "formed" }));
      state.fields.temperature.values.fill(0);
      state.fields.humidity.values.fill(0);
      state.species = Array.from({ length: 5 }, (_, index) => ({
        id: `species:historical-consumer:${seed}:${index}` as never,
        role: "consumer" as const,
        traits: { energyUse: 0.2, reproduction: 0.3, temperatureOptimum: 1, humidityOptimum: 1, mobility: 0, cognitivePotential: 0.2 },
      }));
      state.populations = [{
        id: `population:surviving-consumer:${seed}` as never,
        speciesId: state.species[0]!.id,
        regionId: "region:3:3" as never,
        count: 10_000,
        energy: 1,
      }];
      return stepEcology(state, ecologyContext(state));
    }).find((delta) => delta.eventDrafts.some((event) => event.kind === "species-divergence"));

    expect(outcome).toBeDefined();
    expect(outcome?.entityEffects).toContainEqual(expect.objectContaining({
      collection: "species",
      operation: "create",
      value: expect.objectContaining({ role: "consumer" }),
    }));
  });

  it("splits a large mobile population into a conserved neighboring branch", () => {
    const outcome = Array.from({ length: 96 }, (_, seed) => {
      const state = initializeEnvironment(createWorld(400 + seed, { width: 8, height: 8 }));
      const species = {
        id: `species:dispersal:${seed}` as never,
        role: "producer" as const,
        traits: { energyUse: 0.1, reproduction: 0, temperatureOptimum: 0.5, humidityOptimum: 0.5, mobility: 1, cognitivePotential: 0 },
      };
      state.fields.temperature.values.fill(0.5);
      state.fields.humidity.values.fill(0.5);
      state.fields.nutrients.values.fill(1);
      state.species = [species];
      state.populations = [{ id: `population:dispersal:${seed}` as never, speciesId: species.id, regionId: "region:3:3" as never, count: 1_000, energy: 1 }];
      const delta = stepEcology(state, ecologyContext(state));
      const next = applyEcologyDelta(state, delta);
      return { state, next, delta };
    }).find(({ delta }) => delta.eventDrafts.some((event) => event.kind === "population-dispersal"));

    expect(outcome).toBeDefined();
    const event = outcome?.delta.eventDrafts.find((candidate) => candidate.kind === "population-dispersal");
    expect(["region:4:3", "region:2:3", "region:3:4", "region:3:2"]).toContain(event?.payload.toRegion);
    const producerPopulations = outcome?.next.populations.filter((population) => population.speciesId === outcome.state.species[0]?.id) ?? [];
    expect(producerPopulations).toHaveLength(2);
    expect(producerPopulations.reduce((sum, population) => sum + population.count, 0)).toBeCloseTo(1_000, 6);
  });
});
