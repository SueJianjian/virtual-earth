import { createSimulationRuntime } from "./runtime.ts";
import type { WorkerCommand } from "./protocol.ts";

const runtime = createSimulationRuntime();
let timer: ReturnType<typeof setInterval> | undefined;

const post = (messages: ReturnType<typeof runtime.dispatch>): void => messages.forEach((message) => self.postMessage(message));
const loopDelayFor = (speed: 1 | 4 | 16 | 64): number => speed <= 4 ? Math.floor(1000 / speed) : 100;
const stepsFor = (speed: 1 | 4 | 16 | 64): number => Math.max(1, Math.round(speed * loopDelayFor(speed) / 1000));
const startLoop = (): void => {
  if (timer !== undefined) clearInterval(timer);
  const speed = runtime.getSpeed();
  timer = setInterval(() => {
    if (!runtime.isPaused()) post(runtime.dispatch({ type: "step", count: stepsFor(speed) }));
  }, loopDelayFor(speed));
};

self.onmessage = (event: MessageEvent<WorkerCommand>): void => {
  const messages = runtime.dispatch(event.data);
  if (event.data.type === "pause" && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  } else if (event.data.type === "start" || event.data.type === "setSpeed") {
    startLoop();
  }
  post(messages);
};
