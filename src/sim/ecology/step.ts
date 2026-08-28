import { forkRandom, hashString, randomFloat } from "../random.ts";
import { ACTIVE_ADAPTIVE_SPECIES_LIMITS, attemptAbiogenesis, attemptAdaptiveSpeciation, attemptTrophicSpecies } from "./species.ts";
import { foodSecurityFromBalance } from "../agents/food.ts";
import { technologyProfilesForState } from "../culture/technology.ts";
import { facilityEffectProfilesForState } from "../society/facilities.ts";
import { nextPopulationCount, populationCellIndex, suitability } from "./populations.ts";
import { MAX_POPULATION_RECORDS } from "./archive.ts";
import { summarizePopulationGenetics } from "../agents/genetics.ts";
import { modelEcologicalInteractions, updateEcologicalRelationships } from "./interactions.ts";
import { simulationStepForWorld } from "../time.ts";
import { annualClimateForLocal } from "../environment/cycle.ts";
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

const appendItems = <T>(target: T[], source: readonly T[]): void => {
  for (const item of source) target.push(item);
};

const mean = (values: Float32Array): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
};

const mergeDelta = (target: WorldDelta, source: WorldDelta): void => {
  appendItems(target.fieldChanges, source.fieldChanges);
  appendItems(target.chemistryChanges, source.chemistryChanges);
  appendItems(target.entityEffects, source.entityEffects);
  appendItems(target.relationshipEffects, source.relationshipEffects);
  appendItems(target.resourceTransactions, source.resourceTransactions);
  appendItems(target.worldviewEffects, source.worldviewEffects);
  appendItems(target.eventDrafts, source.eventDrafts);
};

const neighborRegions = (regionId: string, width: number, height: number): string[] => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  if (!match) return [];
  const x = Number(match[1] ?? 0);
  const y = Number(match[2] ?? 0);
  return [...new Set([
    width > 1 ? `region:${(x + 1) % width}:${y}` : undefined,
    width > 1 ? `region:${(x + width - 1) % width}:${y}` : undefined,
    y + 1 < height ? `region:${x}:${y + 1}` : undefined,
    y > 0 ? `region:${x}:${y - 1}` : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate)))];
};

export const stepEcology = (state: WorldState, context: RuleContext): EcologyDelta => {
  const delta = emptyDelta();
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const fallbackTemperature = mean(state.fields.temperature.values);
  const fallbackHumidity = mean(state.fields.humidity.values);
  const regionIndexCache = new Map<string, number>();
  const neighborCache = new Map<string, string[]>();
  const suitabilityCache = new Map<string, number>();
  const regionIndexFor = (regionId: string): number => {
    const cached = regionIndexCache.get(regionId);
    if (cached !== undefined) return cached;
    const match = /^(?:region:)(\d+):(\d+)$/.exec(regionId);
    if (!match) {
      regionIndexCache.set(regionId, 0);
      return 0;
    }
    const x = Math.max(0, Math.min(width - 1, Number(match[1] ?? 0)));
    const y = Math.max(0, Math.min(height - 1, Number(match[2] ?? 0)));
    const index = y * width + x;
    regionIndexCache.set(regionId, index);
    return index;
  };
  const neighborsFor = (regionId: string): string[] => {
    const cached = neighborCache.get(regionId);
    if (cached) return cached;
    const neighbors = neighborRegions(regionId, width, height);
    neighborCache.set(regionId, neighbors);
    return neighbors;
  };
  const suitabilityFor = (species: WorldState["species"][number], regionId: string): number => {
    const key = `${species.id}|${regionId}`;
    const cached = suitabilityCache.get(key);
    if (cached !== undefined) return cached;
    const index = regionIndexFor(regionId);
    const climate = annualClimateForLocal(
      state.fields.temperature.values[index] ?? fallbackTemperature,
      state.fields.humidity.values[index] ?? fallbackHumidity,
      fallbackTemperature,
      fallbackHumidity,
      state.climateCycle,
    );
    const value = suitability(species, climate.temperature, climate.humidity);
    suitabilityCache.set(key, value);
    return value;
  };
  const facilityEffects = facilityEffectProfilesForState(state);
  const technologyProfiles = technologyProfilesForState(state);
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  const agentsByPopulationForGenetics = new Map<string, WorldState["agents"]>();
  for (const agent of state.agents) {
    const agents = agentsByPopulationForGenetics.get(agent.populationId) ?? [];
    agents.push(agent);
    agentsByPopulationForGenetics.set(agent.populationId, agents);
  }
  const geneticSamplesByPopulation = new Map([...agentsByPopulationForGenetics.entries()].map(([populationId, agents]) => [
    populationId,
    summarizePopulationGenetics(agents),
  ]));
  const occupiedPopulationRegions = new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`));
  const plannedPopulationRegions = new Set<string>();
  const foodByRegion = new Map<string, number>();
  for (const resource of state.resources) {
    if (resource.resourceId !== "food") continue;
    foodByRegion.set(resource.regionId, (foodByRegion.get(resource.regionId) ?? 0) + resource.amount);
  }
  const regionalDescendants = new Set<string>();
  const producerPopulations: WorldState["populations"] = [];
  for (const population of state.populations) {
    const species = speciesById.get(population.speciesId);
    if (species?.role === "producer") producerPopulations.push(population);
    if (population.count >= 1) {
      const parentId = species?.parentId;
      if (parentId) regionalDescendants.add(`${parentId}|${population.regionId}`);
    }
  }
  for (let index = 0; index < state.fields.biomass.values.length; index += 1) {
    const biomass = state.fields.biomass.values[index] ?? 0;
    if (biomass > 0) {
      delta.fieldChanges.push({ field: "biomass", index, operation: "add", value: -biomass * 0.00035, causeRuleId: "ecology:biomass-turnover" });
      delta.chemistryChanges.push({ field: "organics", index, operation: "add", value: biomass * 0.00035, causeRuleId: "ecology:biomass-turnover" });
    }
  }
  const metrics = {
    ...context.metrics,
    waterCoverage: mean(state.fields.water.values),
    nutrientLevel: mean(state.fields.nutrients.values),
    meanTemperature: mean(state.fields.temperature.values),
    populationCount: state.populations.reduce((sum, population) => sum + population.count, 0),
  };
  const ruleContext: RuleContext = { ...context, metrics };
  const activeSpeciesIds = {
    producer: new Set<string>(),
    consumer: new Set<string>(),
    decomposer: new Set<string>(),
  };
  for (const population of state.populations) {
    const species = speciesById.get(population.speciesId);
    if (!species) continue;
    const minimumViableCount = species.role === "producer" ? 1 : 4;
    if (population.count >= minimumViableCount) activeSpeciesIds[species.role].add(species.id);
  }
  const plannedSpeciesCount = new Map([
    ["producer", activeSpeciesIds.producer.size],
    ["consumer", activeSpeciesIds.consumer.size],
    ["decomposer", activeSpeciesIds.decomposer.size],
  ] as const);
  if (activeSpeciesIds.producer.size === 0) {
    const outcome = attemptAbiogenesis(ruleContext);
    mergeDelta(delta, outcome.delta);
    if (outcome.status === "applied") plannedSpeciesCount.set("producer", plannedSpeciesCount.get("producer")! + 1);
  }

  const producerFood = producerPopulations.reduce((sum, population) => sum + population.count, 0) /
    Math.max(1, producerPopulations.length);
  if (activeSpeciesIds.consumer.size < 2) {
    const outcome = attemptTrophicSpecies(ruleContext, "consumer", producerFood);
    mergeDelta(delta, outcome.delta);
    if (outcome.status === "applied") plannedSpeciesCount.set("consumer", plannedSpeciesCount.get("consumer")! + 1);
  }
  if (activeSpeciesIds.decomposer.size < 1) {
    const outcome = attemptTrophicSpecies(ruleContext, "decomposer", producerFood * 0.7);
    mergeDelta(delta, outcome.delta);
    if (outcome.status === "applied") plannedSpeciesCount.set("decomposer", plannedSpeciesCount.get("decomposer")! + 1);
  }

  const interactionModel = modelEcologicalInteractions(state);
  const interactionUpdate = updateEcologicalRelationships(state, interactionModel);
  delta.ecologicalRelationshipEffects = interactionUpdate.effects;
  appendItems(delta.eventDrafts, interactionUpdate.events);

  let speciationOccurred = false;

  for (const population of state.populations) {
    const species = speciesById.get(population.speciesId);
    if (!species) continue;
    const technology = technologyProfiles.get(population.regionId) ?? {
      subsistence: 0,
      construction: 0,
      navigation: 0,
      medicine: 0,
      governance: 0,
      energy: 0,
    };
    const facilities = facilityEffects.get(population.regionId);
    const index = regionIndexFor(population.regionId);
    const climate = annualClimateForLocal(
      state.fields.temperature.values[index] ?? metrics.meanTemperature,
      state.fields.humidity.values[index] ?? metrics.meanHumidity,
      fallbackTemperature,
      fallbackHumidity,
      state.climateCycle,
    );
    const temperature = climate.temperature;
    const humidity = climate.humidity;
    const nutrients = state.fields.nutrients.values[index] ?? metrics.nutrientLevel;
    const suitabilityScore = suitabilityFor(species, population.regionId);
    const baseFood = species.role === "producer"
      ? nutrients
      : Math.min(1, producerFood * (species.role === "consumer" ? 0.2 : 0.12));
    const food = Math.max(0, Math.min(1, baseFood + (interactionModel.foodAdjustments.get(population.id) ?? 0)));
    const count = nextPopulationCount(population, species, suitabilityScore, food);
    let nextRegionId = population.regionId;
    if (suitabilityScore < 0.35) {
      const originFoodSecurity = foodSecurityFromBalance(foodByRegion.get(population.regionId) ?? 0, population.count);
      const candidates = neighborsFor(population.regionId)
        .map((regionId) => {
          const candidateIndex = regionIndexFor(regionId);
          const habitat = suitabilityFor(species, regionId);
          const foodSecurity = foodSecurityFromBalance(foodByRegion.get(regionId) ?? 0, population.count);
          const ecologicalResource = species.role === "producer"
            ? state.fields.nutrients.values[candidateIndex] ?? 0
            : state.fields.biomass.values[candidateIndex] ?? 0;
          const foodAdvantage = Math.max(0, foodSecurity - originFoodSecurity);
          const habitatAdvantage = habitat > suitabilityScore + 0.1;
          const foodDriven = foodAdvantage > 0.1 && habitat >= suitabilityScore - 0.05;
          return {
            regionId,
            habitat,
            foodSecurity,
            foodAdvantage,
            ecologicalResource,
            habitatAdvantage,
            foodDriven,
            score: habitat * 0.7 + foodSecurity * 0.2 + ecologicalResource * 0.1,
          };
        })
        .filter((candidate) => candidate.habitatAdvantage || candidate.foodDriven)
        .sort((left, right) => right.score - left.score || left.regionId.localeCompare(right.regionId));
      const destination = candidates[0];
      const foodStress = Math.max(0, 0.5 - originFoodSecurity);
      const migrationProbability = destination
        ? Math.max(0, Math.min(0.8, (species.traits.mobility ?? 0) * (0.35 + technology.navigation * 0.12 + (facilities?.navigation ?? 0) * 0.18) + destination.foodAdvantage * 0.25 + foodStress * 0.1))
        : 0;
      const [roll] = randomFloat(forkRandom(state.random, `migration:${population.id}:${simulationStepForWorld(state)}`));
      if (destination && roll < migrationProbability) {
        nextRegionId = destination.regionId as typeof population.regionId;
        delta.eventDrafts.push({
          kind: "population-migration",
          ruleId: "ecology:local-migration",
          sourceIds: [population.id],
          probability: migrationProbability,
          roll,
          evidence: {
            fromRegion: population.regionId,
            toRegion: destination.regionId,
            suitability: suitabilityScore,
            destinationSuitability: destination.habitat,
            destinationScore: destination.score,
            mobility: species.traits.mobility ?? 0,
            originFoodSecurity,
            destinationFoodSecurity: destination.foodSecurity,
            foodAdvantage: destination.foodAdvantage,
            foodDriven: destination.foodDriven,
          },
          payload: { populationId: population.id, fromRegion: population.regionId, toRegion: destination.regionId },
          source: "natural",
        });
      }
    }
    let retainedCount = count;
    if (nextRegionId === population.regionId
      && count >= 80
      && (species.traits.mobility ?? 0) >= 0.25
      && state.populations.length + plannedPopulationRegions.size < MAX_POPULATION_RECORDS) {
      const candidates = neighborsFor(population.regionId)
        .filter((regionId) => !occupiedPopulationRegions.has(`${population.speciesId}|${regionId}`)
          && !plannedPopulationRegions.has(`${population.speciesId}|${regionId}`))
        .map((regionId) => {
          const candidateIndex = regionIndexFor(regionId);
          const habitat = suitabilityFor(species, regionId);
          const resources = species.role === "producer"
            ? state.fields.nutrients.values[candidateIndex] ?? 0
            : state.fields.biomass.values[candidateIndex] ?? 0;
          return { regionId, habitat, score: habitat * 0.82 + resources * 0.18 };
        })
        .sort((left, right) => right.score - left.score || left.regionId.localeCompare(right.regionId));
      const destination = candidates[0];
      if (destination && destination.score >= 0.42) {
        const probability = Math.min(0.45, (species.traits.mobility ?? 0) * 0.16 + Math.max(0, destination.habitat - suitabilityScore) * 0.25 + Math.min(0.12, count / 20_000));
        const [roll] = randomFloat(forkRandom(state.random, `dispersal:${population.id}:${destination.regionId}:${simulationStepForWorld(state)}`));
        if (roll < probability) {
          const branchCount = Math.min(500, Math.max(4, count * 0.08));
          retainedCount = Math.max(0, count - branchCount);
          const branchId = `population:${hashString(`${population.speciesId}:${destination.regionId}`).toString(16)}` as typeof population.id;
          delta.entityEffects.push({
            collection: "populations",
            operation: "create",
            id: branchId,
            value: { ...population, id: branchId, regionId: destination.regionId as typeof population.regionId, count: branchCount, energy: Math.max(0.1, population.energy * 0.72) },
          });
          plannedPopulationRegions.add(`${population.speciesId}|${destination.regionId}`);
          delta.eventDrafts.push({
            kind: "population-dispersal",
            ruleId: "ecology:population-dispersal",
            sourceIds: [population.id, branchId],
            probability,
            roll,
            evidence: { fromRegion: population.regionId, toRegion: destination.regionId, habitat: destination.habitat, destinationScore: destination.score, mobility: species.traits.mobility ?? 0, branchCount },
            payload: { populationId: population.id, branchPopulationId: branchId, speciesId: population.speciesId, fromRegion: population.regionId, toRegion: destination.regionId, branchCount },
            source: "natural",
          });
        }
      }
    }
    if (!speciationOccurred
      && retainedCount >= 250
      && (plannedSpeciesCount.get(species.role) ?? 0) < ACTIVE_ADAPTIVE_SPECIES_LIMITS[species.role]
      && !regionalDescendants.has(`${species.id}|${nextRegionId}`)) {
      const adaptationIndex = regionIndexFor(nextRegionId);
      const localClimate = annualClimateForLocal(
        state.fields.temperature.values[adaptationIndex] ?? metrics.meanTemperature,
        state.fields.humidity.values[adaptationIndex] ?? metrics.meanHumidity,
        fallbackTemperature,
        fallbackHumidity,
        state.climateCycle,
      );
      const localTemperature = localClimate.temperature;
      const localHumidity = localClimate.humidity;
      const localSuitability = suitabilityFor(species, nextRegionId);
      const outcome = attemptAdaptiveSpeciation(
        ruleContext,
        species,
        { ...population, regionId: nextRegionId, count: retainedCount },
        localTemperature,
        localHumidity,
        localSuitability,
        plannedSpeciesCount.get(species.role) ?? 0,
        regionalDescendants.has(`${species.id}|${nextRegionId}`),
        geneticSamplesByPopulation.get(population.id),
      );
      if (outcome.status === "applied") {
        const branchPopulation = outcome.delta.entityEffects.find((effect) => effect.collection === "populations" && effect.operation === "create");
        const branchCount = branchPopulation?.collection === "populations" ? branchPopulation.value?.count ?? 0 : 0;
        retainedCount = Math.max(0, retainedCount - branchCount);
        plannedSpeciesCount.set(species.role, (plannedSpeciesCount.get(species.role) ?? 0) + 1);
        speciationOccurred = true;
        mergeDelta(delta, outcome.delta);
      }
    }
    const minimumViableCount = species.role === "producer" ? 1 : 4;
    delta.entityEffects.push({
      collection: "populations",
      operation: retainedCount < minimumViableCount ? "remove" : "update",
      id: population.id,
      ...(retainedCount >= minimumViableCount ? { value: { ...population, regionId: nextRegionId, count: retainedCount, energy: Math.max(0, Math.min(1, population.energy + suitabilityScore * 0.02 - 0.01)) } } : {}),
    });
    if (species.role === "producer") {
      const primaryProduction = Math.min(0.02, count * 0.000001 * (0.5 + suitabilityScore) * (0.6 + nutrients * 0.4));
      delta.fieldChanges.push({
        field: "biomass",
        index,
        operation: "add",
        value: primaryProduction,
        causeRuleId: "ecology:primary-production",
      });
      delta.fieldChanges.push({ field: "nutrients", index, operation: "add", value: -primaryProduction * 0.12, causeRuleId: "ecology:nutrient-uptake" });
      delta.chemistryChanges.push(
        { field: "carbon", index, operation: "add", value: -primaryProduction * 0.025, causeRuleId: "ecology:photosynthesis" },
        { field: "oxygen", index, operation: "add", value: primaryProduction * 0.032, causeRuleId: "ecology:photosynthesis" },
      );
      const foodAmount = Math.max(0, Math.min(4, count * suitabilityScore * 0.002 * (1 + technology.subsistence * 0.45 + (facilities?.subsistence ?? 0) * 0.65)));
      if (foodAmount > 0.001) {
        delta.resourceTransactions.push({
          id: `resource:food:production:${simulationStepForWorld(state)}:${population.id}`,
          resourceId: "food",
          regionId: population.regionId,
          amount: foodAmount,
          operation: "mint",
          source: "environment",
          sourceId: population.id,
          causeRuleId: "ecology:producer-food",
        });
      }
    } else if (species.role === "consumer") {
      const localBiomass = state.fields.biomass.values[index] ?? 0;
      const grazing = Math.min(localBiomass * 0.0015, count * 0.000000001);
      if (grazing > 0) {
        delta.fieldChanges.push({ field: "biomass", index, operation: "add", value: -grazing, causeRuleId: "ecology:grazing" });
        delta.chemistryChanges.push({ field: "organics", index, operation: "add", value: grazing * 0.35, causeRuleId: "ecology:grazing" });
      }
    } else {
      const decomposition = Math.min(state.chemistry.organics.values[index] ?? 0, count * 0.00000035);
      if (decomposition > 0) {
        delta.chemistryChanges.push(
          { field: "organics", index, operation: "add", value: -decomposition, causeRuleId: "ecology:decomposition" },
          { field: "carbon", index, operation: "add", value: decomposition * 0.2, causeRuleId: "ecology:decomposition" },
        );
        delta.fieldChanges.push({ field: "nutrients", index, operation: "add", value: decomposition * 0.4, causeRuleId: "ecology:decomposition" });
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
  const ecologicalRelationships = next.ecologicalRelationships ?? [];
  const relationshipIndex = new Map(ecologicalRelationships.map((relationship, index) => [relationship.id, index]));
  for (const effect of delta.ecologicalRelationshipEffects ?? []) {
    const index = relationshipIndex.get(effect.relationship.id);
    if (effect.operation === "remove") {
      if (index !== undefined) {
        ecologicalRelationships[index] = undefined as never;
        relationshipIndex.delete(effect.relationship.id);
      }
    } else if (effect.operation === "update" && index !== undefined) {
      ecologicalRelationships[index] = effect.relationship;
    } else if (effect.operation === "create" && index === undefined) {
      relationshipIndex.set(effect.relationship.id, ecologicalRelationships.length);
      ecologicalRelationships.push(effect.relationship);
    }
  }
  next.ecologicalRelationships = ecologicalRelationships.filter((relationship): relationship is NonNullable<typeof relationship> => Boolean(relationship));
  return next;
};
