import type { WorkerMessage, WorldSnapshot } from "./protocol.ts";

const addGridBuffer = (buffers: Set<ArrayBuffer>, values: Float32Array): void => {
  if (values.buffer instanceof ArrayBuffer) buffers.add(values.buffer);
};

export const snapshotTransferables = (snapshot: WorldSnapshot): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();
  for (const grid of Object.values(snapshot.fields)) addGridBuffer(buffers, grid.values);
  for (const grid of Object.values(snapshot.chemistry)) addGridBuffer(buffers, grid.values);
  if (snapshot.tectonics) {
    addGridBuffer(buffers, snapshot.tectonics.plateIndex.values);
    addGridBuffer(buffers, snapshot.tectonics.boundaryStress.values);
    addGridBuffer(buffers, snapshot.tectonics.boundaryActivity.values);
  }
  if (snapshot.atmosphere) {
    addGridBuffer(buffers, snapshot.atmosphere.pressure.values);
    addGridBuffer(buffers, snapshot.atmosphere.windX.values);
    addGridBuffer(buffers, snapshot.atmosphere.windY.values);
    addGridBuffer(buffers, snapshot.atmosphere.precipitation.values);
  }
  if (snapshot.ocean) {
    addGridBuffer(buffers, snapshot.ocean.seaTemperature.values);
    addGridBuffer(buffers, snapshot.ocean.salinity.values);
    addGridBuffer(buffers, snapshot.ocean.currentX.values);
    addGridBuffer(buffers, snapshot.ocean.currentY.values);
    addGridBuffer(buffers, snapshot.ocean.seaIce.values);
    addGridBuffer(buffers, snapshot.ocean.dissolvedNutrients.values);
    addGridBuffer(buffers, snapshot.ocean.dissolvedOxygen.values);
    addGridBuffer(buffers, snapshot.ocean.organicCarbon.values);
    addGridBuffer(buffers, snapshot.ocean.primaryProductivity.values);
    addGridBuffer(buffers, snapshot.ocean.planktonBiomass.values);
  }
  if (snapshot.foodSecurity) addGridBuffer(buffers, snapshot.foodSecurity.values);
  if (snapshot.diseasePrevalence) addGridBuffer(buffers, snapshot.diseasePrevalence.values);
  return [...buffers];
};

export const messageTransferables = (message: WorkerMessage): ArrayBuffer[] =>
  message.type === "snapshot" ? snapshotTransferables(message.snapshot) : [];
