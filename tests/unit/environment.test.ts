import { describe, expect, it } from "vitest";
import { initializeEnvironment, stepEnvironment, applyEnvironmentDelta, calculateClimate } from "../../src/sim/environment/index.ts";
import { totalWater } from "../../src/sim/environment/hydrology.ts";
import { createWorld } from "../../src/sim/world.ts";

const makeEnvironment = () => initializeEnvironment(createWorld(9, { width: 16, height: 8 }));

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
});
