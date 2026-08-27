import { hashString, nextRandom } from "./random.ts";
import {
  appendEventsInPlace,
  appendExternalEventsInPlace,
  compactEventArchiveIndexes,
  compactEventLedger,
  lifetimeTradeVolume,
  recordAppendedEvents,
  synchronizeEventArchive,
} from "./events/ledger.ts";
import { stepEnvironment } from "./environment/index.ts";
import { stepEcology } from "./ecology/index.ts";
import { compactExtinctSpecies, compactPopulationRecords } from "./ecology/archive.ts";
import { ensureSpeciesIdentity } from "./ecology/blueprints.ts";
import { agentsStage, compactAgentMemoryRecords, compactRelationshipRecords } from "./agents/index.ts";
import { createRelationship } from "./agents/relationships.ts";
import { cultureStage } from "./culture/index.ts";
import { compactCultureRecords, compactKnowledgeRecords } from "./culture/archive.ts";
import { ensureCultureIdentity } from "./culture/identity.ts";
import { societyStage } from "./society/index.ts";
import { compactOrganizationRecords } from "./society/archive.ts";
import { lodStage } from "./lod/index.ts";
import { worldviewStage } from "./worldview/index.ts";
import { compactWorldviewRecords } from "./worldview/archive.ts";
import { reconcileWorldviewLifecycle } from "./worldview/lifecycle.ts";
import { meanFoodSecurity } from "./agents/food.ts";
import { worldDigest } from "./world.ts";
import { wholeYearsCrossed } from "./time.ts";
import { governanceForOrganization } from "./society/organization.ts";
import type {
  EntityEffect,
  RuleContext,
  SimulationStage,
  StateMetric,
  StepInput,
  WorldDelta,
  WorldState,
  WorldviewEffect,
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

const collectionFor = (state: WorldState, collection: EntityEffect["collection"]): Array<{ id: string }> | null => {
  if (collection === "species") return state.species;
  if (collection === "populations") return state.populations;
  if (collection === "agents") return state.agents;
  if (collection === "cultures") return state.cultures;
  if (collection === "knowledge") return state.knowledge;
  if (collection === "organizations") return state.organizations;
  if (collection === "facilities") return state.facilities;
  if (collection === "substances") return state.substances;
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
      existing.amount = Math.max(0, Math.min(existing.cap, existing.amount + amount));
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
    if (!Number.isFinite(transaction.amount) || transaction.amount < 0) throw new Error(`Invalid resource amount: ${transaction.id}`);
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
        originTick: state.tick + 1,
        ...(effect.sourcePhenomenonId ? { sourcePhenomenonId: effect.sourcePhenomenonId } : {}),
        ...(founderId ? { founderId } : {}),
        ...(memberIds.length > 0 ? { memberIds } : {}),
        ...(sponsorOrganizationId ? { sponsorOrganizationId } : {}),
        status: "active",
        supporterCount: 0,
        activePractitionerCount: 0,
        sponsorCount: sponsorOrganizationId ? 1 : 0,
        viability: clamp(effect.influence ?? 0.01),
        lastStatusChangeTick: state.tick + 1,
        lastActiveTick: state.tick + 1,
        revivalCount: 0,
      });
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
        originTick: state.tick + 1,
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
        originTick: state.tick + 1,
        lastTrainedTick: state.tick,
        attunement: 0.02,
        energy: 0.12,
        attempts: 0,
        failures: 0,
        status: "active",
      });
      if (effect.teacherId && state.agents.some((agent) => agent.id === effect.teacherId)) {
        const relationship = createRelationship("teacher", effect.teacherId, effect.practitionerId, state.tick + 1, 0.78);
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
      practice.attempts += 1;
      practice.lastTrainedTick = state.tick + 1;
      if (effect.outcome !== "advance") practice.failures += 1;
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
  for (const change of delta.fieldChanges) {
    if (!(change.field in state.fields) || !Number.isInteger(change.index) || change.index < 0 || change.index >= gridSize || !Number.isFinite(change.value)) {
      throw new Error(`Invalid field change: ${change.field}:${change.index}`);
    }
  }
  for (const change of delta.chemistryChanges) {
    if (!(change.field in state.chemistry) || !Number.isInteger(change.index) || change.index < 0 || change.index >= gridSize || !Number.isFinite(change.value)) {
      throw new Error(`Invalid chemistry change: ${change.field}:${change.index}`);
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
  }
  if (delta.formationEffect && !Object.values(delta.formationEffect).every((value) => typeof value !== "number" || Number.isFinite(value))) {
    throw new Error("Invalid planet formation state");
  }
};

const applyDelta = (state: WorldState, delta: WorldDelta): void => {
  applyFieldChanges(state, delta.fieldChanges);
  applyChemistryChanges(state, delta.chemistryChanges);
  applyEntityEffects(state, delta.entityEffects);
  applyRelationshipEffects(state, delta.relationshipEffects);
  const worldviewTransactions = delta.worldviewEffects
    .filter((effect): effect is Extract<WorldviewEffect, { kind: "resource-transaction" }> => effect.kind === "resource-transaction")
    .map((effect) => effect.transaction);
  applyResourceTransactions(state, [...delta.resourceTransactions, ...worldviewTransactions]);
  applyWorldviewEffects(state, delta.worldviewEffects);
  if (delta.formationEffect) state.formation = structuredClone(delta.formationEffect);
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

const pruneTransientState = (state: WorldState): WorldDelta["eventDrafts"] => {
  compactPopulationRecords(state);
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
  state.resources = state.resources.filter((resource) => {
    if (resource.amount <= 0.000000001) return false;
    if (!resource.holderId) return true;
    // Typed entity ledgers must not outlive their owner. Generic holders are
    // valid system accounts and intentionally remain available to rule packs.
    if (resource.holderId.startsWith("agent:")) return agentIds.has(resource.holderId as WorldState["agents"][number]["id"]);
    if (resource.holderId.startsWith("organization:")) return organizationIdsAfterPrune.has(resource.holderId as WorldState["organizations"][number]["id"]);
    return true;
  });
  compactCultureRecords(state);
  compactKnowledgeRecords(state);
  compactAgentMemoryRecords(state);
  const identifiedCultures = state.cultures.map(ensureCultureIdentity);
  if (identifiedCultures.some((culture, index) => culture !== state.cultures[index])) state.cultures = identifiedCultures;
  const identifiedSpecies = state.species.map(ensureSpeciesIdentity);
  if (identifiedSpecies.some((species, index) => species !== state.species[index])) state.species = identifiedSpecies;
  compactExtinctSpecies(state);
  const lifecycleEvents = reconcileWorldviewLifecycle(state);
  compactWorldviewRecords(state);
  return lifecycleEvents;
};

const installDefaultStages = (): void => {
  if (!stageRegistry.has("environment")) {
    registerSimulationStage({
      id: "environment",
      order: 10,
      run: (state, input) => stepEnvironment(state, { solarFlux: 1, externalEvents: input.externalEvents, elapsedYears: input.elapsedYears }),
    });
  }
  const annualized = (stage: SimulationStage): SimulationStage => ({
    ...stage,
    run: (state, input, priorDeltas) => {
      if (state.formation.phase !== "stable-crust") return emptyDelta();
      const elapsedYears = wholeYearsCrossed(state.years, input.elapsedYears);
      return elapsedYears > 0
        ? stage.run(state, { ...input, elapsedYears }, priorDeltas)
        : emptyDelta();
    },
  });
  if (!stageRegistry.has("ecology")) {
    registerSimulationStage(annualized({
      id: "ecology",
      order: 20,
      run: (state) => {
        const context: RuleContext = { state, random: state.random, metrics: metricsFor(state), tick: state.tick, years: state.years };
        return stepEcology(state, context);
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
export type StepOptions = { computeDigest?: boolean; mutateState?: boolean };

export const stepWorld = (state: WorldState, input: StepInput, options: StepOptions = {}): { state: WorldState; events: WorldState["events"]; digest: string } => {
  installDefaultStages();
  const previous = state;
  const knownExternalIds = new Set(previous.events.map((event) => event.id));
  const acceptedExternalEvents = input.externalEvents.slice(0, MAX_EXTERNAL_EVENTS_PER_STEP).filter((event) => {
    if (knownExternalIds.has(event.id)) return false;
    knownExternalIds.add(event.id);
    return true;
  });
  const priorDeltas = new Map<string, WorldDelta>();
  const merged = emptyDelta();
  for (const stage of listSimulationStages()) {
    const delta = stage.run(previous, { ...input, externalEvents: acceptedExternalEvents }, priorDeltas);
    priorDeltas.set(stage.id, delta);
    appendItems(merged.fieldChanges, delta.fieldChanges);
    appendItems(merged.chemistryChanges, delta.chemistryChanges);
    appendItems(merged.entityEffects, delta.entityEffects);
    appendItems(merged.relationshipEffects, delta.relationshipEffects);
    appendItems(merged.resourceTransactions, delta.resourceTransactions);
    appendItems(merged.worldviewEffects, delta.worldviewEffects);
    appendItems(merged.eventDrafts, delta.eventDrafts);
    if (delta.lodEffects) merged.lodEffects = [...(merged.lodEffects ?? []), ...delta.lodEffects];
    if (delta.formationEffect) merged.formationEffect = delta.formationEffect;
  }
  const next = options.mutateState
    ? previous
    : structuredClone({ ...previous, events: [] }) as WorldState;
  if (!options.mutateState) next.events = [...previous.events];
  if (options.mutateState) validateDeltaBeforeMutation(next, merged);
  synchronizeEventArchive(next.eventArchive, next.events);
  applyDelta(next, merged);
  appendItems(merged.eventDrafts, pruneTransientState(next));
  const [, nextRandom] = nextRandomValue(previous.random);
  next.random = nextRandom;
  next.tick += 1;
  next.years += Math.max(0, input.elapsedYears);
  const emittedExternal = appendExternalEventsInPlace(next.events, acceptedExternalEvents);
  const emittedNatural = appendEventsInPlace(next.events, merged.eventDrafts, next.tick, next.years);
  const emittedEvents = [...emittedExternal, ...emittedNatural];
  recordAppendedEvents(next.eventArchive, emittedEvents);
  compactEventLedger(next);
  compactEventArchiveIndexes(next);
  return { state: next, events: emittedEvents, digest: options.computeDigest === false ? "" : worldDigest(next) };
};

const nextRandomValue = (random: WorldState["random"]): [number, WorldState["random"]] => nextRandom(random);
