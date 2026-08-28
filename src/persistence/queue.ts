export type PersistenceOperation = () => Promise<void>;

export type LatestOnlyQueue = {
  enqueue(operation: PersistenceOperation): void;
  flush(): Promise<void>;
};

/** Runs writes serially while discarding superseded queued checkpoints. */
export const createLatestOnlyQueue = (): LatestOnlyQueue => {
  let pending: PersistenceOperation | undefined;
  let active = false;
  let idle = Promise.resolve();
  let resolveIdle: (() => void) | undefined;

  const run = async (): Promise<void> => {
    while (pending) {
      const operation = pending;
      pending = undefined;
      try {
        await operation();
      } catch {
        // A storage failure is reported by the operation and must not block later checkpoints.
      }
    }
    active = false;
    resolveIdle?.();
    resolveIdle = undefined;
  };

  return {
    enqueue: (operation) => {
      pending = operation;
      if (active) return;
      active = true;
      idle = new Promise<void>((resolve) => { resolveIdle = resolve; });
      void run();
    },
    flush: () => idle,
  };
};
