import type { WorkerClient, WorkerCommand, WorkerMessage } from "./protocol.ts";

export const createWorkerClient = (): WorkerClient => {
  const worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
  const listeners = new Set<(message: WorkerMessage) => void>();
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => listeners.forEach((listener) => listener(event.data));
  return {
    send: (command: WorkerCommand) => worker.postMessage(command),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
};
