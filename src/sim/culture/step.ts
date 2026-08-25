import { forkRandom, randomChance } from "../random.ts";
import type { CultureDelta, EntityEffect, WorldDelta, WorldState } from "../types.ts";
import { createKnowledge, knowledgeKindsFor } from "./knowledge.ts";

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
  const agents = new Map(state.agents.map((agent) => [agent.id, structuredClone(agent)]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "agents") continue;
    if (effect.operation === "remove") agents.delete(effect.id);
    else if (effect.value) agents.set(effect.id, structuredClone(effect.value));
  }
  return [...agents.values()];
};

export const stepCulture = (state: WorldState, agentsDelta: WorldDelta): CultureDelta => {
  const delta = emptyDelta();
  const agents = agentsAfterDelta(state, agentsDelta);
  const cultures = new Map(state.cultures.map((culture) => [culture.id, structuredClone(culture)]));
  const byRegion = new Map<string, WorldState["agents"]>();
  for (const agent of agents) {
    const members = byRegion.get(agent.regionId) ?? [];
    members.push(agent);
    byRegion.set(agent.regionId, members);
  }

  for (const [regionId, members] of [...byRegion.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (members.length < 2) continue;
    let culture = [...cultures.values()].find((candidate) => candidate.regionId === regionId);
    if (!culture) {
      const sortedIds = members.map((agent) => agent.id).sort();
      culture = {
        id: `culture:${regionId.replaceAll(":", "-")}` as WorldState["cultures"][number]["id"],
        regionId: regionId as WorldState["cultures"][number]["regionId"],
        knowledgeIds: [],
        beliefIds: [],
        transmissionRate: Math.max(0.05, Math.min(1, members.reduce((sum, agent) => sum + (agent.traits.sociality ?? 0), 0) / members.length * 0.6)),
      };
      cultures.set(culture.id, culture);
      delta.entityEffects.push({ collection: "cultures", operation: "create", id: culture.id, value: culture });
      delta.eventDrafts.push({
        kind: "culture-emergence",
        ruleId: "collective-learning",
        sourceIds: sortedIds,
        probability: 1,
        roll: 0,
        evidence: { memberCount: members.length, regionId },
        payload: { cultureId: culture.id },
        source: "natural",
      });
    }
    const candidateKinds = [...new Set(members.flatMap(knowledgeKindsFor))].sort();
    for (const kind of candidateKinds) {
      const sources = members.filter((agent) => knowledgeKindsFor(agent).includes(kind));
      const knowledge = createKnowledge(regionId, kind, sources);
      const known = state.knowledge.find((candidate) => candidate.id === knowledge.id);
      if (!known) {
        delta.entityEffects.push({ collection: "knowledge", operation: "create", id: knowledge.id, value: knowledge });
      }
      if (!culture.knowledgeIds.includes(knowledge.id)) culture.knowledgeIds.push(knowledge.id);
    }
    const retained = culture.knowledgeIds.filter((knowledgeId) => {
      const knowledge = state.knowledge.find((candidate) => candidate.id === knowledgeId);
      if (!knowledge) return true;
      const [forgotten] = randomChance(forkRandom(state.random, `forget:${culture?.id}:${knowledgeId}`), knowledge.forgettingRate * (1 - culture.transmissionRate));
      return !forgotten;
    });
    culture.knowledgeIds = retained;
    delta.entityEffects.push({ collection: "cultures", operation: "update", id: culture.id, value: culture });
    for (const agent of members) {
      const knowledgeIds = [...new Set([...agent.knowledgeIds, ...culture.knowledgeIds])].sort();
      const memoryIds = [...new Set([...agent.memoryIds, ...culture.knowledgeIds])].sort();
      if (knowledgeIds.length !== agent.knowledgeIds.length || memoryIds.length !== agent.memoryIds.length) {
        delta.entityEffects.push({ collection: "agents", operation: "update", id: agent.id, value: { ...agent, knowledgeIds, memoryIds } });
      }
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
