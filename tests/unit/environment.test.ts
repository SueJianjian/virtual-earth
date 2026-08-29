import { describe, expect, it } from "vitest";
import { applyEnvironmentDelta, applyNaturalHazardWaterEffects, calculateClimate, initializeEnvironment, MAX_NATURAL_HAZARDS_PER_STEP, naturalHazardDelta, stepEnvironment } from "../../src/sim/environment/index.ts";
import { projectChemistry } from "../../src/sim/environment/chemistry.ts";
import { simulateWater, totalWater } from "../../src/sim/environment/hydrology.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { createTectonicState, isTectonicState, MAX_TECTONIC_EVENTS_PER_STEP, MAX_TECTONIC_PLATES, MIN_TECTONIC_PLATES, stepTectonics } from "../../src/sim/environment/geology.ts";
import { calculateAtmosphere, createAtmosphereState, isAtmosphereState } from "../../src/sim/environment/atmosphere.ts";
import { calculateOcean, createOceanState, isOceanState } from "../../src/sim/environment/ocean.ts";

const makeEnvironment = () => initializeEnvironment(createWorld(9, { width: 16, height: 8, formation: "formed" }));

describe("environment simulation", () => {
  it("creates deterministic seed-specific pressure, wind and precipitation fields", () => {
    const world = makeEnvironment();
    const initial = createAtmosphereState(world.seed, 16, 8);
    const first = calculateAtmosphere(initial, world.fields, world.seed, { elapsedYears: 1 });
    const replay = calculateAtmosphere(createAtmosphereState(world.seed, 16, 8), world.fields, world.seed, { elapsedYears: 1 });
    const different = calculateAtmosphere(createAtmosphereState(world.seed + 1, 16, 8), world.fields, world.seed + 1, { elapsedYears: 1 });

    expect(first).toEqual(replay);
    expect(first.pressure.values).not.toEqual(different.pressure.values);
    expect(first.pressure.values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(first.windX.values.every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(first.windY.values.every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(first.precipitation.values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(isAtmosphereState(first, 16, 8)).toBe(true);
  });

  it("keeps the atmospheric pressure field continuous across the longitude seam", () => {
    const world = initializeEnvironment(createWorld(90_004, { width: 96, height: 48, formation: "formed" }));
    const atmosphere = calculateAtmosphere(world.atmosphere, world.fields, world.seed, { elapsedYears: 1 });
    const seamDifferences = Array.from({ length: 48 }, (_, y) => Math.abs(
      (atmosphere.pressure.values[y * 96] ?? 0) - (atmosphere.pressure.values[y * 96 + 95] ?? 0),
    ));

    expect(Math.max(...seamDifferences)).toBeLessThan(0.08);
  });

  it("moves ocean moisture downwind and increases rain over rising terrain", () => {
    const world = createWorld(90_003, { width: 8, height: 8, formation: "formed" });
    world.fields.temperature.values.fill(0.5);
    world.fields.humidity.values.fill(0.05);
    world.fields.water.values.fill(0);
    world.fields.elevation.values.fill(0.1);
    const row = 4 * 8;
    world.fields.humidity.values[row + 4] = 0.95;
    world.fields.water.values[row + 4] = 1;
    world.fields.elevation.values[row + 3] = 0.7;

    const atmosphere = calculateAtmosphere(
      createAtmosphereState(world.seed, 8, 8),
      world.fields,
      world.seed,
      { elapsedYears: 1 },
    );

    expect(atmosphere.windX.values[row + 3]).toBeLessThan(0);
    expect(atmosphere.precipitation.values[row + 3]).toBeGreaterThan(atmosphere.precipitation.values[row + 5] ?? 0);
  });

  it("keeps atmospheric work and state bounded for a billion-year step", () => {
    const world = makeEnvironment();
    const atmosphere = calculateAtmosphere(world.atmosphere, world.fields, world.seed, { elapsedYears: 1_000_000_000 });

    expect(Object.values(atmosphere).filter((value) => typeof value === "object" && "values" in value)).toHaveLength(4);
    expect(atmosphere.updateCount).toBe(world.atmosphere.updateCount + 1);
    expect(isAtmosphereState(atmosphere, 16, 8)).toBe(true);
  });

  it("couples ocean temperature, salinity and ice to bounded environmental inputs", () => {
    const world = makeEnvironment();
    const coldFields = structuredClone(world.fields);
    const warmFields = structuredClone(world.fields);
    coldFields.temperature.values.fill(0.2);
    warmFields.temperature.values.fill(0.8);
    const cold = calculateOcean(createOceanState(world.seed, 16, 8), coldFields, world.atmosphere, world.seed, { elapsedYears: 1 });
    const warm = calculateOcean(createOceanState(world.seed, 16, 8), warmFields, world.atmosphere, world.seed, { elapsedYears: 1 });
    const mean = (values: Float32Array): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(warm.seaTemperature.values)).toBeGreaterThan(mean(cold.seaTemperature.values));
    expect(cold.seaIce.values.some((value) => value > 0)).toBe(true);

    const dryFields = structuredClone(world.fields);
    const wetFields = structuredClone(world.fields);
    dryFields.humidity.values.fill(0);
    wetFields.humidity.values.fill(1);
    const dryAtmosphere = structuredClone(world.atmosphere);
    const wetAtmosphere = structuredClone(world.atmosphere);
    dryAtmosphere.precipitation.values.fill(0);
    wetAtmosphere.precipitation.values.fill(1);
    const dry = calculateOcean(createOceanState(world.seed, 16, 8), dryFields, dryAtmosphere, world.seed, { elapsedYears: 1 });
    const wet = calculateOcean(createOceanState(world.seed, 16, 8), wetFields, wetAtmosphere, world.seed, { elapsedYears: 1 });
    expect(mean(dry.salinity.values)).toBeGreaterThan(mean(wet.salinity.values));
    expect(isOceanState(warm, 16, 8)).toBe(true);
  });

  it("keeps ocean circulation finite for an effectively unbounded elapsed interval", () => {
    const world = makeEnvironment();
    const ocean = calculateOcean(world.ocean, world.fields, world.atmosphere, world.seed, {
      elapsedYears: 1_000_000_000,
      lastUpdatedTick: Number.MAX_SAFE_INTEGER,
      lastUpdatedYears: Number.MAX_SAFE_INTEGER,
      timelineStep: "1000000000000000000000000",
    });

    expect(ocean.updateCount).toBe(world.ocean.updateCount + 1);
    expect(ocean.lastUpdatedTick).toBe(Number.MAX_SAFE_INTEGER);
    expect(ocean.lastUpdatedYears).toBe(Number.MAX_SAFE_INTEGER);
    expect(ocean.lastUpdatedTimelineStep).toBe("1000000000000000000000000");
    expect(isOceanState(ocean, 16, 8)).toBe(true);
    expect([
      ...ocean.seaTemperature.values,
      ...ocean.salinity.values,
      ...ocean.currentX.values,
      ...ocean.currentY.values,
      ...ocean.seaIce.values,
    ].every(Number.isFinite)).toBe(true);
  });

  it("creates deterministic, seed-specific bounded tectonic plates", () => {
    const first = createTectonicState(90_001, 32, 16);
    const replay = createTectonicState(90_001, 32, 16);
    const different = createTectonicState(90_002, 32, 16);

    expect(first).toEqual(replay);
    expect(first).not.toEqual(different);
    expect(first.plates.length).toBeGreaterThanOrEqual(MIN_TECTONIC_PLATES);
    expect(first.plates.length).toBeLessThanOrEqual(MAX_TECTONIC_PLATES);
    expect(new Set(first.plates.map((plate) => plate.name)).size).toBe(first.plates.length);
    expect(first.plates.every((plate) => plate.name.endsWith(" Plate") && !/^Plate \d+$/.test(plate.name))).toBe(true);
    expect(first.plateIndex.values.every((value) => Number.isInteger(value) && value >= 0 && value < first.plates.length)).toBe(true);
    expect(first.boundaryStress.values.some((value) => value > 0)).toBe(true);
    expect(isTectonicState(first, 32, 16)).toBe(true);
  });

  it("moves plates in bounded geological intervals with traceable boundary events", () => {
    const state = makeEnvironment();
    const beforeCenters = state.tectonics.plates.map((plate) => [plate.centerX, plate.centerY]);
    const result = stepTectonics(state, 8);

    expect(result.tectonics).toBeDefined();
    expect(result.tectonics?.plates.map((plate) => [plate.centerX, plate.centerY])).not.toEqual(beforeCenters);
    expect(result.eventDrafts.length).toBeLessThanOrEqual(MAX_TECTONIC_EVENTS_PER_STEP);
    expect(result.eventDrafts.every((event) => event.kind === "tectonic-boundary-shift"
      && event.sourceIds.length === 2
      && event.sourceIds.every((id) => result.tectonics?.plates.some((plate) => plate.id === id)))).toBe(true);
    expect(result.fieldChanges).toHaveLength(state.fields.elevation.values.length * 2);
  });

  it("keeps tectonic work bounded for a billion-year simulation step", () => {
    const state = makeEnvironment();
    const result = stepTectonics(state, 1_000_000_000);

    expect(result.tectonics?.plates).toHaveLength(state.tectonics.plates.length);
    expect(result.fieldChanges).toHaveLength(state.fields.elevation.values.length * 2);
    expect(result.eventDrafts.length).toBeLessThanOrEqual(MAX_TECTONIC_EVENTS_PER_STEP);
    expect(isTectonicState(result.tectonics, 16, 8)).toBe(true);
  });

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
    expect(after.atmosphere.updateCount).toBe(state.atmosphere.updateCount + 1);
    expect(after.atmosphere.precipitation.values.some((value) => value > 0)).toBe(true);
  });

  it("advects ocean water with currents while preserving the global water total", () => {
    const calm = createWorld(90_005, { width: 8, height: 8, formation: "formed" });
    calm.fields.elevation.values.fill(0.1);
    calm.fields.water.values.fill(0);
    calm.fields.water.values[3] = 1;
    calm.fields.humidity.values.fill(1);
    calm.atmosphere.precipitation.values.fill(0);
    const moving = structuredClone(calm);
    moving.ocean.currentX.values.fill(1);
    moving.ocean.currentY.values.fill(0);

    const calmWater = simulateWater(calm, [], 1, calm.atmosphere.precipitation);
    const movingWater = simulateWater(moving, [], 1, moving.atmosphere.precipitation);
    expect(totalWater({ ...moving.fields.water, values: movingWater })).toBeCloseTo(totalWater(calm.fields.water), 6);
    expect(Array.from(movingWater)).not.toEqual(Array.from(calmWater));
    expect(movingWater[4]).toBeGreaterThan(calmWater[4] ?? 0);
  });

  it("uses bounded typed-array patches for dense environmental fields", () => {
    const state = createWorld(12, { width: 64, height: 32, formation: "formed" });
    const delta = stepEnvironment(state, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });

    expect(delta.fieldPatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "temperature", operation: "set", causeRuleId: "climate-field" }),
      expect.objectContaining({ field: "humidity", operation: "set", causeRuleId: "climate-field" }),
      expect.objectContaining({ field: "water", operation: "set", causeRuleId: "hydrology-cycle" }),
    ]));
    expect(delta.fieldPatches?.every((patch) => patch.values.length === 64 * 32)).toBe(true);
    expect(delta.chemistryPatches).toHaveLength(5);
    expect(delta.chemistryPatches?.every((patch) => patch.values.length === 64 * 32)).toBe(true);
    expect(delta.fieldChanges.length).toBeLessThan(64);
    expect(delta.chemistryChanges.length).toBeLessThan(64);

    const next = applyEnvironmentDelta(state, delta);
    expect(next.fields.temperature.values.every(Number.isFinite)).toBe(true);
    expect(Object.values(next.chemistry).every((grid) => grid.values.every(Number.isFinite))).toBe(true);
  });

  it("projects dense chemistry once without mutating its source world", () => {
    const state = makeEnvironment();
    const sourceDigest = worldDigest(state);
    const carbonPatch = new Float64Array(state.chemistry.carbon.values.length);
    carbonPatch[0] = 0.1;
    const projected = projectChemistry(state, [{
      field: "carbon",
      operation: "add",
      values: carbonPatch,
      causeRuleId: "test:carbon-patch",
    }], [{
      field: "carbon",
      index: 0,
      operation: "add",
      value: 0.2,
      causeRuleId: "test:carbon-change",
    }]);

    expect(projected).not.toBe(state.chemistry);
    expect(projected.carbon.values[0]).toBeCloseTo((state.chemistry.carbon.values[0] ?? 0) + 0.3, 6);
    expect(worldDigest(state)).toBe(sourceDigest);
  });

  it("does not copy water when a step contains no water-changing hazard", () => {
    const state = makeEnvironment();
    const water = new Float32Array(state.fields.water.values);

    expect(applyNaturalHazardWaterEffects(state, water, [])).toBe(water);
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

  it("does not recalculate a recorded environmental milestone after a later recrossing", () => {
    const state = createWorld(13, { width: 16, height: 8, formation: "formed" });
    state.fields.water.values.fill(0);
    state.eventArchive.kindCounts["ocean-formation"] = 1;

    const delta = stepEnvironment(state, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });

    expect(delta.eventDrafts.some((event) => event.kind === "ocean-formation")).toBe(false);
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

  it("keeps accumulating hazard probability beyond the old duration cap", () => {
    const state = createWorld(991, { width: 32, height: 8, formation: "formed" });
    state.fields.elevation.values.fill(0.05);
    state.fields.temperature.values.fill(0.95);
    state.fields.humidity.values.fill(0.04);
    state.fields.water.values.fill(0.04);
    state.fields.nutrients.values.fill(0.4);

    const atTwentyThousandYears = naturalHazardDelta(state, 20_000);
    const beyondTwentyThousandYears = naturalHazardDelta(state, 40_000);
    const firstProbability = Math.max(...atTwentyThousandYears.hazards.map((hazard) => hazard.probability));
    const secondProbability = Math.max(...beyondTwentyThousandYears.hazards.map((hazard) => hazard.probability));

    expect(atTwentyThousandYears.hazards.length).toBeGreaterThan(0);
    expect(beyondTwentyThousandYears.hazards.length).toBeGreaterThan(0);
    expect(secondProbability).toBeGreaterThan(firstProbability);
    expect(secondProbability).toBeLessThanOrEqual(1);
  });
});
