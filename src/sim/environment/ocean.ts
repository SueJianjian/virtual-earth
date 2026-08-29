import { hashString } from "../random.ts";
import { isOcean } from "./terrain.ts";
import type { Grid, OceanState, WorldState } from "../types.ts";

const MAX_OCEAN_AGE_YEARS = Number.MAX_SAFE_INTEGER;
const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));
const makeGrid = (width: number, height: number): Grid => ({ width, height, values: new Float32Array(width * height) });
const phaseFor = (seed: number): number => (hashString(`ocean:${seed}`) % 65_536) / 65_536 * Math.PI * 2;
const latitudeFor = (y: number, height: number): number => height <= 1 ? 0 : y / (height - 1) * 2 - 1;
const oceanAt = (fields: Pick<WorldState["fields"], "elevation">, index: number): boolean => isOcean(fields.elevation.values[index] ?? 0);

const neighborIndex = (index: number, width: number, height: number, dx: number, dy: number): number => {
  const x = index % width;
  const y = Math.floor(index / width);
  return Math.max(0, Math.min(height - 1, y + dy)) * width + (x + dx + width) % width;
};

export const createOceanState = (
  seed: number,
  width: number,
  height: number,
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string; updateCount?: number } = {},
): OceanState => {
  const seaTemperature = makeGrid(width, height);
  const salinity = makeGrid(width, height);
  const currentX = makeGrid(width, height);
  const currentY = makeGrid(width, height);
  const seaIce = makeGrid(width, height);
  const phase = phaseFor(seed);
  for (let y = 0; y < height; y += 1) {
    const latitude = latitudeFor(y, height);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      seaTemperature.values[index] = clamp(0.62 - Math.abs(latitude) * 0.28 + Math.sin(phase + x / Math.max(1, width) * Math.PI * 2) * 0.018);
      salinity.values[index] = 0.52;
      currentX.values[index] = Math.sin(latitude * Math.PI * 2) * 0.12;
    }
  }
  return {
    seaTemperature,
    salinity,
    currentX,
    currentY,
    seaIce,
    updateCount: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(history.updateCount ?? 0))),
    lastUpdatedTick: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(history.lastUpdatedTick ?? 0))),
    lastUpdatedTimelineStep: history.timelineStep ?? "0",
    lastUpdatedYears: Math.max(0, Math.min(MAX_OCEAN_AGE_YEARS, history.elapsedYears ?? 0)),
  };
};

const validGrid = (value: unknown, width: number, height: number, predicate: (entry: number) => boolean): value is Grid => {
  if (!value || typeof value !== "object") return false;
  const grid = value as Partial<Grid>;
  return grid.width === width && grid.height === height && grid.values instanceof Float32Array
    && grid.values.length === width * height && grid.values.every(predicate);
};

export const isOceanState = (value: unknown, width: number, height: number): value is OceanState => {
  if (!value || typeof value !== "object") return false;
  const ocean = value as Partial<OceanState>;
  return validGrid(ocean.seaTemperature, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.salinity, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.currentX, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && validGrid(ocean.currentY, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && validGrid(ocean.seaIce, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && Number.isSafeInteger(ocean.updateCount) && (ocean.updateCount ?? -1) >= 0
    && Number.isSafeInteger(ocean.lastUpdatedTick) && (ocean.lastUpdatedTick ?? -1) >= 0
    && (ocean.lastUpdatedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(ocean.lastUpdatedTimelineStep))
    && Number.isFinite(ocean.lastUpdatedYears) && (ocean.lastUpdatedYears ?? -1) >= 0 && (ocean.lastUpdatedYears ?? -1) <= MAX_OCEAN_AGE_YEARS;
};

export type OceanUpdate = {
  elapsedYears?: number;
  lastUpdatedTick?: number;
  timelineStep?: string;
  lastUpdatedYears?: number;
};

export const calculateOcean = (
  previous: OceanState,
  fields: Pick<WorldState["fields"], "elevation" | "temperature" | "humidity" | "water">,
  atmosphere: WorldState["atmosphere"],
  seed: number,
  update: OceanUpdate = {},
): OceanState => {
  const { elevation, temperature, humidity, water } = fields;
  const { width, height } = elevation;
  const seaTemperature = makeGrid(width, height);
  const salinity = makeGrid(width, height);
  const currentX = makeGrid(width, height);
  const currentY = makeGrid(width, height);
  const seaIce = makeGrid(width, height);
  const elapsedYears = Math.max(0, update.elapsedYears ?? 1);
  const relaxation = previous.updateCount === 0 ? 1 : clamp(-Math.expm1(-elapsedYears * 1.6));
  const phase = phaseFor(seed);
  for (let index = 0; index < seaTemperature.values.length; index += 1) {
    if (!oceanAt(fields, index)) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const latitude = latitudeFor(y, height);
    const airHeat = temperature.values[index] ?? 0.5;
    const windHeat = (atmosphere.windX.values[index] ?? 0) * 0.025;
    const targetTemperature = clamp(airHeat * 0.63 + (0.7 - Math.abs(latitude) * 0.32) * 0.37 + windHeat + Math.sin(phase + x / Math.max(1, width) * Math.PI * 2) * 0.01);
    const oldTemperature = previous.seaTemperature.values[index] ?? targetTemperature;
    seaTemperature.values[index] = clamp(oldTemperature + (targetTemperature - oldTemperature) * relaxation);
    const freshwater = (atmosphere.precipitation.values[index] ?? 0) * 0.005;
    const evaporation = (water.values[index] ?? 0) * Math.max(0, 0.5 - (humidity.values[index] ?? 0) * 0.5) * 0.004;
    const targetSalinity = clamp(0.52 + evaporation - freshwater);
    const oldSalinity = previous.salinity.values[index] ?? targetSalinity;
    salinity.values[index] = clamp(oldSalinity + (targetSalinity - oldSalinity) * relaxation);
  }
  for (let index = 0; index < seaTemperature.values.length; index += 1) {
    if (!oceanAt(fields, index)) continue;
    const y = Math.floor(index / width);
    const latitude = latitudeFor(y, height);
    const west = neighborIndex(index, width, height, -1, 0);
    const east = neighborIndex(index, width, height, 1, 0);
    const north = neighborIndex(index, width, height, 0, -1);
    const south = neighborIndex(index, width, height, 0, 1);
    const pressureGradientX = (atmosphere.pressure.values[west] ?? 0.5) - (atmosphere.pressure.values[east] ?? 0.5);
    const pressureGradientY = (atmosphere.pressure.values[north] ?? 0.5) - (atmosphere.pressure.values[south] ?? 0.5);
    const temperatureGradientX = (seaTemperature.values[west] ?? 0) - (seaTemperature.values[east] ?? 0);
    const salinityGradientY = (salinity.values[north] ?? 0.52) - (salinity.values[south] ?? 0.52);
    const coriolis = Math.sin(latitude * Math.PI / 2);
    let targetX = Math.sin(latitude * Math.PI * 2) * 0.16 + pressureGradientX * 1.8 + temperatureGradientX * 0.8 - pressureGradientY * coriolis * 0.3;
    let targetY = pressureGradientY * 1.8 + salinityGradientY * 0.8 + pressureGradientX * coriolis * 0.3;
    const magnitude = Math.hypot(targetX, targetY);
    if (magnitude > 1) { targetX /= magnitude; targetY /= magnitude; }
    const oldX = previous.currentX.values[index] ?? targetX;
    const oldY = previous.currentY.values[index] ?? targetY;
    currentX.values[index] = clamp(oldX + (targetX - oldX) * relaxation, -1, 1);
    currentY.values[index] = clamp(oldY + (targetY - oldY) * relaxation, -1, 1);
    const temperature = seaTemperature.values[index] ?? 0;
    seaIce.values[index] = clamp(Math.max(0, (0.28 - temperature) / 0.28) * (1 - Math.abs(latitude) * 0.25));
  }
  return {
    seaTemperature, salinity, currentX, currentY, seaIce,
    updateCount: Math.min(Number.MAX_SAFE_INTEGER, previous.updateCount + 1),
    lastUpdatedTick: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(update.lastUpdatedTick ?? previous.lastUpdatedTick))),
    ...((update.timelineStep ?? previous.lastUpdatedTimelineStep) === undefined ? {} : { lastUpdatedTimelineStep: update.timelineStep ?? previous.lastUpdatedTimelineStep }),
    lastUpdatedYears: Math.min(MAX_OCEAN_AGE_YEARS, Math.max(0, update.lastUpdatedYears ?? previous.lastUpdatedYears + elapsedYears)),
  };
};

export const restoreOceanState = (
  seed: number,
  fields: Pick<WorldState["fields"], "elevation" | "temperature" | "humidity" | "water">,
  atmosphere: WorldState["atmosphere"],
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string } = {},
): OceanState => calculateOcean(createOceanState(seed, fields.elevation.width, fields.elevation.height), fields, atmosphere, seed, {
  elapsedYears: 0,
  ...(history.lastUpdatedTick === undefined ? {} : { lastUpdatedTick: history.lastUpdatedTick }),
  ...(history.timelineStep === undefined ? {} : { timelineStep: history.timelineStep }),
  ...(history.elapsedYears === undefined ? {} : { lastUpdatedYears: history.elapsedYears }),
});
