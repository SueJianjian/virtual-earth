export type FrameScheduler = (callback: () => void) => void;

const browserFrameScheduler: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 0);
};

/** Coalesces bursts of UI work while retaining the newest value. */
export const createLatestOnlyRenderer = <T>(
  render: (value: T) => void,
  schedule: FrameScheduler = browserFrameScheduler,
): { enqueue: (value: T) => void; flush: () => void } => {
  let pending: T | undefined;
  let scheduled = false;
  let scheduleVersion = 0;

  const flush = (): void => {
    scheduled = false;
    if (pending === undefined) return;
    const next = pending;
    pending = undefined;
    render(next);
  };

  return {
    enqueue: (value: T): void => {
      pending = value;
      if (scheduled) return;
      scheduled = true;
      const version = ++scheduleVersion;
      schedule(() => {
        if (version !== scheduleVersion) return;
        flush();
      });
    },
    flush: (): void => {
      if (!scheduled && pending === undefined) return;
      scheduleVersion += 1;
      flush();
    },
  };
};
