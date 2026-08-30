import { describe, expect, it } from "vitest";
import { createLatestOnlyRenderer, type FrameScheduler } from "../../src/ui/render-coordinator.ts";

const createManualScheduler = (): { schedule: FrameScheduler; run: () => void; scheduledCount: () => number } => {
  const callbacks: Array<() => void> = [];
  return {
    schedule: (callback) => { callbacks.push(callback); },
    run: () => callbacks.shift()?.(),
    scheduledCount: () => callbacks.length,
  };
};

describe("latest-only render coordinator", () => {
  it("renders only the newest value from a burst", () => {
    const scheduler = createManualScheduler();
    const rendered: number[] = [];
    const coordinator = createLatestOnlyRenderer((value: number) => rendered.push(value), scheduler.schedule);

    coordinator.enqueue(1);
    coordinator.enqueue(2);
    coordinator.enqueue(3);

    expect(scheduler.scheduledCount()).toBe(1);
    expect(rendered).toEqual([]);
    scheduler.run();
    expect(rendered).toEqual([3]);
  });

  it("flushes the newest value immediately and does not duplicate it", () => {
    const scheduler = createManualScheduler();
    const rendered: number[] = [];
    const coordinator = createLatestOnlyRenderer((value: number) => rendered.push(value), scheduler.schedule);

    coordinator.enqueue(7);
    coordinator.flush();
    expect(rendered).toEqual([7]);

    scheduler.run();
    expect(rendered).toEqual([7]);
  });

  it("schedules a new frame after an immediate flush", () => {
    const scheduler = createManualScheduler();
    const rendered: number[] = [];
    const coordinator = createLatestOnlyRenderer((value: number) => rendered.push(value), scheduler.schedule);

    coordinator.enqueue(4);
    coordinator.flush();
    coordinator.enqueue(5);
    expect(scheduler.scheduledCount()).toBe(2);

    scheduler.run();
    expect(rendered).toEqual([4]);
    scheduler.run();
    expect(rendered).toEqual([4, 5]);
  });
});
