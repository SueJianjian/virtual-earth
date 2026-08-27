import { createSimulationRuntime } from "./runtime.ts";
import type { WorkerCommand } from "./protocol.ts";
import { REAL_MILLISECONDS_PER_SIMULATED_DAY } from "../sim/time.ts";

const runtime = createSimulationRuntime();
let timer: ReturnType<typeof setInterval> | undefined;

const post = (messages: ReturnType<typeof runtime.dispatch>): void => messages.forEach((message) => self.postMessage(message));
const stopLoop = (): void => {
  if (timer === undefined) return;
  clearInterval(timer);
  timer = undefined;
};
const loopDelayFor = (speed: 1 | 4 | 16 | 64): number => REAL_MILLISECONDS_PER_SIMULATED_DAY / speed;
const startLoop = (): void => {
  stopLoop();
  const speed = runtime.getSpeed();
  timer = setInterval(() => {
    if (runtime.isPaused()) return;
    const messages = runtime.dispatch({ type: "step", count: 1 });
    if (messages.some((message) => message.type === "error")) stopLoop();
    post(messages);
  }, loopDelayFor(speed));
};

self.onmessage = (event: MessageEvent<WorkerCommand>): void => {
  const messages = runtime.dispatch(event.data);
  if (messages.some((message) => message.type === "error")) {
    stopLoop();
  } else if (event.data.type === "pause") {
    stopLoop();
  } else if (event.data.type === "start" || event.data.type === "setSpeed") {
    startLoop();
  }
  post(messages);
};
