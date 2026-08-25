import { calculateChemistry, applyChemistryChanges } from "./chemistry.ts";
import { calculateClimate } from "./climate.ts";
import { simulateWater } from "./hydrology.ts";
import { initializeTerrainWater } from "./terrain.ts";
import type {
  EnvironmentDelta,
  EnvironmentInput,
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
  for (let index = 0; index < next.fields.elevation.values.length; index += 1) {
    next.fields.nutrients.values[index] = Math.max(
      0,
      Math.min(1, (1 - (next.fields.elevation.values[index] ?? 0)) * 0.32),
    );
  }
  return next;
};

export const stepEnvironment = (
  state: WorldState,
  input: EnvironmentInput,
): EnvironmentDelta => {
  const delta = emptyDelta();
  const climate = calculateClimate(state, input.solarFlux);
  const water = simulateWater(state, input.externalEvents);
  for (let index = 0; index < water.length; index += 1) {
    delta.fieldChanges.push(
      { field: "temperature", index, operation: "set", value: climate.temperature[index] ?? 0, causeRuleId: "climate-field" },
      { field: "humidity", index, operation: "set", value: climate.humidity[index] ?? 0, causeRuleId: "climate-field" },
      { field: "water", index, operation: "set", value: water[index] ?? 0, causeRuleId: "hydrology-cycle" },
    );
  }
  delta.chemistryChanges = calculateChemistry(state);
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
