import { forkRandom, randomChance, randomFloat } from "../random.ts";
import type { CultureDelta, EntityEffect, WorldDelta, WorldState } from "../types.ts";
import { createKnowledge, knowledgeKindsFor } from "./knowledge.ts";
import { attemptKnowledgeDiffusion, attemptKnowledgeInnovation, knowledgeDiffusionRoutes } from "./innovation.ts";
import { createCultureIdentity, cultureIdentityChanged, evolveCultureIdentity } from "./identity.ts";
import { simulationStepForWorld } from "../time.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const agentsAfterDelta = (state: WorldState, delta: WorldDelta): WorldState["agents"] => {
  const hasAgentEffect = delta.entityEffects.some((effect) => effect.collection === "agents");
  if (!hasAgentEffect) return state.agents;
  const agents = new Map(state.agents.map((agent) => [agent.id, agent]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "agents") continue;
    if (effect.operation === "remove") agents.delete(effect.id);
    else if (effect.value) agents.set(effect.id, effect.value);
  }
  return [...agents.values()];
};

const environmentForRegion = (state: WorldState, regionId: WorldState["cultures"][number]["regionId"]) => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  const x = Number(match?.[1] ?? 0);
  const y = Number(match?.[2] ?? 0);
  const index = Math.max(0, Math.min(state.fields.elevation.values.length - 1, y * state.fields.elevation.width + x));
  return {
    elevation: state.fields.elevation.values[index] ?? 0.5,
    water: state.fields.water.values[index] ?? 0.5,
    humidity: state.fields.humidity.values[index] ?? 0.5,
    nutrients: state.fields.nutrients.values[index] ?? 0.5,
    biomass: state.fields.biomass.values[index] ?? 0.5,
  };
};

export const stepCulture = (state: WorldState, agentsDelta: WorldDelta): CultureDelta => {
  const delta = emptyDelta();
  const agents = agentsAfterDelta(state, agentsDelta);
  const cultures = new Map(state.cultures.map((culture) => [culture.id, {
    ...culture,
    knowledgeIds: [...culture.knowledgeIds],
    beliefIds: [...culture.beliefIds],
    ...(culture.identity ? { identity: structuredClone(culture.identity) } : {}),
  }]));
  const culturesByRegion = new Map<string, WorldState["cultures"][number]>(state.cultures.map((culture) => [culture.regionId, cultures.get(culture.id)!]));
  const knowledgeById = new Map(state.knowledge.map((knowledge) => [knowledge.id, knowledge]));
  const newKnowledge = new Map<string, WorldState["knowledge"][number]>();
  const createdCultureIds = new Set<WorldState["cultures"][number]["id"]>();
  const changedCultureIds = new Set<WorldState["cultures"][number]["id"]>();
  const byRegion = new Map<string, WorldState["agents"]>();
  for (const agent of agents) {
    const members = byRegion.get(agent.regionId) ?? [];
    members.push(agent);
    byRegion.set(agent.regionId, members);
  }

  for (const [regionId, members] of [...byRegion.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (members.length < 2) continue;
    let culture = culturesByRegion.get(regionId);
    if (!culture) {
      const sortedIds = members.map((agent) => agent.id).sort();
      culture = {
        id: `culture:${regionId.replaceAll(":", "-")}` as WorldState["cultures"][number]["id"],
        regionId: regionId as WorldState["cultures"][number]["regionId"],
        knowledgeIds: [],
        beliefIds: [],
        transmissionRate: Math.max(0.05, Math.min(1, members.reduce((sum, agent) => sum + (agent.traits.sociality ?? 0), 0) / members.length * 0.6)),
        identity: createCultureIdentity(`culture:${state.seed}:${regionId}`, regionId as WorldState["cultures"][number]["regionId"], state.tick, state.years, members, environmentForRegion(state, regionId as WorldState["cultures"][number]["regionId"]), undefined, simulationStepForWorld(state)),
      };
      cultures.set(culture.id, culture);
      culturesByRegion.set(culture.regionId, culture);
      createdCultureIds.add(culture.id);
      const identity = culture.identity!;
      const [roll] = randomFloat(forkRandom(state.random, `culture:${regionId}:${members.length}`));
      delta.eventDrafts.push({
        kind: "culture-emergence",
        ruleId: "collective-learning",
        sourceIds: sortedIds,
        probability: 1,
        roll,
        evidence: {
          memberCount: members.length,
          regionId,
          languageFamily: identity.languageFamily,
          communicationStyle: identity.communicationStyle,
          noveltySignature: identity.noveltySignature,
        },
        payload: { cultureId: culture.id, name: identity.name, regionId, languageFamily: identity.languageFamily },
        source: "natural",
      });
    }
    const knowledgeBefore = culture.knowledgeIds.join("\0");
    const sourcesByKnowledgeKind = new Map<string, WorldState["agents"]>();
    for (const member of members) {
      for (const kind of knowledgeKindsFor(member)) {
        const sources = sourcesByKnowledgeKind.get(kind) ?? [];
        sources.push(member);
        sourcesByKnowledgeKind.set(kind, sources);
      }
    }
    const candidateKinds = [...sourcesByKnowledgeKind.keys()].sort();
    for (const kind of candidateKinds) {
      const sources = sourcesByKnowledgeKind.get(kind)!;
      const knowledge = createKnowledge(regionId, kind, sources);
      const known = knowledgeById.get(knowledge.id);
      if (!known) newKnowledge.set(knowledge.id, knowledge);
      knowledgeById.set(knowledge.id, known ?? knowledge);
      if (!culture.knowledgeIds.includes(knowledge.id)) culture.knowledgeIds.push(knowledge.id);
    }
    const retained = culture.knowledgeIds.filter((knowledgeId) => {
      const knowledge = knowledgeById.get(knowledgeId);
      if (!knowledge) return true;
      const [forgotten] = randomChance(forkRandom(state.random, `forget:${culture?.id}:${knowledgeId}`), knowledge.forgettingRate * (1 - culture.transmissionRate));
      return !forgotten;
    });
    culture.knowledgeIds = retained;
    const innovation = attemptKnowledgeInnovation(state, culture, members, knowledgeById);
    if (innovation) {
      const knownInnovation = knowledgeById.get(innovation.knowledge.id);
      if (!knownInnovation) {
        knowledgeById.set(innovation.knowledge.id, innovation.knowledge);
        newKnowledge.set(innovation.knowledge.id, innovation.knowledge);
        delta.eventDrafts.push(innovation.event);
      }
      if (!culture.knowledgeIds.includes(innovation.knowledge.id)) culture.knowledgeIds.push(innovation.knowledge.id);
    }
    culture.knowledgeIds = [...new Set(culture.knowledgeIds)].sort();
    const knowledgeChanged = culture.knowledgeIds.join("\0") !== knowledgeBefore;
    const domains = culture.knowledgeIds
      .map((knowledgeId) => knowledgeById.get(knowledgeId)?.domain)
      .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));
    const identity = culture.identity ?? createCultureIdentity(`legacy:${culture.id}`, culture.regionId, 0, 0, members, environmentForRegion(state, culture.regionId));
    const evolvedIdentity = evolveCultureIdentity(identity, `${state.seed}:${culture.id}`, state.tick, members, environmentForRegion(state, culture.regionId), domains, simulationStepForWorld(state));
    if (cultureIdentityChanged(identity, evolvedIdentity)) {
      culture.identity = evolvedIdentity;
      changedCultureIds.add(culture.id);
      delta.eventDrafts.push({
        kind: "culture-evolution",
        ruleId: "culture:identity-adaptation",
        sourceIds: members.map((member) => member.id).sort(),
        probability: 1,
        roll: 0,
        evidence: {
          regionId: culture.regionId,
          generation: evolvedIdentity.generation,
          languageFamily: evolvedIdentity.languageFamily,
          communicationStyle: evolvedIdentity.communicationStyle,
          noveltySignature: evolvedIdentity.noveltySignature,
        },
        payload: { cultureId: culture.id, name: evolvedIdentity.name, regionId: culture.regionId, traditions: evolvedIdentity.traditions },
        source: "natural",
      });
    } else if (!culture.identity) {
      culture.identity = identity;
      changedCultureIds.add(culture.id);
    }
    if (knowledgeChanged || createdCultureIds.has(culture.id)) {
      changedCultureIds.add(culture.id);
    }
  }

  for (const route of knowledgeDiffusionRoutes(state)) {
    const diffusion = attemptKnowledgeDiffusion(state, culturesByRegion, knowledgeById, route);
    if (!diffusion) continue;
    const destination = cultures.get(diffusion.destinationCultureId);
    if (!destination || destination.knowledgeIds.includes(diffusion.knowledgeId)) continue;
    destination.knowledgeIds = [...destination.knowledgeIds, diffusion.knowledgeId].sort();
    changedCultureIds.add(destination.id);
    delta.eventDrafts.push(diffusion.event);
  }

  for (const knowledge of newKnowledge.values()) {
    delta.entityEffects.push({ collection: "knowledge", operation: "create", id: knowledge.id, value: knowledge });
  }
  for (const cultureId of changedCultureIds) {
    const culture = cultures.get(cultureId);
    if (!culture) continue;
    delta.entityEffects.push({ collection: "cultures", operation: createdCultureIds.has(cultureId) ? "create" : "update", id: culture.id, value: culture });
  }
  for (const agent of agents) {
    const culture = culturesByRegion.get(agent.regionId);
    if (!culture) continue;
    const missingKnowledge = culture.knowledgeIds.some((id) => !agent.knowledgeIds.includes(id));
    const missingMemory = culture.knowledgeIds.some((id) => !agent.memoryIds.includes(id));
    if (!missingKnowledge && !missingMemory) continue;
    const knowledgeIds = missingKnowledge ? [...new Set([...agent.knowledgeIds, ...culture.knowledgeIds])].sort() : agent.knowledgeIds;
    const memoryIds = missingMemory ? [...new Set([...agent.memoryIds, ...culture.knowledgeIds])].sort() : agent.memoryIds;
    if (knowledgeIds.length !== agent.knowledgeIds.length || memoryIds.length !== agent.memoryIds.length) {
      delta.entityEffects.push({ collection: "agents", operation: "update", id: agent.id, value: { ...agent, knowledgeIds, memoryIds } });
    }
  }
  return delta;
};

export const applyCultureDelta = (state: WorldState, delta: CultureDelta): WorldState => {
  const next = structuredClone(state);
  const collections: Array<EntityEffect["collection"]> = ["agents", "cultures", "knowledge"];
  for (const effect of delta.entityEffects) {
    if (!collections.includes(effect.collection)) continue;
    const collection = effect.collection === "agents" ? next.agents : effect.collection === "cultures" ? next.cultures : next.knowledge;
    const index = collection.findIndex((item) => item.id === effect.id);
    if (effect.operation === "remove" && index >= 0) collection.splice(index, 1);
    else if (effect.operation === "update" && index >= 0 && effect.value) collection[index] = effect.value as never;
    else if (effect.operation === "create" && index < 0 && effect.value) collection.push(effect.value as never);
  }
  return next;
};
