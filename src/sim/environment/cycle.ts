import { DAYS_PER_YEAR } from "../time.ts";
import type { ClimateCycleState, ClimateYearSummary } from "../types.ts";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const decimalInteger = /^(0|[1-9]\d*)$/;

const exactDays = (value: string): bigint => {
  if (!decimalInteger.test(value)) throw new RangeError("Climate cycle timeline days must be a non-negative integer");
  return BigInt(value);
};

const dayOfYear = (timelineDays: string): number =>
  Number(exactDays(timelineDays) % BigInt(DAYS_PER_YEAR));

const emptyCycle = (timelineDays: string): ClimateCycleState => ({
  timelineDays,
  currentYearDays: 0,
  temperatureTotal: 0,
  humidityTotal: 0,
  waterTotal: 0,
  solarFluxTotal: 0,
  minimumTemperature: 1,
  maximumTemperature: 0,
});

export const createClimateCycleState = (timelineDays = "0"): ClimateCycleState => {
  exactDays(timelineDays);
  return emptyCycle(timelineDays);
};

const validSummary = (summary: ClimateYearSummary | undefined): boolean => Boolean(summary)
  && decimalInteger.test(summary!.timelineStep)
  && decimalInteger.test(summary!.timelineDays)
  && Number.isInteger(summary!.sampleDays)
  && summary!.sampleDays > 0
  && summary!.sampleDays <= DAYS_PER_YEAR
  && [
    summary!.meanTemperature,
    summary!.meanHumidity,
    summary!.meanWater,
    summary!.meanSolarFlux,
    summary!.minimumTemperature,
    summary!.maximumTemperature,
    summary!.seasonalRange,
  ].every(Number.isFinite)
  && summary!.meanTemperature >= 0
  && summary!.meanTemperature <= 1
  && summary!.meanHumidity >= 0
  && summary!.meanHumidity <= 1
  && summary!.meanWater >= 0
  && summary!.meanWater <= 1
  && summary!.meanSolarFlux >= 0.45
  && summary!.meanSolarFlux <= 1.8
  && summary!.minimumTemperature >= 0
  && summary!.minimumTemperature <= 1
  && summary!.maximumTemperature >= 0
  && summary!.maximumTemperature <= 1
  && summary!.minimumTemperature <= summary!.maximumTemperature
  && summary!.seasonalRange >= 0
  && summary!.seasonalRange <= 1;

export const isClimateCycleState = (value: unknown): value is ClimateCycleState => {
  if (!value || typeof value !== "object") return false;
  const cycle = value as Partial<ClimateCycleState>;
  if (typeof cycle.timelineDays !== "string" || !decimalInteger.test(cycle.timelineDays)) return false;
  const currentYearDays = cycle.currentYearDays;
  const temperatureTotal = cycle.temperatureTotal;
  const humidityTotal = cycle.humidityTotal;
  const waterTotal = cycle.waterTotal;
  const solarFluxTotal = cycle.solarFluxTotal;
  const minimumTemperature = cycle.minimumTemperature;
  const maximumTemperature = cycle.maximumTemperature;
  if (!Number.isInteger(currentYearDays) || currentYearDays! < 0 || currentYearDays! >= DAYS_PER_YEAR) return false;
  const totals = [temperatureTotal, humidityTotal, waterTotal, solarFluxTotal, minimumTemperature, maximumTemperature];
  const emptyCurrentYear = currentYearDays === 0
    && temperatureTotal === 0
    && humidityTotal === 0
    && waterTotal === 0
    && solarFluxTotal === 0
    && minimumTemperature === 1
    && maximumTemperature === 0;
  return totals.every((number) => typeof number === "number" && Number.isFinite(number))
    && temperatureTotal! >= 0
    && humidityTotal! >= 0
    && waterTotal! >= 0
    && solarFluxTotal! >= 0
    && minimumTemperature! >= 0
    && minimumTemperature! <= 1
    && maximumTemperature! >= 0
    && maximumTemperature! <= 1
    && (emptyCurrentYear || minimumTemperature! <= maximumTemperature! )
    && (cycle.lastCompleted === undefined || validSummary(cycle.lastCompleted));
};

export type ClimateCycleObservation = {
  meanTemperature: number;
  meanHumidity: number;
  meanWater: number;
  solarFlux: number;
  currentTimelineDays: string;
  targetTimelineDays: string;
  targetTimelineStep: string;
};

const addObservation = (
  cycle: ClimateCycleState,
  observation: ClimateCycleObservation,
  days: number,
): void => {
  if (days <= 0) return;
  cycle.currentYearDays += days;
  cycle.temperatureTotal += clamp(observation.meanTemperature, 0, 1) * days;
  cycle.humidityTotal += clamp(observation.meanHumidity, 0, 1) * days;
  cycle.waterTotal += clamp(observation.meanWater, 0, 1) * days;
  cycle.solarFluxTotal += clamp(observation.solarFlux, 0.45, 1.8) * days;
  cycle.minimumTemperature = Math.min(cycle.minimumTemperature, clamp(observation.meanTemperature, 0, 1));
  cycle.maximumTemperature = Math.max(cycle.maximumTemperature, clamp(observation.meanTemperature, 0, 1));
};

const resetCurrentYear = (cycle: ClimateCycleState): void => {
  cycle.currentYearDays = 0;
  cycle.temperatureTotal = 0;
  cycle.humidityTotal = 0;
  cycle.waterTotal = 0;
  cycle.solarFluxTotal = 0;
  cycle.minimumTemperature = 1;
  cycle.maximumTemperature = 0;
};

const summaryFromCycle = (
  cycle: ClimateCycleState,
  observation: ClimateCycleObservation,
  timelineDays: string,
): ClimateYearSummary => {
  const days = Math.max(1, cycle.currentYearDays);
  const minimumTemperature = clamp(cycle.minimumTemperature, 0, 1);
  const maximumTemperature = clamp(cycle.maximumTemperature, 0, 1);
  return {
    timelineStep: observation.targetTimelineStep,
    timelineDays,
    sampleDays: days,
    meanTemperature: clamp(cycle.temperatureTotal / days, 0, 1),
    meanHumidity: clamp(cycle.humidityTotal / days, 0, 1),
    meanWater: clamp(cycle.waterTotal / days, 0, 1),
    meanSolarFlux: clamp(cycle.solarFluxTotal / days, 0.45, 1.8),
    minimumTemperature,
    maximumTemperature,
    seasonalRange: Math.max(0, maximumTemperature - minimumTemperature),
  };
};

const summaryForConstantObservation = (
  observation: ClimateCycleObservation,
  timelineDays: string,
): ClimateYearSummary => {
  const temperature = clamp(observation.meanTemperature, 0, 1);
  return {
    timelineStep: observation.targetTimelineStep,
    timelineDays,
    sampleDays: DAYS_PER_YEAR,
    meanTemperature: temperature,
    meanHumidity: clamp(observation.meanHumidity, 0, 1),
    meanWater: clamp(observation.meanWater, 0, 1),
    meanSolarFlux: clamp(observation.solarFlux, 0.45, 1.8),
    minimumTemperature: temperature,
    maximumTemperature: temperature,
    seasonalRange: 0,
  };
};

/** Accumulate one environment sample without looping over large batch spans. */
export const advanceClimateCycle = (
  previous: ClimateCycleState | undefined,
  observation: ClimateCycleObservation,
  elapsedDays: number,
): ClimateCycleState => {
  if (!Number.isSafeInteger(elapsedDays) || elapsedDays < 0) throw new RangeError("Climate cycle elapsed days must be a non-negative safe integer");
  const currentTimelineDays = exactDays(observation.currentTimelineDays);
  const targetTimelineDays = exactDays(observation.targetTimelineDays);
  if (targetTimelineDays < currentTimelineDays) throw new RangeError("Climate cycle cannot move backwards");
  const cycle = previous && isClimateCycleState(previous)
    ? structuredClone(previous)
    : createClimateCycleState(observation.currentTimelineDays);

  // Legacy callers may move the clock directly. Rebase to the exact clock
  // instead of carrying a stale day-of-year into a new annual cycle.
  if (cycle.timelineDays !== observation.currentTimelineDays) {
    const position = dayOfYear(observation.currentTimelineDays);
    const rebased = emptyCycle(observation.currentTimelineDays);
    addObservation(rebased, observation, position);
    cycle.timelineDays = rebased.timelineDays;
    cycle.currentYearDays = rebased.currentYearDays;
    cycle.temperatureTotal = rebased.temperatureTotal;
    cycle.humidityTotal = rebased.humidityTotal;
    cycle.waterTotal = rebased.waterTotal;
    cycle.solarFluxTotal = rebased.solarFluxTotal;
    cycle.minimumTemperature = rebased.minimumTemperature;
    cycle.maximumTemperature = rebased.maximumTemperature;
  }

  let remaining = elapsedDays;
  const firstCapacity = DAYS_PER_YEAR - cycle.currentYearDays;
  if (remaining < firstCapacity) {
    addObservation(cycle, observation, remaining);
    cycle.timelineDays = observation.targetTimelineDays;
    return cycle;
  }

  addObservation(cycle, observation, firstCapacity);
  remaining -= firstCapacity;
  cycle.lastCompleted = summaryFromCycle(
    cycle,
    observation,
    (targetTimelineDays - BigInt(remaining)).toString(),
  );
  resetCurrentYear(cycle);

  const completeYears = Math.floor(remaining / DAYS_PER_YEAR);
  if (completeYears > 0) {
    const lastCompletedDays = targetTimelineDays - BigInt(remaining - completeYears * DAYS_PER_YEAR);
    cycle.lastCompleted = summaryForConstantObservation(observation, lastCompletedDays.toString());
    remaining -= completeYears * DAYS_PER_YEAR;
  }
  addObservation(cycle, observation, remaining);
  cycle.timelineDays = observation.targetTimelineDays;
  return cycle;
};

/** Shift the local climate snapshot toward the completed year's mean. */
export const annualClimateForLocal = (
  currentTemperature: number,
  currentHumidity: number,
  currentMeanTemperature: number,
  currentMeanHumidity: number,
  cycle: ClimateCycleState | undefined,
): { temperature: number; humidity: number } => {
  const summary = cycle?.lastCompleted;
  if (!summary) return { temperature: currentTemperature, humidity: currentHumidity };
  return {
    temperature: clamp(currentTemperature + summary.meanTemperature - currentMeanTemperature, 0, 1),
    humidity: clamp(currentHumidity + summary.meanHumidity - currentMeanHumidity, 0, 1),
  };
};
