import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSimulationRuntime } from "../src/worker/runtime.ts";
import type { WorkerCommand, WorkerMessage } from "../src/worker/protocol.ts";
import { scheduledStepBatch, simulationStepIntervalMs } from "../src/worker/scheduler.ts";
import { deserializeWorld, serializeWorld } from "../src/persistence/serialize.ts";
import { timelineForWorld } from "../src/sim/time.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const worldPath = resolve(rootDir, process.env.VE_WORLD_PATH ?? "data/virtual-earth-world.json");
const serverToken = process.env.VE_SERVER_TOKEN;

const json = (value: unknown): string => JSON.stringify(value, (_key, nested) => {
  if (nested instanceof Float32Array) return Array.from(nested);
  return nested;
});

const runtime = await (async () => {
  try {
    const payload = await readFile(worldPath, "utf8");
    return createSimulationRuntime(deserializeWorld(payload));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`无法读取服务器存档，将创建新世界：${error instanceof Error ? error.message : String(error)}`);
    }
    return createSimulationRuntime();
  }
})();

const clients = new Set<ServerResponse>();
let latestSnapshot = (runtime.dispatch({ type: "pause" })[0] as Extract<WorkerMessage, { type: "snapshot" }>).snapshot;
let nextStepAtMs = performance.now() + simulationStepIntervalMs(runtime.getSpeed());
let timer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let shuttingDown = false;

const stopSchedule = (): void => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
};

const persist = (payload = serializeWorld(runtime.getState())): Promise<void> => {
  saveQueue = saveQueue.then(async () => {
    await mkdir(dirname(worldPath), { recursive: true });
    const temporaryPath = `${worldPath}.tmp`;
    await writeFile(temporaryPath, payload, "utf8");
    await rm(worldPath, { force: true });
    await rename(temporaryPath, worldPath);
  });
  return saveQueue;
};

const cors = (response: ServerResponse): void => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
};

const writeJson = (response: ServerResponse, statusCode: number, value: unknown): void => {
  cors(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(json(value));
};

const authorized = (request: IncomingMessage, url: URL): boolean => {
  if (!serverToken) return true;
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  return bearer === serverToken || url.searchParams.get("token") === serverToken;
};

const broadcast = (message: WorkerMessage): void => {
  if (message.type === "autosaved") return;
  const payload = `data: ${json(message)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { clients.delete(client); }
  }
};

const handleMessages = (messages: WorkerMessage[]): void => {
  for (const message of messages) {
    if (message.type === "snapshot") latestSnapshot = message.snapshot;
    if (message.type === "autosaved") void persist(message.payload);
    broadcast(message);
  }
};

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const health = () => ({
  ok: true,
  paused: runtime.isPaused(),
  speed: runtime.getSpeed(),
  tick: latestSnapshot.tick,
  years: latestSnapshot.years,
  timelineDays: latestSnapshot.timeline?.days ?? timelineForWorld(runtime.getState()).days,
  digest: latestSnapshot.digest,
  worldPath,
});

const requestHandler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  cors(response);
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (!authorized(request, url)) { writeJson(response, 401, { error: "unauthorized" }); return; }

  if (request.method === "GET" && url.pathname === "/api/health") { writeJson(response, 200, health()); return; }
  if (request.method === "GET" && url.pathname === "/api/snapshot") { writeJson(response, 200, { type: "snapshot", snapshot: latestSnapshot, paused: runtime.isPaused(), speed: runtime.getSpeed() }); return; }
  if (request.method === "GET" && url.pathname === "/api/stream") {
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
    response.write(`data: ${json({ type: "snapshot", snapshot: latestSnapshot, paused: runtime.isPaused(), speed: runtime.getSpeed() })}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/command") {
    let command: WorkerCommand;
    try { command = JSON.parse(await readBody(request)) as WorkerCommand; } catch { writeJson(response, 400, { error: "invalid-json" }); return; }
    const messages = runtime.dispatch(command);
    handleMessages(messages);
    if (command.type === "start" || command.type === "setSpeed") {
      nextStepAtMs = performance.now() + simulationStepIntervalMs(runtime.getSpeed());
      stopSchedule();
      schedule();
    }
    if (command.type === "pause" || command.type === "reset" || command.type === "load") {
      stopSchedule();
      await persist();
    }
    writeJson(response, messages.some((message) => message.type === "error") ? 400 : 200, { messages, health: health() });
    return;
  }
  writeJson(response, 404, { error: "not-found" });
};

const server = createServer((request, response) => { void requestHandler(request, response).catch((error) => writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })); });

const schedule = (): void => {
  if (shuttingDown || runtime.isPaused()) return;
  const delay = Math.max(0, nextStepAtMs - performance.now());
  timer = setTimeout(() => {
    timer = undefined;
    if (shuttingDown || runtime.isPaused()) return;
    const batch = scheduledStepBatch(performance.now(), nextStepAtMs, runtime.getSpeed());
    nextStepAtMs = batch.nextStepAtMs;
    handleMessages(runtime.dispatch({ type: "step", count: batch.count }));
    schedule();
  }, delay);
};

const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSchedule();
  await persist();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
};

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

server.listen(port, host, () => {
  handleMessages(runtime.dispatch({ type: "start" }));
  schedule();
  console.log(`虚拟地球服务器已启动：http://${host}:${port}`);
  console.log(`服务器存档：${worldPath}`);
  if (serverToken) console.log("服务器鉴权：已启用");
});
