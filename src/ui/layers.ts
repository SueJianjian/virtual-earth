import type { WorldSnapshot } from "../worker/protocol.ts";

export type MapLayer = "natural" | "temperature" | "rainfall" | "nutrients" | "biomass" | "carbon" | "oxygen" | "substances" | "species" | "culture" | "foodSecurity";

export const layerLabels: Record<MapLayer, string> = {
  natural: "自然",
  temperature: "温度",
  rainfall: "降水",
  nutrients: "养分",
  biomass: "生物量",
  carbon: "碳循环",
  oxygen: "氧气",
  substances: "物质",
  species: "物种",
  culture: "文化",
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
  const substanceRichness = clamp(snapshot.substanceRichnessByRegion?.[regionId] ?? 0);
  const culture = snapshot.cultureIdentityByRegion?.[regionId];
  if (layer === "temperature") return mix([43, 93, 145], [221, 72, 40], temperature);
  if (layer === "rainfall") return mix([37, 43, 46], [44, 163, 191], humidity);
  if (layer === "nutrients") return mix([51, 47, 41], [211, 167, 63], nutrients);
  if (layer === "biomass") return mix([50, 48, 43], [65, 157, 85], biomass);
  if (layer === "carbon") return mix([47, 92, 105], [201, 118, 58], carbon);
  if (layer === "oxygen") return mix([74, 72, 76], [111, 192, 215], oxygen);
  if (layer === "substances") return mix([54, 53, 58], [222, 181, 72], substanceRichness);
  if (layer === "species") return biomass > 0.005 ? mix([62, 85, 59], [224, 193, 86], Math.min(1, biomass * 4)) : [42, 48, 45];
  if (layer === "culture") {
    if (!culture) return [43, 48, 49];
    const signature = Number.parseInt(culture.noveltySignature.slice(0, 6), 16) || 0;
    const hue: [number, number, number] = [
      84 + signature % 118,
      82 + Math.floor(signature / 13) % 106,
      70 + Math.floor(signature / 173) % 112,
    ];
    const intensity = clamp(0.38 + culture.values.cooperation * 0.28 + culture.values.curiosity * 0.18 + culture.values.stewardship * 0.16);
    return mix([38, 45, 48], hue, intensity);
  }
  if (layer === "foodSecurity") return mix([131, 61, 49], [64, 157, 104], foodSecurity);
  if (snapshot.formation.phase !== "stable-crust") {
    const formation = snapshot.formation;
    const density = clamp(elevation * 5 + formation.planetaryMass * 0.35);
    if (formation.phase === "dust-cloud") return mix([24, 27, 30], [174, 139, 91], density);
    if (formation.phase === "planetesimals") return mix([42, 39, 38], [150, 116, 79], density);
    if (formation.phase === "accretion") return mix([56, 43, 39], [226, 103, 44], clamp(formation.collisionEnergy * 0.72 + density * 0.28));
    if (formation.phase === "differentiation") return mix([48, 48, 47], [212, 92, 38], clamp(formation.surfaceHeat * 0.68 + density * 0.32));
    return mix([50, 55, 55], [133, 111, 87], clamp(density * (1 - formation.surfaceHeat * 0.35)));
  }
  if (water > 0.45 || elevation < 0.46) return mix([20, 66, 88], [46, 121, 144], Math.max(water, 1 - elevation));
  const land = elevation < 0.58 ? mix([82, 105, 67], [116, 132, 81], biomass + 0.2) : mix([91, 83, 70], [205, 202, 186], (elevation - 0.58) * 2.2);
  return land;
};
