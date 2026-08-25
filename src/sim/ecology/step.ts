import { forkRandom, randomFloat } from "../random.ts";
import { attemptAbiogenesis, attemptTrophicSpecies } from "./species.ts";
import { foodSecurityForRegion } from "../agents/food.ts";
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

const neighborRegion = (regionId: string, width: number, height: number): string | undefined => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  if (!match) return undefined;
  const x = Number(match[1] ?? 0);
  const y = Number(match[2] ?? 0);
  if (x + 1 < width) return `region:${x + 1}:${y}`;
  if (x > 0) return `region:${x - 1}:${y}`;
  if (y + 1 < height) return `region:${x}:${y + 1}`;
  return y > 0 ? `region:${x}:${y - 1}` : undefined;
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

  const producerPopulations = state.populations.filter((population) =>
    state.species.find((species) => species.id === population.speciesId)?.role === "producer",
  );
  const producerFood = producerPopulations.reduce((sum, population) => sum + population.count, 0) /
    Math.max(1, producerPopulations.length);
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
    const food = species.role === "producer"
      ? nutrients
      : Math.min(1, producerFood * (species.role === "consumer" ? 0.2 : 0.12));
    const count = nextPopulationCount(population, species, suitabilityScore, food);
    let nextRegionId = population.regionId;
    const candidateRegionId = neighborRegion(population.regionId, state.fields.elevation.width, state.fields.elevation.height);
    if (suitabilityScore < 0.35 && candidateRegionId) {
      const candidateMatch = /^region:(\d+):(\d+)$/.exec(candidateRegionId);
      const candidateIndex = candidateMatch
        ? Number(candidateMatch[2] ?? 0) * state.fields.elevation.width + Number(candidateMatch[1] ?? 0)
        : index;
      const candidateTemperature = state.fields.temperature.values[candidateIndex] ?? metrics.meanTemperature;
      const candidateHumidity = state.fields.humidity.values[candidateIndex] ?? metrics.meanHumidity;
      const candidateSuitability = suitability(species, candidateTemperature, candidateHumidity);
      const originFoodSecurity = foodSecurityForRegion(state, population.regionId, population.count);
      const destinationFoodSecurity = foodSecurityForRegion(state, candidateRegionId as typeof population.regionId, population.count);
      const foodAdvantage = Math.max(0, destinationFoodSecurity - originFoodSecurity);
      const foodStress = Math.max(0, 0.5 - originFoodSecurity);
      const migrationProbability = Math.max(0, Math.min(0.8, (species.traits.mobility ?? 0) * 0.35 + foodAdvantage * 0.25 + foodStress * 0.1));
      const [roll] = randomFloat(forkRandom(state.random, `migration:${population.id}:${state.tick}`));
      const habitatAdvantage = candidateSuitability > suitabilityScore + 0.1;
      const foodDriven = foodAdvantage > 0.1 && candidateSuitability >= suitabilityScore - 0.05;
      if ((habitatAdvantage || foodDriven) && roll < migrationProbability) {
        nextRegionId = candidateRegionId as typeof population.regionId;
        delta.eventDrafts.push({
          kind: "population-migration",
          ruleId: "ecology:local-migration",
          sourceIds: [population.id],
          probability: migrationProbability,
          roll,
          evidence: { fromRegion: population.regionId, toRegion: candidateRegionId, suitability: suitabilityScore, destinationSuitability: candidateSuitability, mobility: species.traits.mobility ?? 0, originFoodSecurity, destinationFoodSecurity, foodAdvantage, foodDriven },
          payload: { populationId: population.id, fromRegion: population.regionId, toRegion: candidateRegionId },
          source: "natural",
        });
      }
    }
    delta.entityEffects.push({
      collection: "populations",
      operation: count <= 0.001 ? "remove" : "update",
      id: population.id,
      ...(count > 0.001 ? { value: { ...population, regionId: nextRegionId, count, energy: Math.max(0, population.energy + suitabilityScore * 0.02 - 0.01) } } : {}),
    });
    if (species.role === "producer") {
      delta.fieldChanges.push({
        field: "biomass",
        index,
        operation: "add",
        value: Math.min(0.03, count * 0.000001),
        causeRuleId: "producer-growth",
      });
      const foodAmount = Math.max(0, Math.min(4, count * suitabilityScore * 0.002));
      if (foodAmount > 0.001) {
        delta.resourceTransactions.push({
          id: `resource:food:production:${state.tick}:${population.id}`,
          resourceId: "food",
          regionId: population.regionId,
          amount: foodAmount,
          operation: "mint",
          source: "environment",
          sourceId: population.id,
          causeRuleId: "ecology:producer-food",
        });
      }
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
