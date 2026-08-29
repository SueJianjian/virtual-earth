import { hashString } from "../random.ts";
import { isOcean } from "./terrain.ts";
import type { ChemistryPatch, Grid, OceanState, WorldState } from "../types.ts";

const MAX_OCEAN_AGE_YEARS = Number.MAX_SAFE_INTEGER;
const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));
const makeGrid = (width: number, height: number): Grid => ({ width, height, values: new Float32Array(width * height) });
const phaseFor = (seed: number): number => (hashString(`ocean:${seed}`) % 65_536) / 65_536 * Math.PI * 2;
const latitudeFor = (y: number, height: number): number => height <= 1 ? 0 : y / (height - 1) * 2 - 1;
const oceanAt = (fields: Pick<WorldState["fields"], "elevation">, index: number): boolean => isOcean(fields.elevation.values[index] ?? 0);

export const createOceanState = (
  seed: number,
  width: number,
  height: number,
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string; updateCount?: number } = {},
): OceanState => {
  const seaTemperature = makeGrid(width, height);
  const salinity = makeGrid(width, height);
  const currentX = makeGrid(width, height);
  const currentY = makeGrid(width, height);
  const seaIce = makeGrid(width, height);
  const dissolvedNutrients = makeGrid(width, height);
  const dissolvedOxygen = makeGrid(width, height);
  const organicCarbon = makeGrid(width, height);
  const primaryProductivity = makeGrid(width, height);
  const planktonBiomass = makeGrid(width, height);
  const phase = phaseFor(seed);
  for (let y = 0; y < height; y += 1) {
    const latitude = latitudeFor(y, height);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      seaTemperature.values[index] = clamp(0.62 - Math.abs(latitude) * 0.28 + Math.sin(phase + x / Math.max(1, width) * Math.PI * 2) * 0.018);
      salinity.values[index] = 0.52;
      currentX.values[index] = Math.sin(latitude * Math.PI * 2) * 0.12;
      dissolvedNutrients.values[index] = 0.04;
      dissolvedOxygen.values[index] = 0.01;
      organicCarbon.values[index] = 0.02;
    }
  }
  return {
    seaTemperature,
    salinity,
    currentX,
    currentY,
    seaIce,
    dissolvedNutrients,
    dissolvedOxygen,
    organicCarbon,
    primaryProductivity,
    planktonBiomass,
    updateCount: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(history.updateCount ?? 0))),
    lastUpdatedTick: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(history.lastUpdatedTick ?? 0))),
    lastUpdatedTimelineStep: history.timelineStep ?? "0",
    lastUpdatedYears: Math.max(0, Math.min(MAX_OCEAN_AGE_YEARS, history.elapsedYears ?? 0)),
  };
};

const validGrid = (value: unknown, width: number, height: number, predicate: (entry: number) => boolean): value is Grid => {
  if (!value || typeof value !== "object") return false;
  const grid = value as Partial<Grid>;
  return grid.width === width && grid.height === height && grid.values instanceof Float32Array
    && grid.values.length === width * height && grid.values.every(predicate);
};

const isOceanHistory = (ocean: Partial<OceanState>): boolean =>
  Number.isSafeInteger(ocean.updateCount) && (ocean.updateCount ?? -1) >= 0
  && Number.isSafeInteger(ocean.lastUpdatedTick) && (ocean.lastUpdatedTick ?? -1) >= 0
  && (ocean.lastUpdatedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(ocean.lastUpdatedTimelineStep))
  && Number.isFinite(ocean.lastUpdatedYears) && (ocean.lastUpdatedYears ?? -1) >= 0 && (ocean.lastUpdatedYears ?? -1) <= MAX_OCEAN_AGE_YEARS;

const isOceanCoreGrids = (ocean: Partial<OceanState>, width: number, height: number): boolean =>
  validGrid(ocean.seaTemperature, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.salinity, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.currentX, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && validGrid(ocean.currentY, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && validGrid(ocean.seaIce, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1);

export const isOceanCoreState = (value: unknown, width: number, height: number): value is Pick<OceanState, "seaTemperature" | "salinity" | "currentX" | "currentY" | "seaIce"> & Partial<OceanState> => {
  if (!value || typeof value !== "object") return false;
  const ocean = value as Partial<OceanState>;
  const marineFields: Array<keyof Pick<OceanState, "dissolvedNutrients" | "dissolvedOxygen" | "organicCarbon" | "primaryProductivity" | "planktonBiomass">> = [
    "dissolvedNutrients", "dissolvedOxygen", "organicCarbon", "primaryProductivity", "planktonBiomass",
  ];
  if (marineFields.some((field) => ocean[field] !== undefined)) return false;
  return isOceanCoreGrids(ocean, width, height) && isOceanHistory(ocean);
};

export const isOceanState = (value: unknown, width: number, height: number): value is OceanState => {
  if (!value || typeof value !== "object") return false;
  const ocean = value as Partial<OceanState>;
  return isOceanCoreGrids(ocean, width, height)
    && isOceanHistory(ocean)
    && validGrid(ocean.dissolvedNutrients, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.dissolvedOxygen, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.organicCarbon, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.primaryProductivity, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(ocean.planktonBiomass, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1);
};

export type OceanUpdate = {
  elapsedYears?: number;
  lastUpdatedTick?: number;
  timelineStep?: string;
  lastUpdatedYears?: number;
};

export const calculateOcean = (
  previous: OceanState,
  fields: Pick<WorldState["fields"], "elevation" | "temperature" | "humidity" | "water" | "nutrients" | "biomass">,
  atmosphere: WorldState["atmosphere"],
  seed: number,
  update: OceanUpdate = {},
  chemistry: WorldState["chemistry"] | undefined = undefined,
): OceanState => {
  const { elevation, temperature, humidity, water } = fields;
  const { width, height } = elevation;
  const seaTemperature = makeGrid(width, height);
  const salinity = makeGrid(width, height);
  const currentX = makeGrid(width, height);
  const currentY = makeGrid(width, height);
  const seaIce = makeGrid(width, height);
  const dissolvedNutrients = makeGrid(width, height);
  const dissolvedOxygen = makeGrid(width, height);
  const organicCarbon = makeGrid(width, height);
  const primaryProductivity = makeGrid(width, height);
  const planktonBiomass = makeGrid(width, height);
  const oceanMask = new Uint8Array(seaTemperature.values.length);
  const elapsedYears = Math.max(0, update.elapsedYears ?? 1);
  const relaxation = previous.updateCount === 0 ? 1 : clamp(-Math.expm1(-Math.min(elapsedYears, 1_000_000) * 1.6));
  const phase = phaseFor(seed);
  for (let index = 0; index < seaTemperature.values.length; index += 1) {
    if (!oceanAt(fields, index)) continue;
    oceanMask[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const latitude = latitudeFor(y, height);
    const airHeat = temperature.values[index] ?? 0.5;
    const windHeat = (atmosphere.windX.values[index] ?? 0) * 0.025;
    const targetTemperature = clamp(airHeat * 0.63 + (0.7 - Math.abs(latitude) * 0.32) * 0.37 + windHeat + Math.sin(phase + x / Math.max(1, width) * Math.PI * 2) * 0.01);
    const oldTemperature = previous.seaTemperature.values[index] ?? targetTemperature;
    seaTemperature.values[index] = clamp(oldTemperature + (targetTemperature - oldTemperature) * relaxation);
    const freshwater = (atmosphere.precipitation.values[index] ?? 0) * 0.005;
    const evaporation = (water.values[index] ?? 0) * Math.max(0, 0.5 - (humidity.values[index] ?? 0) * 0.5) * 0.004;
    const targetSalinity = clamp(0.52 + evaporation - freshwater);
    const oldSalinity = previous.salinity.values[index] ?? targetSalinity;
    salinity.values[index] = clamp(oldSalinity + (targetSalinity - oldSalinity) * relaxation);

    const sourceNutrients = (fields.elevation.values[index] ?? 1) >= 0.48
      ? fields.nutrients.values[index] ?? 0
      : ((chemistry?.nitrogen.values[index] ?? 0) * 0.45 + (chemistry?.phosphorus.values[index] ?? 0) * 0.55);
    const targetNutrients = clamp(sourceNutrients * 0.72 + (chemistry?.organics.values[index] ?? 0) * 0.18 + 0.015);
    const projectedSeaIce = clamp(Math.max(0, (0.28 - seaTemperature.values[index]!) / 0.28) * (1 - Math.abs(latitude) * 0.25));
    const light = clamp((1 - Math.abs(latitude) * 0.32) * (1 - projectedSeaIce * 0.85));
    const targetProductivity = clamp(targetNutrients * light * (0.45 + (seaTemperature.values[index] ?? 0) * 0.7) * 0.9);
    const targetPlankton = clamp(targetProductivity * (0.62 + targetNutrients * 0.48));
    const targetOxygen = clamp((chemistry?.oxygen.values[index] ?? 0.01) * 0.58 + targetProductivity * 0.34 + 0.015);
    const targetOrganicCarbon = clamp((chemistry?.organics.values[index] ?? 0) * 0.62 + targetPlankton * 0.25 + 0.012);
    dissolvedNutrients.values[index] = clamp((previous.dissolvedNutrients.values[index] ?? targetNutrients) + (targetNutrients - (previous.dissolvedNutrients.values[index] ?? targetNutrients)) * relaxation);
    primaryProductivity.values[index] = clamp((previous.primaryProductivity.values[index] ?? targetProductivity) + (targetProductivity - (previous.primaryProductivity.values[index] ?? targetProductivity)) * relaxation);
    planktonBiomass.values[index] = clamp((previous.planktonBiomass.values[index] ?? targetPlankton) + (targetPlankton - (previous.planktonBiomass.values[index] ?? targetPlankton)) * relaxation);
    dissolvedOxygen.values[index] = clamp((previous.dissolvedOxygen.values[index] ?? targetOxygen) + (targetOxygen - (previous.dissolvedOxygen.values[index] ?? targetOxygen)) * relaxation);
    organicCarbon.values[index] = clamp((previous.organicCarbon.values[index] ?? targetOrganicCarbon) + (targetOrganicCarbon - (previous.organicCarbon.values[index] ?? targetOrganicCarbon)) * relaxation);
  }
  for (let index = 0; index < seaTemperature.values.length; index += 1) {
    if (oceanMask[index] === 0) continue;
    const y = Math.floor(index / width);
    const latitude = latitudeFor(y, height);
    const x = index % width;
    const rowStart = y * width;
    const west = rowStart + (x + width - 1) % width;
    const east = rowStart + (x + 1) % width;
    const north = y > 0 ? index - width : index;
    const south = y + 1 < height ? index + width : index;
    const pressureGradientX = (atmosphere.pressure.values[west] ?? 0.5) - (atmosphere.pressure.values[east] ?? 0.5);
    const pressureGradientY = (atmosphere.pressure.values[north] ?? 0.5) - (atmosphere.pressure.values[south] ?? 0.5);
    const temperatureGradientX = (seaTemperature.values[west] ?? 0) - (seaTemperature.values[east] ?? 0);
    const salinityGradientY = (salinity.values[north] ?? 0.52) - (salinity.values[south] ?? 0.52);
    const coriolis = Math.sin(latitude * Math.PI / 2);
    let targetX = Math.sin(latitude * Math.PI * 2) * 0.16 + pressureGradientX * 1.8 + temperatureGradientX * 0.8 - pressureGradientY * coriolis * 0.3;
    let targetY = pressureGradientY * 1.8 + salinityGradientY * 0.8 + pressureGradientX * coriolis * 0.3;
    const magnitude = Math.hypot(targetX, targetY);
    if (magnitude > 1) { targetX /= magnitude; targetY /= magnitude; }
    const oldX = previous.currentX.values[index] ?? targetX;
    const oldY = previous.currentY.values[index] ?? targetY;
    currentX.values[index] = clamp(oldX + (targetX - oldX) * relaxation, -1, 1);
    currentY.values[index] = clamp(oldY + (targetY - oldY) * relaxation, -1, 1);
    const temperature = seaTemperature.values[index] ?? 0;
    seaIce.values[index] = clamp(Math.max(0, (0.28 - temperature) / 0.28) * (1 - Math.abs(latitude) * 0.25));
  }
  const exchange = clamp(-Math.expm1(-Math.min(elapsedYears, 1_000_000) * 0.12));
  const biologicalGrids = [dissolvedNutrients, dissolvedOxygen, organicCarbon, primaryProductivity, planktonBiomass];
  for (let index = 0; index < seaTemperature.values.length; index += 1) {
    if (oceanMask[index] === 0) continue;
    const y = Math.floor(index / width);
    const x = index % width;
    const rowStart = y * width;
    const west = rowStart + (x + width - 1) % width;
    const east = rowStart + (x + 1) % width;
    const north = y > 0 ? index - width : index;
    const south = y + 1 < height ? index + width : index;
    const horizontal = (currentX.values[index] ?? 0) >= 0 ? west : east;
    const vertical = (currentY.values[index] ?? 0) >= 0 ? north : south;
    for (const grid of biologicalGrids) {
      const transported = clamp((grid.values[index] ?? 0) * 0.54 + (grid.values[horizontal] ?? grid.values[index] ?? 0) * 0.3 + (grid.values[vertical] ?? grid.values[index] ?? 0) * 0.16);
      grid.values[index] = clamp((grid.values[index] ?? 0) * (1 - exchange) + transported * exchange);
    }
  }
  return {
    seaTemperature, salinity, currentX, currentY, seaIce,
    dissolvedNutrients, dissolvedOxygen, organicCarbon, primaryProductivity, planktonBiomass,
    updateCount: Math.min(Number.MAX_SAFE_INTEGER, previous.updateCount + 1),
    lastUpdatedTick: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(update.lastUpdatedTick ?? previous.lastUpdatedTick))),
    ...((update.timelineStep ?? previous.lastUpdatedTimelineStep) === undefined ? {} : { lastUpdatedTimelineStep: update.timelineStep ?? previous.lastUpdatedTimelineStep }),
    lastUpdatedYears: Math.min(MAX_OCEAN_AGE_YEARS, Math.max(0, update.lastUpdatedYears ?? previous.lastUpdatedYears + elapsedYears)),
  };
};

export const restoreOceanState = (
  seed: number,
  fields: Pick<WorldState["fields"], "elevation" | "temperature" | "humidity" | "water" | "nutrients" | "biomass">,
  atmosphere: WorldState["atmosphere"],
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string } = {},
  legacy?: Pick<OceanState, "seaTemperature" | "salinity" | "currentX" | "currentY" | "seaIce">,
  chemistry?: WorldState["chemistry"],
): OceanState => calculateOcean(legacy ? { ...createOceanState(seed, fields.elevation.width, fields.elevation.height, history), ...legacy } : createOceanState(seed, fields.elevation.width, fields.elevation.height, history), fields, atmosphere, seed, {
  elapsedYears: 0,
  ...(history.lastUpdatedTick === undefined ? {} : { lastUpdatedTick: history.lastUpdatedTick }),
  ...(history.timelineStep === undefined ? {} : { timelineStep: history.timelineStep }),
  ...(history.elapsedYears === undefined ? {} : { lastUpdatedYears: history.elapsedYears }),
}, chemistry);

export const calculateMarineChemistryPatches = (
  ocean: OceanState,
  chemistry: WorldState["chemistry"],
  elapsedYears = 1,
): ChemistryPatch[] => {
  const size = ocean.primaryProductivity.values.length;
  const years = Math.min(Math.max(0, elapsedYears), 1_000_000);
  const values = {
    carbon: new Float64Array(size),
    nitrogen: new Float64Array(size),
    phosphorus: new Float64Array(size),
    organics: new Float64Array(size),
    oxygen: new Float64Array(size),
  };
  for (let index = 0; index < size; index += 1) {
    if ((ocean.primaryProductivity.values[index] ?? 0) <= 0 && (ocean.planktonBiomass.values[index] ?? 0) <= 0) continue;
    const production = ocean.primaryProductivity.values[index] ?? 0;
    const plankton = ocean.planktonBiomass.values[index] ?? 0;
    const recycle = plankton * 0.00016;
    const uptake = production * 0.00042;
    values.carbon[index] = (-uptake + recycle * 0.18) * years;
    values.nitrogen[index] = -uptake * 0.16 * years;
    values.phosphorus[index] = -uptake * 0.08 * years;
    values.organics[index] = (production * 0.0002 - recycle) * years;
    values.oxygen[index] = (uptake * 0.9 - (chemistry.oxygen.values[index] ?? 0) * 0.00004) * years;
  }
  return (Object.keys(values) as Array<keyof typeof values>).map((field) => ({
    field,
    operation: "add" as const,
    values: values[field],
    causeRuleId: `ocean:marine-${field}-cycle`,
  }));
};
