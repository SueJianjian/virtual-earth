import type { Grid, WorldEvent, WorldState } from "../types.ts";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const total = (values: Float32Array): number => {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
};

const rebalance = (values: Float32Array, targetTotal: number): Float32Array => {
  const currentTotal = total(values);
  if (currentTotal <= 0 || targetTotal <= 0) {
    values.fill(targetTotal <= 0 ? 0 : targetTotal / Math.max(1, values.length));
    return values;
  }
  const scale = targetTotal / currentTotal;
  for (let index = 0; index < values.length; index += 1) {
    values[index] = clamp01((values[index] ?? 0) * scale);
  }
  return values;
};

export const totalWater = (grid: Grid): number => total(grid.values);

export const simulateWater = (
  state: WorldState,
  externalEvents: WorldEvent[] = [],
  elapsedYears = 1,
  precipitation: Grid = state.atmosphere.precipitation,
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
    const rowStart = y * water.width;
    const north = y > 0 ? index - water.width : index;
    const south = y + 1 < water.height ? index + water.width : index;
    const west = rowStart + (x + water.width - 1) % water.width;
    const east = rowStart + (x + 1) % water.width;
    const neighborWater = (
      (water.values[north] ?? waterValue)
      + (water.values[south] ?? waterValue)
      + (water.values[west] ?? waterValue)
      + (water.values[east] ?? waterValue)
    ) / 4;
    const neighborElevation = (
      (elevation.values[north] ?? elevationValue)
      + (elevation.values[south] ?? elevationValue)
      + (elevation.values[west] ?? elevationValue)
      + (elevation.values[east] ?? elevationValue)
    ) / 4;
    const evaporation = waterValue * (0.012 + (1 - humidityValue) * 0.012);
    const rain = clamp01(precipitation.values[index] ?? 0) * (0.022 + (1 - elevationValue) * 0.012);
    const diffusion = (neighborWater - waterValue) * 0.045;
    const runoff = Math.max(0, elevationValue - neighborElevation) * waterValue * 0.035;
    const years = Math.max(0, elapsedYears);
    next[index] = clamp01(waterValue + (-evaporation + rain + diffusion - runoff) * years);
  }
  return rebalance(next, targetTotal);
};
