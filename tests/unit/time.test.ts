import { describe, expect, it } from "vitest";
import {
  DAYS_PER_YEAR,
  REAL_MILLISECONDS_PER_SIMULATED_DAY,
  SIMULATED_YEARS_PER_DAY,
  simulationAgeFromYears,
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
});
