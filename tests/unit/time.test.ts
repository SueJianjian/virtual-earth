import { describe, expect, it } from "vitest";
import {
  DAYS_PER_YEAR,
  MAX_SIMULATION_DAYS,
  advanceSimulationDays,
  advanceSimulationTimeline,
  advanceSimulationYears,
  exactSimulationDaysForWorld,
  MAX_SIMULATION_YEARS,
  REAL_MILLISECONDS_PER_SIMULATED_DAY,
  SIMULATED_YEARS_PER_DAY,
  simulationDaysFromYears,
  simulationDaysFromWorld,
  simulationAgeFromYears,
  projectedYearsAfterStep,
  timelineProjection,
  wholeYearsCrossed,
} from "../../src/sim/time.ts";

describe("simulation time scale", () => {
  it("maps one real minute to one simulated day at 1x", () => {
    expect(REAL_MILLISECONDS_PER_SIMULATED_DAY).toBe(60_000);
    expect(SIMULATED_YEARS_PER_DAY).toBe(1 / DAYS_PER_YEAR);
  });

  it("converts elapsed years into stable calendar days", () => {
    expect(simulationAgeFromYears(0)).toEqual({ totalDays: 0, years: 0, days: 0 });
    expect(simulationAgeFromYears(1 / DAYS_PER_YEAR)).toEqual({ totalDays: 1, years: 0, days: 1 });
    expect(simulationAgeFromYears(1 + 32 / DAYS_PER_YEAR)).toEqual({ totalDays: 397, years: 1, days: 32 });
  });

  it("runs annual systems only when a daily step crosses a year boundary", () => {
    expect(wholeYearsCrossed(363 / DAYS_PER_YEAR, SIMULATED_YEARS_PER_DAY)).toBe(0);
    expect(wholeYearsCrossed(364 / DAYS_PER_YEAR, SIMULATED_YEARS_PER_DAY)).toBe(1);
  });

  it("keeps daily resolution at remote calendar years", () => {
    let years = 1_000_000_000;
    for (let day = 0; day < DAYS_PER_YEAR; day += 1) years = advanceSimulationYears(years, SIMULATED_YEARS_PER_DAY);

    expect(years).toBe(1_000_000_001);
    expect(simulationDaysFromYears(years)).toBe(365_000_000_365);
    expect(MAX_SIMULATION_YEARS).toBeGreaterThan(3_000_000_000_000);
  });

  it("rejects invalid or imprecise calendar inputs", () => {
    expect(() => advanceSimulationYears(0, Number.NaN)).toThrow("Simulation step");
    expect(() => advanceSimulationYears(-1, 1)).toThrow("World time");
    expect(() => advanceSimulationYears(MAX_SIMULATION_YEARS, SIMULATED_YEARS_PER_DAY)).toThrow("precision");
  });

  it("keeps exact day increments at the edge of the supported range", () => {
    const beforeLimit = MAX_SIMULATION_DAYS - 2;
    expect(advanceSimulationDays(beforeLimit, SIMULATED_YEARS_PER_DAY)).toBe(MAX_SIMULATION_DAYS - 1);
    expect(simulationDaysFromWorld({ years: 0, simulationDays: beforeLimit })).toBe(beforeLimit);
    expect(() => advanceSimulationDays(MAX_SIMULATION_DAYS, SIMULATED_YEARS_PER_DAY)).toThrow("precision");
  });

  it("keeps advancing with an exact clock after compatibility projections saturate", () => {
    const timeline = advanceSimulationTimeline({
      step: String(Number.MAX_SAFE_INTEGER),
      days: String(MAX_SIMULATION_DAYS),
    }, SIMULATED_YEARS_PER_DAY);

    expect(timeline).toEqual({
      step: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      days: String(BigInt(MAX_SIMULATION_DAYS) + 1n),
    });
    expect(timelineProjection(timeline)).toEqual({
      tick: Number.MAX_SAFE_INTEGER,
      simulationDays: MAX_SIMULATION_DAYS,
      years: MAX_SIMULATION_YEARS,
    });
    expect(wholeYearsCrossed(0, SIMULATED_YEARS_PER_DAY, timeline.days)).toBe(0);
  });

  it("keeps exact day arithmetic available to legacy callers after saturation", () => {
    const world = {
      tick: Number.MAX_SAFE_INTEGER,
      years: MAX_SIMULATION_YEARS,
      simulationDays: MAX_SIMULATION_DAYS,
      timeline: {
        step: String(BigInt(Number.MAX_SAFE_INTEGER) + 4096n),
        days: String(BigInt(MAX_SIMULATION_DAYS) + 4096n),
      },
    };

    expect(exactSimulationDaysForWorld(world)).toBe(BigInt(MAX_SIMULATION_DAYS) + 4096n);
    expect(advanceSimulationTimeline(world.timeline, 1 / DAYS_PER_YEAR)).toEqual({
      step: String(BigInt(Number.MAX_SAFE_INTEGER) + 4097n),
      days: String(BigInt(MAX_SIMULATION_DAYS) + 4097n),
    });

    const legacyWorld = {
      tick: Number.MAX_SAFE_INTEGER,
      years: MAX_SIMULATION_YEARS,
      simulationDays: MAX_SIMULATION_DAYS + 4096,
    };
    expect(simulationDaysFromWorld(legacyWorld)).toBe(MAX_SIMULATION_DAYS);
    expect(exactSimulationDaysForWorld(legacyWorld)).toBe(BigInt(legacyWorld.simulationDays));
  });

  it("derives legacy timestamps from the exact next-step clock", () => {
    const world = {
      tick: Number.MAX_SAFE_INTEGER,
      years: MAX_SIMULATION_YEARS,
      simulationDays: MAX_SIMULATION_DAYS,
      timeline: {
        step: String(Number.MAX_SAFE_INTEGER),
        days: String(MAX_SIMULATION_DAYS),
      },
    };

    expect(projectedYearsAfterStep(world, SIMULATED_YEARS_PER_DAY)).toBe(MAX_SIMULATION_YEARS);
  });
});
