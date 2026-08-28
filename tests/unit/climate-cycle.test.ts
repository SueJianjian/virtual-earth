import { describe, expect, it } from "vitest";
import { annualClimateForLocal, advanceClimateCycle, createClimateCycleState, isClimateCycleState } from "../../src/sim/environment/cycle.ts";

const observation = (currentTimelineDays: string, targetTimelineDays: string, temperature: number, humidity = 0.5) => ({
  meanTemperature: temperature,
  meanHumidity: humidity,
  meanWater: 0.4,
  solarFlux: 1,
  currentTimelineDays,
  targetTimelineDays,
  targetTimelineStep: targetTimelineDays,
});

describe("bounded annual climate cycle", () => {
  it("accumulates daily samples and publishes a complete annual summary", () => {
    let cycle = createClimateCycleState();
    for (let day = 0; day < 365; day += 1) {
      const temperature = 0.2 + day / 365 * 0.4;
      cycle = advanceClimateCycle(cycle, observation(String(day), String(day + 1), temperature), 1);
    }

    expect(isClimateCycleState(cycle)).toBe(true);
    expect(cycle.currentYearDays).toBe(0);
    expect(cycle.lastCompleted?.sampleDays).toBe(365);
    expect(cycle.lastCompleted?.minimumTemperature).toBeCloseTo(0.2, 10);
    expect(cycle.lastCompleted?.maximumTemperature).toBeCloseTo(0.2 + 364 / 365 * 0.4, 10);
    expect(cycle.lastCompleted?.seasonalRange).toBeGreaterThan(0.39);
    expect(cycle.timelineDays).toBe("365");
  });

  it("handles a multi-million-year batch arithmetically", () => {
    const cycle = advanceClimateCycle(
      createClimateCycleState(),
      observation("0", "3650000000", 0.61, 0.72),
      3_650_000_000,
    );

    expect(cycle.currentYearDays).toBe(0);
    expect(cycle.lastCompleted).toMatchObject({
      sampleDays: 365,
      meanTemperature: 0.61,
      meanHumidity: 0.72,
      timelineDays: "3650000000",
    });
    expect(cycle.timelineDays).toBe("3650000000");
  });

  it("rebases when a legacy or remote save has a different exact clock", () => {
    const cycle = advanceClimateCycle(
      createClimateCycleState("0"),
      observation("9007199254740993", "9007199254740994", 0.58),
      1,
    );

    expect(cycle.timelineDays).toBe("9007199254740994");
    expect(cycle.currentYearDays).toBe(Number(9007199254740994n % 365n));
    expect(isClimateCycleState(cycle)).toBe(true);
  });

  it("feeds the completed year's mean back into local ecology inputs", () => {
    const cycle = createClimateCycleState();
    cycle.lastCompleted = {
      timelineStep: "365",
      timelineDays: "365",
      sampleDays: 365,
      meanTemperature: 0.6,
      meanHumidity: 0.4,
      meanWater: 0.5,
      meanSolarFlux: 1,
      minimumTemperature: 0.3,
      maximumTemperature: 0.8,
      seasonalRange: 0.5,
    };

    const climate = annualClimateForLocal(0.5, 0.5, 0.4, 0.6, cycle);
    expect(climate.temperature).toBeCloseTo(0.7, 12);
    expect(climate.humidity).toBeCloseTo(0.3, 12);
  });
});
