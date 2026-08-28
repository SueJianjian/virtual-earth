import { describe, expect, it } from "vitest";
import { createLatestOnlyQueue } from "../../src/persistence/queue.ts";

const deferred = <T = void>(): { promise: Promise<T>; resolve(value: T): void } => {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((next) => { resolve = next; }), resolve };
};

describe("latest-only persistence queue", () => {
  it("keeps only the newest checkpoint while an earlier write is in progress", async () => {
    const queue = createLatestOnlyQueue();
    const first = deferred();
    const started: string[] = [];
    const completed: string[] = [];

    queue.enqueue(async () => {
      started.push("first");
      await first.promise;
      completed.push("first");
    });
    expect(started).toEqual(["first"]);

    queue.enqueue(async () => { started.push("stale"); completed.push("stale"); });
    queue.enqueue(async () => { started.push("latest"); completed.push("latest"); });
    const flushed = queue.flush();

    first.resolve();
    await flushed;

    expect(started).toEqual(["first", "latest"]);
    expect(completed).toEqual(["first", "latest"]);
  });

  it("continues with later checkpoints after a storage operation fails", async () => {
    const queue = createLatestOnlyQueue();
    const completed: string[] = [];

    queue.enqueue(async () => { throw new Error("storage unavailable"); });
    queue.enqueue(async () => { completed.push("recovered"); });
    await queue.flush();

    expect(completed).toEqual(["recovered"]);
  });
});
