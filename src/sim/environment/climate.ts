import { oceanFractionAround } from "./terrain.ts";
import type { Grid, WorldState } from "../types.ts";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const temperatureAt = (
  elevation: number,
  y: number,
  height: number,
  oceanFraction: number,
  solarFlux = 1,
): number => {
  const latitudeDistance = Math.abs(y / Math.max(1, height - 1) - 0.5) * 2;
  const latitudeHeat = 1 - latitudeDistance * 0.68;
  const elevationCooling = Math.max(0, elevation - 0.35) * 0.42;
  const oceanModeration = oceanFraction * 0.08;
  return clamp01((latitudeHeat + oceanModeration - elevationCooling) * solarFlux * 0.72 + 0.14);
};

export const calculateClimate = (
  state: WorldState,
  solarFlux = 1,
): { temperature: Float32Array; humidity: Float32Array } => {
  const { elevation } = state.fields;
  const temperature = new Float32Array(elevation.values.length);
  const humidity = new Float32Array(elevation.values.length);
  for (let index = 0; index < elevation.values.length; index += 1) {
    const y = Math.floor(index / elevation.width);
    const oceanFraction = oceanFractionAround(elevation, index);
    const elevationValue = elevation.values[index] ?? 0;
    temperature[index] = temperatureAt(
      elevationValue,
      y,
      elevation.height,
      oceanFraction,
      solarFlux,
    );
    humidity[index] = clamp01(oceanFraction * 0.72 + (1 - (temperature[index] ?? 0)) * 0.08);
  }
  return { temperature, humidity };
};

export const averageGrid = (grid: Grid): number => {
  if (grid.values.length === 0) return 0;
  let total = 0;
  for (const value of grid.values) total += value;
  return total / grid.values.length;
};
