import type { Grid, WorldEvent, WorldState } from "../types.ts";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const total = (values: Float32Array): number => {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
};

const rebalance = (values: Float32Array, targetTotal: number): Float32Array => {
  const result = new Float32Array(values);
  const currentTotal = total(result);
  if (currentTotal <= 0 || targetTotal <= 0) {
    result.fill(targetTotal <= 0 ? 0 : targetTotal / Math.max(1, result.length));
    return result;
  }
  const scale = targetTotal / currentTotal;
  for (let index = 0; index < result.length; index += 1) {
    result[index] = clamp01((result[index] ?? 0) * scale);
  }
  return result;
};

export const totalWater = (grid: Grid): number => total(grid.values);

export const simulateWater = (
  state: WorldState,
  externalEvents: WorldEvent[] = [],
): Float32Array => {
  const { water, humidity, elevation } = state.fields;
  const next = new Float32Array(water.values.length);
  let explicitTransfer = 0;
  for (const event of externalEvents) {
    if (event.kind === "add-water" || event.kind === "flood") {
      explicitTransfer += Math.max(0, Number(event.payload.amount ?? event.probability));
    }
    if (event.kind === "drought") {
      explicitTransfer -= Math.max(0, Number(event.payload.amount ?? event.probability));
    }
  }
  const targetTotal = Math.max(0, total(water.values) + explicitTransfer);
  for (let index = 0; index < water.values.length; index += 1) {
    const x = index % water.width;
    const y = Math.floor(index / water.width);
    const waterValue = water.values[index] ?? 0;
    const humidityValue = humidity.values[index] ?? 0;
    const elevationValue = elevation.values[index] ?? 0;
    const neighborIndices = [
      y > 0 ? index - water.width : index,
      y + 1 < water.height ? index + water.width : index,
      y * water.width + (x + water.width - 1) % water.width,
      y * water.width + (x + 1) % water.width,
    ];
    const neighborWater = neighborIndices.reduce((sum, neighbor) => sum + (water.values[neighbor] ?? waterValue), 0) / neighborIndices.length;
    const neighborElevation = neighborIndices.reduce((sum, neighbor) => sum + (elevation.values[neighbor] ?? elevationValue), 0) / neighborIndices.length;
    const evaporation = waterValue * (0.012 + (1 - humidityValue) * 0.012);
    const rain = humidityValue * (0.018 + (1 - elevationValue) * 0.012);
    const diffusion = (neighborWater - waterValue) * 0.045;
    const runoff = Math.max(0, elevationValue - neighborElevation) * waterValue * 0.035;
    next[index] = clamp01(waterValue - evaporation + rain + diffusion - runoff);
  }
  return rebalance(next, targetTotal);
};
