import type { WorkerMessage, WorldSnapshot } from "./protocol.ts";

const addGridBuffer = (buffers: Set<ArrayBuffer>, values: Float32Array): void => {
  if (values.buffer instanceof ArrayBuffer) buffers.add(values.buffer);
};

export const snapshotTransferables = (snapshot: WorldSnapshot): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();
  for (const grid of Object.values(snapshot.fields)) addGridBuffer(buffers, grid.values);
  for (const grid of Object.values(snapshot.chemistry)) addGridBuffer(buffers, grid.values);
  if (snapshot.foodSecurity) addGridBuffer(buffers, snapshot.foodSecurity.values);
  return [...buffers];
};

export const messageTransferables = (message: WorkerMessage): ArrayBuffer[] =>
  message.type === "snapshot" ? snapshotTransferables(message.snapshot) : [];
