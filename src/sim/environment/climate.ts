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
  // A higher surface loses enough heat to remain cooler than nearby lowland,
  // even when the lowland benefits from oceanic thermal moderation.
  const elevationCooling = Math.max(0, elevation - 0.35) * 0.9;
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
  const meanCarbon = averageGrid(state.chemistry.carbon);
  const meanOrganics = averageGrid(state.chemistry.organics);
  const seedPhase = (state.seed % 2048) / 2048 * Math.PI * 2;
  const orbitalPhase = state.years / 240 * Math.PI * 2 + seedPhase;
  const orbitalFlux = solarFlux * (1 + Math.sin(orbitalPhase) * 0.018);
  const greenhouse = Math.max(-0.04, Math.min(0.12, (meanCarbon - 0.2) * 0.24 + meanOrganics * 0.035));
  for (let index = 0; index < elevation.values.length; index += 1) {
    const y = Math.floor(index / elevation.width);
    const oceanFraction = oceanFractionAround(elevation, index);
    const elevationValue = elevation.values[index] ?? 0;
    const hemisphere = y / Math.max(1, elevation.height - 1) * 2 - 1;
    const axialCycle = Math.sin(state.years / 37 * Math.PI * 2 + seedPhase) * hemisphere * 0.025;
    const equilibrium = clamp01(temperatureAt(
      elevationValue,
      y,
      elevation.height,
      oceanFraction,
      orbitalFlux,
    ) + greenhouse + axialCycle);
    const previousTemperature = state.fields.temperature.values[index] ?? 0;
    // No thermal history exists while the first climate field is initialized.
    const thermalInertia = previousTemperature > 0 ? oceanFraction * 0.42 : 0;
    temperature[index] = clamp01(equilibrium * (1 - thermalInertia) + previousTemperature * thermalInertia);
    const previousHumidity = state.fields.humidity.values[index] ?? 0;
    const localWater = state.fields.water.values[index] ?? 0;
    humidity[index] = clamp01(
      oceanFraction * 0.5
      + localWater * 0.2
      + (1 - (temperature[index] ?? 0)) * 0.07
      + previousHumidity * 0.16,
    );
  }
  return { temperature, humidity };
};

export const averageGrid = (grid: Grid): number => {
  if (grid.values.length === 0) return 0;
  let total = 0;
  for (const value of grid.values) total += value;
  return total / grid.values.length;
};
