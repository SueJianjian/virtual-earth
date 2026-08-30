import { describe, expect, it } from "vitest";
import { calculateClimate, initializeEnvironment } from "../../src/sim/environment/index.ts";
import {
  MOON_TO_PLANET_MASS_RATIO,
  createOrbitalState,
  isLunarState,
  isOrbitalState,
  lunarDirectionAt,
  lunarDistanceScaleAt,
  lunarStateAtDays,
  lunarStateForWorld,
  moonPositionAt,
  moonSemiMajorAxisInPlanetRadii,
  orbitalStateAtDays,
  planetMoonBarycentricPositionsAt,
  planetPositionAt,
  planetRotationPhaseAt,
  planetSemiMajorAxisInPlanetRadii,
  solarAltitudeFor,
  solarDirectionFor,
  starDirectionFromPlanetAt,
  stellarSystemPositionsAt,
} from "../../src/sim/environment/orbit.ts";
import { SIMULATED_YEARS_PER_DAY } from "../../src/sim/time.ts";
import { createWorld } from "../../src/sim/world.ts";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { stepWorld } from "../../src/sim/engine.ts";

describe("autonomous orbital and seasonal forcing", () => {
  it("derives deterministic but seed-specific orbital parameters", () => {
    const first = createOrbitalState(701);
    const second = createOrbitalState(701);
    const alternate = createOrbitalState(702);

    expect(first).toEqual(second);
    expect(first).not.toEqual(alternate);
    expect(isOrbitalState(first)).toBe(true);
    expect(first.orbitalPeriodDays).toBeGreaterThanOrEqual(365);
    expect(first.orbitalPeriodDays).toBeLessThan(486);
    expect(first.eccentricity).toBeGreaterThanOrEqual(0);
    expect(first.eccentricity).toBeLessThan(0.25);
  });

  it("makes opposite hemispheres respond to the same season in opposite directions", () => {
    const state = initializeEnvironment(createWorld(703, { width: 16, height: 8, formation: "formed" }));
    const summer = calculateClimate({ ...state, timeline: { step: "91", days: "91" } });
    const winter = calculateClimate({ ...state, timeline: { step: "273", days: "273" } });
    const north = 0;
    const south = (state.fields.elevation.height - 1) * state.fields.elevation.width;

    expect(summer.temperature[north]).toBeGreaterThan(winter.temperature[north]!);
    expect(summer.temperature[south]).toBeLessThan(winter.temperature[south]!);
  });

  it("keeps orbital phase exact for remote-era decimal clocks", () => {
    const parameters = createOrbitalState(704);
    const edge = String(Number.MAX_SAFE_INTEGER);
    const next = (BigInt(edge) + 1n).toString();
    const before = orbitalStateAtDays(parameters, edge);
    const after = orbitalStateAtDays(parameters, next);

    expect(after.seasonalPhase).not.toBe(before.seasonalPhase);
    expect(after.orbitalPhase).not.toBe(before.orbitalPhase);
    expect(isOrbitalState(after)).toBe(true);
  });

  it("commits the orbital state at the same exact day as the climate step", () => {
    const state = createWorld(705, { width: 8, height: 8, formation: "formed" });
    const next = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false }).state;

    expect(next.timeline).toEqual({ step: "1", days: "1" });
    expect(next.orbital.seasonalPhase).toBeCloseTo(1 / next.orbital.orbitalPeriodDays, 12);
    expect(next.orbital.season).toBe("spring");
    expect(next.fields.temperature.values.some((value) => value > 0)).toBe(true);
  });

  it("restores orbital parameters and upgrades legacy saves without them", () => {
    const state = createWorld(706, { width: 8, height: 8, formation: "formed" });
    const restored = deserializeWorld(serializeWorld(state));
    expect(restored.orbital).toEqual(state.orbital);

    const legacy = JSON.parse(serializeWorld(state)) as { world: Record<string, unknown> };
    delete legacy.world.orbital;
    const upgraded = deserializeWorld(JSON.stringify(legacy));
    expect(upgraded.orbital).toEqual(state.orbital);

    const longPeriodLegacy = JSON.parse(serializeWorld(state)) as { world: { orbital: { orbitalPeriodDays: number } } };
    longPeriodLegacy.world.orbital.orbitalPeriodDays = 365 * 205;
    const migrated = deserializeWorld(JSON.stringify(longPeriodLegacy));
    expect(migrated.orbital).toEqual(state.orbital);
  });

  it("derives a deterministic satellite only from the formed world's exact clock", () => {
    const world = createWorld(707, { width: 8, height: 8, formation: "formed" });
    const first = lunarStateForWorld(world);
    const second = lunarStateForWorld(world);
    const next = lunarStateAtDays(first, String(first.orbitalPeriodDays), world.orbital.orbitalPhase, world.orbital.periapsisPhase);

    expect(first).toEqual(second);
    expect(isLunarState(first)).toBe(true);
    expect(first.orbitalPeriodDays).toBeGreaterThanOrEqual(22);
    expect(first.orbitalPeriodDays).toBeLessThan(42);
    expect(next.orbitalPhase).toBeCloseTo(first.orbitalPhase, 12);
    expect(lunarDirectionAt(first)).toHaveLength(3);
    expect(lunarDistanceScaleAt(first)).toBeGreaterThan(0.8);
    expect(lunarDistanceScaleAt(first)).toBeLessThan(1.2);
  });

  it("moves the sun through a complete daily arc and keeps its direction normalized", () => {
    const orbital = createOrbitalState(708);
    const midnight = solarAltitudeFor(orbital, 0);
    const noon = solarAltitudeFor(orbital, 0.5);
    const direction = solarDirectionFor(orbital, 0.27);
    const length = Math.hypot(direction[0], direction[1], direction[2]);

    expect(midnight).toBeLessThan(0);
    expect(noon).toBeGreaterThan(0.9);
    expect(length).toBeCloseTo(1, 12);
  });

  it("keeps the central star fixed while the planet and moon use nested orbits", () => {
    const world = createWorld(709, { width: 8, height: 8, formation: "formed" });
    const orbital = world.orbital;
    const lunar = lunarStateForWorld(world);
    const planet = planetPositionAt(orbital);
    const starDirection = starDirectionFromPlanetAt(orbital);
    const planetDistance = Math.hypot(...planet);
    const moon = moonPositionAt(lunar);

    expect(planetDistance).toBeGreaterThan(0);
    expect(Math.hypot(...starDirection)).toBeCloseTo(1, 12);
    expect(starDirection[0]).toBeCloseTo(-planet[0] / planetDistance, 12);
    expect(starDirection[2]).toBeCloseTo(-planet[2] / planetDistance, 12);
    expect(Math.hypot(...moon)).toBeCloseTo(lunarDistanceScaleAt(lunar), 12);
  });

  it("uses physical radii and a shared planet-moon barycenter at both observation scales", () => {
    const world = createWorld(711, { width: 8, height: 8, formation: "formed" });
    const lunar = lunarStateForWorld(world);
    const local = planetMoonBarycentricPositionsAt(lunar);
    const system = stellarSystemPositionsAt(world.orbital, lunar);
    const lunarDistance = Math.hypot(
      local.moon[0] - local.planet[0],
      local.moon[1] - local.planet[1],
      local.moon[2] - local.planet[2],
    );

    expect(system.star).toEqual([0, 0, 0]);
    expect(Math.hypot(...system.barycenter)).toBeCloseTo(
      Math.hypot(...planetPositionAt(world.orbital)) * planetSemiMajorAxisInPlanetRadii(world.orbital),
      8,
    );
    expect(lunarDistance).toBeCloseTo(
      lunarDistanceScaleAt(lunar) * moonSemiMajorAxisInPlanetRadii(lunar),
      8,
    );
    for (let axis = 0; axis < 3; axis += 1) {
      expect(local.planet[axis]! + local.moon[axis]! * MOON_TO_PLANET_MASS_RATIO).toBeCloseTo(0, 10);
    }
    expect(stellarSystemPositionsAt(world.orbital, lunar, world.orbital.orbitalPhase + 0.25).planet)
      .not.toEqual(system.planet);
    expect(planetMoonBarycentricPositionsAt(lunar, lunar.orbitalPhase + 0.25).moon)
      .not.toEqual(local.moon);
  });

  it("derives axial rotation from exact world days and the seeded rotation period", () => {
    const orbital = createOrbitalState(710);
    const edge = String(Number.MAX_SAFE_INTEGER);
    const next = (BigInt(edge) + 1n).toString();
    const beforePhase = planetRotationPhaseAt(orbital, edge);
    const afterPhase = planetRotationPhaseAt(orbital, next);

    expect(beforePhase).toBeGreaterThanOrEqual(0);
    expect(beforePhase).toBeLessThan(1);
    expect(afterPhase).toBeGreaterThanOrEqual(0);
    expect(afterPhase).toBeLessThan(1);
    expect(afterPhase).not.toBe(beforePhase);
  });
});
