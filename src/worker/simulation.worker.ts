import { createSimulationRuntime } from "./runtime.ts";
import type { WorkerCommand } from "./protocol.ts";
import { REAL_MILLISECONDS_PER_SIMULATED_DAY } from "../sim/time.ts";

const runtime = createSimulationRuntime();
let timer: ReturnType<typeof setTimeout> | undefined;

const post = (messages: ReturnType<typeof runtime.dispatch>): void => messages.forEach((message) => self.postMessage(message));
const stopLoop = (): void => {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
};
const loopDelayFor = (speed: 1 | 4 | 16 | 64): number => REAL_MILLISECONDS_PER_SIMULATED_DAY / speed;
const startLoop = (): void => {
  stopLoop();
  const scheduleNext = (): void => {
    if (runtime.isPaused()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (runtime.isPaused()) return;
      const messages = runtime.dispatch({ type: "step", count: 1 });
      if (messages.some((message) => message.type === "error")) {
        stopLoop();
        post(messages);
        return;
      }
      post(messages);
      scheduleNext();
    }, loopDelayFor(runtime.getSpeed()));
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
