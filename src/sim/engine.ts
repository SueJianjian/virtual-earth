import { hashString, nextRandom } from "./random.ts";
import {
  appendEventsInPlace,
  appendExternalEventsInPlace,
  compactEventArchiveIndexes,
  compactEventLedger,
  lifetimeTradeVolume,
  recordAppendedEvents,
  appendHistorySample,
  synchronizeEventArchive,
} from "./events/ledger.ts";
import { stepEnvironment } from "./environment/index.ts";
import { stepEcology } from "./ecology/index.ts";
import { compactExtinctSpecies, compactPopulationRecords } from "./ecology/archive.ts";
import { ensureSpeciesIdentity } from "./ecology/blueprints.ts";
import { agentsStage, compactAgentMemoryRecords, compactRelationshipRecords, MAX_BELIEFS_PER_AGENT } from "./agents/index.ts";
import { createRelationship } from "./agents/relationships.ts";
import { cultureStage } from "./culture/index.ts";
import { compactCultureRecords, compactKnowledgeRecords, MAX_BELIEFS_PER_CULTURE } from "./culture/archive.ts";
import { ensureCultureIdentity } from "./culture/identity.ts";
import { societyStage } from "./society/index.ts";
import { archiveOrganizationRecords, compactOrganizationRecords } from "./society/archive.ts";
import { compactFacilityRecords } from "./society/facilities.ts";
import { lodStage } from "./lod/index.ts";
import { worldviewStage } from "./worldview/index.ts";
import { compactWorldviewRecords, MAX_WORLDVIEW_PRACTICES } from "./worldview/archive.ts";
import { reconcileWorldviewLifecycle } from "./worldview/lifecycle.ts";
import { meanFoodSecurity } from "./agents/food.ts";
import { worldDigest } from "./world.ts";
import { advanceSimulationTimeline, DAYS_PER_YEAR, simulationDaysFromWorld, nextSimulationStep, nextSimulationTick, timelineForWorld, timelineProjection, wholeYearsCrossed } from "./time.ts";
import { governanceForOrganization } from "./society/organization.ts";
import { compactPathogenRecords } from "./health/disease.ts";
import { addPersistentTotal } from "./numeric.ts";
import { compactEcologicalRelationships } from "./ecology/interactions.ts";
import { compactResourceRecords } from "./resources.ts";
import { orbitalStateForWorld } from "./environment/orbit.ts";
import { isClimateCycleState } from "./environment/cycle.ts";
import { isTectonicState } from "./environment/geology.ts";
import { isAtmosphereState } from "./environment/atmosphere.ts";
import { isOceanState } from "./environment/ocean.ts";
import { recordOrganizationDevelopment } from "./society/development.ts";
import type {
  EntityEffect,
  RuleContext,
  SimulationStage,
  StateMetric,
  StepInput,
  WorldDelta,
  WorldHistorySample,
  WorldState,
  WorldviewEffect,
  WorldviewEntityState,
  WorldviewGovernanceEffect,
} from "./types.ts";

const stageRegistry = new Map<string, SimulationStage>();

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

const historySampleFor = (state: WorldState): WorldHistorySample => {
  const timeline = timelineForWorld(state);
  const metrics = metricsFor(state);
  const annualClimate = state.climateCycle.lastCompleted;
  const diseasePrevalence = state.pathogens.length === 0
    ? 0
    : state.pathogens.reduce((sum, pathogen) => sum + pathogen.prevalence, 0) / state.pathogens.length;
  return {
    tick: state.tick,
    years: state.years,
    timelineStep: timeline.step,
    timelineDays: timeline.days,
    meanTemperature: metrics.meanTemperature,
    oceanCoverage: metrics.oceanCoverage,
    biomass: metrics.biomass,
    oxygen: metrics.oxygen,
    organics: metrics.organics,
    populationCount: metrics.populationCount,
    speciesCount: state.species.length,
    organizationCount: state.organizations.length,
    facilityCount: state.facilities.length,
    knowledgeCount: state.knowledge.length,
    foodSecurity: metrics.foodSecurity,
    diseasePrevalence,
    ...(annualClimate ? {
      annualMeanTemperature: annualClimate.meanTemperature,
      annualMeanHumidity: annualClimate.meanHumidity,
      annualMeanWater: annualClimate.meanWater,
      annualMeanSolarFlux: annualClimate.meanSolarFlux,
      annualMinimumTemperature: annualClimate.minimumTemperature,
      annualMaximumTemperature: annualClimate.maximumTemperature,
      annualSeasonalRange: annualClimate.seasonalRange,
    } : {}),
  };
};

const recordHistorySample = (state: WorldState): void => {
  appendHistorySample(state.eventArchive.historySamples, historySampleFor(state));
};

export const registerSimulationStage = (stage: SimulationStage): void => {
  if (stageRegistry.has(stage.id)) throw new Error(`Duplicate simulation stage: ${stage.id}`);
  if (stage.id.includes("phase") || stage.id.includes("tick")) {
    throw new Error(`Simulation stage id cannot encode time: ${stage.id}`);
  }
  stageRegistry.set(stage.id, stage);
};

export const clearSimulationStages = (): void => {
  stageRegistry.clear();
};

export const listSimulationStages = (): SimulationStage[] =>
  [...stageRegistry.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const mean = (values: Float32Array): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
};

const fractionAtLeast = (values: Float32Array, threshold: number): number => {
  if (values.length === 0) return 0;
  let count = 0;
  for (const value of values) if (value >= threshold) count += 1;
  return count / values.length;
};

const terrainRelief = (state: WorldState): number => {
  const { elevation } = state.fields;
  if (elevation.values.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < elevation.values.length; index += 1) {
    const x = index % elevation.width;
    const east = Math.floor(index / elevation.width) * elevation.width + (x + 1) % elevation.width;
    total += Math.abs((elevation.values[index] ?? 0) - (elevation.values[east] ?? 0));
  }
  return total / elevation.values.length;
};

export const metricsFor = (state: WorldState): Record<StateMetric, number> => ({
  meanTemperature: mean(state.fields.temperature.values),
  meanHumidity: mean(state.fields.humidity.values),
  waterCoverage: mean(state.fields.water.values),
  nutrientLevel: mean(state.fields.nutrients.values),
  biomass: mean(state.fields.biomass.values),
  oxygen: mean(state.chemistry.oxygen.values),
  carbon: mean(state.chemistry.carbon.values),
  organics: mean(state.chemistry.organics.values),
  oceanCoverage: fractionAtLeast(state.fields.water.values, 0.5),
  terrainRelief: terrainRelief(state),
  populationCount: state.populations.reduce((sum, population) => sum + population.count, 0),
  cognitivePotential: state.species.reduce((sum, species) => sum + (species.traits.cognitivePotential ?? 0), 0),
  knowledgeDiversity: state.cultures.reduce((sum, culture) => sum + culture.knowledgeIds.length, 0),
  beliefDiversity: state.cultures.reduce((sum, culture) => sum + culture.beliefIds.length, 0),
  householdCount: state.organizations.filter((organization) => organization.type === "family").length,
  settlementDensity: state.organizations.filter((organization) => organization.type === "settlement" || organization.type === "city").length,
  tradeVolume: lifetimeTradeVolume(state),
  foodSurplus: state.resources
    .filter((resource) => resource.resourceId === "food")
    .reduce((sum, resource) => sum + resource.amount, 0),
  foodSecurity: meanFoodSecurity(state),
  organizationCapacity: state.organizations.reduce((sum, organization) => sum + organization.memberIds.length, 0),
  resourceBalance: state.resources.reduce((sum, resource) => sum + resource.amount, 0),
});

const applyFieldChanges = (state: WorldState, changes: WorldDelta["fieldChanges"]): void => {
  for (const change of changes) {
    const values = state.fields[change.field].values;
    const current = values[change.index] ?? 0;
    values[change.index] = Math.max(0, Math.min(1, change.operation === "add" ? current + change.value : change.value));
  }
};

const applyChemistryChanges = (state: WorldState, changes: WorldDelta["chemistryChanges"]): void => {
  for (const change of changes) {
    const values = state.chemistry[change.field].values;
    const current = values[change.index] ?? 0;
    values[change.index] = Math.max(0, Math.min(1, change.operation === "add" ? current + change.value : change.value));
  }
};

const applyFieldPatches = (state: WorldState, patches: NonNullable<WorldDelta["fieldPatches"]>): void => {
  for (const patch of patches) {
    const values = state.fields[patch.field].values;
    if (patch.operation === "set") {
      values.set(patch.values);
      continue;
    }
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.max(0, Math.min(1, (values[index] ?? 0) + (patch.values[index] ?? 0)));
    }
  }
};

const applyChemistryPatches = (state: WorldState, patches: NonNullable<WorldDelta["chemistryPatches"]>): void => {
  for (const patch of patches) {
    const values = state.chemistry[patch.field].values;
    if (patch.operation === "set") {
      values.set(patch.values);
      continue;
    }
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.max(0, Math.min(1, (values[index] ?? 0) + (patch.values[index] ?? 0)));
    }
  }
};

const stateWithPendingClimateCycle = (state: WorldState, priorDeltas: ReadonlyMap<string, WorldDelta>): WorldState => {
  const climateCycle = priorDeltas.get("environment")?.climateCycleEffect;
  return climateCycle ? { ...state, climateCycle } : state;
};

const collectionFor = (state: WorldState, collection: EntityEffect["collection"]): Array<{ id: string }> | null => {
  if (collection === "species") return state.species;
  if (collection === "populations") return state.populations;
  if (collection === "agents") return state.agents;
  if (collection === "cultures") return state.cultures;
  if (collection === "knowledge") return state.knowledge;
  if (collection === "organizations") return state.organizations;
  if (collection === "facilities") return state.facilities;
  if (collection === "substances") return state.substances;
  if (collection === "pathogens") return state.pathogens;
  return state.worldview.entities;
};

const applyEntityEffects = (state: WorldState, effects: EntityEffect[]): void => {
  let culturesChanged = false;
  let knowledgeChanged = false;
  let facilitiesChanged = false;
  const indexes = new Map<EntityEffect["collection"], Map<string, number>>();
  const collectionsWithRemovals = new Set<EntityEffect["collection"]>();
  for (const effect of effects) {
    if (effect.collection === "worldviewEntities") {
      throw new Error("Worldview entities must use constrained worldview effects");
    }
    const collection = collectionFor(state, effect.collection);
    if (!collection) continue;
    let indexById = indexes.get(effect.collection);
    if (!indexById) {
      indexById = new Map(collection.map((item, index) => [item.id, index]));
      indexes.set(effect.collection, indexById);
    }
    const index = indexById.get(effect.id);
    if (effect.operation === "remove") {
      if (index !== undefined) {
        (collection as Array<{ id: string } | undefined>)[index] = undefined;
        indexById.delete(effect.id);
        collectionsWithRemovals.add(effect.collection);
      }
    } else if (effect.value && effect.operation === "update" && index !== undefined) {
      collection[index] = effect.value as never;
    } else if (effect.value && effect.operation === "create" && index === undefined) {
      indexById.set(effect.id, collection.length);
      collection.push(effect.value as never);
    }
    if (effect.collection === "cultures") culturesChanged = true;
    else if (effect.collection === "knowledge") knowledgeChanged = true;
    else if (effect.collection === "facilities") facilitiesChanged = true;
  }
  for (const collectionName of collectionsWithRemovals) {
    const collection = collectionFor(state, collectionName);
    if (!collection) continue;
    const compacted = (collection as Array<{ id: string } | undefined>)
      .filter((item): item is { id: string } => item !== undefined);
    collection.splice(0, collection.length, ...compacted);
  }
  // Cache keys in technology and facility indexes are collection references.
  // Refresh only the changed references when the Worker advances in place.
  if (culturesChanged) state.cultures = [...state.cultures];
  if (knowledgeChanged) state.knowledge = [...state.knowledge];
  if (facilitiesChanged) state.facilities = [...state.facilities];
};

const applyRelationshipEffects = (state: WorldState, effects: WorldDelta["relationshipEffects"]): void => {
  const indexById = new Map(state.relationships.map((relationship, index) => [relationship.id, index]));
  let removed = false;
  for (const effect of effects) {
    const index = indexById.get(effect.relationship.id);
    if (effect.operation === "remove") {
      if (index !== undefined) {
        (state.relationships as Array<WorldState["relationships"][number] | undefined>)[index] = undefined;
        indexById.delete(effect.relationship.id);
        removed = true;
      }
    } else if (effect.operation === "update" && index !== undefined) {
      state.relationships[index] = effect.relationship;
    } else if (effect.operation === "create" && index === undefined) {
      indexById.set(effect.relationship.id, state.relationships.length);
      state.relationships.push(effect.relationship);
    }
  }
  if (removed) {
    state.relationships = (state.relationships as Array<WorldState["relationships"][number] | undefined>)
      .filter((relationship): relationship is WorldState["relationships"][number] => relationship !== undefined);
  }
};

const applyEcologicalRelationshipEffects = (state: WorldState, effects: NonNullable<WorldDelta["ecologicalRelationshipEffects"]>): void => {
  const relationships = state.ecologicalRelationships ?? [];
  const indexById = new Map(relationships.map((relationship, index) => [relationship.id, index]));
  let removed = false;
  for (const effect of effects) {
    const index = indexById.get(effect.relationship.id);
    if (effect.operation === "remove") {
      if (index !== undefined) {
        relationships[index] = undefined as never;
        indexById.delete(effect.relationship.id);
        removed = true;
      }
    } else if (effect.operation === "update" && index !== undefined) {
      relationships[index] = effect.relationship;
    } else if (effect.operation === "create" && index === undefined) {
      indexById.set(effect.relationship.id, relationships.length);
      relationships.push(effect.relationship);
    }
  }
  state.ecologicalRelationships = removed
    ? relationships.filter((relationship): relationship is NonNullable<typeof relationship> => Boolean(relationship))
    : relationships;
};

const applyResourceTransactions = (state: WorldState, transactions: WorldDelta["resourceTransactions"]): void => {
  const entryKey = (resourceId: string, regionId: string, holderId?: string): string =>
    `${resourceId}|${regionId}|${holderId ?? "world"}`;
  const entriesByKey = new Map<string, WorldState["resources"][number]>();
  for (const entry of state.resources) {
    const key = entryKey(entry.resourceId, entry.regionId, entry.holderId);
    if (!entriesByKey.has(key)) entriesByKey.set(key, entry);
  }
  const findEntry = (resourceId: string, regionId: string, holderId?: string) =>
    entriesByKey.get(entryKey(resourceId, regionId, holderId));
  const balance = (resourceId: string, regionId: string, holderId?: string): number =>
    findEntry(resourceId, regionId, holderId)?.amount ?? 0;
  const changeBalance = (transaction: ResourceTransactionLike, regionId: ResourceTransactionLike["regionId"], holderId: string | undefined, amount: number, originEventId: string): void => {
    const existing = findEntry(transaction.resourceId, regionId, holderId);
    if (existing) {
      existing.amount = amount < 0
        ? Math.max(0, existing.amount + amount)
        : amount >= existing.cap - existing.amount
          ? existing.cap
          : existing.amount + amount;
      existing.originEventId = originEventId;
      return;
    }
    if (amount < 0) throw new Error(`Insufficient resource balance: ${transaction.id}`);
    const created = {
      id: `resource:${hashString(entryKey(transaction.resourceId, regionId, holderId)).toString(16)}`,
      resourceId: transaction.resourceId,
      regionId,
      ...(holderId ? { holderId } : {}),
      amount,
      cap: Number.MAX_SAFE_INTEGER,
      originEventId,
    };
    state.resources.push(created);
    entriesByKey.set(entryKey(created.resourceId, created.regionId, created.holderId), created);
  };
  const appliedIds = new Set<string>();
  for (const transaction of transactions) {
    if (appliedIds.has(transaction.id)) continue;
    appliedIds.add(transaction.id);
    if (!Number.isFinite(transaction.amount) || transaction.amount < 0 || transaction.amount > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Invalid resource amount: ${transaction.id}`);
    }
    if (transaction.operation === "mint") {
      changeBalance(transaction, transaction.regionId, transaction.toHolderId, transaction.amount, transaction.id);
    } else if (transaction.operation === "transfer") {
      if (!transaction.toHolderId) throw new Error(`Transfer requires destination holder: ${transaction.id}`);
      const from = transaction.fromHolderId;
      if (balance(transaction.resourceId, transaction.regionId, from) < transaction.amount) {
        throw new Error(`Insufficient resource balance: ${transaction.id}`);
      }
      changeBalance(transaction, transaction.regionId, from, -transaction.amount, transaction.id);
      changeBalance(transaction, transaction.destinationRegionId ?? transaction.regionId, transaction.toHolderId, transaction.amount, transaction.id);
    } else {
      const holderId = transaction.fromHolderId ?? transaction.toHolderId;
      if (balance(transaction.resourceId, transaction.regionId, holderId) < transaction.amount) {
        throw new Error(`Insufficient resource balance: ${transaction.id}`);
      }
      changeBalance(transaction, transaction.regionId, holderId, -transaction.amount, transaction.id);
    }
  }
};

type ResourceTransactionLike = WorldDelta["resourceTransactions"][number];

const asEntityId = (value: string) => value as WorldState["agents"][number]["id"];

const fusionKindFor = (source: WorldviewEntityState, target: WorldviewEntityState): WorldviewEntityState["kind"] =>
  source.kind === target.kind
    ? source.kind
    : source.kind === "cultivation-path" || target.kind === "cultivation-path"
      ? "cultivation-path"
      : "sect";

const worldviewOrganizationRank: Record<WorldState["organizations"][number]["type"], number> = {
  family: 0,
  clan: 1,
  tribe: 2,
  settlement: 3,
  city: 4,
  state: 5,
  federation: 6,
  empire: 7,
};

const primaryWorldviewOrganization = (state: WorldState, regionId: string, preferredId?: string): WorldState["organizations"][number] | undefined => {
  const preferred = preferredId
    ? state.organizations.find((organization) => organization.id === preferredId && organization.status === "active" && organization.regionId === regionId)
    : undefined;
  if (preferred) return preferred;
  return state.organizations
    .filter((organization) => organization.status === "active" && organization.regionId === regionId)
    .sort((left, right) => worldviewOrganizationRank[right.type] - worldviewOrganizationRank[left.type]
      || right.memberIds.length - left.memberIds.length
      || left.id.localeCompare(right.id))[0];
};

const worldviewGovernanceImpact = (kind: Extract<WorldviewEffect, { kind: "interact-entities" }>["interaction"]): {
  effect: WorldviewGovernanceEffect;
  values: Pick<NonNullable<WorldState["organizations"][number]["governance"]>, "stability" | "legitimacy" | "cohesion" | "publicGoods" | "warWeariness">;
} => kind === "conflict"
  ? { effect: "destabilizing", values: { stability: -0.006, legitimacy: -0.004, cohesion: -0.007, publicGoods: -0.002, warWeariness: 0.018 } }
  : kind === "fusion"
    ? { effect: "integrating", values: { stability: 0.004, legitimacy: 0.006, cohesion: 0.008, publicGoods: 0.003, warWeariness: -0.004 } }
    : { effect: "stabilizing", values: { stability: 0.002, legitimacy: 0.003, cohesion: 0.004, publicGoods: 0.002, warWeariness: -0.002 } };

const applyWorldviewGovernanceImpact = (
  state: WorldState,
  effect: Extract<WorldviewEffect, { kind: "interact-entities" }>,
  source: WorldviewEntityState,
  target: WorldviewEntityState,
): WorldviewGovernanceEffect => {
  const impact = worldviewGovernanceImpact(effect.interaction);
  const scale = Math.max(0, Math.min(1, effect.intensity * (0.65 + effect.compatibility * 0.35)));
  const regions = [...new Set([source.regionId, target.regionId])].sort();
  for (const regionId of regions) {
    const preferredId = regionId === source.regionId ? source.sponsorOrganizationId : target.sponsorOrganizationId;
    const organization = primaryWorldviewOrganization(state, regionId, preferredId);
    if (!organization) continue;
    const governance = governanceForOrganization(organization);
    organization.governance = {
      ...governance,
      stability: Math.max(0, Math.min(1, governance.stability + impact.values.stability * scale)),
      legitimacy: Math.max(0, Math.min(1, governance.legitimacy + impact.values.legitimacy * scale)),
      cohesion: Math.max(0, Math.min(1, governance.cohesion + impact.values.cohesion * scale)),
      publicGoods: Math.max(0, Math.min(1, governance.publicGoods + impact.values.publicGoods * scale)),
      warWeariness: Math.max(0, Math.min(1, governance.warWeariness + impact.values.warWeariness * scale)),
    };
  }
  return impact.effect;
};

const sourcePhenomenonFor = (state: WorldState, entity: WorldviewEntityState): WorldState["worldview"]["phenomena"][number] | undefined => {
  if (!entity.sourcePhenomenonId) return undefined;
  return state.worldview.phenomena.find((phenomenon) => phenomenon.id === entity.sourcePhenomenonId && phenomenon.packId === entity.packId);
};

const boundedBeliefIds = (ids: readonly string[], requiredId: string): string[] => {
  const unique = [...new Set([...ids, requiredId])].sort();
  if (unique.length <= MAX_BELIEFS_PER_AGENT) return unique;
  const retained = unique.filter((id) => id !== requiredId).slice(-(MAX_BELIEFS_PER_AGENT - 1));
  return [...retained, requiredId].sort();
};

const boundedCultureBeliefIds = (ids: readonly string[], requiredId: string): string[] => {
  const unique = [...new Set([...ids, requiredId])].sort();
  if (unique.length <= MAX_BELIEFS_PER_CULTURE) return unique;
  const retained = unique.filter((id) => id !== requiredId).slice(-(MAX_BELIEFS_PER_CULTURE - 1));
  return [...retained, requiredId].sort();
};

const applyWorldviewTransmission = (
  state: WorldState,
  effect: Extract<WorldviewEffect, { kind: "interact-entities" }>,
  source: WorldviewEntityState,
  target: WorldviewEntityState,
  interactionId: string,
): { transmittedBeliefId?: string; transmittedPracticeId?: string } => {
  if (source.regionId === target.regionId || (effect.interaction !== "propagation" && effect.interaction !== "fusion")) return {};
  const targetAgentIds = new Set([
    ...(target.memberIds ?? []),
    ...state.agents.filter((agent) => agent.regionId === target.regionId).map((agent) => agent.id),
  ]);
  const targetAgents = [...targetAgentIds]
    .map((agentId) => state.agents.find((agent) => agent.id === agentId))
    .filter((agent): agent is WorldState["agents"][number] => agent !== undefined && agent.regionId === target.regionId)
    .sort((left, right) => (right.traits.cognitivePotential ?? 0) - (left.traits.cognitivePotential ?? 0) || left.id.localeCompare(right.id));
  const phenomenon = sourcePhenomenonFor(state, source);
  const transmittedBeliefId = phenomenon ? `belief:${phenomenon.id}` : undefined;
  if (transmittedBeliefId) {
    const culture = state.cultures.find((candidate) => candidate.regionId === target.regionId);
    if (culture && !culture.beliefIds.includes(transmittedBeliefId)) {
      culture.beliefIds = boundedCultureBeliefIds(culture.beliefIds, transmittedBeliefId);
    }
    const adopterCount = Math.min(targetAgents.length, Math.max(1, Math.ceil(targetAgents.length * Math.min(1, effect.intensity * effect.compatibility * 0.25))));
    for (const agent of targetAgents.slice(0, adopterCount)) agent.beliefIds = boundedBeliefIds(agent.beliefIds, transmittedBeliefId);
  }

  if (state.worldview.practices.length >= MAX_WORLDVIEW_PRACTICES || targetAgents.length === 0) return transmittedBeliefId ? { transmittedBeliefId } : {};
  const sourcePractice = state.worldview.practices
    .filter((practice) => practice.status === "active"
      && practice.regionId === source.regionId
      && state.agents.some((agent) => agent.id === practice.practitionerId)
      && ((source.kind === "cultivation-path" && !source.sourcePhenomenonId)
        || (source.sourcePhenomenonId !== undefined && practice.phenomenonId === source.sourcePhenomenonId)))
    .sort((left, right) => right.attunement - left.attunement || left.id.localeCompare(right.id))[0];
  const recipient = targetAgents.find((agent) => !state.worldview.practices.some((practice) => practice.practitionerId === agent.id
    && practice.phenomenonId === sourcePractice?.phenomenonId));
  if (!sourcePractice || !recipient) return transmittedBeliefId ? { transmittedBeliefId } : {};
  const practiceId = `practice:transmission:${hashString(`${interactionId}:${sourcePractice.id}:${recipient.id}`).toString(16)}`;
  if (state.worldview.practices.some((practice) => practice.id === practiceId)) return transmittedBeliefId ? { transmittedBeliefId, transmittedPracticeId: practiceId } : {};
  const organization = primaryWorldviewOrganization(state, target.regionId);
  state.worldview.practices.push({
    id: practiceId,
    packId: sourcePractice.packId,
    name: `${sourcePractice.name} / transmitted`,
    phenomenonId: sourcePractice.phenomenonId,
    regionId: target.regionId,
    practitionerId: recipient.id,
    teacherId: sourcePractice.practitionerId,
    originTick: nextSimulationTick(state),
    originTimelineStep: nextSimulationStep(state),
    lastTrainedTick: state.tick,
    lastTrainedTimelineStep: timelineForWorld(state).step,
    attunement: Math.max(0.02, Math.min(0.22, sourcePractice.attunement * 0.7)),
    energy: 0.08,
    attempts: 0,
    failures: 0,
    status: "active",
    ...(organization ? { organizationId: organization.id } : {}),
  });
  const relationship = createRelationship("teacher", sourcePractice.practitionerId, recipient.id, nextSimulationTick(state), Math.max(0.35, Math.min(0.8, effect.compatibility)), nextSimulationStep(state));
  if (!state.relationships.some((candidate) => candidate.id === relationship.id)) {
    state.relationships.push(relationship);
    for (const agentId of [relationship.fromId, relationship.toId]) {
      const agent = state.agents.find((candidate) => candidate.id === agentId);
      if (agent && !agent.relationshipIds.includes(relationship.id)) agent.relationshipIds.push(relationship.id);
    }
  }
  return {
    ...(transmittedBeliefId ? { transmittedBeliefId } : {}),
    transmittedPracticeId: practiceId,
  };
};

const applyWorldviewInteraction = (state: WorldState, effect: Extract<WorldviewEffect, { kind: "interact-entities" }>): void => {
  const source = state.worldview.entities.find((entity) => entity.id === effect.sourceEntityId);
  const target = state.worldview.entities.find((entity) => entity.id === effect.targetEntityId);
  const targetRegionId = effect.targetRegionId ?? effect.regionId;
  if (!source || !target || source.id === target.id || source.regionId !== effect.regionId || target.regionId !== targetRegionId) return;
  if (source.packId !== effect.packId
    || source.packId === target.packId
    || !state.worldview.enabledPackIds.includes(target.packId)) return;

  const sourceId = source.id.localeCompare(target.id) <= 0 ? source.id : target.id;
  const targetId = source.id.localeCompare(target.id) <= 0 ? target.id : source.id;
  const interactionId = `worldview-interaction:${hashString(`${effect.interaction}:${sourceId}:${targetId}:${effect.regionId}:${targetRegionId}`).toString(16)}`;
  const nextTick = nextSimulationTick(state);
  const nextStep = nextSimulationStep(state);
  const existing = state.worldview.interactions.find((interaction) => interaction.id === interactionId);
  if (existing?.kind === "fusion" && existing.fusionEntityId) return;
  const sourcePackId = source.packId;
  const targetPackId = target.packId;
  const intensity = Math.max(0, Math.min(1, effect.intensity));
  const compatibility = Math.max(0, Math.min(1, effect.compatibility));
  const governanceEffect = applyWorldviewGovernanceImpact(state, effect, source, target);

  if (effect.interaction === "conflict") {
    source.influence = Math.max(0, Math.min(1, source.influence + intensity * 0.015));
    target.influence = Math.max(0, Math.min(1, target.influence - intensity * 0.02));
    source.conflictCount = addPersistentTotal(source.conflictCount ?? 0, 1);
    target.conflictCount = addPersistentTotal(target.conflictCount ?? 0, 1);
  } else if (effect.interaction === "propagation") {
    target.influence = Math.max(0, Math.min(1, target.influence + intensity * (0.008 + compatibility * 0.012)));
    source.propagationCount = addPersistentTotal(source.propagationCount ?? 0, 1);
    target.propagationCount = addPersistentTotal(target.propagationCount ?? 0, 1);
  } else {
    const fusionId = asEntityId(`worldview:fusion:${hashString(`${effect.regionId}:${targetRegionId}:${sourceId}:${targetId}`).toString(16)}`);
    const existingFusion = state.worldview.entities.find((entity) => entity.id === fusionId);
    if (!existingFusion) {
      const memberIds = [...new Set([...(source.memberIds ?? []), ...(target.memberIds ?? [])])].sort().slice(0, 64);
      const sponsorOrganizationId = [source.sponsorOrganizationId, target.sponsorOrganizationId]
        .find((organizationId) => organizationId && state.organizations.some((organization) => organization.id === organizationId && organization.status === "active"));
      const resourceBalances: Record<string, number> = {};
      for (const [resourceId, amount] of Object.entries(source.resourceBalances)) resourceBalances[resourceId] = Math.min(4, (resourceBalances[resourceId] ?? 0) + amount);
      for (const [resourceId, amount] of Object.entries(target.resourceBalances)) resourceBalances[resourceId] = Math.min(4, (resourceBalances[resourceId] ?? 0) + amount);
      const fusionEntity: WorldviewEntityState = {
        id: fusionId,
        packId: sourcePackId,
        kind: fusionKindFor(source, target),
        name: `${source.name ?? source.id.slice(-8)} + ${target.name ?? target.id.slice(-8)}`,
        regionId: targetRegionId,
        influence: Math.max(0, Math.min(1, (source.influence + target.influence) * 0.35 + compatibility * 0.15)),
        resourceBalances,
        originTick: nextTick,
        originTimelineStep: nextStep,
        derivedFromEntityIds: [source.id, target.id].sort(),
        derivedFromPackIds: [sourcePackId, targetPackId].sort(),
        ...(memberIds.length > 0 ? { memberIds } : {}),
        ...(sponsorOrganizationId ? { sponsorOrganizationId } : {}),
        status: "active",
        supporterCount: Math.min(1_000_000_000, (source.supporterCount ?? 0) + (target.supporterCount ?? 0)),
        activePractitionerCount: Math.min(1_000_000_000, (source.activePractitionerCount ?? 0) + (target.activePractitionerCount ?? 0)),
        sponsorCount: sponsorOrganizationId ? 1 : 0,
        viability: Math.max(0, Math.min(1, compatibility * 0.7 + Math.min(source.viability ?? source.influence, target.viability ?? target.influence) * 0.3)),
        lastStatusChangeTick: nextTick,
        lastStatusChangeTimelineStep: nextStep,
        lastActiveTick: nextTick,
        lastActiveTimelineStep: nextStep,
        revivalCount: 0,
        fusionCount: 1,
        lastInteractionTick: nextTick,
        lastInteractionTimelineStep: nextStep,
      };
      state.worldview.entities.push(fusionEntity);
    }
    const transmission = applyWorldviewTransmission(state, effect, source, target, interactionId);
    source.fusionCount = addPersistentTotal(source.fusionCount ?? 0, 1);
    target.fusionCount = addPersistentTotal(target.fusionCount ?? 0, 1);
    source.lastInteractionTick = nextTick;
    target.lastInteractionTick = nextTick;
    source.lastInteractionTimelineStep = nextStep;
    target.lastInteractionTimelineStep = nextStep;
    const fusionEntity = state.worldview.entities.find((entity) => entity.id === fusionId);
    if (existing) {
      if (fusionEntity) existing.fusionEntityId = fusionEntity.id;
      existing.governanceEffect = governanceEffect;
      Object.assign(existing, transmission);
      existing.status = "resolved";
    } else {
      state.worldview.interactions.push({
        id: interactionId,
        kind: effect.interaction,
        sourceEntityId: source.id,
        targetEntityId: target.id,
        sourcePackId,
        targetPackId,
        regionId: effect.regionId,
        ...(targetRegionId === effect.regionId ? {} : { targetRegionId }),
        originTick: nextTick,
        originTimelineStep: nextStep,
        lastInteractionTick: nextTick,
        lastInteractionTimelineStep: nextStep,
        attempts: 1,
        successes: 1,
        failures: 0,
        compatibility,
        intensity,
        status: "resolved",
        ...(fusionEntity ? { fusionEntityId: fusionEntity.id } : {}),
        ...(transmission.transmittedBeliefId ? { transmittedBeliefId: transmission.transmittedBeliefId } : {}),
        ...(transmission.transmittedPracticeId ? { transmittedPracticeId: transmission.transmittedPracticeId } : {}),
        governanceEffect,
      });
    }
    return;
  }

  const transmission = applyWorldviewTransmission(state, effect, source, target, interactionId);
  source.lastInteractionTick = nextTick;
  target.lastInteractionTick = nextTick;
  source.lastInteractionTimelineStep = nextStep;
  target.lastInteractionTimelineStep = nextStep;
  if (existing) {
    existing.lastInteractionTick = nextTick;
    existing.lastInteractionTimelineStep = nextStep;
    existing.attempts = addPersistentTotal(existing.attempts, 1);
    existing.successes = addPersistentTotal(existing.successes, 1);
    existing.compatibility = compatibility;
    existing.intensity = intensity;
    existing.governanceEffect = governanceEffect;
    Object.assign(existing, transmission);
    existing.status = source.status === "active" && target.status === "active" ? "active" : "dormant";
  } else {
    state.worldview.interactions.push({
      id: interactionId,
      kind: effect.interaction,
      sourceEntityId: source.id,
      targetEntityId: target.id,
      sourcePackId,
      targetPackId,
      regionId: effect.regionId,
      ...(targetRegionId === effect.regionId ? {} : { targetRegionId }),
      originTick: nextTick,
      originTimelineStep: nextStep,
      lastInteractionTick: nextTick,
      lastInteractionTimelineStep: nextStep,
      attempts: 1,
      successes: 1,
      failures: 0,
      compatibility,
      intensity,
      status: "active",
      ...(transmission.transmittedBeliefId ? { transmittedBeliefId: transmission.transmittedBeliefId } : {}),
      ...(transmission.transmittedPracticeId ? { transmittedPracticeId: transmission.transmittedPracticeId } : {}),
      governanceEffect,
    });
  }
};

const applyWorldviewEffects = (state: WorldState, effects: WorldviewEffect[]): void => {
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  for (const effect of effects) {
    if (effect.kind === "discover-motif") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      const ruleId = `${effect.packId}:${effect.motifId}`;
      if (!state.worldview.discoveredRuleIds.includes(ruleId)) state.worldview.discoveredRuleIds.push(ruleId);
    } else if (effect.kind === "propagate-belief") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      for (const culture of state.cultures.filter((candidate) => candidate.regionId === effect.regionId)) {
        if (!culture.beliefIds.includes(effect.beliefId)) culture.beliefIds.push(effect.beliefId);
      }
    } else if (effect.kind === "propose-entity") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      if (!Number.isFinite(effect.probability) || effect.probability < 0 || effect.probability > 1) {
        throw new Error(`Invalid worldview probability: ${effect.packId}`);
      }
      if (effect.evidence.eligible !== true) continue;
      if (effect.sourcePhenomenonId && !state.worldview.phenomena.some((phenomenon) => phenomenon.id === effect.sourcePhenomenonId
        && phenomenon.packId === effect.packId
        && phenomenon.regionId === effect.regionId)) continue;
      const memberIds = [...new Set(effect.memberIds ?? [])]
        .filter((memberId) => state.agents.some((agent) => agent.id === memberId && agent.regionId === effect.regionId))
        .sort();
      const founderId = effect.founderId && memberIds.includes(effect.founderId) ? effect.founderId : memberIds[0];
      const sponsorOrganizationId = effect.sponsorOrganizationId && state.organizations.some((organization) => organization.id === effect.sponsorOrganizationId && organization.status === "active")
        ? effect.sponsorOrganizationId
        : undefined;
      const id = asEntityId(`worldview:${hashString(`${effect.packId}:${effect.entityKind}:${effect.regionId}`).toString(16)}`);
      if (state.worldview.entities.some((entity) => entity.id === id)) continue;
      state.worldview.entities.push({
        id,
        packId: effect.packId,
        kind: effect.entityKind,
        ...(effect.name ? { name: effect.name } : {}),
        regionId: effect.regionId,
        influence: clamp(effect.influence ?? 0.01),
        resourceBalances: {},
        originTick: nextSimulationTick(state),
        originTimelineStep: nextSimulationStep(state),
        ...(effect.sourcePhenomenonId ? { sourcePhenomenonId: effect.sourcePhenomenonId } : {}),
        ...(founderId ? { founderId } : {}),
        ...(memberIds.length > 0 ? { memberIds } : {}),
        ...(sponsorOrganizationId ? { sponsorOrganizationId } : {}),
        status: "active",
        supporterCount: 0,
        activePractitionerCount: 0,
        sponsorCount: sponsorOrganizationId ? 1 : 0,
        viability: clamp(effect.influence ?? 0.01),
        lastStatusChangeTick: nextSimulationTick(state),
        lastStatusChangeTimelineStep: nextSimulationStep(state),
        lastActiveTick: nextSimulationTick(state),
        lastActiveTimelineStep: nextSimulationStep(state),
        revivalCount: 0,
      });
    } else if (effect.kind === "interact-entities") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      if (![effect.probability, effect.compatibility, effect.intensity].every(Number.isFinite)
        || effect.probability < 0 || effect.probability > 1
        || effect.compatibility < 0 || effect.compatibility > 1
        || effect.intensity < 0 || effect.intensity > 1) {
        throw new Error(`Invalid worldview interaction: ${effect.sourceEntityId}`);
      }
      applyWorldviewInteraction(state, effect);
    } else if (effect.kind === "record-phenomenon") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      const id = `phenomenon:${hashString(JSON.stringify(effect)).toString(16)}`;
      if (state.worldview.phenomena.some((record) => record.id === id)) continue;
      state.worldview.phenomena.push({
        id,
        packId: effect.packId,
        kind: effect.phenomenonKind,
        epistemicStatus: effect.epistemicStatus,
        name: effect.name,
        regionId: effect.regionId,
        originTick: nextSimulationTick(state),
        originTimelineStep: nextSimulationStep(state),
        parentIds: [...effect.parentIds].sort(),
        causeRuleId: effect.causeRuleId,
        evidence: { ...effect.evidence },
      });
      if (effect.epistemicStatus === "believed") {
        const beliefId = `belief:${id}`;
        for (const culture of state.cultures.filter((candidate) => candidate.regionId === effect.regionId)) {
          if (!culture.beliefIds.includes(beliefId)) culture.beliefIds.push(beliefId);
        }
      }
    } else if (effect.kind === "begin-practice") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      const id = `practice:${hashString(JSON.stringify(effect)).toString(16)}`;
      if (state.worldview.practices.some((practice) => practice.id === id)) continue;
      if (!state.agents.some((agent) => agent.id === effect.practitionerId)) continue;
      const organizationId = effect.organizationId && state.organizations.some((organization) => organization.id === effect.organizationId)
        ? effect.organizationId
        : undefined;
      state.worldview.practices.push({
        id,
        packId: effect.packId,
        name: effect.name,
        phenomenonId: effect.phenomenonId,
        regionId: effect.regionId,
        practitionerId: effect.practitionerId,
        ...(effect.teacherId ? { teacherId: effect.teacherId } : {}),
        ...(organizationId ? { organizationId } : {}),
        originTick: nextSimulationTick(state),
        originTimelineStep: nextSimulationStep(state),
        lastTrainedTick: state.tick,
        lastTrainedTimelineStep: timelineForWorld(state).step,
        attunement: 0.02,
        energy: 0.12,
        attempts: 0,
        failures: 0,
        status: "active",
      });
      if (effect.teacherId && state.agents.some((agent) => agent.id === effect.teacherId)) {
        const relationship = createRelationship("teacher", effect.teacherId, effect.practitionerId, nextSimulationTick(state), 0.78, nextSimulationStep(state));
        if (!state.relationships.some((candidate) => candidate.id === relationship.id)) {
          state.relationships.push(relationship);
          for (const agentId of [relationship.fromId, relationship.toId]) {
            const agent = state.agents.find((candidate) => candidate.id === agentId);
            if (agent && !agent.relationshipIds.includes(relationship.id)) agent.relationshipIds.push(relationship.id);
          }
        }
      }
    } else if (effect.kind === "train-practice") {
      if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
      const practice = state.worldview.practices.find((candidate) => candidate.id === effect.practiceId);
      if (!practice || practice.status !== "active") continue;
      const values = [effect.energyGain, effect.energySpent, effect.attunementDelta];
      if (!values.every(Number.isFinite) || effect.energyGain < 0 || effect.energySpent < 0) {
        throw new Error(`Invalid practice training values: ${effect.practiceId}`);
      }
      const nextEnergy = Math.max(0, Math.min(1, practice.energy + effect.energyGain - effect.energySpent));
      practice.energy = nextEnergy;
      practice.attunement = Math.max(0, Math.min(1, practice.attunement + effect.attunementDelta));
      practice.attempts = addPersistentTotal(practice.attempts, 1);
      practice.lastTrainedTick = nextSimulationTick(state);
      practice.lastTrainedTimelineStep = nextSimulationStep(state);
      if (effect.outcome !== "advance") practice.failures = addPersistentTotal(practice.failures, 1);
      if (effect.outcome === "exhausted" && nextEnergy <= 0.01) practice.status = "dormant";
      if (practice.failures >= 5 && practice.attunement < 0.04) practice.status = "failed";
      const organizationId = effect.organizationId ?? practice.organizationId;
      const organization = organizationId ? state.organizations.find((candidate) => candidate.id === organizationId) : undefined;
      if (organization) {
        const governance = governanceForOrganization(organization);
        const impact = effect.outcome === "advance"
          ? { stability: 0.003, legitimacy: 0.004, cohesion: 0.007, publicGoods: 0.003 }
          : effect.outcome === "setback"
            ? { stability: -0.002, legitimacy: -0.002, cohesion: -0.004, publicGoods: -0.001 }
            : { stability: -0.004, legitimacy: -0.003, cohesion: -0.006, publicGoods: -0.003 };
        organization.governance = {
          ...governance,
          stability: clamp(governance.stability + impact.stability),
          legitimacy: clamp(governance.legitimacy + impact.legitimacy),
          cohesion: clamp(governance.cohesion + impact.cohesion),
          publicGoods: clamp(governance.publicGoods + impact.publicGoods),
        };
      }
    }
  }
};

const validateDeltaBeforeMutation = (state: WorldState, delta: WorldDelta): void => {
  const gridSize = state.fields.elevation.values.length;
  for (const patch of delta.fieldPatches ?? []) {
    if (!(patch.field in state.fields) || patch.values.length !== gridSize || !patch.values.every((value) => Number.isFinite(value))) {
      throw new Error(`Invalid field patch: ${patch.field}`);
    }
  }
  for (const change of delta.fieldChanges) {
    if (!(change.field in state.fields) || !Number.isInteger(change.index) || change.index < 0 || change.index >= gridSize || !Number.isFinite(change.value)) {
      throw new Error(`Invalid field change: ${change.field}:${change.index}`);
    }
  }
  for (const patch of delta.chemistryPatches ?? []) {
    if (!(patch.field in state.chemistry) || patch.values.length !== gridSize || !patch.values.every((value) => Number.isFinite(value))) {
      throw new Error(`Invalid chemistry patch: ${patch.field}`);
    }
  }
  for (const change of delta.chemistryChanges) {
    if (!(change.field in state.chemistry) || !Number.isInteger(change.index) || change.index < 0 || change.index >= gridSize || !Number.isFinite(change.value)) {
      throw new Error(`Invalid chemistry change: ${change.field}:${change.index}`);
    }
  }
  for (const effect of delta.ecologicalRelationshipEffects ?? []) {
    const relationship = effect.relationship;
    if (!Number.isFinite(relationship.strength)
      || !Number.isFinite(relationship.firstTick)
      || !Number.isFinite(relationship.lastTick)
      || !Number.isFinite(relationship.interactionCount)
      || !Number.isFinite(relationship.cumulativeImpact)
      || !Number.isFinite(relationship.lastImpact)
      || !relationship.id
      || !relationship.regionId
      || !relationship.fromSpeciesId
      || !relationship.toSpeciesId) {
      throw new Error(`Invalid ecological relationship: ${relationship.id}`);
    }
  }
  if (delta.entityEffects.some((effect) => effect.collection === "worldviewEntities")) {
    throw new Error("Worldview entities must use constrained worldview effects");
  }
  const worldviewTransactions = delta.worldviewEffects
    .filter((effect): effect is Extract<WorldviewEffect, { kind: "resource-transaction" }> => effect.kind === "resource-transaction")
    .map((effect) => effect.transaction);
  const resourceShadow = { ...state, resources: structuredClone(state.resources) };
  applyResourceTransactions(resourceShadow, [...delta.resourceTransactions, ...worldviewTransactions]);
  for (const effect of delta.worldviewEffects) {
    if (effect.kind === "resource-transaction") continue;
    if (!state.worldview.enabledPackIds.includes(effect.packId)) throw new Error(`Worldview pack is not enabled: ${effect.packId}`);
    if (effect.kind === "propose-entity"
      && (!Number.isFinite(effect.probability) || effect.probability < 0 || effect.probability > 1)) {
      throw new Error(`Invalid worldview probability: ${effect.packId}`);
    }
    if (effect.kind === "train-practice"
      && (![effect.energyGain, effect.energySpent, effect.attunementDelta].every(Number.isFinite)
        || effect.energyGain < 0 || effect.energySpent < 0)) {
      throw new Error(`Invalid practice training values: ${effect.practiceId}`);
    }
    if (effect.kind === "interact-entities"
      && (![effect.probability, effect.compatibility, effect.intensity].every(Number.isFinite)
        || effect.probability < 0 || effect.probability > 1
        || effect.compatibility < 0 || effect.compatibility > 1
        || effect.intensity < 0 || effect.intensity > 1)) {
      throw new Error(`Invalid worldview interaction: ${effect.sourceEntityId}`);
    }
  }
  if (delta.formationEffect && !Object.values(delta.formationEffect).every((value) => typeof value !== "number" || Number.isFinite(value))) {
    throw new Error("Invalid planet formation state");
  }
  if (delta.climateCycleEffect && !isClimateCycleState(delta.climateCycleEffect)) {
    throw new Error("Invalid climate cycle state");
  }
  if (delta.tectonicEffect && !isTectonicState(
    delta.tectonicEffect,
    state.fields.elevation.width,
    state.fields.elevation.height,
  )) {
    throw new Error("Invalid tectonic state");
  }
  if (delta.atmosphereEffect && !isAtmosphereState(
    delta.atmosphereEffect,
    state.fields.elevation.width,
    state.fields.elevation.height,
  )) {
    throw new Error("Invalid atmosphere state");
  }
  if (delta.oceanEffect && !isOceanState(
    delta.oceanEffect,
    state.fields.elevation.width,
    state.fields.elevation.height,
  )) {
    throw new Error("Invalid ocean state");
  }
};

const applyDelta = (state: WorldState, delta: WorldDelta, orderedGridDeltas: readonly WorldDelta[] = [delta]): void => {
  for (const gridDelta of orderedGridDeltas) {
    applyFieldPatches(state, gridDelta.fieldPatches ?? []);
    applyFieldChanges(state, gridDelta.fieldChanges);
  }
  for (const gridDelta of orderedGridDeltas) {
    applyChemistryPatches(state, gridDelta.chemistryPatches ?? []);
    applyChemistryChanges(state, gridDelta.chemistryChanges);
  }
  const worldviewTransactions = delta.worldviewEffects
    .filter((effect): effect is Extract<WorldviewEffect, { kind: "resource-transaction" }> => effect.kind === "resource-transaction")
    .map((effect) => effect.transaction);
  applyResourceTransactions(state, [...delta.resourceTransactions, ...worldviewTransactions]);
  const removedOrganizations = delta.entityEffects
    .filter((effect): effect is EntityEffect & { collection: "organizations"; operation: "remove" } => effect.collection === "organizations" && effect.operation === "remove")
    .map((effect) => state.organizations.find((organization) => organization.id === effect.id))
    .filter((organization): organization is WorldState["organizations"][number] => Boolean(organization));
  archiveOrganizationRecords(state, removedOrganizations, "lifecycle");
  applyEntityEffects(state, delta.entityEffects);
  applyRelationshipEffects(state, delta.relationshipEffects);
  applyEcologicalRelationshipEffects(state, delta.ecologicalRelationshipEffects ?? []);
  applyWorldviewEffects(state, delta.worldviewEffects);
  if (delta.formationEffect) state.formation = structuredClone(delta.formationEffect);
  if (delta.climateCycleEffect) state.climateCycle = structuredClone(delta.climateCycleEffect);
  if (delta.tectonicEffect) state.tectonics = structuredClone(delta.tectonicEffect);
  if (delta.atmosphereEffect) state.atmosphere = structuredClone(delta.atmosphereEffect);
  if (delta.oceanEffect) state.ocean = structuredClone(delta.oceanEffect);
  for (const effect of delta.lodEffects ?? []) {
    const index = state.lod.summaries.findIndex((summary) => summary.regionId === (effect.operation === "upsert-summary" ? effect.summary.regionId : effect.regionId));
    if (effect.operation === "remove-summary") {
      if (index >= 0) state.lod.summaries.splice(index, 1);
      state.lod.canonicalMicroRegionIds = state.lod.canonicalMicroRegionIds.filter((regionId) => regionId !== effect.regionId);
    } else if (index >= 0) {
      state.lod.summaries[index] = effect.summary;
      if (effect.summary.mode === "micro" && !state.lod.canonicalMicroRegionIds.includes(effect.summary.regionId)) state.lod.canonicalMicroRegionIds.push(effect.summary.regionId);
    } else {
      state.lod.summaries.push(effect.summary);
      if (effect.summary.mode === "micro" && !state.lod.canonicalMicroRegionIds.includes(effect.summary.regionId)) state.lod.canonicalMicroRegionIds.push(effect.summary.regionId);
    }
  }
};

const TRANSIENT_MAINTENANCE_INTERVAL = 64;

const transientMaintenanceDue = (state: WorldState): boolean => {
  if (state.tick < Number.MAX_SAFE_INTEGER) return state.tick % TRANSIENT_MAINTENANCE_INTERVAL === 0;
  const timelineStep = state.timeline?.step;
  if (!timelineStep || !/^\d+$/.test(timelineStep)) return true;
  return Number(BigInt(timelineStep) % BigInt(TRANSIENT_MAINTENANCE_INTERVAL)) === 0;
};

const worldviewLifecycleNeedsMaintenance = (state: WorldState): boolean => {
  if (state.worldview.entities.length === 0) return false;
  const agentIds = new Set(state.agents.map((agent) => agent.id));
  const validPractices = state.worldview.practices.filter((practice) => practice.status !== "failed" && agentIds.has(practice.practitionerId));
  const practiceIdsByEntityKey = new Map<string, Set<string>>();
  for (const practice of validPractices) {
    const key = `${practice.packId}|${practice.regionId}|${practice.phenomenonId}`;
    const ids = practiceIdsByEntityKey.get(key) ?? new Set<string>();
    ids.add(practice.practitionerId);
    practiceIdsByEntityKey.set(key, ids);
  }
  for (const entity of state.worldview.entities) {
    if ((entity.memberIds ?? []).some((memberId) => !agentIds.has(memberId))) return true;
    const expected = entity.sourcePhenomenonId
      ? practiceIdsByEntityKey.get(`${entity.packId}|${entity.regionId}|${entity.sourcePhenomenonId}`) ?? new Set<string>()
      : entity.kind === "sect"
        ? practiceIdsByEntityKey.get(`${entity.packId}|${entity.regionId}|`) ?? new Set<string>()
        : undefined;
    if (expected) {
      const currentMembers = new Set((entity.memberIds ?? []).map(String));
      if ([...expected].some((memberId) => !currentMembers.has(memberId))) return true;
    }
  }
  return false;
};

const requiresTransientMaintenance = (state: WorldState, delta: WorldDelta): boolean => {
  // Relationship updates only refresh attributes on existing endpoints. They
  // cannot leave a dangling reference, so defer their global reconciliation
  // to the bounded maintenance interval. Creating or removing a relationship
  // still needs an immediate pass to preserve the runtime invariants.
  if (delta.relationshipEffects.some((effect) => effect.operation !== "update")) return true;
  if (delta.entityEffects.some((effect) =>
    (effect.collection === "species"
      || effect.collection === "populations"
      || effect.collection === "agents"
      || effect.collection === "organizations"
      || effect.collection === "facilities")
    && (effect.operation === "create" || effect.operation === "remove"),
  )) return true;
  // Worldview lifecycle reconciliation is only needed after worldview data
  // changes; periodic maintenance still repairs older or externally loaded
  // states.
  if (!delta.worldviewEffects.some((effect) => effect.kind !== "resource-transaction")) return false;
  return worldviewLifecycleNeedsMaintenance(state);
};

const pruneTransientState = (state: WorldState, delta: WorldDelta): WorldDelta["eventDrafts"] => {
  // Most ticks only update already-canonical records. Defer whole-world
  // reconciliation until a structural change or a bounded maintenance tick.
  // The stage deltas still carry immediate entity and relationship updates.
  if (!requiresTransientMaintenance(state, delta) && !transientMaintenanceDue(state)) return [];
  compactPopulationRecords(state);
  compactExtinctSpecies(state);
  const populationIds = new Set(state.populations.map((population) => population.id));
  state.agents = state.agents.filter((agent) => populationIds.has(agent.populationId));
  compactEcologicalRelationships(state, { validSpeciesIds: new Set(state.species.map((species) => species.id)) });
  const agentIds = new Set(state.agents.map((agent) => agent.id));
  // Later stages can still see an organization member that died earlier in
  // this step. Reconcile relationship endpoints at the commit boundary so
  // no runtime relationship can outlive either detailed agent.
  const relationshipIds = new Set<string>();
  state.relationships = state.relationships.filter((relationship) => {
    if (relationshipIds.has(relationship.id)) return false;
    if (!agentIds.has(relationship.fromId) || !agentIds.has(relationship.toId)) return false;
    relationshipIds.add(relationship.id);
    return true;
  });
  compactRelationshipRecords(state);
  const relationshipIdsByAgent = new Map<WorldState["agents"][number]["id"], string[]>();
  for (const relationship of state.relationships) {
    for (const agentId of [relationship.fromId, relationship.toId]) {
      const ids = relationshipIdsByAgent.get(agentId) ?? [];
      ids.push(relationship.id);
      relationshipIdsByAgent.set(agentId, ids);
    }
  }
  for (const agent of state.agents) {
    agent.relationshipIds = [...new Set(relationshipIdsByAgent.get(agent.id) ?? [])].sort();
  }
  const organizationIds = new Set(state.organizations.map((organization) => organization.id));
  state.organizations = state.organizations.map((organization) => {
    const memberIds = [...new Set(organization.memberIds.filter((memberId) => agentIds.has(memberId)))].sort();
    const childOrganizationIds = [...new Set(organization.childOrganizationIds.filter((childId) => organizationIds.has(childId)))].sort();
    const diplomacy = Object.fromEntries(
      Object.entries(organization.diplomacy ?? {})
        .filter(([otherId]) => otherId !== organization.id && organizationIds.has(otherId as WorldState["organizations"][number]["id"]))
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    const status = memberIds.length === 0 || (organization.type === "family" && memberIds.length < 2)
      ? "collapsed"
      : organization.status;
    if (memberIds.length === organization.memberIds.length
      && childOrganizationIds.length === organization.childOrganizationIds.length
      && Object.keys(diplomacy).length === Object.keys(organization.diplomacy ?? {}).length
      && status === organization.status) return organization;
    return { ...organization, memberIds, childOrganizationIds, diplomacy, status };
  });
  compactOrganizationRecords(state);
  compactFacilityRecords(state);
  const organizationIdsAfterPrune = new Set(state.organizations.map((organization) => organization.id));
  state.worldview.practices = state.worldview.practices
    .filter((practice) => agentIds.has(practice.practitionerId))
    .map((practice) => {
      const { teacherId, organizationId, ...base } = practice;
      return {
        ...base,
        ...(teacherId && agentIds.has(teacherId) ? { teacherId } : {}),
        ...(organizationId && organizationIdsAfterPrune.has(organizationId) ? { organizationId } : {}),
      };
    });
  compactResourceRecords(state);
  compactCultureRecords(state);
  compactKnowledgeRecords(state);
  compactAgentMemoryRecords(state);
  const identifiedCultures = state.cultures.map(ensureCultureIdentity);
  if (identifiedCultures.some((culture, index) => culture !== state.cultures[index])) state.cultures = identifiedCultures;
  const identifiedSpecies = state.species.map(ensureSpeciesIdentity);
  if (identifiedSpecies.some((species, index) => species !== state.species[index])) state.species = identifiedSpecies;
  compactPathogenRecords(state);
  const lifecycleEvents = reconcileWorldviewLifecycle(state);
  compactWorldviewRecords(state);
  return lifecycleEvents;
};

const installDefaultStages = (): void => {
  if (!stageRegistry.has("environment")) {
    registerSimulationStage({
      id: "environment",
      order: 10,
      run: (state, input) => stepEnvironment(state, {
        solarFlux: 1,
        externalEvents: input.externalEvents,
        elapsedYears: input.elapsedYears,
        ...(input.timelineDays === undefined ? {} : { timelineDays: input.timelineDays }),
        ...(input.timelineStep === undefined ? {} : { timelineStep: input.timelineStep }),
      }),
    });
  }
  const annualized = (stage: SimulationStage): SimulationStage => ({
    ...stage,
    run: (state, input, priorDeltas) => {
      if (state.formation.phase !== "stable-crust") return emptyDelta();
      const elapsedYears = wholeYearsCrossed(state.years, input.elapsedYears, timelineForWorld(state).days);
      const stageState = stateWithPendingClimateCycle(state, priorDeltas);
      return elapsedYears > 0
        ? stage.run(stageState, { ...input, elapsedYears }, priorDeltas)
        : emptyDelta();
    },
  });
  if (!stageRegistry.has("ecology")) {
    registerSimulationStage(annualized({
      id: "ecology",
      order: 20,
      run: (state, _input, priorDeltas) => {
        const context: RuleContext = { state, random: state.random, metrics: metricsFor(state), tick: state.tick, years: state.years };
        return stepEcology(state, context, priorDeltas.get("environment")?.oceanEffect);
      },
    }));
  }
  if (!stageRegistry.has(agentsStage.id)) registerSimulationStage(annualized(agentsStage));
  if (!stageRegistry.has(cultureStage.id)) registerSimulationStage(annualized(cultureStage));
  if (!stageRegistry.has(societyStage.id)) registerSimulationStage(annualized(societyStage));
  if (!stageRegistry.has(lodStage.id)) registerSimulationStage(annualized(lodStage));
  if (!stageRegistry.has(worldviewStage.id)) registerSimulationStage(annualized(worldviewStage));
};

export const MAX_EXTERNAL_EVENTS_PER_STEP = 256;
export type StepOptions = {
  computeDigest?: boolean;
  mutateState?: boolean;
  validation?: "full" | "periodic" | "none";
};

const PERIODIC_VALIDATION_INTERVAL = 64;

const periodicValidationDue = (state: WorldState): boolean => {
  if (state.tick < Number.MAX_SAFE_INTEGER) return state.tick % PERIODIC_VALIDATION_INTERVAL === 0;
  const timelineStep = state.timeline?.step;
  if (!timelineStep || !/^\d+$/.test(timelineStep)) return true;
  return Number(BigInt(timelineStep) % BigInt(PERIODIC_VALIDATION_INTERVAL)) === 0;
};

export const stepWorld = (state: WorldState, input: StepInput, options: StepOptions = {}): { state: WorldState; events: WorldState["events"]; digest: string } => {
  if (!Number.isSafeInteger(state.tick) || state.tick < 0) {
    throw new RangeError("World tick must be a safe, non-negative integer");
  }
  const currentTimeline = timelineForWorld(state);
  // Promote legacy saves to the exact clock on their next step, even when
  // their compatibility tick has already reached MAX_SAFE_INTEGER.
  const nextTimeline = advanceSimulationTimeline(currentTimeline, input.elapsedYears);
  const projection = timelineProjection(nextTimeline);
  installDefaultStages();
  const previous = state;
  const knownExternalIds = new Set(previous.events.map((event) => event.id));
  const acceptedExternalEvents = input.externalEvents.slice(0, MAX_EXTERNAL_EVENTS_PER_STEP).filter((event) => {
    if (knownExternalIds.has(event.id)) return false;
    knownExternalIds.add(event.id);
    return true;
  });
  const priorDeltas = new Map<string, WorldDelta>();
  const orderedDeltas: WorldDelta[] = [];
  const merged = emptyDelta();
  for (const stage of listSimulationStages()) {
    const delta = stage.run(previous, {
      ...input,
      externalEvents: acceptedExternalEvents,
      timelineDays: nextTimeline.days,
      timelineStep: nextTimeline.step,
    }, priorDeltas);
    priorDeltas.set(stage.id, delta);
    orderedDeltas.push(delta);
    appendItems(merged.fieldChanges, delta.fieldChanges);
    appendItems(merged.chemistryChanges, delta.chemistryChanges);
    if (delta.fieldPatches) merged.fieldPatches = [...(merged.fieldPatches ?? []), ...delta.fieldPatches];
    if (delta.chemistryPatches) merged.chemistryPatches = [...(merged.chemistryPatches ?? []), ...delta.chemistryPatches];
    appendItems(merged.entityEffects, delta.entityEffects);
    appendItems(merged.relationshipEffects, delta.relationshipEffects);
    if (delta.ecologicalRelationshipEffects) merged.ecologicalRelationshipEffects = [...(merged.ecologicalRelationshipEffects ?? []), ...delta.ecologicalRelationshipEffects];
    appendItems(merged.resourceTransactions, delta.resourceTransactions);
    appendItems(merged.worldviewEffects, delta.worldviewEffects);
    appendItems(merged.eventDrafts, delta.eventDrafts);
    if (delta.lodEffects) merged.lodEffects = [...(merged.lodEffects ?? []), ...delta.lodEffects];
    if (delta.formationEffect) merged.formationEffect = delta.formationEffect;
    if (delta.climateCycleEffect) merged.climateCycleEffect = delta.climateCycleEffect;
    if (delta.tectonicEffect) merged.tectonicEffect = delta.tectonicEffect;
    if (delta.atmosphereEffect) merged.atmosphereEffect = delta.atmosphereEffect;
    if (delta.oceanEffect) merged.oceanEffect = delta.oceanEffect;
  }
  const next = options.mutateState
    ? previous
    : structuredClone({ ...previous, events: [] }) as WorldState;
  if (!options.mutateState) next.events = [...previous.events];
  const validation = options.validation ?? "periodic";
  if (options.mutateState
    && validation !== "none"
    && (validation === "full" || periodicValidationDue(previous))) {
    validateDeltaBeforeMutation(next, merged);
  }
  synchronizeEventArchive(next.eventArchive, next.events);
  applyDelta(next, merged, orderedDeltas);
  appendItems(merged.eventDrafts, pruneTransientState(next, merged));
  const [, nextRandom] = nextRandomValue(previous.random);
  next.random = nextRandom;
  next.timeline = nextTimeline;
  next.tick = projection.tick;
  next.simulationDays = projection.simulationDays;
  next.years = projection.years;
  next.orbital = orbitalStateForWorld(next);
  const emittedExternal = appendExternalEventsInPlace(next.events, acceptedExternalEvents, currentTimeline.step, currentTimeline.days);
  const emittedNatural = appendEventsInPlace(next.events, merged.eventDrafts, next.tick, next.years, nextTimeline.step, nextTimeline.days);
  const emittedEvents = [...emittedExternal, ...emittedNatural];
  recordAppendedEvents(next.eventArchive, emittedEvents);
  recordOrganizationDevelopment(next, emittedEvents);
  if (wholeYearsCrossed(0, input.elapsedYears, currentTimeline.days) > 0) recordHistorySample(next);
  const archivedEvents = compactEventLedger(next);
  const removedOrganization = merged.entityEffects.some((effect) => effect.collection === "organizations" && effect.operation === "remove");
  if (archivedEvents.length > 0 || removedOrganization) compactEventArchiveIndexes(next);
  return { state: next, events: emittedEvents, digest: options.computeDigest === false ? "" : worldDigest(next) };
};

const nextRandomValue = (random: WorldState["random"]): [number, WorldState["random"]] => nextRandom(random);
