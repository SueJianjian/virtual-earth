import type { WorkerClient, WorkerCommand, WorkerMessage } from "./protocol.ts";

const endpoint = (serverUrl: string, path: string): string => {
  const base = new URL(serverUrl);
  const target = new URL(path, `${base.origin}/`);
  const token = base.searchParams.get("token");
  if (token) target.searchParams.set("token", token);
  return target.toString();
};

export const createRemoteClient = (serverUrl: string): WorkerClient => {
  const listeners = new Set<(message: WorkerMessage) => void>();
  const emit = (message: WorkerMessage): void => listeners.forEach((listener) => listener(message));
  const stream = new EventSource(endpoint(serverUrl, "/api/stream"));
  stream.onmessage = (event) => {
    try { emit(JSON.parse(event.data) as WorkerMessage); }
    catch { emit({ type: "error", code: "remote-protocol", message: "服务器返回了无法解析的消息" }); }
  };
  stream.onerror = () => emit({ type: "error", code: "remote-connection", message: "服务器连接中断，正在等待重连" });
  return {
    send: (command: WorkerCommand): void => {
      void fetch(endpoint(serverUrl, "/api/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }).then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          emit({ type: "error", code: "remote-command", message: body.error ?? `服务器命令失败（${response.status}）` });
        }
      }).catch(() => emit({ type: "error", code: "remote-command", message: "无法发送服务器命令" }));
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
};
