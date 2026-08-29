import { hashString } from "../random.ts";
import type { AtmosphereState, Grid, WorldState } from "../types.ts";

const MAX_ATMOSPHERE_AGE_YEARS = Number.MAX_SAFE_INTEGER;

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

const makeGrid = (width: number, height: number): Grid => ({
  width,
  height,
  values: new Float32Array(width * height),
});

const atmospherePhase = (seed: number): number =>
  (hashString(`atmosphere:${seed}`) % 65_536) / 65_536 * Math.PI * 2;

const seededWave = (phase: number, x: number, y: number, width: number, height: number): number => {
  const longitude = x / Math.max(1, width) * Math.PI * 2;
  const latitude = y / Math.max(1, height - 1) * Math.PI;
  return Math.sin(phase + longitude * 2 + latitude * 0.7) * 0.5
    + Math.cos(phase * 0.61 - longitude + latitude * 1.3) * 0.5;
};

const latitudeFor = (y: number, height: number): number =>
  height <= 1 ? 0 : y / (height - 1) * 2 - 1;

const prevailingWind = (latitude: number): number => {
  const absoluteLatitude = Math.abs(latitude);
  const direction = absoluteLatitude < 0.34 ? -1 : absoluteLatitude < 0.72 ? 1 : -0.72;
  return direction * (0.16 + Math.abs(Math.cos(latitude * Math.PI * 1.5)) * 0.16);
};

export const createAtmosphereState = (
  seed: number,
  width: number,
  height: number,
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string; updateCount?: number } = {},
): AtmosphereState => {
  const pressure = makeGrid(width, height);
  const windX = makeGrid(width, height);
  const windY = makeGrid(width, height);
  const precipitation = makeGrid(width, height);
  const phase = atmospherePhase(seed);
  for (let y = 0; y < height; y += 1) {
    const latitude = latitudeFor(y, height);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      pressure.values[index] = clamp(0.52 + Math.cos(latitude * Math.PI * 3) * 0.045 + seededWave(phase, x, y, width, height) * 0.018);
      windX.values[index] = prevailingWind(latitude);
    }
  }
  return {
    pressure,
    windX,
    windY,
    precipitation,
    updateCount: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(history.updateCount ?? 0))),
    lastUpdatedTick: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(history.lastUpdatedTick ?? 0))),
    lastUpdatedTimelineStep: history.timelineStep ?? "0",
    lastUpdatedYears: Math.min(MAX_ATMOSPHERE_AGE_YEARS, Math.max(0, history.elapsedYears ?? 0)),
  };
};

const validGrid = (
  value: unknown,
  width: number,
  height: number,
  predicate: (entry: number) => boolean,
): value is Grid => {
  if (!value || typeof value !== "object") return false;
  const grid = value as Partial<Grid>;
  return grid.width === width
    && grid.height === height
    && grid.values instanceof Float32Array
    && grid.values.length === width * height
    && grid.values.every(predicate);
};

export const isAtmosphereState = (value: unknown, width: number, height: number): value is AtmosphereState => {
  if (!value || typeof value !== "object") return false;
  const atmosphere = value as Partial<AtmosphereState>;
  return validGrid(atmosphere.pressure, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(atmosphere.windX, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && validGrid(atmosphere.windY, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && validGrid(atmosphere.precipitation, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && Number.isSafeInteger(atmosphere.updateCount) && Number(atmosphere.updateCount) >= 0
    && Number.isSafeInteger(atmosphere.lastUpdatedTick) && Number(atmosphere.lastUpdatedTick) >= 0
    && (atmosphere.lastUpdatedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(atmosphere.lastUpdatedTimelineStep))
    && Number.isFinite(atmosphere.lastUpdatedYears)
    && Number(atmosphere.lastUpdatedYears) >= 0
    && Number(atmosphere.lastUpdatedYears) <= MAX_ATMOSPHERE_AGE_YEARS;
};

const upstreamIndex = (
  index: number,
  width: number,
  height: number,
  windX: number,
  windY: number,
): number => {
  const x = index % width;
  const y = Math.floor(index / width);
  const upstreamX = (x - Math.sign(windX) + width) % width;
  const upstreamY = Math.max(0, Math.min(height - 1, y - Math.sign(windY)));
  return upstreamY * width + upstreamX;
};

export type AtmosphereUpdate = {
  elapsedYears?: number;
  lastUpdatedTick?: number;
  timelineStep?: string;
  lastUpdatedYears?: number;
};

export const calculateAtmosphere = (
  previous: AtmosphereState,
  fields: Pick<WorldState["fields"], "elevation" | "temperature" | "humidity" | "water">,
  seed: number,
  update: AtmosphereUpdate = {},
): AtmosphereState => {
  const { elevation, temperature, humidity, water } = fields;
  const { width, height } = elevation;
  const pressure = makeGrid(width, height);
  const windX = makeGrid(width, height);
  const windY = makeGrid(width, height);
  const precipitation = makeGrid(width, height);
  const phase = atmospherePhase(seed);
  const elapsedYears = Math.max(0, update.elapsedYears ?? 1);
  const relaxation = previous.updateCount === 0 ? 1 : clamp(-Math.expm1(-elapsedYears * 2.4));

  for (let index = 0; index < pressure.values.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const latitude = latitudeFor(y, height);
    const target = clamp(
      0.56
      + (0.5 - (temperature.values[index] ?? 0.5)) * 0.28
      - (elevation.values[index] ?? 0) * 0.13
      - (humidity.values[index] ?? 0) * 0.035
      + Math.cos(latitude * Math.PI * 3) * 0.052
      + seededWave(phase, x, y, width, height) * 0.016,
    );
    const oldPressure = previous.pressure.values[index] ?? target;
    pressure.values[index] = clamp(oldPressure + (target - oldPressure) * relaxation);
  }

  for (let index = 0; index < pressure.values.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const rowStart = y * width;
    const north = y > 0 ? index - width : index;
    const south = y + 1 < height ? index + width : index;
    const west = rowStart + (x + width - 1) % width;
    const east = rowStart + (x + 1) % width;
    const latitude = latitudeFor(y, height);
    const coriolis = Math.sin(latitude * Math.PI / 2);
    const pressureFlowX = ((pressure.values[west] ?? 0) - (pressure.values[east] ?? 0)) * 4.2;
    const pressureFlowY = ((pressure.values[north] ?? 0) - (pressure.values[south] ?? 0)) * 4.2;
    let targetX = prevailingWind(latitude) + pressureFlowX - pressureFlowY * coriolis * 0.42;
    let targetY = pressureFlowY + pressureFlowX * coriolis * 0.42;
    const magnitude = Math.hypot(targetX, targetY);
    if (magnitude > 1) {
      targetX /= magnitude;
      targetY /= magnitude;
    }
    const oldX = previous.windX.values[index] ?? targetX;
    const oldY = previous.windY.values[index] ?? targetY;
    windX.values[index] = clamp(oldX + (targetX - oldX) * relaxation, -1, 1);
    windY.values[index] = clamp(oldY + (targetY - oldY) * relaxation, -1, 1);
  }

  for (let index = 0; index < precipitation.values.length; index += 1) {
    const upstream = upstreamIndex(index, width, height, windX.values[index] ?? 0, windY.values[index] ?? 0);
    const localHumidity = humidity.values[index] ?? 0;
    const upstreamHumidity = humidity.values[upstream] ?? localHumidity;
    const upstreamWater = water.values[upstream] ?? 0;
    const localWater = water.values[index] ?? 0;
    const transportedMoisture = clamp(localHumidity * 0.52 + upstreamHumidity * 0.3 + upstreamWater * 0.12 + localWater * 0.06);
    const uplift = Math.max(0, (elevation.values[index] ?? 0) - (elevation.values[upstream] ?? 0));
    const cooling = clamp(0.58 - (temperature.values[index] ?? 0.5));
    const saturation = Math.max(0, transportedMoisture - 0.31);
    const target = clamp(saturation * 1.34 + uplift * 0.86 + cooling * transportedMoisture * 0.22);
    const oldPrecipitation = previous.precipitation.values[index] ?? target;
    precipitation.values[index] = clamp(oldPrecipitation + (target - oldPrecipitation) * relaxation);
  }

  return {
    pressure,
    windX,
    windY,
    precipitation,
    updateCount: Math.min(Number.MAX_SAFE_INTEGER, previous.updateCount + 1),
    lastUpdatedTick: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(update.lastUpdatedTick ?? previous.lastUpdatedTick))),
    ...((update.timelineStep ?? previous.lastUpdatedTimelineStep) === undefined
      ? {}
      : { lastUpdatedTimelineStep: update.timelineStep ?? previous.lastUpdatedTimelineStep }),
    lastUpdatedYears: Math.min(
      MAX_ATMOSPHERE_AGE_YEARS,
      Math.max(0, update.lastUpdatedYears ?? previous.lastUpdatedYears + elapsedYears),
    ),
  };
};

export const restoreAtmosphereState = (
  seed: number,
  fields: Pick<WorldState["fields"], "elevation" | "temperature" | "humidity" | "water">,
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string } = {},
): AtmosphereState => calculateAtmosphere(
  createAtmosphereState(seed, fields.elevation.width, fields.elevation.height),
  fields,
  seed,
  {
    elapsedYears: 0,
    ...(history.lastUpdatedTick === undefined ? {} : { lastUpdatedTick: history.lastUpdatedTick }),
    ...(history.timelineStep === undefined ? {} : { timelineStep: history.timelineStep }),
    ...(history.elapsedYears === undefined ? {} : { lastUpdatedYears: history.elapsedYears }),
  },
);
