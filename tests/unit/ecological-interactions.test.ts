import { describe, expect, it } from "vitest";
import { initializeEnvironment } from "../../src/sim/environment/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { modelEcologicalInteractions, compactEcologicalRelationships, updateEcologicalRelationships, MAX_ECOLOGICAL_RELATIONSHIPS } from "../../src/sim/ecology/interactions.ts";
import { stepEcology, applyEcologyDelta } from "../../src/sim/ecology/index.ts";
import { createWorld } from "../../src/sim/world.ts";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { summarizeRegionState } from "../../src/sim/lod/index.ts";
import type { RuleContext } from "../../src/sim/types.ts";

const contextFor = (state: ReturnType<typeof createWorld>): RuleContext => ({
  state,
  random: state.random,
  metrics: {
    meanTemperature: 0.5,
    meanHumidity: 0.5,
    waterCoverage: 0.7,
    nutrientLevel: 0.7,
    biomass: 0.5,
    oxygen: 0.1,
    carbon: 0.2,
    organics: 0.1,
    oceanCoverage: 0.4,
    terrainRelief: 0.1,
    populationCount: 2_000,
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

const interactionWorld = () => {
  const state = initializeEnvironment(createWorld(802, { width: 8, height: 8, formation: "formed" }));
  state.fields.temperature.values.fill(0.5);
  state.fields.humidity.values.fill(0.5);
  const producer = createSpecies("interaction-producer", "producer");
  const consumer = createSpecies("interaction-consumer", "consumer");
  consumer.blueprint!.metabolism = "ingestive-predation";
  state.species = [producer, consumer];
  state.populations = [
    { id: "population:interaction-producer" as never, speciesId: producer.id, regionId: "region:3:3" as never, count: 1_000, energy: 1 },
    { id: "population:interaction-consumer" as never, speciesId: consumer.id, regionId: "region:3:3" as never, count: 200, energy: 1 },
  ];
  return state;
};

describe("ecological interactions", () => {
  it("creates an auditable predation relation and feeds back into population growth", () => {
    const state = interactionWorld();
    const model = modelEcologicalInteractions(state);
    expect(model.plans).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "predation", regionId: "region:3:3" })]));
    const delta = stepEcology(state, contextFor(state));
    expect(delta.ecologicalRelationshipEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "create", relationship: expect.objectContaining({ kind: "predation", interactionCount: 1 }) }),
    ]));
    const next = applyEcologyDelta(state, delta);
    expect(next.ecologicalRelationships).toHaveLength(1);
    expect(model.foodAdjustments.get("population:interaction-consumer")).toBeGreaterThan(0);
    expect(model.foodAdjustments.get("population:interaction-producer")).toBeLessThan(0);
  });

  it("updates the same relation with bounded cumulative counters", () => {
    const state = interactionWorld();
    const first = updateEcologicalRelationships(state, modelEcologicalInteractions(state));
    const next = structuredClone(state);
    next.ecologicalRelationships = first.effects.filter((effect) => effect.operation !== "remove").map((effect) => effect.relationship);
    next.tick = 1;
    const second = updateEcologicalRelationships(next, modelEcologicalInteractions(next));
    expect(second.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "update", relationship: expect.objectContaining({ interactionCount: 2, cumulativeImpact: expect.any(Number) }) }),
    ]));
  });

  it("keeps long-lived ecological history within a fixed bound", () => {
    const state = interactionWorld();
    state.ecologicalRelationships = Array.from({ length: MAX_ECOLOGICAL_RELATIONSHIPS + 200 }, (_, index) => ({
      id: `ecology-relationship:${index}`,
      kind: "competition" as const,
      fromSpeciesId: `species:from:${index}` as never,
      toSpeciesId: `species:to:${index}` as never,
      regionId: `region:${index % 8}:3` as never,
      strength: index / MAX_ECOLOGICAL_RELATIONSHIPS,
      firstTick: index,
      lastTick: index,
      interactionCount: index,
      cumulativeImpact: index,
      lastImpact: 0.1,
      status: "active" as const,
      details: {},
    }));
    const removed = compactEcologicalRelationships(state);
    expect(removed).toBe(200);
    expect(state.ecologicalRelationships).toHaveLength(MAX_ECOLOGICAL_RELATIONSHIPS);
  });

  it("round-trips ecological history and includes it in regional summaries", () => {
    const state = interactionWorld();
    const effects = updateEcologicalRelationships(state, modelEcologicalInteractions(state)).effects;
    state.ecologicalRelationships = effects.map((effect) => effect.relationship);
    const summary = summarizeRegionState(state, "region:3:3" as never, "micro");
    expect(summary.ecologicalRelationshipCount).toBe(1);
    expect(summary.ecologicalRelationships?.[0]?.kind).toBe("predation");
    const restored = deserializeWorld(serializeWorld(state));
    expect(restored.ecologicalRelationships).toEqual(state.ecologicalRelationships);
  });
});
