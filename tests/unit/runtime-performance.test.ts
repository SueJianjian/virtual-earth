import { describe, expect, it } from "vitest";
import { RUNTIME_PERFORMANCE_WINDOW_STEPS, RuntimePerformanceTracker } from "../../src/worker/performance.ts";

describe("runtime performance tracker", () => {
  it("keeps a fixed recent window and reports degradation against its first complete window", () => {
    const tracker = new RuntimePerformanceTracker();

    for (let index = 0; index < RUNTIME_PERFORMANCE_WINDOW_STEPS; index += 1) tracker.record(2);
    expect(tracker.diagnostics()).toMatchObject({
      recentWindowSteps: RUNTIME_PERFORMANCE_WINDOW_STEPS,
      recentAverageStepMs: 2,
      recentP95StepMs: 2,
      recentSlowStepCount: 0,
      baselineStepMs: 2,
      recentStepCostRatio: 1,
    });

    for (let index = 0; index < RUNTIME_PERFORMANCE_WINDOW_STEPS; index += 1) tracker.record(8);
    expect(tracker.diagnostics()).toMatchObject({
      recentWindowSteps: RUNTIME_PERFORMANCE_WINDOW_STEPS,
      recentAverageStepMs: 8,
      recentP95StepMs: 8,
      recentSlowStepCount: RUNTIME_PERFORMANCE_WINDOW_STEPS,
      baselineStepMs: 2,
      recentStepCostRatio: 4,
    });
  });

  it("normalizes invalid samples and resets its comparison baseline", () => {
    const tracker = new RuntimePerformanceTracker();
    tracker.record(Number.NaN);
    tracker.record(-4);

    expect(tracker.diagnostics()).toMatchObject({
      recentWindowSteps: 2,
      recentAverageStepMs: 0,
      recentP95StepMs: 0,
      recentSlowStepCount: 0,
      baselineStepMs: 0,
      recentStepCostRatio: 1,
    });

    tracker.reset();
    expect(tracker.diagnostics()).toMatchObject({
      recentWindowSteps: 0,
      recentAverageStepMs: 0,
      baselineStepMs: 0,
      recentStepCostRatio: 1,
    });
  });
});
