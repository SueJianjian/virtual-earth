import type { SimulationTimeline } from "./types.ts";

export const DAYS_PER_YEAR = 365;
export const SIMULATED_YEARS_PER_DAY = 1 / DAYS_PER_YEAR;
export const REAL_MILLISECONDS_PER_SIMULATED_DAY = 60_000;
// The calendar keeps exact totals as decimal strings once compatibility number
// fields reach their safe-integer limit. There is no project-defined year
// horizon.
export const MAX_SIMULATION_DAYS = Number.MAX_SAFE_INTEGER;
export const MAX_SIMULATION_YEARS = MAX_SIMULATION_DAYS / DAYS_PER_YEAR;

const DECIMAL_INTEGER = /^(0|[1-9]\d*)$/;

const exactInteger = (value: string, label: string): bigint => {
  if (!DECIMAL_INTEGER.test(value)) throw new RangeError(`${label} must be a non-negative decimal integer`);
  return BigInt(value);
};

const exactNumber = (value: number, label: string): bigint => {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return BigInt(value);
};

const exactDaysFromNumericWorld = (world: { years: number; simulationDays?: number }): bigint => {
  if (!Number.isFinite(world.years) || world.years < 0) {
    throw new RangeError("World time must be a finite, non-negative number");
  }
  return world.simulationDays === undefined
    ? simulationDaysFromYearsExact(world.years, "World time")
    : exactNumber(world.simulationDays, "World time days");
};

const exactStep = (value: string | number, label = "Simulation step"): bigint => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
    return BigInt(value);
  }
  return exactInteger(value, label);
};

const safeStepNumber = (value: string | number): number | undefined => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (!DECIMAL_INTEGER.test(value)) return undefined;
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : undefined;
};

const projectedInteger = (value: bigint): number => {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : Number.MAX_SAFE_INTEGER;
};

/** Convert a finite elapsed-year input to the exact whole-day delta. */
export const simulationDaysFromYearsExact = (elapsedYears: number, label = "Simulation time"): bigint => {
  if (!Number.isFinite(elapsedYears) || elapsedYears < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`);
  }
  const totalDays = Math.round(elapsedYears * DAYS_PER_YEAR);
  if (!Number.isFinite(totalDays)) throw new RangeError(`${label} is too large to represent as a calendar interval`);
  return BigInt(totalDays);
};

export const compareSimulationSteps = (left: string, right: string): number => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) return leftNumber - rightNumber;
  if (left.length !== right.length) return left.length - right.length;
  try {
    const leftValue = exactInteger(left, "Simulation step");
    const rightValue = exactInteger(right, "Simulation step");
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
};

export const isSimulationTimeline = (value: unknown): value is SimulationTimeline => {
  if (!value || typeof value !== "object") return false;
  const timeline = value as Partial<SimulationTimeline>;
  return typeof timeline.step === "string"
    && DECIMAL_INTEGER.test(timeline.step)
    && typeof timeline.days === "string"
    && DECIMAL_INTEGER.test(timeline.days);
};

export const timelineForWorld = (world: {
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: SimulationTimeline;
}): SimulationTimeline => {
  if (world.timeline !== undefined) {
    if (!isSimulationTimeline(world.timeline)) throw new RangeError("World timeline is invalid");
    return world.timeline;
  }
  return { step: String(world.tick), days: exactDaysFromNumericWorld(world).toString() };
};

/** The exact current step. Number fields are intentionally not used here. */
export const simulationStepForWorld = (world: {
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: SimulationTimeline;
}): string => timelineForWorld(world).step;

/** The exact current day count used for calendar cycles and persistence. */
export const simulationDaysForWorld = (world: {
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: SimulationTimeline;
}): string => timelineForWorld(world).days;

/** Read the authoritative world day count without a numeric precision limit. */
export const exactSimulationDaysForWorld = (world: {
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: SimulationTimeline;
}): bigint => exactInteger(simulationDaysForWorld(world), "World timeline days");

export const nextSimulationStep = (world: {
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: SimulationTimeline;
}): string => {
  const step = timelineForWorld(world).step;
  const numericStep = Number(step);
  // The exact decimal timeline remains authoritative. Most normal simulation
  // steps are still representable as safe integers, where Number avoids a
  // repeated BigInt parse for every event created in the same year.
  if (Number.isSafeInteger(numericStep) && numericStep < Number.MAX_SAFE_INTEGER) return String(numericStep + 1);
  return (exactInteger(step, "World timeline step") + 1n).toString();
};

export const nextSimulationTick = (world: {
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: SimulationTimeline;
}): number => {
  const numericStep = Number(timelineForWorld(world).step);
  return Number.isSafeInteger(numericStep) && numericStep < Number.MAX_SAFE_INTEGER
    ? numericStep + 1
    : Number.MAX_SAFE_INTEGER;
};

export const simulationStepDistance = (
  newer: string | number,
  older: string | number,
  cap = Number.MAX_SAFE_INTEGER,
): number => {
  const newerNumber = safeStepNumber(newer);
  const olderNumber = safeStepNumber(older);
  if (newerNumber !== undefined && olderNumber !== undefined && Number.isSafeInteger(cap) && cap >= 0) {
    const distance = newerNumber - olderNumber;
    return distance <= 0 ? 0 : Math.min(cap, distance);
  }
  try {
    const distance = exactStep(newer, "Simulation step") - exactStep(older, "Simulation step");
    if (distance <= 0n) return 0;
    return distance >= BigInt(cap) ? cap : Number(distance);
  } catch {
    return cap;
  }
};

export const simulationStepModulo = (step: string | number, modulus: number): number => {
  if (!Number.isSafeInteger(modulus) || modulus <= 0) throw new RangeError("Step modulus must be a positive integer");
  const numericStep = safeStepNumber(step);
  if (numericStep !== undefined) return numericStep % modulus;
  return Number(exactStep(step, "Simulation step") % BigInt(modulus));
};

export const simulationCyclePhase = (
  totalDays: string | number,
  periodDays: number,
): number => {
  if (!Number.isSafeInteger(periodDays) || periodDays <= 0) throw new RangeError("Cycle period must be a positive integer number of days");
  const days = typeof totalDays === "number"
    ? BigInt(simulationDaysFromYears(totalDays / DAYS_PER_YEAR, "World time"))
    : exactInteger(totalDays, "Simulation days");
  return Number(days % BigInt(periodDays)) / periodDays;
};

export const simulationCycleAngle = (totalDays: string | number, periodDays: number): number =>
  simulationCyclePhase(totalDays, periodDays) * Math.PI * 2;

export const wholePeriodsCrossed = (
  currentDays: string | number,
  elapsedYears: number,
  periodYears: number,
): number => {
  if (!Number.isFinite(periodYears) || periodYears <= 0) throw new RangeError("Cycle period must be positive");
  const before = typeof currentDays === "number"
    ? exactNumber(currentDays, "World timeline days")
    : exactInteger(currentDays, "World timeline days");
  const elapsedDays = simulationDaysFromYearsExact(elapsedYears, "Simulation step");
  const periodDaysNumber = Math.round(periodYears * DAYS_PER_YEAR);
  if (!Number.isFinite(periodDaysNumber)) throw new RangeError("Cycle period is too large");
  const periodDays = BigInt(Math.max(1, periodDaysNumber));
  return Number((before + elapsedDays) / periodDays - before / periodDays);
};

export const advanceSimulationTimeline = (
  current: SimulationTimeline,
  elapsedYears: number,
): SimulationTimeline => {
  if (!isSimulationTimeline(current)) throw new RangeError("World timeline is invalid");
  const step = exactInteger(current.step, "World timeline step") + 1n;
  const days = exactInteger(current.days, "World timeline days") + simulationDaysFromYearsExact(elapsedYears, "Simulation step");
  return { step: step.toString(), days: days.toString() };
};

export const timelineProjection = (timeline: SimulationTimeline): {
  tick: number;
  simulationDays: number;
  years: number;
} => {
  const stepNumber = Number(timeline.step);
  const daysNumber = Number(timeline.days);
  const step = Number.isSafeInteger(stepNumber) ? stepNumber : Number.MAX_SAFE_INTEGER;
  const projectedDays = Number.isSafeInteger(daysNumber) ? daysNumber : MAX_SIMULATION_DAYS;
  return {
    tick: step,
    simulationDays: projectedDays,
    years: projectedDays / DAYS_PER_YEAR,
  };
};

/** Keep legacy numeric timestamps aligned with the exact next-step clock. */
export const projectedYearsAfterStep = (
  world: {
    tick: number;
    years: number;
    simulationDays?: number;
    timeline?: SimulationTimeline;
  },
  elapsedYears: number,
): number => timelineProjection(advanceSimulationTimeline(timelineForWorld(world), elapsedYears)).years;

export const simulationAgeFromDays = (totalDays: string | number): { years: string; days: number } => {
  const days = typeof totalDays === "number"
    ? exactNumber(totalDays, "Simulation days")
    : exactInteger(totalDays, "Simulation days");
  return {
    years: (days / BigInt(DAYS_PER_YEAR)).toString(),
    days: Number(days % BigInt(DAYS_PER_YEAR)),
  };
};

export type SimulationAge = {
  totalDays: number;
  years: number;
  days: number;
};

export const simulationDaysFromWorld = (world: { years: number; simulationDays?: number }): number => {
  return projectedInteger(exactDaysFromNumericWorld(world));
};

export const simulationDaysFromYears = (elapsedYears: number, label = "Simulation time"): number => {
  if (!Number.isFinite(elapsedYears) || elapsedYears < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`);
  }
  const totalDays = Math.round(elapsedYears * DAYS_PER_YEAR);
  if (!Number.isSafeInteger(totalDays) || totalDays > MAX_SIMULATION_DAYS) {
    throw new RangeError(`${label} exceeds the supported calendar precision`);
  }
  return totalDays;
};

export const advanceSimulationYears = (currentYears: number, elapsedYears: number): number => {
  const currentDays = simulationDaysFromYears(currentYears, "World time");
  return advanceSimulationDays(currentDays, elapsedYears) / DAYS_PER_YEAR;
};

export const advanceSimulationDays = (currentDays: number, elapsedYears: number): number => {
  if (!Number.isSafeInteger(currentDays) || currentDays < 0 || currentDays > MAX_SIMULATION_DAYS) {
    throw new RangeError("World time exceeds the supported calendar precision");
  }
  const elapsedDays = simulationDaysFromYears(elapsedYears, "Simulation step");
  const nextDays = currentDays + elapsedDays;
  if (!Number.isSafeInteger(nextDays) || nextDays > MAX_SIMULATION_DAYS) {
    throw new RangeError("Simulation time exceeds the supported calendar precision");
  }
  return nextDays;
};

export const simulationAgeFromYears = (elapsedYears: number): SimulationAge => {
  const totalDays = Math.max(0, Math.round(elapsedYears * DAYS_PER_YEAR));
  return {
    totalDays,
    years: Math.floor(totalDays / DAYS_PER_YEAR),
    days: totalDays % DAYS_PER_YEAR,
  };
};

export const wholeYearsCrossed = (elapsedYears: number, stepYears: number, currentDays?: number | string): number => {
  const beforeDays = currentDays === undefined
    ? simulationDaysFromYearsExact(elapsedYears, "World time")
    : typeof currentDays === "string" ? exactInteger(currentDays, "World time days") : exactNumber(currentDays, "World time days");
  const stepDays = simulationDaysFromYearsExact(stepYears, "Simulation step");
  const afterDays = beforeDays + stepDays;
  return Number(afterDays / BigInt(DAYS_PER_YEAR) - beforeDays / BigInt(DAYS_PER_YEAR));
};
