import { calculateChemistry, applyChemistryChanges } from "./chemistry.ts";
import { calculateClimate } from "./climate.ts";
import { simulateWater } from "./hydrology.ts";
import { initializeTerrainWater } from "./terrain.ts";
import { calculateGeology } from "./geology.ts";
import { stepPlanetFormation } from "./formation.ts";
import { stepSubstances } from "./substances.ts";
import { applyNaturalHazardWaterEffects, naturalHazardDelta } from "./hazards.ts";
import { OCEAN_MILESTONE_THRESHOLD, PREBIOTIC_ORGANICS_THRESHOLD } from "./thresholds.ts";
import { technologyProfilesForState } from "../culture/technology.ts";
import type {
  EnvironmentDelta,
  EnvironmentInput,
  WorldEvent,
  WorldState,
} from "../types.ts";

const emptyDelta = (): EnvironmentDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const isEmpty = (values: Float32Array): boolean =>
  values.every((value) => value <= 0);

const average = (values: Float32Array): number => {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
};

const fractionAtLeast = (values: Float32Array, threshold: number): number => {
  if (values.length === 0) return 0;
  let count = 0;
  for (const value of values) if (value >= threshold) count += 1;
  return count / values.length;
};


const addEnvironmentalMilestones = (
  state: WorldState,
  delta: EnvironmentDelta,
  nextWater: Float32Array,
  nextChemistry: WorldState["chemistry"],
  elapsedYears: number,
): void => {
  const beforeOcean = fractionAtLeast(state.fields.water.values, 0.5);
  const afterOcean = fractionAtLeast(nextWater, 0.5);
  const eventYears = state.years + Math.max(0, elapsedYears);
  if (beforeOcean < OCEAN_MILESTONE_THRESHOLD && afterOcean >= OCEAN_MILESTONE_THRESHOLD) {
    delta.eventDrafts.push({
      kind: "ocean-formation",
      ruleId: "environment:ocean-condensation",
      years: eventYears,
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { oceanCoverage: afterOcean, waterCoverage: average(nextWater) },
      payload: { name: "稳定海洋形成", threshold: OCEAN_MILESTONE_THRESHOLD },
      source: "natural",
    });
  }
  const beforeOrganics = average(state.chemistry.organics.values);
  const afterOrganics = average(nextChemistry.organics.values);
  if (beforeOrganics < PREBIOTIC_ORGANICS_THRESHOLD && afterOrganics >= PREBIOTIC_ORGANICS_THRESHOLD) {
    delta.eventDrafts.push({
      kind: "prebiotic-chemistry",
      ruleId: "environment:prebiotic-organics",
      years: eventYears,
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { organics: afterOrganics, oceanCoverage: afterOcean },
      payload: { name: "前生物有机化学建立", threshold: PREBIOTIC_ORGANICS_THRESHOLD },
      source: "natural",
    });
  }
};

const terrainNutrients = (state: WorldState): Float32Array => {
  const nutrients = new Float32Array(state.fields.elevation.values.length);
  for (let index = 0; index < nutrients.length; index += 1) {
    nutrients[index] = Math.max(
      0,
      Math.min(1, (1 - (state.fields.elevation.values[index] ?? 0)) * 0.32),
    );
  }
  return nutrients;
};

const activeUserEvents = (state: WorldState, incoming: WorldEvent[]): WorldEvent[] => {
  const events = incoming.length > 0 ? [...state.events, ...incoming] : state.events;
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    if (event.source !== "user") return incoming.includes(event);
    const duration = Math.max(1, Math.trunc(Number(event.payload.duration ?? 1)));
    return incoming.includes(event) || state.tick - event.tick < duration;
  });
};

export const initializeEnvironment = (state: WorldState): WorldState => {
  const next = structuredClone(state);
  const water = initializeTerrainWater(next);
  const climate = calculateClimate({
    ...next,
    fields: { ...next.fields, water: { ...next.fields.water, values: water } },
  });
  next.fields.water.values.set(water);
  next.fields.temperature.values.set(climate.temperature);
  next.fields.humidity.values.set(climate.humidity);
  next.fields.nutrients.values.set(terrainNutrients(next));
  return next;
};

export const stepEnvironment = (
  state: WorldState,
  input: EnvironmentInput,
): EnvironmentDelta => {
  const activeEvents = activeUserEvents(state, input.externalEvents);
  if (state.formation.phase !== "stable-crust") return stepPlanetFormation(state, { ...input, externalEvents: activeEvents });
  const delta = emptyDelta();
  const elapsedYears = Math.max(0, input.elapsedYears ?? 1);
  const isBlankStart = isEmpty(state.fields.water.values);
  const needsNutrients = isEmpty(state.fields.nutrients.values);
  // Only the fields recalculated below need writable copies. Cloning the full
  // world here also cloned the entire historical event ledger every year.
  const workingState = {
    ...state,
    fields: {
      ...state.fields,
      water: { ...state.fields.water, values: new Float32Array(state.fields.water.values) },
      temperature: { ...state.fields.temperature, values: new Float32Array(state.fields.temperature.values) },
      humidity: { ...state.fields.humidity, values: new Float32Array(state.fields.humidity.values) },
      nutrients: { ...state.fields.nutrients, values: new Float32Array(state.fields.nutrients.values) },
    },
  } as WorldState;
  if (isBlankStart) {
    workingState.fields.water.values.set(initializeTerrainWater(workingState));
  }
  if (needsNutrients) {
    workingState.fields.nutrients.values.set(terrainNutrients(workingState));
  }
  const climate = calculateClimate(workingState, input.solarFlux);
  workingState.fields.temperature.values.set(climate.temperature);
  workingState.fields.humidity.values.set(climate.humidity);
  const hazardResult = naturalHazardDelta(workingState, elapsedYears);
  const water = applyNaturalHazardWaterEffects(
    workingState,
    simulateWater(workingState, activeEvents, elapsedYears),
    hazardResult.hazards,
  );
  for (let index = 0; index < water.length; index += 1) {
    delta.fieldChanges.push(
      { field: "temperature", index, operation: "set", value: climate.temperature[index] ?? 0, causeRuleId: "climate-field" },
      { field: "humidity", index, operation: "set", value: climate.humidity[index] ?? 0, causeRuleId: "climate-field" },
      { field: "water", index, operation: "set", value: water[index] ?? 0, causeRuleId: "hydrology-cycle" },
    );
    if (needsNutrients) {
      delta.fieldChanges.push({
        field: "nutrients",
        index,
        operation: "set",
        value: workingState.fields.nutrients.values[index] ?? 0,
        causeRuleId: "terrain-nutrients",
      });
    }
  }
  delta.chemistryChanges = calculateChemistry(workingState, elapsedYears);
  delta.fieldChanges.push(...hazardResult.delta.fieldChanges);
  delta.chemistryChanges.push(...hazardResult.delta.chemistryChanges);
  delta.eventDrafts.push(...hazardResult.delta.eventDrafts);
  const technologyByRegion = technologyProfilesForState(state);
  for (let index = 0; index < state.fields.elevation.values.length; index += 1) {
    const x = index % state.fields.elevation.width;
    const y = Math.floor(index / state.fields.elevation.width);
    const technology = technologyByRegion.get(`region:${x}:${y}` as WorldState["cultures"][number]["regionId"]);
    if (!technology) continue;
    const organics = state.chemistry.organics.values[index] ?? 0;
    const conversion = Math.min(0.0015, organics * technology.energy * 0.004) * elapsedYears;
    if (conversion <= 0.000001) continue;
    delta.chemistryChanges.push(
      { field: "organics", index, operation: "add", value: -conversion, causeRuleId: "culture:energy-conversion" },
      { field: "carbon", index, operation: "add", value: conversion * 0.18, causeRuleId: "culture:energy-conversion" },
      { field: "oxygen", index, operation: "add", value: conversion * 0.06, causeRuleId: "culture:energy-conversion" },
    );
  }
  const nextChemistry = applyChemistryChanges(workingState, delta.chemistryChanges);
  addEnvironmentalMilestones(state, delta, water, nextChemistry, elapsedYears);
  delta.fieldChanges.push(...calculateGeology(workingState, elapsedYears));
  const width = state.fields.elevation.width;
  for (const event of activeEvents) {
    const region = String(event.evidence.regionId ?? event.payload.regionId ?? "region:0:0");
    const match = /^region:(\d+):(\d+)$/.exec(region);
    const x = Math.max(0, Math.min(width - 1, Number(match?.[1] ?? 0)));
    const y = Math.max(0, Math.min(state.fields.elevation.height - 1, Number(match?.[2] ?? 0)));
    const index = y * width + x;
    const intensity = Math.max(0, Math.min(1, Number(event.payload.amount ?? event.probability)));
    const addField = (field: "elevation" | "temperature" | "humidity" | "water" | "nutrients" | "biomass", value: number) => delta.fieldChanges.push({ field, index, operation: "add", value, causeRuleId: `user-${event.kind}` });
    const addChemistry = (field: "carbon" | "nitrogen" | "phosphorus" | "organics" | "oxygen", value: number) => delta.chemistryChanges.push({ field, index, operation: "add", value, causeRuleId: `user-${event.kind}` });
    if (event.kind === "raise-terrain") addField("elevation", intensity * 0.15);
    else if (event.kind === "lower-terrain") addField("elevation", -intensity * 0.15);
    else if (event.kind === "heat" || event.kind === "volcano" || event.kind === "meteor") addField("temperature", intensity * 0.18);
    else if (event.kind === "cool" || event.kind === "cold-snap" || event.kind === "volcanic-winter") addField("temperature", -intensity * 0.18);
    else if (event.kind === "add-rain") addField("humidity", intensity * 0.2);
    else if (event.kind === "add-minerals" || event.kind === "earthquake") addField("nutrients", intensity * 0.2);
    else if (event.kind === "add-organics" || event.kind === "seed-life") addChemistry("organics", intensity * 0.2);
  }
  const substanceDelta = stepSubstances({
    ...workingState,
    fields: {
      ...workingState.fields,
      water: { ...workingState.fields.water, values: water },
    },
    chemistry: nextChemistry,
  }, elapsedYears);
  delta.entityEffects.push(...substanceDelta.entityEffects);
  delta.eventDrafts.push(...substanceDelta.eventDrafts);
  return delta;
};

export const applyEnvironmentDelta = (
  state: WorldState,
  delta: EnvironmentDelta,
): WorldState => {
  const next = structuredClone(state);
  for (const change of delta.fieldChanges) {
    const values = next.fields[change.field].values;
    values[change.index] = change.operation === "add"
      ? (values[change.index] ?? 0) + change.value
      : change.value;
  }
  next.chemistry = applyChemistryChanges(next, delta.chemistryChanges);
  return next;
};

export { calculateChemistry, calculateClimate, initializeTerrainWater, simulateWater };
export { calculateGeology } from "./geology.ts";
export { applyNaturalHazardWaterEffects, naturalHazardDelta, naturalHazardsFor, MAX_NATURAL_HAZARDS_PER_STEP, type NaturalHazard, type NaturalHazardKind } from "./hazards.ts";
export { deriveNaturalSubstance, MAX_SUBSTANCES, stepSubstances, substanceEffectProfileForRegion, substanceEffectProfilesForState } from "./substances.ts";
export { ABIOGENESIS_WATER_THRESHOLD, OCEAN_MILESTONE_THRESHOLD, PREBIOTIC_ORGANICS_THRESHOLD } from "./thresholds.ts";
export { completedPlanetFormationState, createPlanetFormationState, formationPhaseForProgress, formedElevation, FORMATION_DURATION_DAYS, primordialDustElevation, stepPlanetFormation } from "./formation.ts";
