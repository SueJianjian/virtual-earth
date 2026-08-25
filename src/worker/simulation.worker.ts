import { createSimulationRuntime } from "./runtime.ts";
import type { WorkerCommand } from "./protocol.ts";

const runtime = createSimulationRuntime();
let timer: ReturnType<typeof setInterval> | undefined;

const post = (messages: ReturnType<typeof runtime.dispatch>): void => messages.forEach((message) => self.postMessage(message));
const startLoop = (): void => {
  if (timer !== undefined) clearInterval(timer);
  timer = setInterval(() => {
    if (!runtime.isPaused()) post(runtime.dispatch({ type: "step", count: 1 }));
  }, Math.max(16, Math.floor(1000 / runtime.getSpeed())));
};

self.onmessage = (event: MessageEvent<WorkerCommand>): void => {
  if (event.data.type === "start" || event.data.type === "setSpeed") startLoop();
  post(runtime.dispatch(event.data));
};
