import { hashString, nextRandom } from "./random.ts";
import { appendEvents, appendExternalEvents } from "./events/ledger.ts";
import { stepEnvironment } from "./environment/index.ts";
import { stepEcology } from "./ecology/index.ts";
import { agentsStage } from "./agents/index.ts";
import { cultureStage } from "./culture/index.ts";
import { worldDigest } from "./world.ts";
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

export const metricsFor = (state: WorldState): Record<StateMetric, number> => ({
  meanTemperature: mean(state.fields.temperature.values),
  meanHumidity: mean(state.fields.humidity.values),
  waterCoverage: mean(state.fields.water.values),
  nutrientLevel: mean(state.fields.nutrients.values),
  biomass: mean(state.fields.biomass.values),
  oxygen: mean(state.chemistry.oxygen.values),
  populationCount: state.populations.reduce((sum, population) => sum + population.count, 0),
  cognitivePotential: state.species.reduce((sum, species) => sum + (species.traits.cognitivePotential ?? 0), 0),
  knowledgeDiversity: state.cultures.reduce((sum, culture) => sum + culture.knowledgeIds.length, 0),
  beliefDiversity: state.cultures.reduce((sum, culture) => sum + culture.beliefIds.length, 0),
  householdCount: state.organizations.filter((organization) => organization.type === "family").length,
  settlementDensity: state.organizations.filter((organization) => organization.type === "settlement" || organization.type === "city").length,
  tradeVolume: 0,
  foodSurplus: 0,
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
  return state.worldview.entities;
};

const applyEntityEffects = (state: WorldState, effects: EntityEffect[]): void => {
  for (const effect of effects) {
    if (effect.collection === "worldviewEntities") {
      throw new Error("Worldview entities must use constrained worldview effects");
    }
    const collection = collectionFor(state, effect.collection);
    if (!collection) continue;
    const index = collection.findIndex((item) => item.id === effect.id);
    if (effect.operation === "remove") {
      if (index >= 0) collection.splice(index, 1);
    } else if (effect.value && effect.operation === "update" && index >= 0) {
      collection[index] = effect.value as never;
    } else if (effect.value && effect.operation === "create" && index < 0) {
      collection.push(effect.value as never);
    }
  }
};

const applyRelationshipEffects = (state: WorldState, effects: WorldDelta["relationshipEffects"]): void => {
  for (const effect of effects) {
    const index = state.relationships.findIndex((relationship) => relationship.id === effect.relationship.id);
    if (effect.operation === "remove") {
      if (index >= 0) state.relationships.splice(index, 1);
    } else if (effect.operation === "update" && index >= 0) {
      state.relationships[index] = effect.relationship;
    } else if (effect.operation === "create" && index < 0) {
      state.relationships.push(effect.relationship);
    }
  }
};

const applyResourceTransactions = (state: WorldState, transactions: WorldDelta["resourceTransactions"]): void => {
  const entryKey = (resourceId: string, regionId: string, holderId?: string): string =>
    `${resourceId}|${regionId}|${holderId ?? "world"}`;
  const findEntry = (resourceId: string, regionId: string, holderId?: string) =>
    state.resources.find((entry) => entryKey(entry.resourceId, entry.regionId, entry.holderId) === entryKey(resourceId, regionId, holderId));
  const balance = (resourceId: string, regionId: string, holderId?: string): number =>
    findEntry(resourceId, regionId, holderId)?.amount ?? 0;
  const changeBalance = (transaction: ResourceTransactionLike, holderId: string | undefined, amount: number, originEventId: string): void => {
    const existing = findEntry(transaction.resourceId, transaction.regionId, holderId);
    if (existing) {
      existing.amount = Math.max(0, Math.min(existing.cap, existing.amount + amount));
      return;
    }
    if (amount < 0) throw new Error(`Insufficient resource balance: ${transaction.id}`);
    state.resources.push({
      id: `resource:${hashString(entryKey(transaction.resourceId, transaction.regionId, holderId)).toString(16)}`,
      resourceId: transaction.resourceId,
      regionId: transaction.regionId,
      ...(holderId ? { holderId } : {}),
      amount,
      cap: Number.MAX_SAFE_INTEGER,
      originEventId,
    });
  };
  const appliedIds = new Set<string>();
  for (const transaction of transactions) {
    if (appliedIds.has(transaction.id)) continue;
    appliedIds.add(transaction.id);
    if (!Number.isFinite(transaction.amount) || transaction.amount < 0) throw new Error(`Invalid resource amount: ${transaction.id}`);
    if (transaction.operation === "mint") {
      changeBalance(transaction, transaction.toHolderId, transaction.amount, transaction.id);
    } else if (transaction.operation === "transfer") {
      if (!transaction.toHolderId) throw new Error(`Transfer requires destination holder: ${transaction.id}`);
      const from = transaction.fromHolderId;
      if (balance(transaction.resourceId, transaction.regionId, from) < transaction.amount) {
        throw new Error(`Insufficient resource balance: ${transaction.id}`);
      }
      changeBalance(transaction, from, -transaction.amount, transaction.id);
      changeBalance(transaction, transaction.toHolderId, transaction.amount, transaction.id);
    } else {
      const holderId = transaction.fromHolderId ?? transaction.toHolderId;
      if (balance(transaction.resourceId, transaction.regionId, holderId) < transaction.amount) {
        throw new Error(`Insufficient resource balance: ${transaction.id}`);
      }
      changeBalance(transaction, holderId, -transaction.amount, transaction.id);
    }
  }
};

type ResourceTransactionLike = WorldDelta["resourceTransactions"][number];

const asEntityId = (value: string) => value as WorldState["agents"][number]["id"];

const applyWorldviewEffects = (state: WorldState, effects: WorldviewEffect[]): void => {
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
      const id = asEntityId(`worldview:${hashString(JSON.stringify(effect)).toString(16)}`);
      if (state.worldview.entities.some((entity) => entity.id === id)) continue;
      state.worldview.entities.push({
        id,
        packId: effect.packId,
        kind: effect.entityKind,
        regionId: effect.regionId,
        influence: 0.01,
        resourceBalances: {},
      });
    }
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
};

const installDefaultStages = (): void => {
  if (!stageRegistry.has("environment")) {
    registerSimulationStage({
      id: "environment",
      order: 10,
      run: (state, input) => stepEnvironment(state, { solarFlux: 1, externalEvents: input.externalEvents }),
    });
  }
  if (!stageRegistry.has("ecology")) {
    registerSimulationStage({
      id: "ecology",
      order: 20,
      run: (state) => {
        const context: RuleContext = { state, random: state.random, metrics: metricsFor(state) };
        return stepEcology(state, context);
      },
    });
  }
  if (!stageRegistry.has(agentsStage.id)) registerSimulationStage(agentsStage);
  if (!stageRegistry.has(cultureStage.id)) registerSimulationStage(cultureStage);
};

export const stepWorld = (state: WorldState, input: StepInput): { state: WorldState; events: WorldState["events"]; digest: string } => {
  installDefaultStages();
  const previous = structuredClone(state);
  const acceptedExternalEvents = input.externalEvents.filter((event) => !previous.events.some((known) => known.id === event.id));
  const priorDeltas = new Map<string, WorldDelta>();
  const merged = emptyDelta();
  for (const stage of listSimulationStages()) {
    const delta = stage.run(structuredClone(previous), { ...input, externalEvents: acceptedExternalEvents }, priorDeltas);
    priorDeltas.set(stage.id, delta);
    merged.fieldChanges.push(...delta.fieldChanges);
    merged.chemistryChanges.push(...delta.chemistryChanges);
    merged.entityEffects.push(...delta.entityEffects);
    merged.relationshipEffects.push(...delta.relationshipEffects);
    merged.resourceTransactions.push(...delta.resourceTransactions);
    merged.worldviewEffects.push(...delta.worldviewEffects);
    merged.eventDrafts.push(...delta.eventDrafts);
  }
  const next = structuredClone(previous);
  applyDelta(next, merged);
  const [, nextRandom] = nextRandomValue(previous.random);
  next.random = nextRandom;
  next.tick += 1;
  next.years += Math.max(0, input.elapsedYears);
  next.events = appendEvents(appendExternalEvents(previous.events, acceptedExternalEvents), merged.eventDrafts, next.tick);
  return { state: next, events: next.events, digest: worldDigest(next) };
};

const nextRandomValue = (random: WorldState["random"]): [number, WorldState["random"]] => nextRandom(random);
