import { oceanFractionAround } from "./terrain.ts";
import type { Grid, WorldState } from "../types.ts";
import { diurnalTemperatureOffset, orbitalStateForWorld, seasonalTemperatureOffset } from "./orbit.ts";

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
  const orbital = orbitalStateForWorld(state);
  const orbitalFlux = solarFlux * orbital.solarFlux;
  const greenhouse = Math.max(-0.04, Math.min(0.12, (meanCarbon - 0.2) * 0.24 + meanOrganics * 0.035));
  for (let index = 0; index < elevation.values.length; index += 1) {
    const y = Math.floor(index / elevation.width);
    const x = index % elevation.width;
    const oceanFraction = oceanFractionAround(elevation, index);
    const elevationValue = elevation.values[index] ?? 0;
    const seasonalOffset = seasonalTemperatureOffset(orbital, y, elevation.height);
    const diurnalOffset = diurnalTemperatureOffset(orbital, x, elevation.width);
    const terrestrialEquilibrium = temperatureAt(
      elevationValue,
      y,
      elevation.height,
      oceanFraction,
      orbitalFlux,
    ) + greenhouse + seasonalOffset + diurnalOffset;
    const seaSurfaceTemperature = state.ocean && elevationValue < 0.48
      ? state.ocean.seaTemperature.values[index] ?? terrestrialEquilibrium
      : terrestrialEquilibrium;
    const seaIceCooling = state.ocean && elevationValue < 0.48
      ? (state.ocean.seaIce.values[index] ?? 0) * 0.06
      : 0;
    const equilibrium = clamp01(
      terrestrialEquilibrium * (elevationValue < 0.48 ? 0.76 : 1)
      + seaSurfaceTemperature * (elevationValue < 0.48 ? 0.24 : 0)
      - seaIceCooling,
    );
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
      - seasonalOffset * 0.12
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
