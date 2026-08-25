import { forkRandom, hashString, randomFloat } from "../random.ts";
import type {
  AgentsDelta,
  AgentState,
  EntityId,
  EcologyDelta,
  OrganizationState,
  PopulationState,
  SpeciesState,
  WorldDelta,
  WorldState,
} from "../types.ts";
import { createFamily, createRelationship, relationshipIdFor } from "./relationships.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const asEntityId = (value: string): EntityId => value as EntityId;

const inheritFromParents = (
  child: AgentState,
  first: AgentState,
  second: AgentState,
  random: WorldState["random"],
): AgentState => {
  const transmissionRate = clamp(0.25 + ((first.skills.communication ?? 0) + (second.skills.communication ?? 0)) * 0.3, 0.25, 0.9);
  const inheritedIds = (kind: "knowledge" | "belief", firstIds: string[], secondIds: string[]): string[] => {
    const shared = new Set(firstIds.filter((id) => secondIds.includes(id)));
    return [...new Set([...firstIds, ...secondIds])].sort().filter((id) => {
      if (shared.has(id)) return true;
      const [roll] = randomFloat(forkRandom(random, `inherit:${kind}:${child.id}:${id}`));
      return roll < transmissionRate;
    });
  };
  return {
    ...child,
    knowledgeIds: inheritedIds("knowledge", first.knowledgeIds, second.knowledgeIds),
    beliefIds: inheritedIds("belief", first.beliefIds, second.beliefIds),
  };
};

export const createAgent = (
  population: PopulationState,
  species: SpeciesState,
  ordinal: number,
  seed: string,
  parentIds: EntityId[] = [],
): AgentState => {
  const base = hashString(`${seed}:${population.id}:${ordinal}`);
  const trait = (label: string): number => (hashString(`${base}:${label}`) % 100) / 100;
  return {
    id: asEntityId(`agent:${hashString(`${population.id}:${ordinal}:${base}`).toString(16)}`),
    populationId: population.id,
    regionId: population.regionId,
    age: 0,
    lifespan: 45 + (base % 55),
    parentIds: [...parentIds],
    traits: {
      cognitivePotential: clamp(species.traits.cognitivePotential ?? 0),
      sociality: trait("sociality"),
      cooperation: trait("cooperation"),
      curiosity: trait("curiosity"),
      fertility: trait("fertility"),
    },
    skills: {
      observation: trait("observation") * 0.4,
      communication: trait("communication") * 0.3,
      toolUse: trait("tool-use") * 0.25,
    },
    needs: { food: 0.5, safety: 0.5, belonging: 0.2 },
    memoryIds: [],
    knowledgeIds: [],
    beliefIds: [],
    relationshipIds: [],
  };
};

export const eligibleAgentCount = (
  population: PopulationState,
  species: SpeciesState,
  oxygen: number,
  biomass: number,
): number => {
  const cognitive = species.traits.cognitivePotential ?? 0;
  if (population.count < 4 || cognitive < 0.3 || oxygen < 0.005 || biomass < 0.001) return 0;
  return Math.min(64, Math.ceil(Math.sqrt(population.count) * cognitive * 1.5));
};

const addRelationship = (
  relationships: Map<string, ReturnType<typeof createRelationship>>,
  relationship: ReturnType<typeof createRelationship>,
): void => {
  relationships.set(relationship.id, relationship);
};

export const stepAgents = (
  state: WorldState,
  _ecology: EcologyDelta,
  elapsedYears = 1,
): AgentsDelta => {
  const delta = emptyDelta();
  const years = Math.max(0, elapsedYears);
  const agents = new Map(state.agents.map((agent) => [agent.id, structuredClone(agent)]));
  const deadIds = new Set<EntityId>();
  const deathRolls: number[] = [];
  const movedPopulations = new Map<string, string>();
  for (const effect of _ecology.entityEffects) {
    if (effect.collection === "populations" && effect.operation === "update" && effect.value) {
      const previous = state.populations.find((population) => population.id === effect.id);
      if (previous && previous.regionId !== effect.value.regionId) movedPopulations.set(String(effect.id), effect.value.regionId);
    }
  }
  for (const agent of agents.values()) {
    const nextAge = agent.age + years;
    const oldAgeRisk = nextAge >= agent.lifespan ? 1 : Math.max(0, (nextAge / agent.lifespan - 0.82) * 0.12);
    const needRisk = Math.max(0, 0.5 - (agent.needs.food ?? 0)) * 0.02;
    const [mortalityRoll] = randomFloat(forkRandom(state.random, `mortality:${agent.id}:${nextAge}`));
    if (mortalityRoll < oldAgeRisk + needRisk) {
      deadIds.add(agent.id);
      deathRolls.push(mortalityRoll);
      continue;
    }
    const migratedRegion = movedPopulations.get(String(agent.populationId));
    if (migratedRegion) agent.regionId = migratedRegion as AgentState["regionId"];
    agent.age = nextAge;
    agent.needs = {
      ...agent.needs,
      food: clamp((agent.needs.food ?? 0.5) - years * 0.01),
      belonging: clamp((agent.needs.belonging ?? 0.2) + years * 0.002),
    };
    agent.skills = {
      ...agent.skills,
      observation: clamp((agent.skills.observation ?? 0) + (agent.traits.curiosity ?? 0) * years * 0.002),
      communication: clamp((agent.skills.communication ?? 0) + (agent.traits.sociality ?? 0) * years * 0.001),
    };
  }

  for (const population of state.populations) {
    const species = state.species.find((candidate) => candidate.id === population.speciesId);
    if (!species) continue;
    const index = state.fields.elevation.values.length === 0
      ? 0
      : Math.max(0, Math.min(state.fields.elevation.values.length - 1, Number(population.regionId.split(":").at(-1) ?? 0) * state.fields.elevation.width + Number(population.regionId.split(":")[1] ?? 0)));
    const target = eligibleAgentCount(population, species, state.chemistry.oxygen.values[index] ?? 0, state.fields.biomass.values[index] ?? 0);
    const existing = [...agents.values()].filter((agent) => agent.populationId === population.id && !deadIds.has(agent.id));
    for (let ordinal = existing.length; ordinal < target; ordinal += 1) {
      const candidate = createAgent(population, species, ordinal, `${state.seed}:${state.tick}`);
      const probability = clamp(0.12 + (species.traits.cognitivePotential ?? 0) * 0.5);
      const [roll] = randomFloat(forkRandom(state.random, `emergence:${candidate.id}`));
      if (roll < probability && !agents.has(candidate.id)) agents.set(candidate.id, candidate);
    }
  }

  const relationshipMap = new Map(state.relationships.map((relationship) => [relationship.id, relationship]));
  const familyMembers = new Map(
    state.organizations
      .filter((organization) => organization.type === "family")
      .map((organization) => [organization.id, [...organization.memberIds]]),
  );
  const currentAgents = [...agents.values()].filter((agent) => !deadIds.has(agent.id)).sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 0; index + 1 < currentAgents.length; index += 2) {
    const first = currentAgents[index];
    const second = currentAgents[index + 1];
    if (!first || !second || first.regionId !== second.regionId || first.age < 16 || second.age < 16) continue;
    const relationId = relationshipIdFor("partner", first.id, second.id);
    if (relationshipMap.has(relationId)) continue;
    const affinity = ((first.traits.sociality ?? 0) + (second.traits.sociality ?? 0) + (first.traits.cooperation ?? 0) + (second.traits.cooperation ?? 0)) / 4;
    const probability = clamp(affinity * 0.45);
    const [roll] = randomFloat(forkRandom(state.random, `partner:${first.id}:${second.id}`));
    if (roll >= probability) continue;
    addRelationship(relationshipMap, createRelationship("partner", first.id, second.id, state.tick + 1, affinity));
    const hasFamily = state.organizations.some((organization) => organization.type === "family" && organization.memberIds.includes(first.id) && organization.memberIds.includes(second.id));
    if (!hasFamily) {
      const family = createFamily([first.id, second.id], first.regionId);
      if (!delta.entityEffects.some((effect) => effect.collection === "organizations" && effect.id === family.id)) {
        delta.entityEffects.push({ collection: "organizations", operation: "create", id: family.id, value: family });
        delta.eventDrafts.push({
          kind: "family-formation",
          ruleId: "family-formation",
          sourceIds: [first.id, second.id],
          probability,
          roll,
          evidence: { affinity, members: family.memberIds.length },
          payload: { familyId: family.id, memberIds: family.memberIds },
          source: "natural",
        });
      }
    }
  }

  const partnerPairs = [...relationshipMap.values()]
    .filter((relationship) => relationship.kind === "partner")
    .map((relationship) => [agents.get(relationship.fromId), agents.get(relationship.toId)] as const)
    .filter((pair): pair is [AgentState, AgentState] => Boolean(pair[0] && pair[1]))
    .sort(([left], [right]) => left.id.localeCompare(right.id));
  for (const [first, second] of partnerPairs) {
    if (first.age < 18 || second.age < 18 || first.age > first.lifespan * 0.75 || second.age > second.lifespan * 0.75) continue;
    const family = state.organizations.find((organization) => organization.type === "family" && organization.memberIds.includes(first.id) && organization.memberIds.includes(second.id));
    if (!family) continue;
    const fertility = ((first.traits.fertility ?? 0) + (second.traits.fertility ?? 0)) / 2;
    const foodSecurity = ((first.needs.food ?? 0) + (second.needs.food ?? 0)) / 2;
    const probability = clamp(fertility * 0.16 + foodSecurity * 0.08);
    const [roll] = randomFloat(forkRandom(state.random, `birth:${family.id}:${state.tick}`));
    if (roll >= probability) continue;
    const population = state.populations.find((candidate) => candidate.regionId === first.regionId);
    const species = population ? state.species.find((candidate) => candidate.id === population.speciesId) : undefined;
    if (!population || !species) continue;
    const child = inheritFromParents(
      createAgent(population, species, agents.size, `birth:${family.id}:${state.tick}`, [first.id, second.id]),
      first,
      second,
      state.random,
    );
    if (agents.has(child.id)) continue;
    agents.set(child.id, child);
    const siblings = (familyMembers.get(family.id) ?? family.memberIds)
      .map((memberId) => agents.get(memberId))
      .filter((member): member is AgentState => Boolean(member && member.id !== first.id && member.id !== second.id && member.parentIds.includes(first.id) && member.parentIds.includes(second.id)))
      .sort((left, right) => left.id.localeCompare(right.id));
    const childRelationships = [
      createRelationship("parent", first.id, child.id, state.tick + 1, 0.9),
      createRelationship("parent", second.id, child.id, state.tick + 1, 0.9),
      createRelationship("caregiver", first.id, child.id, state.tick + 1, 0.8),
      createRelationship("caregiver", second.id, child.id, state.tick + 1, 0.8),
      ...siblings.map((sibling) => createRelationship("sibling", sibling.id, child.id, state.tick + 1, 0.85)),
    ];
    for (const relationship of childRelationships) {
      relationshipMap.set(relationship.id, relationship);
    }
    delta.entityEffects.push({
      collection: "organizations",
      operation: "update",
      id: family.id,
      value: { ...family, memberIds: [...new Set([...(familyMembers.get(family.id) ?? family.memberIds), child.id])].sort() },
    });
    familyMembers.set(family.id, [...new Set([...(familyMembers.get(family.id) ?? family.memberIds), child.id])].sort());
    delta.eventDrafts.push({
      kind: "agent-birth",
      ruleId: "family-reproduction",
      sourceIds: [first.id, second.id, family.id],
      probability,
      roll,
      evidence: { fertility, foodSecurity, familyMembers: family.memberIds.length, inheritedKnowledge: child.knowledgeIds.length, inheritedBeliefs: child.beliefIds.length, siblings: siblings.length },
      payload: { agentId: child.id, familyId: family.id, parentIds: child.parentIds },
      source: "natural",
    });
  }

  for (const family of state.organizations.filter((organization) => organization.type === "family")) {
    const members = (familyMembers.get(family.id) ?? family.memberIds).filter((id) => !deadIds.has(id) && agents.has(id));
    delta.entityEffects.push({
      collection: "organizations",
      operation: "update",
      id: family.id,
      value: { ...family, memberIds: members, status: members.length < 2 ? "collapsed" : "active" },
    });
  }

  for (const relationship of state.relationships) {
    if (deadIds.has(relationship.fromId) || deadIds.has(relationship.toId)) {
      delta.relationshipEffects.push({ operation: "remove", relationship });
      relationshipMap.delete(relationship.id);
    }
  }
  for (const relationship of relationshipMap.values()) {
    if (!state.relationships.some((candidate) => candidate.id === relationship.id)) {
      delta.relationshipEffects.push({ operation: "create", relationship });
    }
  }
  for (const agent of state.agents) {
    if (deadIds.has(agent.id)) {
      delta.entityEffects.push({ collection: "agents", operation: "remove", id: agent.id });
    }
  }
  const relationshipIds = new Map<EntityId, string[]>();
  for (const relationship of relationshipMap.values()) {
    for (const id of [relationship.fromId, relationship.toId]) {
      const ids = relationshipIds.get(id) ?? [];
      ids.push(relationship.id);
      relationshipIds.set(id, ids);
    }
  }
  for (const agent of agents.values()) {
    if (deadIds.has(agent.id)) continue;
    const operation = state.agents.some((existing) => existing.id === agent.id) ? "update" : "create";
    delta.entityEffects.push({
      collection: "agents",
      operation,
      id: agent.id,
      value: { ...agent, relationshipIds: [...new Set(relationshipIds.get(agent.id) ?? [])].sort() },
    });
  }
  if (deadIds.size > 0) {
    delta.eventDrafts.push({
      kind: "agent-death",
      ruleId: "agent-lifecycle",
      sourceIds: [...deadIds],
      probability: 1,
      roll: deathRolls.reduce((sum, value) => sum + value, 0) / Math.max(1, deathRolls.length),
      evidence: { deaths: deadIds.size },
      payload: { agentIds: [...deadIds] },
      source: "natural",
    });
  }
  return delta;
};

export type { OrganizationState };
