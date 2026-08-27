import { forkRandom, randomFloat } from "../random.ts";
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

const localRelief = (state: WorldState, index: number): number => {
  const elevation = state.fields.elevation.values[index] ?? 0;
  const neighbors = neighborsForIndex(state, index);
  const average = neighbors.reduce((sum, candidate) => sum + (state.fields.elevation.values[candidate] ?? elevation), 0) / Math.max(1, neighbors.length);
  return clamp(Math.abs(elevation - average) * 9);
};

const tectonicStress = (state: WorldState, index: number): number => {
  const { width, height } = state.fields.elevation;
  const x = index % width;
  const y = Math.floor(index / width);
  const phase = (state.seed % 4096) / 4096 * Math.PI * 2;
  const plate = Math.sin(x / Math.max(1, width) * Math.PI * 4 + phase)
    * Math.cos(y / Math.max(1, height - 1) * Math.PI * 2 - phase * 0.7);
  const pulse = 0.55 + Math.sin(state.years / 180 + phase) * 0.45;
  return clamp(Math.abs(plate) * pulse);
};

const probabilityAcross = (annualProbability: number, elapsedYears: number): number => {
  const years = Math.max(0, Math.min(20_000, elapsedYears));
  return clamp(1 - Math.pow(1 - clamp(annualProbability), years));
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
  const [roll] = randomFloat(forkRandom(state.random, `natural-hazard:${kind}:${regionId}:${state.tick}:${state.years}`));
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

export const naturalHazardsFor = (state: WorldState, elapsedYears = 1): NaturalHazard[] => {
  if (state.formation.phase !== "stable-crust" || elapsedYears <= 0) return [];
  const candidates: NaturalHazard[] = [];
  // Grid resolution changes visual and local simulation detail, not the
  // physical area of the planet. Normalize per-cell sampling to keep the
  // global hazard rate comparable across map resolutions.
  const samplingScale = REFERENCE_HAZARD_CELL_COUNT / Math.max(1, state.fields.elevation.values.length);
  for (let index = 0; index < state.fields.elevation.values.length; index += 1) {
    const elevation = clamp(state.fields.elevation.values[index] ?? 0);
    const temperature = clamp(state.fields.temperature.values[index] ?? 0);
    const humidity = clamp(state.fields.humidity.values[index] ?? 0);
    const water = clamp(state.fields.water.values[index] ?? 0);
    const nutrients = clamp(state.fields.nutrients.values[index] ?? 0);
    const relief = localRelief(state, index);
    const stress = tectonicStress(state, index);
    const volcanicScore = clamp(stress * 0.54 + elevation * 0.3 + relief * 0.16);
    const earthquakeScore = clamp(stress * 0.68 + relief * 0.32);
    const heat = clamp((temperature - 0.6) / 0.4);
    const aridity = (clamp((0.4 - humidity) / 0.4) + clamp((0.34 - water) / 0.34)) / 2;
    const droughtScore = clamp(heat * 0.42 + aridity * 0.58);
    const wetness = (water + humidity) / 2;
    const floodScore = clamp(wetness * 0.68 + (1 - elevation) * 0.32);
    const common = { elevation: round(elevation), temperature: round(temperature), humidity: round(humidity), water: round(water), nutrients: round(nutrients), samplingScale: round(samplingScale) };
    const volcano = evaluateHazard(state, index, "volcano", volcanicScore, 0.73, (0.00035 + Math.max(0, volcanicScore - 0.73) * 0.0022) * samplingScale, elapsedYears, { ...common, tectonicStress: round(stress), relief: round(relief) });
    const earthquake = evaluateHazard(state, index, "earthquake", earthquakeScore, 0.78, (0.00028 + Math.max(0, earthquakeScore - 0.78) * 0.0018) * samplingScale, elapsedYears, { ...common, tectonicStress: round(stress), relief: round(relief) });
    const drought = evaluateHazard(state, index, "drought", droughtScore, 0.74, (0.00065 + Math.max(0, droughtScore - 0.74) * 0.0024) * samplingScale, elapsedYears, { ...common, heat: round(heat), aridity: round(aridity) });
    const flood = evaluateHazard(state, index, "flood", floodScore, 0.78, (0.00055 + Math.max(0, floodScore - 0.78) * 0.002) * samplingScale, elapsedYears, { ...common, wetness: round(wetness), basin: round(1 - elevation) });
    for (const hazard of [volcano, earthquake, drought, flood]) if (hazard) candidates.push(hazard);
  }
  const occupiedRegions = new Set<RegionId>();
  const selected: NaturalHazard[] = [];
  for (const candidate of candidates.sort((left, right) => right.intensity - left.intensity || right.probability - left.probability || left.kind.localeCompare(right.kind) || left.regionId.localeCompare(right.regionId))) {
    if (selected.length >= MAX_NATURAL_HAZARDS_PER_STEP || occupiedRegions.has(candidate.regionId)) continue;
    occupiedRegions.add(candidate.regionId);
    selected.push(candidate);
  }
  return selected;
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
    const years = state.years + Math.max(0, elapsedYears);
    const event: WorldEventDraft = {
      kind: hazard.kind,
      ruleId: `environment:natural-${hazard.kind}`,
      years,
      position: [hazard.index % state.fields.elevation.width, Math.floor(hazard.index / state.fields.elevation.width)],
      sourceIds: [],
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
