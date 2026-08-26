import type { WorldSnapshot } from "../worker/protocol.ts";

export type MapLayer = "natural" | "temperature" | "rainfall" | "nutrients" | "biomass" | "carbon" | "oxygen" | "species" | "foodSecurity";

export const layerLabels: Record<MapLayer, string> = {
  natural: "自然",
  temperature: "温度",
  rainfall: "降水",
  nutrients: "养分",
  biomass: "生物量",
  carbon: "碳循环",
  oxygen: "氧气",
  species: "物种",
  foodSecurity: "食物保障",
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (from: [number, number, number], to: [number, number, number], amount: number): [number, number, number] => [
  Math.round(from[0] + (to[0] - from[0]) * amount),
  Math.round(from[1] + (to[1] - from[1]) * amount),
  Math.round(from[2] + (to[2] - from[2]) * amount),
];

export const colorForCell = (snapshot: WorldSnapshot, index: number, layer: MapLayer): [number, number, number] => {
  const fields = snapshot.fields;
  const elevation = clamp(fields.elevation.values[index] ?? 0);
  const water = clamp(fields.water.values[index] ?? 0);
  const temperature = clamp(fields.temperature.values[index] ?? 0);
  const humidity = clamp(fields.humidity.values[index] ?? 0);
  const nutrients = clamp(fields.nutrients.values[index] ?? 0);
  const biomass = clamp(fields.biomass.values[index] ?? 0);
  const carbon = clamp(snapshot.chemistry.carbon.values[index] ?? 0);
  const oxygen = clamp(snapshot.chemistry.oxygen.values[index] ?? 0);
  const width = fields.elevation.width;
  const regionId = `region:${index % width}:${Math.floor(index / width)}`;
  const foodSecurity = clamp(snapshot.foodSecurityByRegion?.[regionId] ?? 0);
  if (layer === "temperature") return mix([43, 93, 145], [221, 72, 40], temperature);
  if (layer === "rainfall") return mix([37, 43, 46], [44, 163, 191], humidity);
  if (layer === "nutrients") return mix([51, 47, 41], [211, 167, 63], nutrients);
  if (layer === "biomass") return mix([50, 48, 43], [65, 157, 85], biomass);
  if (layer === "carbon") return mix([47, 92, 105], [201, 118, 58], carbon);
  if (layer === "oxygen") return mix([74, 72, 76], [111, 192, 215], oxygen);
  if (layer === "species") return biomass > 0.005 ? mix([62, 85, 59], [224, 193, 86], Math.min(1, biomass * 4)) : [42, 48, 45];
  if (layer === "foodSecurity") return mix([131, 61, 49], [64, 157, 104], foodSecurity);
  if (water > 0.45 || elevation < 0.46) return mix([20, 66, 88], [46, 121, 144], Math.max(water, 1 - elevation));
  const land = elevation < 0.58 ? mix([82, 105, 67], [116, 132, 81], biomass + 0.2) : mix([91, 83, 70], [205, 202, 186], (elevation - 0.58) * 2.2);
  return land;
};
