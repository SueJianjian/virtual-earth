import { describe, expect, it } from "vitest";
import { MAX_SCHEDULED_STEP_BATCH, scheduledStepBatch, simulationStepIntervalMs } from "../../src/worker/scheduler.ts";

describe("worker simulation scheduler", () => {
  it("preserves the configured real-time day ratio at every speed", () => {
    expect(simulationStepIntervalMs(1)).toBe(60_000);
    expect(simulationStepIntervalMs(4)).toBe(15_000);
    expect(simulationStepIntervalMs(16)).toBe(3_750);
    expect(simulationStepIntervalMs(64)).toBe(937.5);
  });

  it("advances deadlines instead of adding compute time to the interval", () => {
    const scheduled = scheduledStepBatch(1_250, 1_000, 1);
    expect(scheduled).toEqual({ count: 1, nextStepAtMs: 61_000 });
  });

  it("batches overdue days and drops unbounded wall-clock debt", () => {
    const interval = simulationStepIntervalMs(64);
    expect(scheduledStepBatch(1_000 + interval * 3.4, 1_000, 64)).toEqual({
      count: 4,
      nextStepAtMs: 1_000 + interval * 4,
    });
    const resumedAt = 1_000 + interval * 100;
    expect(scheduledStepBatch(resumedAt, 1_000, 64)).toEqual({
      count: MAX_SCHEDULED_STEP_BATCH,
      nextStepAtMs: resumedAt + interval,
    });
    expect(scheduledStepBatch(999, 1_000, 64)).toEqual({ count: 0, nextStepAtMs: 1_000 });
  });
});
