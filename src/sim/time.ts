export const DAYS_PER_YEAR = 365;
export const SIMULATED_YEARS_PER_DAY = 1 / DAYS_PER_YEAR;
export const REAL_MILLISECONDS_PER_SIMULATED_DAY = 60_000;

export type SimulationAge = {
  totalDays: number;
  years: number;
  days: number;
};

export const simulationAgeFromYears = (elapsedYears: number): SimulationAge => {
  const totalDays = Math.max(0, Math.round(elapsedYears * DAYS_PER_YEAR));
  return {
    totalDays,
    years: Math.floor(totalDays / DAYS_PER_YEAR),
    days: totalDays % DAYS_PER_YEAR,
  };
};

export const wholeYearsCrossed = (elapsedYears: number, stepYears: number): number => {
  const beforeDays = Math.max(0, Math.round(elapsedYears * DAYS_PER_YEAR));
  const afterDays = Math.max(beforeDays, Math.round((elapsedYears + Math.max(0, stepYears)) * DAYS_PER_YEAR));
  return Math.floor(afterDays / DAYS_PER_YEAR) - Math.floor(beforeDays / DAYS_PER_YEAR);
};
