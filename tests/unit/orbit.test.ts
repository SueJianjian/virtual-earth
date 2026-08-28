import { describe, expect, it } from "vitest";
import { calculateClimate, initializeEnvironment } from "../../src/sim/environment/index.ts";
import { createOrbitalState, isOrbitalState, orbitalStateAtDays } from "../../src/sim/environment/orbit.ts";
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
    expect(first.orbitalPeriodDays).toBeGreaterThan(365);
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
    expect(next.orbital.seasonalPhase).toBeCloseTo(1 / 365, 12);
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
  });
});
