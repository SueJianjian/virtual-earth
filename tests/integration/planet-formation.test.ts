import { beforeEach, describe, expect, it } from "vitest";
import { clearSimulationStages, stepWorld } from "../../src/sim/engine.ts";
import { FORMATION_DURATION_DAYS, formedElevation } from "../../src/sim/environment/formation.ts";
import { SIMULATED_YEARS_PER_DAY } from "../../src/sim/time.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";

describe("autonomous planet formation", () => {
  beforeEach(() => clearSimulationStages());

  it("starts as deterministic dust without oceans, oxygen, or life", () => {
    const first = createWorld(404, { width: 8, height: 8 });
    const second = createWorld(404, { width: 8, height: 8 });

    expect(first.formation).toMatchObject({ phase: "dust-cloud", progress: 0, planetaryMass: 0 });
    expect(first.fields.water.values.every((value) => value === 0)).toBe(true);
    expect(first.chemistry.oxygen.values.every((value) => value === 0)).toBe(true);
    expect(first.species).toEqual([]);
    expect(worldDigest(first)).toBe(worldDigest(second));
  });

  it("forms coherent spherical terrain without longitude seams or split poles", () => {
    const width = 96;
    const height = 48;
    const values = Array.from({ length: width * height }, (_, index) =>
      formedElevation(42, index % width, Math.floor(index / width), width, height));
    const horizontalDifferences: number[] = [];
    for (let y = 0; y < height; y += 1) {
      expect(formedElevation(42, 0, y, width, height)).toBeCloseTo(formedElevation(42, width, y, width, height), 12);
      for (let x = 1; x < width; x += 1) {
        horizontalDifferences.push(Math.abs(values[y * width + x]! - values[y * width + x - 1]!));
      }
    }
    const northPole = Array.from({ length: width }, (_, x) => formedElevation(42, x, 0, width, height));
    const southPole = Array.from({ length: width }, (_, x) => formedElevation(42, x, height - 1, width, height));
    const oceanFraction = values.filter((value) => value < 0.48).length / values.length;
    const averageDifference = horizontalDifferences.reduce((sum, value) => sum + value, 0) / horizontalDifferences.length;

    expect(Math.max(...northPole) - Math.min(...northPole)).toBeLessThan(1e-12);
    expect(Math.max(...southPole) - Math.min(...southPole)).toBeLessThan(1e-12);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.35);
    expect(oceanFraction).toBeGreaterThan(0.2);
    expect(oceanFraction).toBeLessThan(0.8);
    expect(averageDifference).toBeGreaterThan(0.002);
    expect(averageDifference).toBeLessThan(0.04);
  });

  it("progresses through every formation milestone before climate and ecology begin", () => {
    let state = createWorld(405, { width: 8, height: 8 });
    for (let day = 0; day < FORMATION_DURATION_DAYS; day += 1) {
      state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false }).state;
      if (day < FORMATION_DURATION_DAYS - 1) {
        expect(state.fields.water.values.every((value) => value === 0)).toBe(true);
        expect(state.species).toEqual([]);
      }
    }

    expect(state.formation.phase).toBe("stable-crust");
    expect(state.formation.progress).toBe(1);
    expect(state.formation.bodyCount).toBe(1);
    expect(state.formation.coreFraction).toBeGreaterThan(0.25);
    expect(state.fields.elevation.values.some((value) => value > 0.48)).toBe(true);
    expect(state.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "protoplanetary-dust",
      "planetesimal-formation",
      "planetary-accretion",
      "core-differentiation",
      "planetary-cooling",
      "planet-formation-complete",
    ]));

    state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false }).state;
    expect(state.fields.water.values.some((value) => value > 0)).toBe(true);
  });

  it("keeps formation replay deterministic across daily steps", () => {
    const run = () => {
      let state = createWorld(406, { width: 8, height: 8 });
      for (let day = 0; day < 180; day += 1) {
        state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false }).state;
      }
      return state;
    };

    expect(worldDigest(run())).toBe(worldDigest(run()));
  });

  it("records every crossed milestone during a fast-forwarded formation step", () => {
    const state = stepWorld(createWorld(408, { width: 8, height: 8 }), { elapsedYears: 1, externalEvents: [] }).state;
    expect(state.formation.phase).toBe("stable-crust");
    expect(state.events.map((event) => event.kind)).toEqual([
      "protoplanetary-dust",
      "planetesimal-formation",
      "planetary-accretion",
      "core-differentiation",
      "planetary-cooling",
      "planet-formation-complete",
    ]);
  });

  it("materializes the first ocean milestone and does not duplicate it", () => {
    let state = createWorld(409, { width: 8, height: 8, formation: "formed" });
    state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false }).state;
    expect(state.events.some((event) => event.kind === "ocean-formation")).toBe(true);

    const before = state.events.filter((event) => event.kind === "ocean-formation").length;
    state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false }).state;
    expect(state.events.filter((event) => event.kind === "ocean-formation")).toHaveLength(before);
  });
});
