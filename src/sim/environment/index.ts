import { calculateChemistry, calculateChemistryPatches, projectChemistry } from "./chemistry.ts";
import { calculateClimate } from "./climate.ts";
import { simulateWater } from "./hydrology.ts";
import { initializeTerrainWater } from "./terrain.ts";
import { stepTectonics } from "./geology.ts";
import { stepPlanetFormation } from "./formation.ts";
import { stepSubstances } from "./substances.ts";
import { applyNaturalHazardWaterEffects, naturalHazardDelta } from "./hazards.ts";
import { OCEAN_MILESTONE_THRESHOLD, PREBIOTIC_ORGANICS_THRESHOLD } from "./thresholds.ts";
import { technologyProfilesForState } from "../culture/technology.ts";
import { isWorldEventActive } from "../events/ledger.ts";
import { advanceSimulationTimeline, nextSimulationStep, projectedYearsAfterStep, simulationDaysFromYears, timelineForWorld } from "../time.ts";
import { advanceClimateCycle } from "./cycle.ts";
import { orbitalStateForWorld } from "./orbit.ts";
import { calculateAtmosphere } from "./atmosphere.ts";
import { calculateMarineChemistryPatches, calculateOcean } from "./ocean.ts";
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

const appendItems = <T>(target: T[], source: readonly T[]): void => {
  for (const item of source) target.push(item);
};

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

const milestoneRecorded = (state: WorldState, kind: WorldEvent["kind"]): boolean =>
  (state.eventArchive.kindCounts[kind] ?? 0) > 0
  || state.eventArchive.milestones.some((milestone) => milestone.kind === kind)
  || state.events.some((event) => event.kind === kind);

const addEnvironmentalMilestones = (
  state: WorldState,
  delta: EnvironmentDelta,
  nextWater: Float32Array,
  nextChemistry: WorldState["chemistry"],
  elapsedYears: number,
): void => {
  const needsOceanMilestone = !milestoneRecorded(state, "ocean-formation");
  const needsPrebioticMilestone = !milestoneRecorded(state, "prebiotic-chemistry");
  if (!needsOceanMilestone && !needsPrebioticMilestone) return;
  const afterOcean = fractionAtLeast(nextWater, 0.5);
  const eventYears = projectedYearsAfterStep(state, Math.max(0, elapsedYears));
  if (needsOceanMilestone
    && fractionAtLeast(state.fields.water.values, 0.5) < OCEAN_MILESTONE_THRESHOLD
    && afterOcean >= OCEAN_MILESTONE_THRESHOLD) {
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
  if (!needsPrebioticMilestone) return;
  const afterOrganics = average(nextChemistry.organics.values);
  if (average(state.chemistry.organics.values) < PREBIOTIC_ORGANICS_THRESHOLD && afterOrganics >= PREBIOTIC_ORGANICS_THRESHOLD) {
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
  const incomingIds = new Set(incoming.map((event) => event.id));
  const seen = new Set<string>();
  const active: WorldEvent[] = [];
  const consider = (event: WorldEvent): void => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (event.source !== "user") {
      if (incomingIds.has(event.id)) active.push(event);
      return;
    }
    if (incomingIds.has(event.id) || isWorldEventActive(event, state.timeline?.step ?? String(state.tick))) active.push(event);
  };
  for (const event of state.events) consider(event);
  for (const event of incoming) consider(event);
  return active;
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
  next.atmosphere = calculateAtmosphere(next.atmosphere, next.fields, next.seed, {
    elapsedYears: 0,
    lastUpdatedTick: next.tick,
    timelineStep: next.timeline?.step ?? String(next.tick),
    lastUpdatedYears: next.years,
  });
  next.ocean = calculateOcean(next.ocean, next.fields, next.atmosphere, next.seed, {
    elapsedYears: 0,
    lastUpdatedTick: next.tick,
    timelineStep: next.timeline?.step ?? String(next.tick),
    lastUpdatedYears: next.years,
  }, next.chemistry);
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
  const waterAtStart = isBlankStart ? initializeTerrainWater(state) : state.fields.water.values;
  const climateState = isBlankStart
    ? {
      ...state,
      fields: { ...state.fields, water: { ...state.fields.water, values: waterAtStart } },
    } as WorldState
    : state;
  const climateProjection = input.timelineDays === undefined
    ? climateState
    : {
      ...climateState,
      timeline: { ...timelineForWorld(climateState), days: input.timelineDays },
    } as WorldState;
  const climate = calculateClimate(climateProjection, input.solarFlux);
  const nutrientValues = needsNutrients ? terrainNutrients(state) : state.fields.nutrients.values;
  // Climate already returns fresh typed arrays. Reuse them as the working
  // fields instead of copying the previous grids only to overwrite them.
  const workingState = {
    ...state,
    fields: {
      ...state.fields,
      water: { ...state.fields.water, values: waterAtStart },
      temperature: { ...state.fields.temperature, values: climate.temperature },
      humidity: { ...state.fields.humidity, values: climate.humidity },
      nutrients: { ...state.fields.nutrients, values: nutrientValues },
    },
  } as WorldState;
  const atmosphere = calculateAtmosphere(state.atmosphere, workingState.fields, state.seed, {
    elapsedYears,
    lastUpdatedTick: Math.min(Number.MAX_SAFE_INTEGER, state.tick + 1),
    timelineStep: input.timelineStep ?? nextSimulationStep(state),
    lastUpdatedYears: projectedYearsAfterStep(state, elapsedYears),
  });
  const atmosphereState = { ...workingState, atmosphere } as WorldState;
  const ocean = calculateOcean(state.ocean, workingState.fields, atmosphere, state.seed, {
    elapsedYears,
    lastUpdatedTick: Math.min(Number.MAX_SAFE_INTEGER, state.tick + 1),
    timelineStep: input.timelineStep ?? nextSimulationStep(state),
    lastUpdatedYears: projectedYearsAfterStep(state, elapsedYears),
  }, state.chemistry);
  const oceanState = { ...atmosphereState, ocean } as WorldState;
  const tectonicResult = stepTectonics(oceanState, elapsedYears, input.timelineStep);
  const geologyState = tectonicResult.tectonics
    ? { ...oceanState, tectonics: tectonicResult.tectonics } as WorldState
    : oceanState;
  const hazardResult = naturalHazardDelta(geologyState, elapsedYears);
  const water = applyNaturalHazardWaterEffects(
    geologyState,
    simulateWater(geologyState, activeEvents, elapsedYears, atmosphere.precipitation),
    hazardResult.hazards,
  );
  const targetTimeline = input.timelineDays === undefined
    ? advanceSimulationTimeline(timelineForWorld(state), elapsedYears)
    : { days: input.timelineDays };
  delta.climateCycleEffect = advanceClimateCycle(
    state.climateCycle,
    {
      meanTemperature: average(climate.temperature),
      meanHumidity: average(climate.humidity),
      meanWater: average(water),
      solarFlux: orbitalStateForWorld(climateProjection).solarFlux * input.solarFlux,
      currentTimelineDays: timelineForWorld(state).days,
      targetTimelineDays: targetTimeline.days,
      targetTimelineStep: input.timelineStep ?? nextSimulationStep(state),
    },
    simulationDaysFromYears(elapsedYears, "Climate cycle step"),
  );
  delta.fieldPatches = [
    { field: "temperature", operation: "set", values: climate.temperature, causeRuleId: "climate-field" },
    { field: "humidity", operation: "set", values: climate.humidity, causeRuleId: "climate-field" },
    { field: "water", operation: "set", values: water, causeRuleId: "hydrology-cycle" },
  ];
  if (needsNutrients) {
    delta.fieldPatches.push({
      field: "nutrients",
      operation: "set",
      values: workingState.fields.nutrients.values,
      causeRuleId: "terrain-nutrients",
    });
  }
  delta.chemistryPatches = [
    ...calculateChemistryPatches(workingState, elapsedYears),
    ...calculateMarineChemistryPatches(ocean, state.chemistry, elapsedYears),
  ];
  appendItems(delta.fieldChanges, hazardResult.delta.fieldChanges);
  appendItems(delta.chemistryChanges, hazardResult.delta.chemistryChanges);
  appendItems(delta.eventDrafts, hazardResult.delta.eventDrafts);
  appendItems(delta.fieldChanges, tectonicResult.fieldChanges);
  appendItems(delta.eventDrafts, tectonicResult.eventDrafts);
  if (tectonicResult.tectonics) delta.tectonicEffect = tectonicResult.tectonics;
  delta.atmosphereEffect = atmosphere;
  delta.oceanEffect = ocean;
  const technologyByRegion = technologyProfilesForState(state);
  const technologyCells = [...technologyByRegion.entries()]
    .filter(([, technology]) => technology.energy > 0)
    .map(([regionId, technology]) => {
      const match = /^region:(\d+):(\d+)$/.exec(regionId);
      const x = Number(match?.[1] ?? -1);
      const y = Number(match?.[2] ?? -1);
      if (x < 0 || x >= state.fields.elevation.width || y < 0 || y >= state.fields.elevation.height) return undefined;
      return { index: y * state.fields.elevation.width + x, technology };
    })
    .filter((cell): cell is NonNullable<typeof cell> => Boolean(cell))
    .sort((left, right) => left.index - right.index);
  for (const { index, technology } of technologyCells) {
    const organics = state.chemistry.organics.values[index] ?? 0;
    const conversion = Math.min(0.0015, organics * technology.energy * 0.004) * elapsedYears;
    if (conversion <= 0.000001) continue;
    delta.chemistryChanges.push(
      { field: "organics", index, operation: "add", value: -conversion, causeRuleId: "culture:energy-conversion" },
      { field: "carbon", index, operation: "add", value: conversion * 0.18, causeRuleId: "culture:energy-conversion" },
      { field: "oxygen", index, operation: "add", value: conversion * 0.06, causeRuleId: "culture:energy-conversion" },
    );
  }
  const nextChemistry = projectChemistry(workingState, delta.chemistryPatches, delta.chemistryChanges);
  addEnvironmentalMilestones(state, delta, water, nextChemistry, elapsedYears);
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
  appendItems(delta.entityEffects, substanceDelta.entityEffects);
  appendItems(delta.eventDrafts, substanceDelta.eventDrafts);
  return delta;
};

export const applyEnvironmentDelta = (
  state: WorldState,
  delta: EnvironmentDelta,
): WorldState => {
  const next = structuredClone(state);
  for (const patch of delta.fieldPatches ?? []) {
    const values = next.fields[patch.field].values;
    if (patch.operation === "set") {
      values.set(patch.values);
      continue;
    }
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.max(0, Math.min(1, (values[index] ?? 0) + (patch.values[index] ?? 0)));
    }
  }
  for (const change of delta.fieldChanges) {
    const values = next.fields[change.field].values;
    values[change.index] = change.operation === "add"
      ? (values[change.index] ?? 0) + change.value
      : change.value;
  }
  next.chemistry = projectChemistry(next, delta.chemistryPatches ?? [], delta.chemistryChanges);
  if (delta.climateCycleEffect) next.climateCycle = structuredClone(delta.climateCycleEffect);
  if (delta.tectonicEffect) next.tectonics = structuredClone(delta.tectonicEffect);
  if (delta.atmosphereEffect) next.atmosphere = structuredClone(delta.atmosphereEffect);
  if (delta.oceanEffect) next.ocean = structuredClone(delta.oceanEffect);
  return next;
};

export { calculateChemistry, calculateChemistryPatches, calculateClimate, initializeTerrainWater, simulateWater };
export { calculateGeology } from "./geology.ts";
export { calculateAtmosphere, createAtmosphereState, isAtmosphereState, restoreAtmosphereState } from "./atmosphere.ts";
export { calculateMarineChemistryPatches, calculateOcean, createOceanState, isOceanCoreState, isOceanState, restoreOceanState } from "./ocean.ts";
export { applyNaturalHazardWaterEffects, naturalHazardDelta, naturalHazardsFor, MAX_NATURAL_HAZARDS_PER_STEP, type NaturalHazard, type NaturalHazardKind } from "./hazards.ts";
export { deriveNaturalSubstance, MAX_SUBSTANCES, stepSubstances, substanceEffectProfileForRegion, substanceEffectProfilesForState } from "./substances.ts";
export { createOrbitalState, diurnalTemperatureOffset, isOrbitalState, orbitalStateAtDays, orbitalStateForWorld, seasonalTemperatureOffset } from "./orbit.ts";
export { advanceClimateCycle, annualClimateForLocal, createClimateCycleState, isClimateCycleState } from "./cycle.ts";
export { ABIOGENESIS_WATER_THRESHOLD, OCEAN_MILESTONE_THRESHOLD, PREBIOTIC_ORGANICS_THRESHOLD } from "./thresholds.ts";
export { completedPlanetFormationState, createPlanetFormationState, formationPhaseForProgress, formedElevation, FORMATION_DURATION_DAYS, primordialDustElevation, stepPlanetFormation } from "./formation.ts";
