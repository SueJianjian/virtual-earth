import { describe, expect, it, beforeEach } from "vitest";
import {
  EVENT_LOG_COMPACT_THRESHOLD,
  EVENT_LOG_RETAIN_COUNT,
  MAX_ACTIVE_USER_EVENTS,
  MAX_ARCHIVE_COUNTER_KEYS,
  MAX_EVENT_MILESTONES,
  MAX_HISTORY_SAMPLES,
  appendEvents,
  appendExternalEvents,
  compactEventLedger,
  compactEventArchiveIndexes,
  createEventArchive,
  isWorldEventActive,
  lifetimeTradeVolume,
  materializeEvent,
  recordAppendedEvents,
  retainHistorySamples,
} from "../../src/sim/events/ledger.ts";
import { derivePhase } from "../../src/sim/events/phase.ts";
import { clearSimulationStages, listSimulationStages, registerSimulationStage, stepWorld } from "../../src/sim/engine.ts";
import { MAX_SIMULATION_DAYS, SIMULATED_YEARS_PER_DAY } from "../../src/sim/time.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { RegionId, ResourceTransaction, WorldDelta, WorldEvent, WorldEventDraft, WorldHistorySample } from "../../src/sim/types.ts";
import { worldDigest } from "../../src/sim/world.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { technologyProfileForRegion } from "../../src/sim/culture/technology.ts";
import { EXTINCT_SPECIES_RETAIN_COUNT } from "../../src/sim/ecology/archive.ts";
import { derivePathogen } from "../../src/sim/health/disease.ts";

const draft: WorldEventDraft = {
  kind: "test-event",
  ruleId: "test-rule",
  sourceIds: [],
  probability: 0.5,
  roll: 0.25,
  evidence: { water: 0.5 },
  payload: { stable: true },
  source: "natural",
};

const historySample = (year: number): WorldHistorySample => ({
  tick: year * 365,
  years: year,
  timelineStep: String(year * 365),
  timelineDays: String(year * 365),
  meanTemperature: 0.5,
  oceanCoverage: 0.4,
  biomass: year / 1_000,
  oxygen: 0.2,
  organics: 0.1,
  populationCount: year,
  speciesCount: 1,
  organizationCount: 1,
  facilityCount: 1,
  knowledgeCount: 1,
  foodSecurity: 0.7,
  diseasePrevalence: 0,
});

describe("rule engine and event ledger", () => {
  beforeEach(() => clearSimulationStages());

  it("deduplicates stable event IDs", () => {
    const first = materializeEvent(draft, 4, 0);
    expect(appendEvents([first], [draft], 4)).toHaveLength(1);
  });

  it("keeps the hot trade metric current after in-place event growth", () => {
    const world = createWorld(8, { width: 8, height: 8 });
    const trade = (id: string, tick: number, amount: number): WorldEvent => ({
      id,
      tick,
      years: tick,
      kind: "organization-trade",
      ruleId: "test:trade",
      source: "natural",
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: {},
      payload: { amount },
    });
    world.events = [trade("event:trade:1", 1, 2)];
    expect(lifetimeTradeVolume(world)).toBe(2);
    world.events.push(trade("event:trade:2", 2, 3));
    expect(lifetimeTradeVolume(world)).toBe(5);
    world.events.splice(0, 1);
    expect(lifetimeTradeVolume(world)).toBe(3);
    world.events[0] = trade("event:trade:replacement", 3, 7);
    expect(lifetimeTradeVolume(world)).toBe(7);
  });

  it("does not change a natural event ID when evidence key order changes", () => {
    const reordered = { ...draft, evidence: { other: true, water: 0.5 } };
    const original = { ...draft, evidence: { water: 0.5, other: true } };
    expect(materializeEvent(original, 4, 0).id).toBe(materializeEvent(reordered, 4, 0).id);
  });

  it("derives display phase without making it part of world state", () => {
    const world = createWorld(8, { width: 8, height: 8 });
    expect(derivePhase(world)).toBe("dust-cloud");
    expect("phase" in world).toBe(false);

    const formed = createWorld(8, { width: 8, height: 8, formation: "formed" });
    formed.chemistry.organics.values.fill(0.0005);
    expect(derivePhase(formed)).toBe("chemical");
  });

  it("runs only registered data stages and advances the authoritative clock", () => {
    const world = createWorld(12, { width: 8, height: 8 });
    const result = stepWorld(world, { elapsedYears: 100, externalEvents: [] });

    expect(listSimulationStages().map((stage) => stage.id)).toEqual(["environment", "ecology", "agents", "culture", "society", "lod", "worldview"]);
    expect(result.state.tick).toBe(1);
    expect(result.state.years).toBe(100);
    expect(result.state.worldview.entities).toHaveLength(0);
  });

  it("rejects invalid time input before changing the authoritative world", () => {
    const world = createWorld(12, { width: 8, height: 8 });
    const before = worldDigest(world);

    expect(() => stepWorld(world, { elapsedYears: Number.NaN, externalEvents: [] }, { computeDigest: false, mutateState: true })).toThrow("Simulation step");
    expect(worldDigest(world)).toBe(before);

    world.tick = -1;
    expect(() => stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true })).toThrow("World tick");

    world.tick = Number.MAX_SAFE_INTEGER;
    stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true });
    expect(world.timeline).toEqual({
      step: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      days: "365",
    });
    expect(world.tick).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("advances from the exact persisted day clock without losing a day", () => {
    const world = createWorld(121, { width: 8, height: 8, formation: "formed" });
    world.simulationDays = MAX_SIMULATION_DAYS - 2;
    world.years = world.simulationDays / 365;

    stepWorld(world, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false, mutateState: true });

    expect(world.simulationDays).toBe(MAX_SIMULATION_DAYS - 1);
    stepWorld(world, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false, mutateState: true });

    expect(world.simulationDays).toBe(MAX_SIMULATION_DAYS);
    expect(() => stepWorld(world, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false, mutateState: true })).not.toThrow();
    expect(world.simulationDays).toBe(MAX_SIMULATION_DAYS);
    expect(world.timeline?.days).toBe(String(MAX_SIMULATION_DAYS + 1));
  });

  it("continues across the numeric clock boundary with an exact timeline", () => {
    const world = createWorld(122, { width: 8, height: 8, formation: "formed" });
    world.timeline = { step: String(Number.MAX_SAFE_INTEGER), days: String(MAX_SIMULATION_DAYS) };
    world.tick = Number.MAX_SAFE_INTEGER;
    world.simulationDays = MAX_SIMULATION_DAYS;
    world.years = MAX_SIMULATION_DAYS / 365;

    stepWorld(world, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false, mutateState: true });

    expect(world.timeline).toEqual({
      step: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      days: String(BigInt(MAX_SIMULATION_DAYS) + 1n),
    });
    expect(world.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(world.simulationDays).toBe(MAX_SIMULATION_DAYS);
  });

  it("keeps event identity and duration exact beyond safe integer steps", () => {
    const first = materializeEvent(draft, Number.MAX_SAFE_INTEGER, 0, MAX_SIMULATION_DAYS / 365, "9007199254740992", "9007199254740992");
    const second = materializeEvent(draft, Number.MAX_SAFE_INTEGER, 0, MAX_SIMULATION_DAYS / 365, "9007199254740993", "9007199254740993");
    expect(first.id).not.toBe(second.id);
    expect(isWorldEventActive({ ...first, source: "user", payload: { duration: 2 } }, "9007199254740993")).toBe(true);
    expect(isWorldEventActive({ ...first, source: "user", payload: { duration: 2 } }, "9007199254740994")).toBe(false);
  });

  it("uses an opt-in mutable path without changing the default immutable contract", () => {
    const immutableInput = createWorld(15, { width: 8, height: 8 });
    const immutableDigest = worldDigest(immutableInput);
    const immutable = stepWorld(immutableInput, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false });
    expect(immutable.state).not.toBe(immutableInput);
    expect(worldDigest(immutableInput)).toBe(immutableDigest);

    const mutableInput = createWorld(15, { width: 8, height: 8 });
    const mutable = stepWorld(mutableInput, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true });
    expect(mutable.state).toBe(mutableInput);
    expect(mutableInput.tick).toBe(1);
  });

  it("keeps the canonical digest stable while streaming typed grids", () => {
    const state = createWorld(1, { width: 256, height: 256, formation: "formed" });
    expect(worldDigest(state)).toBe("6f8b8cc1");
    state.observation.focusRegionId = "region:1:1" as RegionId;
    expect(worldDigest(state)).toBe("6f8b8cc1");
  });

  it("applies dense patches and sparse changes in simulation-stage order", () => {
    const baseline = stepWorld(
      createWorld(19, { width: 8, height: 8, formation: "formed" }),
      { elapsedYears: 1, externalEvents: [] },
      { computeDigest: false },
    ).state.fields.water.values[0] ?? 0;
    clearSimulationStages();
    const sparseStage = (id: string, order: number, value: number) => ({
      id,
      order,
      run: (): WorldDelta => ({
        fieldChanges: [{ field: "water", index: 0, operation: "add", value, causeRuleId: id }],
        chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
      }),
    });
    registerSimulationStage(sparseStage("before-environment", 5, 0.25));
    registerSimulationStage(sparseStage("after-environment", 15, 0.1));

    const result = stepWorld(
      createWorld(19, { width: 8, height: 8, formation: "formed" }),
      { elapsedYears: 1, externalEvents: [] },
      { computeDigest: false },
    );

    expect(result.state.fields.water.values[0]).toBeCloseTo(Math.min(1, baseline + 0.1), 6);
  });

  it("refreshes collection-keyed indexes after an in-place entity update", () => {
    const world = createWorld(17, { width: 8, height: 8, formation: "formed" });
    const regionId = "region:1:1" as RegionId;
    world.knowledge = [{ id: "knowledge:old", kind: "old", sourceIds: [], credibility: 1, transmissionCost: 0.1, forgettingRate: 0.01, domain: "subsistence" }];
    world.cultures = [{ id: "culture:index" as never, regionId, knowledgeIds: ["knowledge:old"], beliefIds: [], transmissionRate: 1 }];
    expect(technologyProfileForRegion(world, regionId).construction).toBe(0);
    registerSimulationStage({
      id: "cache-refresh",
      order: 1,
      run: () => ({
        fieldChanges: [], chemistryChanges: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
        entityEffects: [
          { collection: "knowledge", operation: "create", id: "knowledge:new", value: { id: "knowledge:new", kind: "new", sourceIds: [], credibility: 1, transmissionCost: 0.1, forgettingRate: 0.01, domain: "construction" } },
          { collection: "cultures", operation: "update", id: world.cultures[0]!.id, value: { ...world.cultures[0]!, knowledgeIds: ["knowledge:old", "knowledge:new"] } },
        ],
      }),
    });

    stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true });

    expect(technologyProfileForRegion(world, regionId).construction).toBeCloseTo(1 / 6);
  });

  it("bounds the hot event ledger and archives historical aggregates", () => {
    const world = createWorld(16, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("city", "region:1:1" as RegionId, []);
    world.organizations = [organization];
    world.tick = EVENT_LOG_COMPACT_THRESHOLD + 1;
    world.years = world.tick;
    world.events = Array.from({ length: EVENT_LOG_COMPACT_THRESHOLD + 1 }, (_, index) => ({
      id: `event:archive:${index}`,
      tick: index,
      years: index,
      kind: index === 0 ? "add-water" : "interregional-trade",
      ruleId: index === 0 ? "user:add-water" : "society:interregional-supply-chain",
      source: index === 0 ? "user" as const : "natural" as const,
      sourceIds: index === 0 ? [] : [organization.id],
      probability: 1,
      roll: 0,
      evidence: { regionId: organization.regionId, amount: 1 },
      payload: index === 0
        ? { regionId: organization.regionId, duration: 10_000 }
        : { fromRegion: organization.regionId, toRegion: "region:2:1", resourceId: "food", amount: 1, fromOrganizationId: organization.id },
    }));
    world.eventArchive = createEventArchive(world.events);

    const archived = compactEventLedger(world);

    expect(archived).toHaveLength(EVENT_LOG_COMPACT_THRESHOLD + 1 - 4_096 - 1);
    expect(world.events).toHaveLength(4_097);
    expect(world.events.some((event) => event.id === "event:archive:0")).toBe(true);
    expect(world.eventArchive.totalEventCount).toBe(EVENT_LOG_COMPACT_THRESHOLD + 1);
    expect(world.eventArchive.archivedEventCount).toBe(archived.length);
    expect(world.eventArchive.kindCounts["interregional-trade"]).toBe(archived.length);
    expect(world.eventArchive.regionCounts[organization.regionId]).toBe(archived.length);
    expect(world.eventArchive.organizationCounts[organization.id]).toBe(archived.length);
    expect(world.eventArchive.organizationFormationCounts).toEqual({});
    expect(world.eventArchive.tradeVolumeByResource.food).toBe(archived.length);
    expect(world.organizations[0]?.archivedHistoryCount).toBe(archived.length);
    expect(lifetimeTradeVolume(world)).toBe(EVENT_LOG_COMPACT_THRESHOLD);
  });

  it("bounds long-lived user events and arbitrary archive keys", () => {
    const world = createWorld(17, { width: 8, height: 8, formation: "formed" });
    world.tick = 20_000;
    world.years = 20_000;
    world.events = Array.from({ length: 10_000 }, (_, index) => ({
      id: `event:long-lived:${index}`,
      tick: index,
      years: index,
      kind: `custom-event-${index}`,
      ruleId: "user:custom-event",
      source: "user" as const,
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { regionId: "region:0:0" },
      payload: { regionId: "region:0:0", duration: Number.MAX_SAFE_INTEGER },
    }));
    world.eventArchive = createEventArchive(world.events);

    const archived = compactEventLedger(world);

    expect(archived.length).toBeGreaterThan(0);
    expect(world.events.length).toBeLessThanOrEqual(EVENT_LOG_RETAIN_COUNT + MAX_ACTIVE_USER_EVENTS);
    expect(world.eventArchive.archivedEventCount).toBe(archived.length);
    expect(Object.keys(world.eventArchive.kindCounts).length).toBeLessThanOrEqual(MAX_ARCHIVE_COUNTER_KEYS);
    expect(world.eventArchive.kindCounts.__other__).toBeGreaterThan(0);
  });

  it("saturates archive totals instead of overflowing during continuous operation", () => {
    const world = createWorld(170, { width: 8, height: 8, formation: "formed" });
    world.tick = 20_000;
    world.years = 20_000;
    world.events = Array.from({ length: EVENT_LOG_COMPACT_THRESHOLD + 1 }, (_, index) => ({
      id: `event:saturation:${index}`,
      tick: index,
      years: index,
      kind: "test-event",
      ruleId: "test:saturation",
      source: "natural" as const,
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: {},
      payload: {},
    }));
    world.eventArchive = createEventArchive();
    world.eventArchive.totalEventCount = Number.MAX_SAFE_INTEGER - 1;
    world.eventArchive.archivedEventCount = Number.MAX_SAFE_INTEGER - 1;
    world.eventArchive.kindCounts["test-event"] = Number.MAX_SAFE_INTEGER - 1;

    recordAppendedEvents(world.eventArchive, [world.events[0]!]);
    compactEventLedger(world);

    expect(world.eventArchive.totalEventCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(world.eventArchive.archivedEventCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(world.eventArchive.kindCounts["test-event"]).toBe(Number.MAX_SAFE_INTEGER);
    expect(Object.values(world.eventArchive).flat().every((value) => typeof value !== "number" || Number.isFinite(value))).toBe(true);
  });

  it("keeps a bounded causal milestone archive with early anchors", () => {
    const world = createWorld(171, { width: 8, height: 8, formation: "formed" });
    const region = "region:1:1" as RegionId;
    world.events = [{
      id: "event:formation-anchor",
      tick: 0,
      years: 0,
      kind: "planet-formation-complete",
      ruleId: "formation:stable-crust",
      source: "natural",
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { regionId: region, surfaceHeat: 0.3 },
      payload: { regionId: region, name: "稳定地壳形成" },
    }, ...Array.from({ length: MAX_EVENT_MILESTONES + 24 }, (_, index) => ({
      id: `event:milestone:${index}`,
      tick: index + 1,
      years: index + 1,
      kind: "organization-formation",
      ruleId: "society:formation",
      source: "natural" as const,
      sourceIds: [`organization:city:${index}`],
      probability: 0.5,
      roll: 0.2,
      evidence: { regionId: region, population: index + 1 },
      payload: { regionId: region, name: `组织 ${index}`, type: "city", organizationId: `organization:city:${index}` },
    }))];
    world.eventArchive = createEventArchive(world.events);

    expect(world.eventArchive.milestones.length).toBe(MAX_EVENT_MILESTONES);
    expect(world.eventArchive.milestones[0]).toMatchObject({ id: "event:formation-anchor", kind: "planet-formation-complete", details: { name: "稳定地壳形成" } });
    expect(world.eventArchive.milestones.at(-1)).toMatchObject({ id: `event:milestone:${MAX_EVENT_MILESTONES + 23}`, details: { name: `组织 ${MAX_EVENT_MILESTONES + 23}` } });
    expect(world.eventArchive.milestones.every((milestone) => milestone.sourceIds.length <= 12 && milestone.regionIds.length <= 12)).toBe(true);
  });

  it("keeps long-term observations bounded with the first and newest annual samples", () => {
    const retained = retainHistorySamples(Array.from({ length: MAX_HISTORY_SAMPLES + 80 }, (_, index) => historySample(index + 1)));

    expect(retained).toHaveLength(MAX_HISTORY_SAMPLES);
    expect(retained[0]?.timelineStep).toBe("365");
    expect(retained.at(-1)?.timelineStep).toBe(String((MAX_HISTORY_SAMPLES + 80) * 365));
    expect(retained.every((sample, index) => index === 0 || BigInt(sample.timelineStep) > BigInt(retained[index - 1]!.timelineStep))).toBe(true);
  });

  it("drops per-organization archive indexes after an organization disappears", () => {
    const world = createWorld(18, { width: 8, height: 8, formation: "formed" });
    const retained = createOrganization("city", "region:1:1" as RegionId, []);
    world.organizations = [retained];
    world.eventArchive.organizationCounts = {
      [retained.id]: 12,
      "organization:city:retired": 45,
    };
    world.eventArchive.totalEventCount = 57;
    world.eventArchive.archivedEventCount = 57;

    compactEventArchiveIndexes(world);

    expect(world.eventArchive.organizationCounts).toEqual({ [retained.id]: 12 });
    expect(world.eventArchive.totalEventCount).toBe(57);
    expect(world.eventArchive.archivedEventCount).toBe(57);
  });

  it("bounds extinct species records while preserving living species", () => {
    const world = createWorld(19, { width: 8, height: 8, formation: "formed" });
    const livingSpeciesId = "species:living" as never;
    world.species = [
      ...Array.from({ length: 200 }, (_, index) => ({
        id: `species:extinct:${index}` as never,
        role: index % 2 === 0 ? "producer" as const : "consumer" as const,
        traits: {},
      })),
      { id: livingSpeciesId, role: "decomposer", traits: {} },
    ];
    const archivedSpeciesId = world.species[0]!.id;
    world.populations = [
      { id: "population:living" as never, speciesId: livingSpeciesId, regionId: "region:1:1" as never, count: 10, energy: 1 },
      { id: "population:archived" as never, speciesId: archivedSpeciesId, regionId: "region:1:1" as never, count: 0, energy: 0 },
    ];
    world.pathogens = [derivePathogen(world, "region:1:1" as never, archivedSpeciesId)];
    world.ecologicalRelationships = [{
      id: "ecology-relationship:archived",
      kind: "predation",
      fromSpeciesId: archivedSpeciesId,
      toSpeciesId: livingSpeciesId,
      regionId: "region:1:1" as never,
      strength: 0.4,
      firstTick: 0,
      lastTick: 0,
      interactionCount: 1,
      cumulativeImpact: 0.2,
      lastImpact: 0.2,
      status: "active",
      details: {},
    }];

    stepWorld(world, { elapsedYears: 0, externalEvents: [] }, { computeDigest: false, mutateState: true });

    expect(world.species).toHaveLength(EXTINCT_SPECIES_RETAIN_COUNT + 1);
    expect(world.species.some((species) => species.id === livingSpeciesId)).toBe(true);
    expect(world.eventArchive.archivedSpeciesCount).toBe(200 - EXTINCT_SPECIES_RETAIN_COUNT);
    expect(Object.values(world.eventArchive.archivedSpeciesRoleCounts).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(200 - EXTINCT_SPECIES_RETAIN_COUNT);
    expect(world.populations.every((population) => world.species.some((species) => species.id === population.speciesId))).toBe(true);
    expect(world.pathogens).toEqual([]);
    expect(world.ecologicalRelationships).toEqual([]);
  });

  it("applies each external event once and digests the full authoritative state", () => {
    const world = createWorld(12, { width: 8, height: 8 });
    const external = { ...materializeEvent(draft, 0, 9), kind: "add-water", payload: { amount: 0.1 } };
    const first = stepWorld(world, { elapsedYears: 1, externalEvents: [external] });
    const second = stepWorld(first.state, { elapsedYears: 1, externalEvents: [external] });

    expect(appendExternalEvents([], [external, external])).toHaveLength(1);
    expect(first.state.events.filter((event) => event.id === external.id)).toHaveLength(1);
    expect(second.state.events.filter((event) => event.id === external.id)).toHaveLength(1);
    expect(first.digest).toBe(worldDigest(first.state));
    expect(first.digest).not.toBe(second.digest);
  });

  it("moves resource balances through the typed reducer", () => {
    const world = createWorld(13, { width: 8, height: 8 });
    const regionId = "region:0:0" as RegionId;
    const stage = {
      id: "resource-test",
      order: 1,
      run: (): WorldDelta => ({
        fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], worldviewEffects: [], eventDrafts: [],
        resourceTransactions: [
          { id: "mint-1", resourceId: "food", regionId, amount: 10, operation: "mint", source: "environment", sourceId: "rain", toHolderId: "a", causeRuleId: "test" },
          { id: "transfer-1", resourceId: "food", regionId, amount: 4, operation: "transfer", source: "culture", sourceId: "trade", fromHolderId: "a", toHolderId: "b", causeRuleId: "test" },
          { id: "consume-1", resourceId: "food", regionId, amount: 1, operation: "consume", source: "culture", sourceId: "meal", fromHolderId: "b", causeRuleId: "test" },
          { id: "cross-region-1", resourceId: "food", regionId, destinationRegionId: "region:1:0" as RegionId, amount: 2, operation: "transfer", source: "culture", sourceId: "caravan", fromHolderId: "a", toHolderId: "c", causeRuleId: "test" },
        ] satisfies ResourceTransaction[],
      }),
    };
    clearSimulationStages();
    registerSimulationStage(stage);
    const { state } = stepWorld(world, { elapsedYears: 1, externalEvents: [] });
    expect(state.resources.find((entry) => entry.holderId === "a")?.amount).toBe(4);
    expect(state.resources.find((entry) => entry.holderId === "b")?.amount).toBe(3);
    expect(state.resources.find((entry) => entry.holderId === "c")?.regionId).toBe("region:1:0");
    expect(state.resources.find((entry) => entry.holderId === "c")?.amount).toBe(2);
    expect(state.resources.reduce((sum, entry) => sum + entry.amount, 0)).toBe(9);
  });

  it("returns dissolved organization balances to the regional commons", () => {
    const world = createWorld(18, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("city", "region:1:1" as RegionId, []);
    organization.status = "collapsed";
    world.organizations = [organization];
    world.resources = [{ id: "resource:orphan", resourceId: "materials", regionId: organization.regionId, holderId: organization.id, amount: 7, cap: 10, originEventId: "test" }];

    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false });

    expect(result.state.organizations.some((candidate) => candidate.id === organization.id)).toBe(false);
    expect(result.state.resources.some((resource) => resource.holderId === organization.id)).toBe(false);
    expect(result.state.resources.find((resource) => resource.resourceId === "materials" && resource.holderId === undefined)?.amount).toBe(7);
  });

  it("keeps default stages when an extension stage is registered", () => {
    clearSimulationStages();
    registerSimulationStage({
      id: "extension",
      order: 35,
      run: () => ({
        fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
        resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
      }),
    });
    stepWorld(createWorld(14, { width: 8, height: 8 }), { elapsedYears: 1, externalEvents: [] });
    expect(listSimulationStages().map((stage) => stage.id)).toEqual(["environment", "ecology", "agents", "extension", "culture", "society", "lod", "worldview"]);
  });
});
