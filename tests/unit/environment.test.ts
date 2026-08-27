import { describe, expect, it } from "vitest";
import { applyEnvironmentDelta, applyNaturalHazardWaterEffects, calculateClimate, initializeEnvironment, MAX_NATURAL_HAZARDS_PER_STEP, naturalHazardDelta, stepEnvironment } from "../../src/sim/environment/index.ts";
import { totalWater } from "../../src/sim/environment/hydrology.ts";
import { createWorld } from "../../src/sim/world.ts";

const makeEnvironment = () => initializeEnvironment(createWorld(9, { width: 16, height: 8, formation: "formed" }));

describe("environment simulation", () => {
  it("creates deterministic ocean, temperature and humidity fields", () => {
    const first = makeEnvironment();
    const second = makeEnvironment();

    expect(Array.from(first.fields.water.values)).toEqual(Array.from(second.fields.water.values));
    expect(first.fields.water.values.some((value) => value > 0.5)).toBe(true);
    expect(first.fields.temperature.values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(first.fields.humidity.values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it("has warmer low-latitude cells and cooler high-elevation cells", () => {
    const state = makeEnvironment();
    const width = state.fields.elevation.width;
    const equator = state.fields.temperature.values[Math.floor(state.fields.elevation.height / 2) * width] ?? 0;
    const pole = state.fields.temperature.values[0] ?? 0;
    expect(equator).toBeGreaterThan(pole);

    const rowStart = Math.floor(state.fields.elevation.height / 2) * width;
    const sorted = Array.from({ length: width }, (_, offset) => ({
      elevation: state.fields.elevation.values[rowStart + offset] ?? 0,
      temperature: state.fields.temperature.values[rowStart + offset] ?? 0,
    })).sort((a, b) => a.elevation - b.elevation);
    const low = sorted[Math.floor(sorted.length * 0.1)];
    const high = sorted[Math.floor(sorted.length * 0.9)];
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(low?.temperature).toBeGreaterThan(high?.temperature ?? 0);
  });

  it("conserves water when no explicit transfer event exists", () => {
    const state = makeEnvironment();
    const before = totalWater(state.fields.water);
    const delta = stepEnvironment(state, { solarFlux: 1, externalEvents: [] });
    const after = applyEnvironmentDelta(state, delta);

    expect(totalWater(after.fields.water)).toBeCloseTo(before, 4);
    expect(after.species).toHaveLength(0);
    expect(after.organizations).toHaveLength(0);
  });

  it("changes water only through an explicit event", () => {
    const state = makeEnvironment();
    const before = totalWater(state.fields.water);
    const delta = stepEnvironment(state, {
      solarFlux: 1,
      externalEvents: [{
        id: "water-test",
        tick: 0,
        kind: "add-water",
        ruleId: "user-event",
        source: "user",
        sourceIds: [],
        probability: 1,
        roll: 0,
        evidence: {},
        payload: { amount: 3 },
      }],
    });
    const after = applyEnvironmentDelta(state, delta);

    expect(totalWater(after.fields.water)).toBeGreaterThan(before);
  });

  it("records environmental milestones when oceans and prebiotic chemistry cross thresholds", () => {
    const state = createWorld(10, { width: 16, height: 8, formation: "formed" });
    state.fields.water.values.fill(0);
    const delta = stepEnvironment(state, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });

    expect(delta.eventDrafts.map((event) => event.kind)).toContain("ocean-formation");
    expect(delta.eventDrafts.every((event) => event.source === "natural")).toBe(true);

    const prebiotic = createWorld(11, { width: 16, height: 8, formation: "formed" });
    prebiotic.fields.water.values.fill(0.8);
    prebiotic.fields.temperature.values.fill(0.6);
    prebiotic.fields.humidity.values.fill(0.6);
    prebiotic.chemistry.organics.values.fill(0.00049);
    const prebioticDelta = stepEnvironment(prebiotic, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });
    expect(prebioticDelta.eventDrafts.map((event) => event.kind)).toContain("prebiotic-chemistry");
  });

  it("does not repeat an ocean milestone after its threshold has been crossed", () => {
    const state = makeEnvironment();
    const first = stepEnvironment(state, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });
    const after = applyEnvironmentDelta(state, first);
    const second = stepEnvironment(after, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });

    expect(second.eventDrafts.some((event) => event.kind === "ocean-formation")).toBe(false);
  });

  it("warms under a stronger atmospheric carbon greenhouse forcing", () => {
    const baseline = makeEnvironment();
    const carbonRich = structuredClone(baseline);
    carbonRich.chemistry.carbon.values.fill(0.8);
    const mean = (values: Float32Array) => values.reduce((sum, value) => sum + value, 0) / values.length;

    expect(mean(calculateClimate(carbonRich).temperature)).toBeGreaterThan(mean(calculateClimate(baseline).temperature));
  });

  it("changes relief and recycles minerals through slow geology", () => {
    const state = makeEnvironment();
    state.tick = 7;
    state.years = 7;
    const beforeElevation = Array.from(state.fields.elevation.values);
    const delta = stepEnvironment(state, { solarFlux: 1, externalEvents: [] });
    const next = applyEnvironmentDelta(state, delta);

    expect(delta.fieldChanges.some((change) => change.causeRuleId === "geology:tectonics-erosion")).toBe(true);
    expect(Array.from(next.fields.elevation.values)).not.toEqual(beforeElevation);
    expect(next.fields.nutrients.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });

  it("derives bounded, replayable climate disasters and conserves redistributed water", () => {
    const drought = createWorld(991, { width: 8, height: 8, formation: "formed" });
    drought.fields.elevation.values.fill(0.05);
    drought.fields.temperature.values.fill(0.95);
    drought.fields.humidity.values.fill(0.04);
    drought.fields.water.values.fill(0.04);
    drought.fields.nutrients.values.fill(0.4);

    const first = naturalHazardDelta(drought, 10_000);
    const second = naturalHazardDelta(structuredClone(drought), 10_000);

    expect(first).toEqual(second);
    expect(first.hazards).toHaveLength(MAX_NATURAL_HAZARDS_PER_STEP);
    expect(first.hazards.every((hazard) => hazard.kind === "drought")).toBe(true);
    expect(first.hazards.every((hazard) => Number(hazard.evidence.samplingScale) === 2)).toBe(true);
    expect(first.delta.eventDrafts.every((event) => event.source === "natural" && event.ruleId === "environment:natural-drought")).toBe(true);
    expect(first.delta.fieldChanges).toContainEqual(expect.objectContaining({ field: "biomass", operation: "add", value: expect.any(Number), causeRuleId: "environment:natural-drought" }));
    const droughtWater = applyNaturalHazardWaterEffects(drought, drought.fields.water.values, first.hazards);
    expect(totalWater({ ...drought.fields.water, values: droughtWater })).toBeCloseTo(totalWater(drought.fields.water), 6);

    const flood = createWorld(992, { width: 8, height: 8, formation: "formed" });
    flood.fields.elevation.values.fill(0.02);
    flood.fields.temperature.values.fill(0.5);
    flood.fields.humidity.values.fill(0.99);
    flood.fields.water.values.fill(0.99);
    const floodResult = naturalHazardDelta(flood, 10_000);
    const floodWater = applyNaturalHazardWaterEffects(flood, flood.fields.water.values, floodResult.hazards);

    expect(floodResult.hazards).not.toHaveLength(0);
    expect(floodResult.hazards.every((hazard) => hazard.kind === "flood")).toBe(true);
    expect(totalWater({ ...flood.fields.water, values: floodWater })).toBeCloseTo(totalWater(flood.fields.water), 6);
    expect(floodWater.every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
