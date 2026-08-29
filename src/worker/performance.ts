export const RUNTIME_PERFORMANCE_WINDOW_STEPS = 120;

export type RuntimePerformanceWindow = {
  recentWindowSteps: number;
  recentAverageStepMs: number;
  recentP95StepMs: number;
  recentSlowStepCount: number;
  baselineStepMs: number;
  recentStepCostRatio: number;
};

const normalizedDuration = (durationMs: number): number =>
  Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
};

/**
 * Keeps runtime timing telemetry bounded so an arbitrarily long simulation
 * can still report whether recently executed steps are becoming more costly.
 */
export class RuntimePerformanceTracker {
  private durations: number[] = [];
  private nextIndex = 0;
  private baselineStepMs = 0;

  private recentAverage(): number {
    return this.durations.length === 0
      ? 0
      : this.durations.reduce((total, duration) => total + duration, 0) / this.durations.length;
  }

  record(durationMs: number): void {
    const duration = normalizedDuration(durationMs);
    if (this.durations.length < RUNTIME_PERFORMANCE_WINDOW_STEPS) {
      this.durations.push(duration);
      if (this.durations.length === RUNTIME_PERFORMANCE_WINDOW_STEPS) this.baselineStepMs = this.recentAverage();
      return;
    }
    this.durations[this.nextIndex] = duration;
    this.nextIndex = (this.nextIndex + 1) % RUNTIME_PERFORMANCE_WINDOW_STEPS;
  }

  reset(): void {
    this.durations = [];
    this.nextIndex = 0;
    this.baselineStepMs = 0;
  }

  diagnostics(): RuntimePerformanceWindow {
    const recentWindowSteps = this.durations.length;
    const recentAverageStepMs = this.recentAverage();
    const referenceStepMs = this.baselineStepMs || recentAverageStepMs;
    const slowStepThresholdMs = referenceStepMs > 0 ? referenceStepMs * 2 : 4;
    return {
      recentWindowSteps,
      recentAverageStepMs,
      recentP95StepMs: percentile(this.durations, 0.95),
      recentSlowStepCount: this.durations.filter((duration) => duration > slowStepThresholdMs).length,
      baselineStepMs: this.baselineStepMs,
      recentStepCostRatio: this.baselineStepMs > 0 ? recentAverageStepMs / this.baselineStepMs : 1,
    };
  }
}
