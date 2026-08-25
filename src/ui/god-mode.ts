import type { RegionId, WorldEventInput } from "../sim/types.ts";

export type GodTool =
  | "raise-terrain" | "lower-terrain" | "add-water" | "add-rain" | "heat" | "cool"
  | "volcano" | "earthquake" | "meteor" | "add-minerals" | "add-organics" | "seed-life"
  | "drought" | "flood" | "cold-snap" | "volcanic-winter";

export const godToolLabels: Record<GodTool, string> = {
  "raise-terrain": "抬升地形", "lower-terrain": "降低地形", "add-water": "增加水量", "add-rain": "增加降雨",
  heat: "升温", cool: "降温", volcano: "火山", earthquake: "地震", meteor: "陨石",
  "add-minerals": "增加矿物", "add-organics": "增加有机物", "seed-life": "投放生命条件",
  drought: "干旱", flood: "洪水", "cold-snap": "寒潮", "volcanic-winter": "火山寒冬",
};

export const createGodEvent = (
  id: string,
  tool: GodTool,
  regionId: RegionId,
  intensity: number,
  duration: number,
): WorldEventInput => ({
  id,
  kind: tool,
  regionId,
  intensity: Math.max(0, Math.min(1, intensity)),
  duration: Math.max(1, Math.trunc(duration)),
  source: "user",
  payload: { amount: Math.max(0, intensity), tool },
});
