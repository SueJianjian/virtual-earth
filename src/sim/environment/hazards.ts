import { forkRandom, randomFloat } from "../random.ts";
import { projectedYearsAfterStep, simulationStepForWorld } from "../time.ts";
import type { ChemistryChange, EnvironmentDelta, FieldChange, RegionId, WorldEventDraft, WorldState } from "../types.ts";

export const MAX_NATURAL_HAZARDS_PER_STEP = 3;
const REFERENCE_HAZARD_CELL_COUNT = 128;

export type NaturalHazardKind = "volcano" | "earthquake" | "drought" | "flood";

export type NaturalHazard = {
  kind: NaturalHazardKind;
  index: number;
  regionId: RegionId;
  intensity: number;
  probability: number;
  roll: number;
  evidence: Record<string, number | string | boolean>;
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const regionForIndex = (state: WorldState, index: number): RegionId =>
  `region:${index % state.fields.elevation.width}:${Math.floor(index / state.fields.elevation.width)}` as RegionId;

const neighborsForIndex = (state: WorldState, index: number): number[] => {
  const { width, height } = state.fields.elevation;
  const x = index % width;
  const y = Math.floor(index / width);
  return [
    y > 0 ? index - width : undefined,
    y + 1 < height ? index + width : undefined,
    y * width + (x + width - 1) % width,
    y * width + (x + 1) % width,
  ].filter((candidate): candidate is number => candidate !== undefined);
};

const probabilityAcross = (annualProbability: number, elapsedYears: number): number => {
  const rate = clamp(annualProbability);
  const years = Math.max(0, elapsedYears);
  if (rate <= 0 || years <= 0) return 0;
  if (rate >= 1) return 1;
  // expm1/log1p preserve small probabilities without imposing an arbitrary
  // maximum duration on a long simulation step.
  return clamp(-Math.expm1(years * Math.log1p(-rate)));
};

const intensityFor = (score: number, threshold: number): number =>
  round(clamp(0.32 + Math.max(0, score - threshold) / Math.max(0.001, 1 - threshold) * 0.62));

const evaluateHazard = (
  state: WorldState,
  index: number,
  kind: NaturalHazardKind,
  score: number,
  threshold: number,
  annualProbability: number,
  elapsedYears: number,
  evidence: Record<string, number | string | boolean>,
): NaturalHazard | undefined => {
  if (score < threshold) return undefined;
  const probability = probabilityAcross(annualProbability, elapsedYears);
  const regionId = regionForIndex(state, index);
  const [roll] = randomFloat(forkRandom(state.random, `natural-hazard:${kind}:${regionId}:${simulationStepForWorld(state)}`));
  if (roll >= probability) return undefined;
  return {
    kind,
    index,
    regionId,
    intensity: intensityFor(score, threshold),
    probability: round(probability),
    roll: round(roll),
    evidence: { ...evidence, score: round(score), threshold, regionId },
  };
};

const compareHazards = (left: NaturalHazard, right: NaturalHazard): number =>
  right.intensity - left.intensity
  || right.probability - left.probability
  || left.kind.localeCompare(right.kind)
  || left.regionId.localeCompare(right.regionId);

const retainHazard = (retained: NaturalHazard[], candidate: NaturalHazard): void => {
  const sameRegion = retained.findIndex((existing) => existing.regionId === candidate.regionId);
  if (sameRegion >= 0) {
    if (compareHazards(candidate, retained[sameRegion]!) < 0) retained[sameRegion] = candidate;
    return;
  }
  if (retained.length < MAX_NATURAL_HAZARDS_PER_STEP) {
    retained.push(candidate);
    return;
  }
  let worst = 0;
  for (let candidateIndex = 1; candidateIndex < retained.length; candidateIndex += 1) {
    if (compareHazards(retained[candidateIndex]!, retained[worst]!) > 0) worst = candidateIndex;
  }
  if (compareHazards(candidate, retained[worst]!) < 0) retained[worst] = candidate;
};

export const naturalHazardsFor = (state: WorldState, elapsedYears = 1): NaturalHazard[] => {
  if (state.formation.phase !== "stable-crust" || elapsedYears <= 0) return [];
  // Grid resolution changes visual and local simulation detail, not the
  // physical area of the planet. Normalize per-cell sampling to keep the
  // global hazard rate comparable across map resolutions.
  const { elevation, temperature, humidity, water, nutrients } = state.fields;
  const cellCount = elevation.values.length;
  const samplingScale = REFERENCE_HAZARD_CELL_COUNT / Math.max(1, cellCount);
  const width = elevation.width;
  const height = elevation.height;
  const sampleScale = round(samplingScale);
  const retained: NaturalHazard[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const y = Math.floor(index / width);
    const rowStart = y * width;
    const x = index - rowStart;
    const north = y > 0 ? index - width : index;
    const south = y + 1 < height ? index + width : index;
    const west = rowStart + (x + width - 1) % width;
    const east = rowStart + (x + 1) % width;
    const elevationValue = clamp(elevation.values[index] ?? 0);
    const localMean = (
      (elevation.values[north] ?? elevationValue)
      + (elevation.values[south] ?? elevationValue)
      + (elevation.values[west] ?? elevationValue)
      + (elevation.values[east] ?? elevationValue)
    ) / 4;
    const relief = clamp(Math.abs(elevationValue - localMean) * 9);
    const localPlateIndex = Math.trunc(state.tectonics.plateIndex.values[index] ?? 0);
    const peerPlateIndex = [north, south, west, east]
      .map((neighbor) => Math.trunc(state.tectonics.plateIndex.values[neighbor] ?? localPlateIndex))
      .find((candidate) => candidate !== localPlateIndex);
    const plate = state.tectonics.plates[localPlateIndex];
    const peerPlate = peerPlateIndex === undefined ? undefined : state.tectonics.plates[peerPlateIndex];
    const stress = clamp(state.tectonics.boundaryStress.values[index] ?? 0);
    const activity = Math.max(-1, Math.min(1, state.tectonics.boundaryActivity.values[index] ?? 0));
    const boundaryType = stress < 0.01 ? "interior" : activity >= 0.12 ? "convergent" : activity <= -0.12 ? "divergent" : "transform";
    const temperatureValue = clamp(temperature.values[index] ?? 0);
    const humidityValue = clamp(humidity.values[index] ?? 0);
    const atmosphereEstablished = state.atmosphere.updateCount > 0;
    const precipitationValue = atmosphereEstablished
      ? clamp(state.atmosphere.precipitation.values[index] ?? 0)
      : humidityValue;
    const pressureValue = atmosphereEstablished ? clamp(state.atmosphere.pressure.values[index] ?? 0.5) : 0.5;
    const windSpeed = atmosphereEstablished
      ? clamp(Math.hypot(state.atmosphere.windX.values[index] ?? 0, state.atmosphere.windY.values[index] ?? 0))
      : 0;
    const waterValue = clamp(water.values[index] ?? 0);
    const nutrientsValue = clamp(nutrients.values[index] ?? 0);
    const volcanicScore = clamp(stress * 0.62 + Math.abs(activity) * 0.16 + elevationValue * 0.12 + relief * 0.1);
    const earthquakeScore = clamp(stress * 0.8 + relief * 0.2);
    const heat = clamp((temperatureValue - 0.6) / 0.4);
    const aridity = (clamp((0.4 - humidityValue) / 0.4) + clamp((0.34 - waterValue) / 0.34) + clamp((0.28 - precipitationValue) / 0.28)) / 3;
    const droughtScore = clamp(heat * 0.4 + aridity * 0.6);
    const wetness = waterValue * 0.46 + humidityValue * 0.2 + precipitationValue * 0.34;
    const floodScore = clamp(wetness * 0.7 + (1 - elevationValue) * 0.3);
    const common = volcanicScore >= 0.73 || earthquakeScore >= 0.78 || droughtScore >= 0.74 || floodScore >= 0.78
      ? {
        elevation: round(elevationValue),
        temperature: round(temperatureValue),
        humidity: round(humidityValue),
        precipitation: round(precipitationValue),
        pressure: round(pressureValue),
        windSpeed: round(windSpeed),
        water: round(waterValue),
        nutrients: round(nutrientsValue),
        samplingScale: sampleScale,
        plateId: plate?.id ?? "unknown",
        ...(peerPlate ? { peerPlateId: peerPlate.id } : {}),
        boundaryType,
        tectonicActivity: round(activity),
      }
      : undefined;
    if (common && volcanicScore >= 0.73) {
      const candidate = evaluateHazard(state, index, "volcano", volcanicScore, 0.73, (0.00035 + Math.max(0, volcanicScore - 0.73) * 0.0022) * samplingScale, elapsedYears, { ...common, tectonicStress: round(stress), relief: round(relief) });
      if (candidate) retainHazard(retained, candidate);
    }
    if (common && earthquakeScore >= 0.78) {
      const candidate = evaluateHazard(state, index, "earthquake", earthquakeScore, 0.78, (0.00028 + Math.max(0, earthquakeScore - 0.78) * 0.0018) * samplingScale, elapsedYears, { ...common, tectonicStress: round(stress), relief: round(relief) });
      if (candidate) retainHazard(retained, candidate);
    }
    if (common && droughtScore >= 0.74) {
      const candidate = evaluateHazard(state, index, "drought", droughtScore, 0.74, (0.00065 + Math.max(0, droughtScore - 0.74) * 0.0024) * samplingScale, elapsedYears, { ...common, heat: round(heat), aridity: round(aridity) });
      if (candidate) retainHazard(retained, candidate);
    }
    if (common && floodScore >= 0.78) {
      const candidate = evaluateHazard(state, index, "flood", floodScore, 0.78, (0.00055 + Math.max(0, floodScore - 0.78) * 0.002) * samplingScale, elapsedYears, { ...common, wetness: round(wetness), basin: round(1 - elevationValue) });
      if (candidate) retainHazard(retained, candidate);
    }
  }
  return retained.sort(compareHazards);
};

const fieldChange = (hazard: NaturalHazard, field: FieldChange["field"], value: number): FieldChange => ({
  field,
  index: hazard.index,
  operation: "add",
  value: round(value),
  causeRuleId: `environment:natural-${hazard.kind}`,
});

const chemistryChange = (hazard: NaturalHazard, field: ChemistryChange["field"], value: number): ChemistryChange => ({
  field,
  index: hazard.index,
  operation: "add",
  value: round(value),
  causeRuleId: `environment:natural-${hazard.kind}`,
});

export const naturalHazardDelta = (state: WorldState, elapsedYears = 1): { hazards: NaturalHazard[]; delta: EnvironmentDelta } => {
  const delta: EnvironmentDelta = {
    fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
    resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
  };
  const hazards = naturalHazardsFor(state, elapsedYears);
  for (const hazard of hazards) {
    const intensity = hazard.intensity;
    if (hazard.kind === "volcano") {
      delta.fieldChanges.push(fieldChange(hazard, "elevation", intensity * 0.045), fieldChange(hazard, "temperature", intensity * 0.13), fieldChange(hazard, "nutrients", intensity * 0.16), fieldChange(hazard, "biomass", -intensity * 0.24), fieldChange(hazard, "humidity", -intensity * 0.035));
      delta.chemistryChanges.push(chemistryChange(hazard, "carbon", intensity * 0.04), chemistryChange(hazard, "oxygen", -intensity * 0.035), chemistryChange(hazard, "organics", -intensity * 0.012));
    } else if (hazard.kind === "earthquake") {
      delta.fieldChanges.push(fieldChange(hazard, "elevation", intensity * 0.025), fieldChange(hazard, "nutrients", intensity * 0.09), fieldChange(hazard, "biomass", -intensity * 0.14));
      delta.chemistryChanges.push(chemistryChange(hazard, "phosphorus", intensity * 0.016), chemistryChange(hazard, "organics", -intensity * 0.008));
    } else if (hazard.kind === "drought") {
      delta.fieldChanges.push(fieldChange(hazard, "temperature", intensity * 0.035), fieldChange(hazard, "humidity", -intensity * 0.2), fieldChange(hazard, "nutrients", -intensity * 0.05), fieldChange(hazard, "biomass", -intensity * 0.2));
      delta.chemistryChanges.push(chemistryChange(hazard, "organics", -intensity * 0.012), chemistryChange(hazard, "oxygen", -intensity * 0.008));
    } else {
      delta.fieldChanges.push(fieldChange(hazard, "temperature", -intensity * 0.025), fieldChange(hazard, "humidity", intensity * 0.12), fieldChange(hazard, "nutrients", intensity * 0.06), fieldChange(hazard, "biomass", -intensity * 0.11));
      delta.chemistryChanges.push(chemistryChange(hazard, "organics", -intensity * 0.006), chemistryChange(hazard, "phosphorus", intensity * 0.012));
    }
    const years = projectedYearsAfterStep(state, Math.max(0, elapsedYears));
    const event: WorldEventDraft = {
      kind: hazard.kind,
      ruleId: `environment:natural-${hazard.kind}`,
      years,
      position: [hazard.index % state.fields.elevation.width, Math.floor(hazard.index / state.fields.elevation.width)],
      sourceIds: hazard.kind === "volcano" || hazard.kind === "earthquake"
        ? [hazard.evidence.plateId, hazard.evidence.peerPlateId]
          .filter((value): value is string => typeof value === "string")
        : [],
      probability: hazard.probability,
      roll: hazard.roll,
      evidence: { ...hazard.evidence, intensity },
      payload: { regionId: hazard.regionId, intensity, name: `natural-${hazard.kind}` },
      source: "natural",
    };
    delta.eventDrafts.push(event);
  }
  return { hazards, delta };
};

export const applyNaturalHazardWaterEffects = (state: WorldState, water: Float32Array, hazards: readonly NaturalHazard[]): Float32Array => {
  if (!hazards.some((hazard) => hazard.kind === "drought" || hazard.kind === "flood")) return water;
  const result = new Float32Array(water);
  for (const hazard of hazards) {
    if (hazard.kind !== "drought" && hazard.kind !== "flood") continue;
    const neighbors = neighborsForIndex(state, hazard.index);
    if (neighbors.length === 0) continue;
    if (hazard.kind === "drought") {
      const available = result[hazard.index] ?? 0;
      const transfer = Math.min(available, hazard.intensity * 0.12);
      result[hazard.index] = available - transfer;
      for (const neighbor of neighbors) result[neighbor] = clamp((result[neighbor] ?? 0) + transfer / neighbors.length);
    } else {
      const capacity = Math.max(0, 1 - (result[hazard.index] ?? 0));
      const requested = Math.min(capacity, hazard.intensity * 0.14);
      const available = neighbors.reduce((sum, neighbor) => sum + (result[neighbor] ?? 0), 0);
      const transfer = Math.min(requested, available);
      if (transfer <= 0) continue;
      for (const neighbor of neighbors) {
        const share = (result[neighbor] ?? 0) / Math.max(0.000001, available);
        result[neighbor] = Math.max(0, (result[neighbor] ?? 0) - transfer * share);
      }
      result[hazard.index] = clamp((result[hazard.index] ?? 0) + transfer);
    }
  }
  return result;
};
