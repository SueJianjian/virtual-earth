import { REAL_MILLISECONDS_PER_SIMULATED_DAY } from "../sim/time.ts";

export type SimulationSpeed = 1 | 4 | 16 | 64;
export const MAX_SCHEDULED_STEP_BATCH = 8;

export const simulationStepIntervalMs = (speed: SimulationSpeed): number =>
  REAL_MILLISECONDS_PER_SIMULATED_DAY / speed;

export const scheduledStepBatch = (
  nowMs: number,
  nextStepAtMs: number,
  speed: SimulationSpeed,
  maxBatch = MAX_SCHEDULED_STEP_BATCH,
): { count: number; nextStepAtMs: number } => {
  const interval = simulationStepIntervalMs(speed);
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextStepAtMs) || nowMs < nextStepAtMs) {
    return { count: 0, nextStepAtMs };
  }
  const due = Math.floor((nowMs - nextStepAtMs) / interval) + 1;
  const count = Math.max(1, Math.min(Math.max(1, Math.trunc(maxBatch)), due));
  return { count, nextStepAtMs: nextStepAtMs + count * interval };
};
