import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { refreshAggregateSummaryWithEvents, stepLod, summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import type { RegionId, WorldDelta, WorldState } from "../../src/sim/types.ts";
import { MAX_KNOWLEDGE_PER_CULTURE } from "../../src/sim/culture/archive.ts";
import { MAX_AGGREGATE_COUNTER, MAX_AGGREGATE_ORGANIZATIONS } from "../../src/sim/lod/index.ts";

const region = "region:0:0" as RegionId;

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const aggregateWorld = (): WorldState => {
  const state = createWorld(90210, { width: 8, height: 8, formation: "formed" });
  state.fields.biomass.values.fill(0.84);
  state.fields.water.values.fill(0.72);
  state.fields.humidity.values.fill(0.68);
  state.fields.nutrients.values.fill(0.76);
  state.chemistry.organics.values.fill(0.52);
  const producer = createSpecies("aggregate-producer", "producer");
  const consumer = createSpecies("aggregate-consumer", "consumer");
  consumer.traits.cognitivePotential = 0.88;
  state.species = [producer, consumer];
  state.populations = [
    { id: "population:aggregate-producer" as never, speciesId: producer.id, regionId: region, count: 600, energy: 1 },
    { id: "population:aggregate-consumer" as never, speciesId: consumer.id, regionId: region, count: 220, energy: 1 },
  ];
  state.resources = [{ id: "resource:aggregate-food", resourceId: "food", regionId: region, amount: 5_000, cap: 5_000, originEventId: "aggregate-test" }];
  return state;
};

const refreshAt = (state: WorldState, previous: WorldState["lod"]["summaries"][number], tick: number) => {
  const stepped = structuredClone(state);
  stepped.tick = tick;
  stepped.years = tick;
  return refreshAggregateSummaryWithEvents(stepped, previous, stepped.populations);
};

describe("aggregate region evolution", () => {
  it("keeps ecological and social populations separate without creating detailed agents", () => {
    const state = aggregateWorld();
    const initial = summarizeRegionState(state, region, "aggregate");
    const refreshed = refreshAt(state, initial, 1);

    expect(refreshed.summary.population).toBe(820);
    expect(refreshed.summary.socialPopulation).toBeGreaterThan(0);
    expect(refreshed.summary.socialPopulation).toBeLessThan(refreshed.summary.population);
    expect(refreshed.summary.agentIds).toEqual([]);
    expect(refreshed.summary.agentRecords).toEqual([]);
    expect(refreshed.summary.cultureSummary).toBeDefined();
    expect(refreshed.summary.societySummary).toBeDefined();

    const stateWithSummary = { ...state, lod: { ...state.lod, summaries: [refreshed.summary] } };
    const delta = stepLod(stateWithSummary, { elapsedYears: 1, externalEvents: [] }, emptyDelta(), emptyDelta(), emptyDelta(), emptyDelta());
    expect(delta.entityEffects.filter((effect) => effect.collection === "agents")).toEqual([]);
  });

  it("evolves culture, knowledge, beliefs, and organizations over a long aggregate horizon", () => {
    const state = aggregateWorld();
    let summary = summarizeRegionState(state, region, "aggregate");
    let emitted = 0;
    for (let tick = 1; tick <= 1_000; tick += 1) {
      const refreshed = refreshAt(state, summary, tick);
      summary = refreshed.summary;
      emitted += refreshed.events.length;
    }

    const culture = summary.cultureSummary;
    const society = summary.societySummary;
    expect(emitted).toBeGreaterThan(0);
    expect(culture?.innovationCount).toBeGreaterThan(0);
    expect(culture?.knowledge.length).toBeGreaterThan(0);
    expect(culture?.beliefCount).toBeGreaterThan(0);
    expect(Object.values(society?.organizationCounts ?? {}).some((count) => count > 0)).toBe(true);
    expect(society?.lastChangeTick).toBeGreaterThan(0);
  });

  it("replays the same aggregate input deterministically", () => {
    const state = aggregateWorld();
    const initial = summarizeRegionState(state, region, "aggregate");
    const left = refreshAt(state, initial, 42);
    const right = refreshAt(state, initial, 42);

    expect(right).toEqual(left);
  });

  it("keeps aggregate records bounded and restorable after sustained refreshes", () => {
    const state = aggregateWorld();
    let summary = summarizeRegionState(state, region, "aggregate");
    for (let tick = 1; tick <= 5_000; tick += 1) summary = refreshAt(state, summary, tick).summary;

    const culture = summary.cultureSummary!;
    const society = summary.societySummary!;
    expect(culture.knowledge.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_PER_CULTURE);
    expect(culture.knowledge.every((knowledge) => [knowledge.credibility, knowledge.transmissionCost, knowledge.forgettingRate, knowledge.originTick, knowledge.originYears].every(Number.isFinite))).toBe(true);
    expect(culture.beliefCount).toBeLessThanOrEqual(MAX_AGGREGATE_COUNTER);
    expect(culture.innovationCount).toBeLessThanOrEqual(MAX_AGGREGATE_COUNTER);
    expect(Object.values(society.organizationCounts).every((count) => count >= 0 && count <= MAX_AGGREGATE_ORGANIZATIONS)).toBe(true);
    expect(society.tradeVolume).toBeLessThanOrEqual(MAX_AGGREGATE_COUNTER);
    expect(worldDigest(deserializeWorld(serializeWorld({ ...state, lod: { ...state.lod, summaries: [summary] } })))).toBe(worldDigest({ ...state, lod: { ...state.lod, summaries: [summary] } }));
  }, 30_000);

  it("can resume older summaries without culture or society extensions", () => {
    const state = aggregateWorld();
    const summary = summarizeRegionState(state, region, "aggregate");
    const legacy = JSON.parse(serializeWorld({ ...state, lod: { ...state.lod, summaries: [summary] } })) as { world: { lod: { summaries: Array<Record<string, unknown>> } } };
    delete legacy.world.lod.summaries[0]?.cultureSummary;
    delete legacy.world.lod.summaries[0]?.societySummary;

    const restored = deserializeWorld(JSON.stringify(legacy));
    const resumed = refreshAt(restored, restored.lod.summaries[0]!, 1).summary;

    expect(resumed.cultureSummary).toBeDefined();
    expect(resumed.societySummary).toBeDefined();
    expect(resumed.cultureSummary?.knowledge.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_PER_CULTURE);
  });
});
