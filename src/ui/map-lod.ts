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

export const formationBodyScale = (formation: PlanetFormationState): number => {
  if (formation.phase === "stable-crust") return 1;
  return Math.min(1, 0.07 + Math.cbrt(Math.max(0, formation.planetaryMass)) * 0.93);
};
