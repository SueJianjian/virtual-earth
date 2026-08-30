import type { PlanetFormationState } from "../sim/types.ts";

export type MapSceneLod = "global" | "continent" | "region" | "settlement" | "individual";
export type MapSurfaceMode = "forming-body" | "planet-globe" | "local-surface";

export type TerrainPatchLod = {
  detail: number;
  radius: number;
  relief: number;
};

export const MAX_MAP_ZOOM = 64;
export const BASE_TERRAIN_DETAIL = 2;

export const mapSceneLodForZoom = (zoom: number): MapSceneLod => {
  if (zoom < 1.5) return "global";
  if (zoom < 4) return "continent";
  if (zoom < 10) return "region";
  if (zoom < 24) return "settlement";
  return "individual";
};

export const mapSceneLodLabel = (zoom: number): string => ({
  global: "全球观察",
  continent: "洲域观察",
  region: "区域观察",
  settlement: "聚落观察",
  individual: "个人观察",
})[mapSceneLodForZoom(zoom)];

export const mapSurfaceModeFor = (formation: PlanetFormationState, zoom: number): MapSurfaceMode => {
  if (formation.phase !== "stable-crust") return "forming-body";
  return mapSceneLodForZoom(zoom) === "global" ? "planet-globe" : "local-surface";
};

export const terrainPatchLodForZoom = (zoom: number): TerrainPatchLod | undefined => ({
  global: undefined,
  continent: { detail: 3, radius: 24, relief: 0.05 },
  region: { detail: 5, radius: 12, relief: 0.1 },
  settlement: { detail: 8, radius: 5, relief: 0.16 },
  individual: { detail: 16, radius: 2, relief: 0.22 },
})[mapSceneLodForZoom(zoom)];

export const propsPerCellForZoom = (zoom: number): number => ({
  global: 0,
  continent: 1,
  region: 1,
  settlement: 2,
  individual: 6,
})[mapSceneLodForZoom(zoom)];

export const terrainVerticalScaleForZoom = (zoom: number): number => ({
  global: 1,
  continent: 0.82,
  region: 0.55,
  settlement: 0.3,
  individual: 0.16,
})[mapSceneLodForZoom(zoom)];

export const propScaleForZoom = (zoom: number): number => ({
  global: 0,
  continent: 0.78,
  region: 0.55,
  settlement: 0.3,
  individual: 0.16,
})[mapSceneLodForZoom(zoom)];

const reliefHash = (x: number, y: number, seed: number): number => {
  let value = Math.imul(Math.trunc(x) + 1, 374761393) ^ Math.imul(Math.trunc(y) + 1, 668265263) ^ Math.trunc(seed);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

const smooth = (value: number): number => value * value * (3 - value * 2);
const valueNoise = (x: number, y: number, scale: number, seed: number): number => {
  const scaledX = x * scale;
  const scaledY = y * scale;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const tx = smooth(scaledX - x0);
  const ty = smooth(scaledY - y0);
  const top = reliefHash(x0, y0, seed) * (1 - tx) + reliefHash(x0 + 1, y0, seed) * tx;
  const bottom = reliefHash(x0, y0 + 1, seed) * (1 - tx) + reliefHash(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
};

/** Continuous seeded relief keeps close-up terrain organic instead of cell-noisy. */
export const terrainReliefFor = (x: number, y: number, seed: number): number => (
  (valueNoise(x, y, 0.22, seed) * 0.56
    + valueNoise(x, y, 0.52, seed + 17) * 0.29
    + valueNoise(x, y, 1.1, seed + 31) * 0.15) * 2 - 1
);

export const formationBodyScale = (formation: PlanetFormationState): number => {
  if (formation.phase === "stable-crust") return 1;
  return Math.min(1, 0.07 + Math.cbrt(Math.max(0, formation.planetaryMass)) * 0.93);
};
