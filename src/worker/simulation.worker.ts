import { createSimulationRuntime } from "./runtime.ts";
import type { WorkerCommand } from "./protocol.ts";
import { messageTransferables } from "./transfer.ts";
import { scheduledStepBatch, simulationStepIntervalMs } from "./scheduler.ts";

const runtime = createSimulationRuntime();
let timer: ReturnType<typeof setTimeout> | undefined;
let nextStepAtMs: number | undefined;

const workerScope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };
const post = (messages: ReturnType<typeof runtime.dispatch>): void => messages.forEach((message) => {
  workerScope.postMessage(message, messageTransferables(message));
});
const stopLoop = (): void => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  nextStepAtMs = undefined;
};
const startLoop = (): void => {
  stopLoop();
  nextStepAtMs = performance.now() + simulationStepIntervalMs(runtime.getSpeed());
  const scheduleNext = (): void => {
    if (runtime.isPaused() || nextStepAtMs === undefined) return;
    const delay = Math.max(0, nextStepAtMs - performance.now());
    timer = setTimeout(() => {
      timer = undefined;
      if (runtime.isPaused() || nextStepAtMs === undefined) return;
      const scheduled = scheduledStepBatch(performance.now(), nextStepAtMs, runtime.getSpeed());
      if (scheduled.count === 0) {
        scheduleNext();
        return;
      }
      nextStepAtMs = scheduled.nextStepAtMs;
      const messages = runtime.dispatch({ type: "step", count: scheduled.count });
      if (messages.some((message) => message.type === "error")) {
        stopLoop();
        post(messages);
        return;
      }
      post(messages);
      scheduleNext();
    }, delay);
  };
  scheduleNext();
};

self.onmessage = (event: MessageEvent<WorkerCommand>): void => {
  const messages = runtime.dispatch(event.data);
  if (messages.some((message) => message.type === "error")) {
    stopLoop();
  } else if (event.data.type === "pause" || event.data.type === "reset") {
    stopLoop();
  } else if (event.data.type === "start" || event.data.type === "setSpeed") {
    startLoop();
  }
  post(messages);
};
