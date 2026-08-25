import type { Grid, WorldState } from "../types.ts";

export const SEA_LEVEL = 0.48;

export const isOcean = (elevation: number): boolean => elevation < SEA_LEVEL;

export const oceanFractionAround = (
  elevation: Grid,
  index: number,
): number => {
  const x = index % elevation.width;
  const y = Math.floor(index / elevation.width);
  let oceanCells = 0;
  let samples = 0;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const neighborY = y + offsetY;
      if (neighborY < 0 || neighborY >= elevation.height) continue;
      const neighborX = (x + offsetX + elevation.width) % elevation.width;
      samples += 1;
      if (isOcean(elevation.values[neighborY * elevation.width + neighborX] ?? 0)) {
        oceanCells += 1;
      }
    }
  }
  return samples === 0 ? 0 : oceanCells / samples;
};

export const initializeTerrainWater = (state: WorldState): Float32Array => {
  const { elevation } = state.fields;
  const water = new Float32Array(elevation.values.length);
  for (let index = 0; index < elevation.values.length; index += 1) {
    const elevationValue = elevation.values[index] ?? 0;
    const basinFactor = Math.max(0, (SEA_LEVEL - elevationValue) * 8);
    water[index] = isOcean(elevationValue)
      ? Math.min(1, 0.72 + basinFactor)
      : basinFactor * 0.12;
  }
  return water;
};
