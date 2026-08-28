import { forkRandom, hashString, randomFloat } from "../random.ts";
import type {
  AgentsDelta,
  AgentState,
  EntityId,
  EcologyDelta,
  OrganizationState,
  PopulationState,
  RelationshipState,
  SpeciesState,
  WorldDelta,
  WorldState,
} from "../types.ts";
import { createFamily, createRelationship, relationshipIdFor } from "./relationships.ts";
import { createFoodBalanceIndex, foodSecurityForAgent } from "./food.ts";
import { populationCellIndex } from "../ecology/populations.ts";
import { technologyProfilesForState } from "../culture/technology.ts";
import { facilityEffectProfilesForState } from "../society/facilities.ts";
import { finalizeAgentHealth, healthyAgentState, stepAgentHealth } from "../health/disease.ts";
import { addPersistentTotal } from "../numeric.ts";
import { founderGenetics, founderHeritableTraits, geneticEnvironmentFitness, inheritAgentGenetics, normalizeAgentGenetics } from "./genetics.ts";
import { compareSimulationSteps, nextSimulationTick, simulationStepForWorld } from "../time.ts";
import { annualClimateForLocal } from "../environment/cycle.ts";

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
export const MAX_DETAILED_AGENTS = 256;
export const MAX_AGENT_MEMORY_IDS = 128;
export const MAX_RELATIONSHIPS_PER_AGENT = 32;
export const MAX_RELATIONSHIP_RECORDS = Math.floor(MAX_DETAILED_AGENTS * MAX_RELATIONSHIPS_PER_AGENT / 2);

const relationshipPriority: Record<RelationshipState["kind"], number> = {
  parent: 8,
  caregiver: 7,
  partner: 6,
  teacher: 5,
  student: 5,
  sibling: 4,
  friend: 3,
  rival: 2,
};

const compareRelationshipsForRetention = (left: RelationshipState, right: RelationshipState): number =>
  relationshipPriority[right.kind] - relationshipPriority[left.kind]
  || compareSimulationSteps(right.createdTimelineStep ?? String(right.createdTick), left.createdTimelineStep ?? String(left.createdTick))
  || right.strength - left.strength
  || left.id.localeCompare(right.id);

const isSortedUnique = (values: readonly string[]): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) return false;
  }
  return true;
};

const hasCanonicalMemoryLayout = (
  memoryIds: readonly string[],
  knowledgeIds: readonly string[],
  activeMemories: readonly string[],
): boolean => {
  if (memoryIds.length > MAX_AGENT_MEMORY_IDS) return false;
  const core = [...knowledgeIds, ...activeMemories].slice(0, MAX_AGENT_MEMORY_IDS);
  if (memoryIds.length < core.length) return false;
  for (let index = 0; index < core.length; index += 1) {
    if (memoryIds[index] !== core[index]) return false;
  }
  const coreIds = new Set(core);
  for (let index = core.length; index < memoryIds.length; index += 1) {
    const id = memoryIds[index]!;
    if (coreIds.has(id) || (index > core.length && memoryIds[index - 1]! <= id)) return false;
  }
  return true;
};

export const compactRelationshipRecords = (state: WorldState): number => {
  const agentIds = new Set(state.agents.map((agent) => agent.id));
  const byId = new Map<string, RelationshipState>();
  for (const relationship of state.relationships) {
    if (!agentIds.has(relationship.fromId) || !agentIds.has(relationship.toId) || relationship.fromId === relationship.toId) continue;
    const current = byId.get(relationship.id);
    if (!current || compareRelationshipsForRetention(relationship, current) < 0) byId.set(relationship.id, relationship);
  }
  const candidates = [...byId.values()].sort(compareRelationshipsForRetention);
  const incidentCounts = new Map<EntityId, number>();
  const retained: RelationshipState[] = [];
  for (const relationship of candidates) {
    if (retained.length >= MAX_RELATIONSHIP_RECORDS) break;
    const fromCount = incidentCounts.get(relationship.fromId) ?? 0;
    const toCount = incidentCounts.get(relationship.toId) ?? 0;
    if (fromCount >= MAX_RELATIONSHIPS_PER_AGENT || toCount >= MAX_RELATIONSHIPS_PER_AGENT) continue;
    retained.push(relationship);
    incidentCounts.set(relationship.fromId, fromCount + 1);
    incidentCounts.set(relationship.toId, toCount + 1);
  }
  const removed = state.relationships.length - retained.length;
  if (removed <= 0) return 0;
  state.relationships = retained;
  state.eventArchive.archivedRelationshipCount = addPersistentTotal(state.eventArchive.archivedRelationshipCount, removed);
  return removed;
};

export const compactAgentMemoryRecords = (state: WorldState): number => {
  const activeMemoriesByAgent = new Map<EntityId, Set<string>>();
  for (const facility of state.facilities) {
    if (facility.status === "abandoned") continue;
    const memoryId = `work:${facility.id}`;
    for (const agentId of facility.workforceIds) {
      const memories = activeMemoriesByAgent.get(agentId) ?? new Set<string>();
      memories.add(memoryId);
      activeMemoriesByAgent.set(agentId, memories);
    }
  }

  let removed = 0;
  for (const agent of state.agents) {
    const activeMemorySet = activeMemoriesByAgent.get(agent.id);
    const knowledgeIsCanonical = agent.knowledgeIds.length <= MAX_AGENT_MEMORY_IDS && isSortedUnique(agent.knowledgeIds);
    const activeMemories = activeMemorySet
      ? [...activeMemorySet].sort()
      : [];
    if (knowledgeIsCanonical) {
      const knowledgeSet = activeMemories.length > 0 ? new Set(agent.knowledgeIds) : undefined;
      const filteredActiveMemories = knowledgeSet
        ? activeMemories.filter((id) => !knowledgeSet.has(id))
        : activeMemories;
      if (hasCanonicalMemoryLayout(agent.memoryIds, agent.knowledgeIds, filteredActiveMemories)) continue;
    }
    const knowledgeIds = [...new Set(agent.knowledgeIds)].sort().slice(0, MAX_AGENT_MEMORY_IDS);
    const knowledgeSet = new Set(knowledgeIds);
    const normalizedActiveMemories = activeMemories.filter((id) => !knowledgeSet.has(id));
    const retainedActiveMemories = normalizedActiveMemories;
    const retained = [...knowledgeIds, ...retainedActiveMemories].slice(0, MAX_AGENT_MEMORY_IDS);
    const remembered = new Set(retained);
    const remaining = [...new Set(agent.memoryIds)]
      .filter((id) => !remembered.has(id))
      .sort()
      .reverse();
    for (const id of remaining) {
      if (retained.length >= MAX_AGENT_MEMORY_IDS) break;
      retained.push(id);
    }
    if (retained.length !== agent.memoryIds.length || retained.some((id, index) => id !== agent.memoryIds[index])) {
      removed += Math.max(0, agent.memoryIds.length - retained.length);
      agent.memoryIds = retained;
    }
  }
  return removed;
};

const inheritCultureFromParents = (
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
  const blueprint = species.blueprint;
  const lifespanVariation = 0.78 + trait("lifespan") * 0.44;
  const lifespan = blueprint
    // Detailed agents represent the long-lived, social-capable portion of a
    // lineage. Short-lived forms remain ecological populations, while agents
    // keep enough adulthood for relationships, family, and knowledge transfer.
    ? Math.max(45, Math.round(blueprint.lifespanYears * lifespanVariation))
    : 45 + (base % 55);
  const id = asEntityId(`agent:${hashString(`${population.id}:${ordinal}:${base}`).toString(16)}`);
  const traits = founderHeritableTraits(species, `${seed}:${id}`);
  const agent: AgentState = {
    id,
    populationId: population.id,
    regionId: population.regionId,
    age: 0,
    lifespan,
    parentIds: [...parentIds],
    traits,
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
    health: healthyAgentState(),
  };
  agent.genetics = founderGenetics(species, traits, `${seed}:${id}`);
  return agent;
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
  // Only these nested fields are written during a lifecycle step. Avoiding a
  // full structured clone for every detailed agent keeps dense worlds bounded
  // without sharing mutable state with the previous authoritative snapshot.
  const agents = new Map<EntityId, AgentState>(state.agents.map((agent) => [agent.id, {
    ...agent,
    skills: { ...agent.skills },
    needs: { ...agent.needs },
    memoryIds: [...agent.memoryIds],
    relationshipIds: [...agent.relationshipIds],
    ...(agent.genetics ? { genetics: { ...agent.genetics } } : {}),
    ...(agent.health ? { health: { ...agent.health, infections: agent.health.infections.map((infection) => ({ ...infection })), immunityIds: [...agent.health.immunityIds] } } : {}),
  }]));
  const populationsById = new Map(state.populations.map((population) => [population.id, population]));
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  const removedPopulationIds = new Set(_ecology.entityEffects
    .filter((effect) => effect.collection === "populations" && effect.operation === "remove")
    .map((effect) => (effect as { id: EntityId }).id));
  const deadIds = new Set<EntityId>(state.agents.filter((agent) => removedPopulationIds.has(agent.populationId)).map((agent) => agent.id));
  const agentsByPopulation = new Map<string, AgentState[]>();
  const agentCountsByPopulation = new Map<string, number>();
  for (const agent of agents.values()) {
    const populationId = String(agent.populationId);
    const members = agentsByPopulation.get(populationId) ?? [];
    members.push(agent);
    agentsByPopulation.set(populationId, members);
    agentCountsByPopulation.set(populationId, members.length);
  }
  const foodIndex = createFoodBalanceIndex(state);
  const technologyProfiles = technologyProfilesForState(state);
  const facilityEffects = facilityEffectProfilesForState(state);
  const meanTemperature = state.fields.temperature.values.length === 0
    ? 0
    : state.fields.temperature.values.reduce((sum, value) => sum + value, 0) / state.fields.temperature.values.length;
  const meanHumidity = state.fields.humidity.values.length === 0
    ? 0
    : state.fields.humidity.values.reduce((sum, value) => sum + value, 0) / state.fields.humidity.values.length;
  const foodSecurityByAgent = new Map<EntityId, number>();
  const foodSecurityFor = (agent: AgentState): number => {
    const cached = foodSecurityByAgent.get(agent.id);
    if (cached !== undefined) return cached;
    const value = foodSecurityForAgent(state, agent, foodIndex);
    foodSecurityByAgent.set(agent.id, value);
    return value;
  };
  const cellIndexByRegion = new Map<string, number>();
  const cellIndexForRegion = (regionId: AgentState["regionId"]): number => {
    const cached = cellIndexByRegion.get(regionId);
    if (cached !== undefined) return cached;
    const regionMatch = /^region:(\d+):(\d+)$/.exec(regionId);
    const x = Math.max(0, Math.min(state.fields.elevation.width - 1, Number(regionMatch?.[1] ?? 0)));
    const y = Math.max(0, Math.min(state.fields.elevation.height - 1, Number(regionMatch?.[2] ?? 0)));
    const index = y * state.fields.elevation.width + x;
    cellIndexByRegion.set(regionId, index);
    return index;
  };
  const aggregateRegions = new Set(state.lod.summaries
    .filter((summary) => summary.mode === "aggregate")
    .map((summary) => summary.regionId));
  const deathRolls: number[] = [];
  const deathContexts: Array<{ foodSecurity: number; hungerRisk: number; oldAgeRisk: number; diseaseRisk: number; environmentalRisk: number }> = [];
  const movedPopulations = new Map<string, string>();
  const professionsByAgent = new Map<EntityId, Array<{ type: WorldState["facilities"][number]["type"]; facilityId: string }>>();
  for (const facility of state.facilities) {
    if (facility.status !== "active" && facility.status !== "damaged") continue;
    for (const id of facility.workforceIds) {
      const professions = professionsByAgent.get(id) ?? [];
      professions.push({ type: facility.type, facilityId: facility.id });
      professionsByAgent.set(id, professions);
    }
  }
  for (const effect of _ecology.entityEffects) {
    if (effect.collection === "populations" && effect.operation === "update" && effect.value) {
      const previous = populationsById.get(effect.id);
      if (previous && previous.regionId !== effect.value.regionId) movedPopulations.set(String(effect.id), effect.value.regionId);
    }
  }
  for (const agent of agents.values()) {
    if (deadIds.has(agent.id)) continue;
    const population = populationsById.get(agent.populationId);
    const species = population ? speciesById.get(population.speciesId) : undefined;
    agent.genetics = normalizeAgentGenetics(agent, species);
  }
  const healthStep = stepAgentHealth(state, agents, years);
  delta.eventDrafts.push(...healthStep.events);
  for (const agent of agents.values()) {
    const nextAge = agent.age + years;
    const population = populationsById.get(agent.populationId);
    const species = population ? speciesById.get(population.speciesId) : undefined;
    const medicineLevel = technologyProfiles.get(agent.regionId)?.medicine ?? 0;
    const medicineFacility = facilityEffects.get(agent.regionId)?.medicine ?? 0;
    const medicineProtection = Math.min(0.55, medicineLevel * 0.28 + medicineFacility * 0.22);
    const oldAgeRisk = nextAge >= agent.lifespan
      ? Math.max(0.08, 1 - medicineProtection)
      : Math.max(0, (nextAge / agent.lifespan - 0.82) * 0.12) * (1 - medicineProtection);
    const foodSecurity = foodSecurityFor(agent);
    const hungerRisk = Math.max(0, 0.5 - (agent.needs.food ?? 0)) * 0.02;
    const metabolicEfficiency = clamp(agent.traits.metabolicEfficiency ?? 0.5);
    const needRisk = hungerRisk
      * (1 - foodSecurity * 0.2)
      * (1 - metabolicEfficiency * 0.32)
      * (1 - Math.min(0.5, medicineLevel * 0.22 + medicineFacility * 0.2));
    const diseaseRisk = healthStep.mortalityRiskByAgent.get(agent.id) ?? 0;
    let environmentalRisk = 0;
    if (species) {
      const cellIndex = cellIndexForRegion(agent.regionId);
      const climate = annualClimateForLocal(
        state.fields.temperature.values[cellIndex] ?? 0.5,
        state.fields.humidity.values[cellIndex] ?? 0.5,
        meanTemperature,
        meanHumidity,
        state.climateCycle,
      );
      const environment = geneticEnvironmentFitness(agent, species, climate.temperature, climate.humidity);
      const annualEnvironmentalRisk = (environment.thermalStress * 0.055 + environment.hydrationStress * 0.04) * (1 - medicineProtection * 0.25);
      environmentalRisk = 1 - Math.pow(1 - clamp(annualEnvironmentalRisk, 0, 0.35), years);
    }
    const [mortalityRoll] = randomFloat(forkRandom(state.random, `mortality:${agent.id}:${nextAge}`));
    if (mortalityRoll < oldAgeRisk + needRisk + diseaseRisk + environmentalRisk) {
      deadIds.add(agent.id);
      deathRolls.push(mortalityRoll);
      deathContexts.push({ foodSecurity, hungerRisk, oldAgeRisk, diseaseRisk, environmentalRisk });
      continue;
    }
    const migratedRegion = movedPopulations.get(String(agent.populationId));
    if (migratedRegion) agent.regionId = migratedRegion as AgentState["regionId"];
    agent.age = nextAge;
    const foodRelief = years * 0.01 * Math.max(0, (foodSecurity - 0.75) / 0.25);
    agent.needs = {
      ...agent.needs,
      food: clamp((agent.needs.food ?? 0.5) - years * 0.01 + foodRelief),
      belonging: clamp((agent.needs.belonging ?? 0.2) + years * 0.002),
    };
    agent.skills = {
      ...agent.skills,
      observation: clamp((agent.skills.observation ?? 0) + (agent.traits.curiosity ?? 0) * years * 0.002),
      communication: clamp((agent.skills.communication ?? 0) + (agent.traits.sociality ?? 0) * years * 0.001),
    };
    for (const profession of professionsByAgent.get(agent.id) ?? []) {
      const skill = `profession:${profession.type}`;
      agent.skills[skill] = clamp((agent.skills[skill] ?? 0) + years * 0.012 * (0.7 + (agent.traits.curiosity ?? 0) * 0.3));
      const memoryId = `work:${profession.facilityId}`;
      if (!agent.memoryIds.includes(memoryId)) agent.memoryIds.push(memoryId);
    }
  }

  for (const agent of state.agents) {
    if (deadIds.has(agent.id)) {
      const populationId = String(agent.populationId);
      agentCountsByPopulation.set(populationId, Math.max(0, (agentCountsByPopulation.get(populationId) ?? 1) - 1));
    }
  }

  if (agents.size - deadIds.size < MAX_DETAILED_AGENTS) {
    for (const population of state.populations) {
      if (agents.size - deadIds.size >= MAX_DETAILED_AGENTS) break;
      if (removedPopulationIds.has(population.id) || aggregateRegions.has(population.regionId) || population.count < 4) continue;
      const species = speciesById.get(population.speciesId);
      if (!species || (species.traits.cognitivePotential ?? 0) < 0.3) continue;
      const index = cellIndexForRegion(population.regionId);
      const target = eligibleAgentCount(population, species, state.chemistry.oxygen.values[index] ?? 0, state.fields.biomass.values[index] ?? 0);
      const emergenceTarget = Math.max(0, target - 2);
      const populationId = String(population.id);
      if ((agentCountsByPopulation.get(populationId) ?? 0) >= emergenceTarget) continue;
      const existing = (agentsByPopulation.get(populationId) ?? []).filter((agent) => !deadIds.has(agent.id));
      for (let ordinal = existing.length; ordinal < emergenceTarget && agents.size - deadIds.size < MAX_DETAILED_AGENTS; ordinal += 1) {
        const candidate = createAgent(population, species, ordinal, `${state.seed}:${simulationStepForWorld(state)}`);
        const probability = clamp(0.12 + (species.traits.cognitivePotential ?? 0) * 0.5);
        const [roll] = randomFloat(forkRandom(state.random, `emergence:${candidate.id}`));
        if (roll < probability && !agents.has(candidate.id)) {
          agents.set(candidate.id, candidate);
          existing.push(candidate);
          const populationMembers = agentsByPopulation.get(populationId) ?? existing;
          if (populationMembers !== existing) populationMembers.push(candidate);
          agentsByPopulation.set(populationId, populationMembers);
          agentCountsByPopulation.set(populationId, populationMembers.length);
        }
      }
    }
  }

  const relationshipMap = new Map(state.relationships.map((relationship) => [relationship.id, relationship]));
  const stateAgentIds = new Set(state.agents.map((agent) => agent.id));
  const stateRelationshipIds = new Set(state.relationships.map((relationship) => relationship.id));
  const familyForPair = new Map<string, OrganizationState>();
  const families = state.organizations.filter((organization) => organization.type === "family");
  const familyMembers = new Map(families.map((organization) => [organization.id, [...organization.memberIds]]));
  for (const family of families) {
    const members = family.memberIds;
    for (let index = 0; index < members.length; index += 1) {
      for (let next = index + 1; next < members.length; next += 1) {
        familyForPair.set([members[index], members[next]].sort().join(":"), family);
      }
    }
  }
  const currentAgents = [...agents.values()].filter((agent) => !deadIds.has(agent.id)).sort((left, right) => left.id.localeCompare(right.id));
  const currentById = new Map(currentAgents.map((agent) => [agent.id, agent]));
  const partnerByAgent = new Map<EntityId, AgentState>();
  for (const relationship of relationshipMap.values()) {
    if (relationship.kind !== "partner") continue;
    const first = currentById.get(relationship.fromId);
    const second = currentById.get(relationship.toId);
    if (first && second) {
      partnerByAgent.set(first.id, second);
      partnerByAgent.set(second.id, first);
    }
  }
  const availableByRegion = new Map<string, AgentState[]>();
  for (const agent of currentAgents) {
    const members = availableByRegion.get(agent.regionId) ?? [];
    members.push(agent);
    availableByRegion.set(agent.regionId, members);
  }
  const pairedAgents = new Set<EntityId>();
  for (const first of currentAgents) {
    if (pairedAgents.has(first.id) || first.age < 16) continue;
    const existingPartner = partnerByAgent.get(first.id);
    const regionalCandidates = availableByRegion.get(first.regionId) ?? [];
    const candidateCount = existingPartner ? 1 : regionalCandidates.length;
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const second = existingPartner ?? regionalCandidates[candidateIndex];
      if (!second
        || second.id === first.id
        || pairedAgents.has(second.id)
        || (!existingPartner && partnerByAgent.has(second.id))
        || first.regionId !== second.regionId
        || first.age < 16
        || second.age < 16) continue;
      const relationId = relationshipIdFor("partner", first.id, second.id);
      if (relationshipMap.has(relationId)) {
        pairedAgents.add(first.id);
        pairedAgents.add(second.id);
        break;
      }
      const affinity = ((first.traits.sociality ?? 0) + (second.traits.sociality ?? 0) + (first.traits.cooperation ?? 0) + (second.traits.cooperation ?? 0)) / 4;
      const foodSecurity = (foodSecurityFor(first) + foodSecurityFor(second)) / 2;
      const probability = clamp(affinity * (0.43 + foodSecurity * 0.02));
      const [roll] = randomFloat(forkRandom(state.random, `partner:${first.id}:${second.id}`));
      if (roll >= probability) continue;
      addRelationship(relationshipMap, createRelationship("partner", first.id, second.id, nextSimulationTick(state), affinity, simulationStepForWorld(state)));
      pairedAgents.add(first.id);
      pairedAgents.add(second.id);
      const pairKey = [first.id, second.id].sort().join(":");
      if (!familyForPair.has(pairKey)) {
        const family = createFamily([first.id, second.id], first.regionId);
        delta.entityEffects.push({ collection: "organizations", operation: "create", id: family.id, value: family });
        familyForPair.set(pairKey, family);
        familyMembers.set(family.id, [...family.memberIds]);
        delta.eventDrafts.push({
          kind: "family-formation",
          ruleId: "family-formation",
          sourceIds: [first.id, second.id],
          probability,
          roll,
          evidence: { affinity, foodSecurity, members: family.memberIds.length },
          payload: { familyId: family.id, memberIds: family.memberIds },
          source: "natural",
        });
      }
      break;
    }
  }

  const partnerPairs = [...relationshipMap.values()]
    .filter((relationship) => relationship.kind === "partner")
    .map((relationship) => [agents.get(relationship.fromId), agents.get(relationship.toId)] as const)
    .filter((pair): pair is [AgentState, AgentState] => Boolean(pair[0]
      && pair[1]
      && !deadIds.has(pair[0].id)
      && !deadIds.has(pair[1].id)))
    .sort(([left], [right]) => left.id.localeCompare(right.id));
  for (const [first, second] of partnerPairs) {
    if (first.age < 18 || second.age < 18 || first.age >= first.lifespan || second.age >= second.lifespan) continue;
    if (first.populationId !== second.populationId) continue;
    const family = familyForPair.get([first.id, second.id].sort().join(":"));
    if (!family) continue;
    const population = populationsById.get(first.populationId);
    const species = population ? speciesById.get(population.speciesId) : undefined;
    if (!population || !species) continue;
    const fertility = ((first.traits.fertility ?? 0) + (second.traits.fertility ?? 0)) / 2;
    const foodSecurity = ((first.needs.food ?? 0) + (second.needs.food ?? 0)) / 2;
    const ageFactor = Math.max(0.08, 1 - Math.max(first.age / first.lifespan, second.age / second.lifespan) * 0.8);
    const populationIndex = populationCellIndex(population, state.fields.elevation.width, state.fields.elevation.height);
    const parentClimate = annualClimateForLocal(
      state.fields.temperature.values[populationIndex] ?? 0.5,
      state.fields.humidity.values[populationIndex] ?? 0.5,
      meanTemperature,
      meanHumidity,
      state.climateCycle,
    );
    const parentFitness = (
      geneticEnvironmentFitness(first, species, parentClimate.temperature, parentClimate.humidity).fitness
      + geneticEnvironmentFitness(second, species, parentClimate.temperature, parentClimate.humidity).fitness
    ) / 2;
    const probability = clamp((fertility * 0.16 + foodSecurity * 0.08) * ageFactor * (0.35 + parentFitness * 0.65));
    const [roll] = randomFloat(forkRandom(state.random, `birth:${family.id}:${simulationStepForWorld(state)}`));
    if (roll >= probability) continue;
    let populationAgentCount = agentCountsByPopulation.get(String(population.id)) ?? 0;
    const ecologicalSampleLimit = Math.min(
      64,
      Math.max(
        eligibleAgentCount(population, species, state.chemistry.oxygen.values[populationIndex] ?? 0, state.fields.biomass.values[populationIndex] ?? 0),
        Math.ceil(Math.sqrt(population.count) * (species.traits.cognitivePotential ?? 0) * 2.4),
      ),
    );
    if (agents.size - deadIds.size >= MAX_DETAILED_AGENTS || populationAgentCount >= ecologicalSampleLimit) {
      const replacement = [...agents.values()]
        .filter((candidate) => candidate.populationId === population.id
          && !deadIds.has(candidate.id)
          && candidate.id !== first.id
          && candidate.id !== second.id
          && candidate.parentIds.length === 0)
        .sort((left, right) => right.age - left.age || left.id.localeCompare(right.id))[0];
      if (!replacement) continue;
      deadIds.add(replacement.id);
      populationAgentCount = Math.max(0, populationAgentCount - 1);
      agentCountsByPopulation.set(String(population.id), populationAgentCount);
    }
    const geneticInheritance = inheritAgentGenetics(
      createAgent(population, species, agents.size, `birth:${family.id}:${simulationStepForWorld(state)}`, [first.id, second.id]),
      first,
      second,
      species,
      `${state.seed}:${state.random.value}:${family.id}:${simulationStepForWorld(state)}`,
    );
    const child = inheritCultureFromParents(geneticInheritance.agent, first, second, state.random);
    if (agents.has(child.id)) continue;
    agents.set(child.id, child);
    const populationMembers = agentsByPopulation.get(String(population.id)) ?? [];
    populationMembers.push(child);
    agentsByPopulation.set(String(population.id), populationMembers);
    agentCountsByPopulation.set(String(population.id), populationAgentCount + 1);
    const siblings = (familyMembers.get(family.id) ?? family.memberIds)
      .map((memberId) => agents.get(memberId))
      .filter((member): member is AgentState => Boolean(member && member.id !== first.id && member.id !== second.id && member.parentIds.includes(first.id) && member.parentIds.includes(second.id)))
      .sort((left, right) => left.id.localeCompare(right.id));
    const childRelationships = [
      createRelationship("parent", first.id, child.id, nextSimulationTick(state), 0.9, simulationStepForWorld(state)),
      createRelationship("parent", second.id, child.id, nextSimulationTick(state), 0.9, simulationStepForWorld(state)),
      createRelationship("caregiver", first.id, child.id, nextSimulationTick(state), 0.8, simulationStepForWorld(state)),
      createRelationship("caregiver", second.id, child.id, nextSimulationTick(state), 0.8, simulationStepForWorld(state)),
      ...siblings.map((sibling) => createRelationship("sibling", sibling.id, child.id, nextSimulationTick(state), 0.85, simulationStepForWorld(state))),
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
      evidence: {
        fertility,
        foodSecurity,
        parentFitness,
        familyMembers: family.memberIds.length,
        inheritedKnowledge: child.knowledgeIds.length,
        inheritedBeliefs: child.beliefIds.length,
        generation: child.genetics?.generation ?? 0,
        mutationCount: geneticInheritance.mutationCount,
        parentDivergence: geneticInheritance.parentDivergence,
        lineageSignature: child.genetics?.lineageSignature ?? "unknown",
        siblings: siblings.length,
      },
      payload: { agentId: child.id, familyId: family.id, parentIds: child.parentIds, speciesId: species.id, regionId: child.regionId },
      source: "natural",
    });
    if (geneticInheritance.mutationCount > 0) {
      delta.eventDrafts.push({
        kind: "genetic-mutation",
        ruleId: "genetics:birth-mutation",
        sourceIds: [child.id, first.id, second.id],
        probability: geneticInheritance.mutationProbability,
        roll: geneticInheritance.mutationRoll,
        evidence: {
          regionId: child.regionId,
          speciesId: species.id,
          generation: child.genetics?.generation ?? 0,
          mutationCount: geneticInheritance.mutationCount,
          parentDivergence: geneticInheritance.parentDivergence,
          lineageSignature: child.genetics?.lineageSignature ?? "unknown",
        },
        payload: { agentId: child.id, parentIds: child.parentIds, speciesId: species.id, regionId: child.regionId },
        source: "natural",
      });
    }
  }

  for (const family of families) {
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
    if (!stateRelationshipIds.has(relationship.id)) {
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
    const operation = stateAgentIds.has(agent.id) ? "update" : "create";
    delta.entityEffects.push({
      collection: "agents",
      operation,
      id: agent.id,
      value: { ...agent, relationshipIds: [...new Set(relationshipIds.get(agent.id) ?? [])].sort() },
    });
  }
  const finalizedHealth = finalizeAgentHealth(state, healthStep, agents, deadIds);
  delta.entityEffects.push(...finalizedHealth.effects);
  delta.eventDrafts.push(...finalizedHealth.events);
  if (deadIds.size > 0) {
    delta.eventDrafts.push({
      kind: "agent-death",
      ruleId: "agent-lifecycle",
      sourceIds: [...deadIds],
      probability: 1,
      roll: deathRolls.reduce((sum, value) => sum + value, 0) / Math.max(1, deathRolls.length),
      evidence: {
        deaths: deadIds.size,
        hungerDeaths: deathContexts.filter((context) => context.hungerRisk > Math.max(context.oldAgeRisk, context.diseaseRisk, context.environmentalRisk)).length,
        diseaseDeaths: deathContexts.filter((context) => context.diseaseRisk > Math.max(context.hungerRisk, context.oldAgeRisk, context.environmentalRisk)).length,
        environmentalDeaths: deathContexts.filter((context) => context.environmentalRisk > Math.max(context.hungerRisk, context.oldAgeRisk, context.diseaseRisk)).length,
        meanFoodSecurity: deathContexts.reduce((sum, context) => sum + context.foodSecurity, 0) / Math.max(1, deathContexts.length),
      },
      payload: { agentIds: [...deadIds] },
      source: "natural",
    });
  }
  return delta;
};

export type { OrganizationState };
