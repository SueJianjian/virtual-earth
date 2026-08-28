import { addPersistentTotal } from "../numeric.ts";
import { hashString } from "../random.ts";
import { speciesBlueprintFor } from "./blueprints.ts";
import { populationCellIndex } from "./populations.ts";
import { compareSimulationSteps, nextSimulationStep, nextSimulationTick, simulationStepDistance, simulationStepForWorld } from "../time.ts";
import type {
  EcologicalRelationshipEffect,
  EcologicalRelationshipKind,
  EcologicalRelationshipState,
  EntityId,
  PopulationState,
  RegionId,
  SpeciesBlueprint,
  WorldDelta,
  WorldState,
} from "../types.ts";

export const MAX_ECOLOGICAL_RELATIONSHIPS = 4_096;
export const MAX_ECOLOGICAL_PLANS_PER_STEP = 512;
const MAX_PLANS_PER_REGION = 12;
const DORMANCY_TICKS = 8;

type InteractionPlan = {
  kind: EcologicalRelationshipKind;
  regionId: RegionId;
  from: PopulationState;
  to: PopulationState;
  strength: number;
  impact: number;
  foodAdjustment: number;
};

export type EcologicalInteractionModel = {
  plans: InteractionPlan[];
  foodAdjustments: ReadonlyMap<string, number>;
};

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const asEntityId = (value: string): EntityId => value as EntityId;

const relationKey = (kind: EcologicalRelationshipKind, regionId: RegionId, fromSpeciesId: EntityId, toSpeciesId: EntityId): string =>
  `${kind}|${regionId}|${fromSpeciesId}|${toSpeciesId}`;

const relationshipIdFor = (key: string): string => `ecology-relationship:${hashString(key).toString(16)}`;

const compareRelationships = (left: EcologicalRelationshipState, right: EcologicalRelationshipState): number =>
  Number(right.status === "active") - Number(left.status === "active")
  || right.strength - left.strength
  || compareSimulationSteps(right.lastTimelineStep ?? String(right.lastTick), left.lastTimelineStep ?? String(left.lastTick))
  || right.interactionCount - left.interactionCount
  || left.id.localeCompare(right.id);

const addAdjustment = (adjustments: Map<string, number>, populationId: string, amount: number): void => {
  // Keep the ecosystem signal meaningful without letting many local links
  // overwhelm the base habitat model in a single annual step.
  adjustments.set(populationId, clamp((adjustments.get(populationId) ?? 0) + amount, -0.08, 0.06));
};


const planScore = (population: PopulationState, blueprint: SpeciesBlueprint, other: PopulationState, otherBlueprint: SpeciesBlueprint, index: number): number => {
  const scaleFit = 1 - Math.min(1, Math.abs(Math.log(Math.max(0.02, blueprint.adultScale) / Math.max(0.02, otherBlueprint.adultScale))) / 4);
  const abundance = Math.min(1, Math.log10(Math.max(1, other.count)) / 5);
  const proximity = 1 - Math.min(1, Math.abs((population.energy ?? 0.5) - (other.energy ?? 0.5)));
  const localBiomass = index >= 0 ? 0.08 : 0;
  return clamp(abundance * 0.5 + scaleFit * 0.27 + proximity * 0.15 + localBiomass * 0.08);
};

const sortPopulations = (left: PopulationState, right: PopulationState): number =>
  right.count - left.count || left.id.localeCompare(right.id);

const preferredTarget = <T extends { population: PopulationState }>(
  candidates: readonly T[],
  scoreFor: (candidate: T) => number,
): { candidate: T; score: number } | undefined => {
  let preferred: T | undefined;
  let preferredScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreFor(candidate);
    if (!preferred || score > preferredScore
      || (score === preferredScore && sortPopulations(candidate.population, preferred.population) < 0)) {
      preferred = candidate;
      preferredScore = score;
    }
  }
  return preferred ? { candidate: preferred, score: preferredScore } : undefined;
};

const addPlan = (
  plans: Map<string, InteractionPlan>,
  kind: EcologicalRelationshipKind,
  from: PopulationState,
  to: PopulationState,
  strength: number,
  impact: number,
  foodAdjustment: number,
): void => {
  if (from.id === to.id || from.regionId !== to.regionId) return;
  const fromId = kind === "competition" && from.speciesId.localeCompare(to.speciesId) > 0 ? to.speciesId : from.speciesId;
  const toId = kind === "competition" && from.speciesId.localeCompare(to.speciesId) > 0 ? from.speciesId : to.speciesId;
  const key = relationKey(kind, from.regionId, fromId, toId);
  if (plans.has(key)) return;
  plans.set(key, {
    kind,
    regionId: from.regionId,
    from: fromId === from.speciesId ? from : to,
    to: toId === to.speciesId ? to : from,
    strength: clamp(strength, 0.02, 1),
    impact: clamp(impact, 0, 1),
    foodAdjustment,
  });
};

const groupsFor = (state: WorldState): Map<RegionId, PopulationState[]> => {
  const groups = new Map<RegionId, PopulationState[]>();
  for (const population of state.populations) {
    if (!Number.isFinite(population.count) || population.count < 1) continue;
    const group = groups.get(population.regionId) ?? [];
    group.push(population);
    groups.set(population.regionId, group);
  }
  return groups;
};

export const modelEcologicalInteractions = (state: WorldState): EcologicalInteractionModel => {
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  const blueprintsById = new Map(state.species.map((species) => [species.id, speciesBlueprintFor(species)]));
  const plans = new Map<string, InteractionPlan>();
  const foodAdjustments = new Map<string, number>();
  const width = state.fields.elevation.width;

  for (const [regionId, populations] of groupsFor(state)) {
    type LivingPopulation = { population: PopulationState; species: WorldState["species"][number]; blueprint: SpeciesBlueprint };
    const producers: LivingPopulation[] = [];
    const consumers: LivingPopulation[] = [];
    const decomposers: LivingPopulation[] = [];
    for (const population of populations) {
      const species = speciesById.get(population.speciesId);
      if (!species) continue;
      const record = { population, species, blueprint: blueprintsById.get(species.id) ?? speciesBlueprintFor(species) };
      if (species.role === "producer" && population.count >= 1) producers.push(record);
      else if (species.role === "consumer" && population.count >= 4) consumers.push(record);
      else if (species.role === "decomposer" && population.count >= 4) decomposers.push(record);
    }
    for (const living of [producers, consumers, decomposers]) living.sort((left, right) => sortPopulations(left.population, right.population));
    const regionIndex = populationCellIndex(populations[0]!, width, state.fields.elevation.height);

    for (const { population: consumer, blueprint } of consumers) {
      const preferred = preferredTarget(producers, (candidate) =>
        planScore(consumer, blueprint, candidate.population, candidate.blueprint, regionIndex));
      if (!preferred) continue;
      const { candidate: target, score: compatibility } = preferred;
      const kind: EcologicalRelationshipKind = blueprint.metabolism === "osmotic-parasitism"
        ? "parasitism"
        : blueprint.metabolism === "symbiotic-exchange" ? "mutualism" : "predation";
      const strength = clamp(0.16 + compatibility * 0.5 + Math.min(0.22, consumer.count / 50_000));
      const impact = clamp(strength * (kind === "mutualism" ? 0.58 : 0.9));
      const adjustment = kind === "mutualism" ? strength * 0.07 : kind === "parasitism" ? strength * 0.03 : strength * 0.045;
      addPlan(plans, kind, consumer, target.population, strength, impact, adjustment);
      addAdjustment(foodAdjustments, consumer.id, adjustment);
      addAdjustment(foodAdjustments, target.population.id, kind === "mutualism" ? adjustment : -strength * (kind === "parasitism" ? 0.2 : 0.28));
    }

    if (decomposers.length > 0 && producers.length > 0) {
      const decomposer = decomposers[0]!;
      const producer = producers[0]!;
      const strength = clamp(0.2 + (decomposer.species.traits.reproduction ?? 0.2) * 0.25 + (producer.species.traits.reproduction ?? 0.2) * 0.25);
      const adjustment = strength * 0.055;
      addPlan(plans, "mutualism", decomposer.population, producer.population, strength, strength * 0.5, adjustment);
      addAdjustment(foodAdjustments, decomposer.population.id, adjustment);
      addAdjustment(foodAdjustments, producer.population.id, adjustment);
    }

    for (const candidates of [producers, consumers, decomposers]) {
      if (candidates.length < 2) continue;
      const first = candidates[0]!;
      const second = candidates[1]!;
      const resourceOverlap = 1 - Math.min(1, Math.abs((first.species.traits.reproduction ?? 0.2) - (second.species.traits.reproduction ?? 0.2)));
      const strength = clamp(0.12 + resourceOverlap * 0.34 + Math.min(0.2, (first.population.count + second.population.count) / 100_000));
      const adjustment = -strength * 0.14;
      addPlan(plans, "competition", first.population, second.population, strength, strength * 0.62, adjustment);
      addAdjustment(foodAdjustments, first.population.id, adjustment);
      addAdjustment(foodAdjustments, second.population.id, adjustment);
    }

    if (plans.size >= MAX_ECOLOGICAL_PLANS_PER_STEP * 2) break;
  }

  const boundedPlans = [...plans.values()]
    .sort((left, right) => right.strength - left.strength || relationKey(left.kind, left.regionId, left.from.speciesId, left.to.speciesId).localeCompare(relationKey(right.kind, right.regionId, right.from.speciesId, right.to.speciesId)))
    .slice(0, MAX_ECOLOGICAL_PLANS_PER_STEP);
  foodAdjustments.clear();
  for (const plan of boundedPlans) {
    if (plan.kind === "competition") {
      const adjustment = -plan.strength * 0.08;
      addAdjustment(foodAdjustments, plan.from.id, adjustment);
      addAdjustment(foodAdjustments, plan.to.id, adjustment);
      continue;
    }
    if (plan.kind === "mutualism") {
      addAdjustment(foodAdjustments, plan.from.id, plan.foodAdjustment);
      addAdjustment(foodAdjustments, plan.to.id, plan.foodAdjustment);
      continue;
    }
    addAdjustment(foodAdjustments, plan.from.id, plan.foodAdjustment);
    addAdjustment(foodAdjustments, plan.to.id, -plan.strength * (plan.kind === "parasitism" ? 0.2 : 0.28));
  }
  return { plans: boundedPlans, foodAdjustments };
};

const relationshipFromPlan = (state: WorldState, plan: InteractionPlan, existing?: EcologicalRelationshipState): EcologicalRelationshipState => {
  const key = relationKey(plan.kind, plan.regionId, plan.from.speciesId, plan.to.speciesId);
  const tick = nextSimulationTick(state);
  const timelineStep = nextSimulationStep(state);
  const details = {
    fromPopulationId: plan.from.id,
    toPopulationId: plan.to.id,
    fromCount: rounded(plan.from.count),
    toCount: rounded(plan.to.count),
    foodAdjustment: rounded(plan.foodAdjustment),
  };
  if (!existing) {
    return {
      id: relationshipIdFor(key),
      kind: plan.kind,
      fromSpeciesId: asEntityId(plan.from.speciesId),
      toSpeciesId: asEntityId(plan.to.speciesId),
      regionId: plan.regionId,
      strength: rounded(plan.strength),
      firstTick: tick,
      firstTimelineStep: timelineStep,
      lastTick: tick,
      lastTimelineStep: timelineStep,
      interactionCount: 1,
      cumulativeImpact: rounded(plan.impact),
      lastImpact: rounded(plan.impact),
      status: "active",
      details,
    };
  }
  return {
    ...existing,
    strength: rounded(existing.strength * 0.82 + plan.strength * 0.18),
    lastTick: tick,
    lastTimelineStep: timelineStep,
    interactionCount: addPersistentTotal(existing.interactionCount, 1),
    cumulativeImpact: addPersistentTotal(existing.cumulativeImpact, plan.impact),
    lastImpact: rounded(plan.impact),
    status: "active",
    details,
  };
};

export const updateEcologicalRelationships = (state: WorldState, model: EcologicalInteractionModel): {
  effects: EcologicalRelationshipEffect[];
  events: WorldDelta["eventDrafts"];
} => {
  const current = state.ecologicalRelationships ?? [];
  const byKey = new Map(current.map((relationship) => [relationKey(relationship.kind, relationship.regionId, relationship.fromSpeciesId, relationship.toSpeciesId), relationship]));
  const effects: EcologicalRelationshipEffect[] = [];
  const events: WorldDelta["eventDrafts"] = [];
  const observed = new Set<string>();
  for (const plan of model.plans) {
    const key = relationKey(plan.kind, plan.regionId, plan.from.speciesId, plan.to.speciesId);
    observed.add(key);
    const relationship = relationshipFromPlan(state, plan, byKey.get(key));
    effects.push({ operation: byKey.has(key) ? "update" : "create", relationship });
    if (!byKey.has(key)) {
      events.push({
        kind: "ecological-interaction",
        ruleId: "ecology:food-web",
        sourceIds: [relationship.fromSpeciesId, relationship.toSpeciesId],
        probability: relationship.strength,
        roll: 0,
        evidence: {
          interaction: relationship.kind,
          strength: relationship.strength,
          impact: relationship.lastImpact,
          regionId: relationship.regionId,
          firstObservedTick: relationship.firstTick,
          firstObservedStep: relationship.firstTimelineStep ?? String(relationship.firstTick),
        },
        payload: {
          relationshipId: relationship.id,
          interaction: relationship.kind,
          fromSpeciesId: relationship.fromSpeciesId,
          toSpeciesId: relationship.toSpeciesId,
          regionId: relationship.regionId,
        },
        source: "natural",
      });
    }
  }
  const nextStep = nextSimulationStep(state);
  const nextTick = nextSimulationTick(state);
  for (const relationship of current) {
    const key = relationKey(relationship.kind, relationship.regionId, relationship.fromSpeciesId, relationship.toSpeciesId);
    if (observed.has(key) || relationship.status === "dormant"
      || simulationStepDistance(nextStep, relationship.lastTimelineStep ?? String(relationship.lastTick)) < DORMANCY_TICKS) continue;
    effects.push({
      operation: "update",
      relationship: { ...relationship, status: "dormant", lastImpact: 0 },
    });
  }
  return { effects, events };
};

export type EcologicalRelationshipCompactionOptions = {
  validSpeciesIds?: ReadonlySet<string>;
};

export const compactEcologicalRelationships = (
  state: WorldState,
  options: EcologicalRelationshipCompactionOptions = {},
): number => {
  const records = state.ecologicalRelationships ?? [];
  if (records.length === 0) {
    state.ecologicalRelationships = [];
    return 0;
  }
  const validSpeciesIds = options.validSpeciesIds;
  const referencesValidSpecies = (record: EcologicalRelationshipState): boolean =>
    validSpeciesIds === undefined
    || (validSpeciesIds.has(record.fromSpeciesId) && validSpeciesIds.has(record.toSpeciesId));
  const seenKeys = new Set<string>();
  let canonical = records.length <= MAX_ECOLOGICAL_RELATIONSHIPS;
  for (let index = 0; canonical && index < records.length; index += 1) {
    const record = records[index]!;
    const key = relationKey(record.kind, record.regionId, record.fromSpeciesId, record.toSpeciesId);
    if (seenKeys.has(key)
      || !referencesValidSpecies(record)
      || !Number.isFinite(record.strength)
      || !Number.isFinite(record.lastTick)
      || (record.firstTimelineStep !== undefined && !/^\d+$/.test(record.firstTimelineStep))
      || (record.lastTimelineStep !== undefined && !/^\d+$/.test(record.lastTimelineStep))
      || record.strength < 0 || record.strength > 1
      || !Number.isFinite(record.lastImpact) || record.lastImpact < 0 || record.lastImpact > 1
      || !Number.isFinite(record.interactionCount) || record.interactionCount < 0
      || !Number.isFinite(record.cumulativeImpact) || record.cumulativeImpact < 0
      || (index > 0 && compareRelationships(records[index - 1]!, record) > 0)) {
      canonical = false;
      break;
    }
    seenKeys.add(key);
  }
  if (canonical) return 0;
  const byKey = new Map<string, EcologicalRelationshipState>();
  for (const record of records) {
    if (!referencesValidSpecies(record) || !Number.isFinite(record.strength) || !Number.isFinite(record.lastTick)) continue;
    const key = relationKey(record.kind, record.regionId, record.fromSpeciesId, record.toSpeciesId);
    const current = byKey.get(key);
    if (!current || compareSimulationSteps(record.lastTimelineStep ?? String(record.lastTick), current.lastTimelineStep ?? String(current.lastTick)) > 0
      || (compareSimulationSteps(record.lastTimelineStep ?? String(record.lastTick), current.lastTimelineStep ?? String(current.lastTick)) === 0 && record.strength > current.strength)) byKey.set(key, {
      ...record,
      strength: clamp(record.strength),
      lastImpact: clamp(record.lastImpact),
      interactionCount: Math.max(0, record.interactionCount),
      cumulativeImpact: Math.max(0, record.cumulativeImpact),
      details: { ...record.details },
    });
  }
  const unique = [...byKey.values()];
  unique.sort(compareRelationships);
  const retained = unique.slice(0, MAX_ECOLOGICAL_RELATIONSHIPS);
  state.ecologicalRelationships = retained;
  return records.length - retained.length;
};
