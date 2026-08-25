import { attemptAbiogenesis, attemptTrophicSpecies } from "./species.ts";
import { nextPopulationCount, populationCellIndex, suitability } from "./populations.ts";
import type {
  EcologyDelta,
  RuleContext,
  WorldDelta,
  WorldState,
} from "../types.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const mean = (values: Float32Array): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
};

const mergeDelta = (target: WorldDelta, source: WorldDelta): void => {
  target.fieldChanges.push(...source.fieldChanges);
  target.chemistryChanges.push(...source.chemistryChanges);
  target.entityEffects.push(...source.entityEffects);
  target.relationshipEffects.push(...source.relationshipEffects);
  target.resourceTransactions.push(...source.resourceTransactions);
  target.worldviewEffects.push(...source.worldviewEffects);
  target.eventDrafts.push(...source.eventDrafts);
};

export const stepEcology = (state: WorldState, context: RuleContext): EcologyDelta => {
  const delta = emptyDelta();
  const metrics = {
    ...context.metrics,
    waterCoverage: mean(state.fields.water.values),
    nutrientLevel: mean(state.fields.nutrients.values),
    meanTemperature: mean(state.fields.temperature.values),
    populationCount: state.populations.reduce((sum, population) => sum + population.count, 0),
  };
  const ruleContext: RuleContext = { ...context, metrics };
  if (state.species.length === 0 || !state.species.some((species) => species.role === "producer")) {
    mergeDelta(delta, attemptAbiogenesis(ruleContext).delta);
  }

  const producerFood = state.populations.reduce((sum, population) => {
    const species = state.species.find((candidate) => candidate.id === population.speciesId);
    return sum + (species?.role === "producer" ? population.count : 0);
  }, 0) / Math.max(1, state.populations.length);
  if (!state.species.some((species) => species.role === "consumer")) {
    mergeDelta(delta, attemptTrophicSpecies(ruleContext, "consumer", producerFood).delta);
  }
  if (!state.species.some((species) => species.role === "decomposer")) {
    mergeDelta(delta, attemptTrophicSpecies(ruleContext, "decomposer", producerFood * 0.7).delta);
  }

  for (const population of state.populations) {
    const species = state.species.find((candidate) => candidate.id === population.speciesId);
    if (!species) continue;
    const index = populationCellIndex(population, state.fields.elevation.width, state.fields.elevation.height);
    const temperature = state.fields.temperature.values[index] ?? metrics.meanTemperature;
    const humidity = state.fields.humidity.values[index] ?? metrics.meanHumidity;
    const nutrients = state.fields.nutrients.values[index] ?? metrics.nutrientLevel;
    const suitabilityScore = suitability(species, temperature, humidity);
    const food = species.role === "producer" ? nutrients : Math.min(1, producerFood / 10);
    const count = nextPopulationCount(population, species, suitabilityScore, food);
    delta.entityEffects.push({
      collection: "populations",
      operation: count <= 0.001 ? "remove" : "update",
      id: population.id,
      ...(count > 0.001 ? { value: { ...population, count, energy: Math.max(0, population.energy + suitabilityScore * 0.02 - 0.01) } } : {}),
    });
    if (species.role === "producer") {
      delta.fieldChanges.push({
        field: "biomass",
        index,
        operation: "add",
        value: Math.min(0.03, count * 0.000001),
        causeRuleId: "producer-growth",
      });
    }
  }
  return delta;
};

export const applyEcologyDelta = (state: WorldState, delta: EcologyDelta): WorldState => {
  const next = structuredClone(state);
  for (const change of delta.fieldChanges) {
    const values = next.fields[change.field].values;
    values[change.index] = change.operation === "add"
      ? Math.max(0, Math.min(1, (values[change.index] ?? 0) + change.value))
      : change.value;
  }
  for (const effect of delta.entityEffects) {
    const collection = effect.collection === "worldviewEntities" ? null : next[effect.collection];
    if (!collection) continue;
    const index = collection.findIndex((item) => item.id === effect.id);
    if (effect.operation === "remove") {
      if (index >= 0) collection.splice(index, 1);
    } else if (effect.operation === "update" && index >= 0 && effect.value) {
      collection[index] = effect.value as never;
    } else if (effect.operation === "create" && effect.value && index < 0) {
      collection.push(effect.value as never);
    }
  }
  return next;
};
