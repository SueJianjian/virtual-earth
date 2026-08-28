import { describe, expect, it } from "vitest";
import { compactAgentMemoryRecords, compactRelationshipRecords, createAgent, eligibleAgentCount, MAX_AGENT_MEMORY_IDS, MAX_RELATIONSHIPS_PER_AGENT, stepAgents } from "../../src/sim/agents/index.ts";
import { stepWorld } from "../../src/sim/engine.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { OrganizationState, PopulationState, WorldDelta } from "../../src/sim/types.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const population: PopulationState = {
  id: "population:mind" as PopulationState["id"],
  speciesId: "species:mind" as PopulationState["speciesId"],
  regionId: "region:0:0" as PopulationState["regionId"],
  count: 100,
  energy: 1,
};

describe("agent emergence and lifecycle", () => {
  it("creates stable agents only when ecological and cognitive conditions qualify", () => {
    const world = createWorld(21, { width: 8, height: 8 });
    const species = createSpecies("mind", "consumer");
    species.traits.cognitivePotential = 1;
    world.species = [species];
    world.populations = [{ ...population, speciesId: species.id }];
    world.fields.biomass.values[0] = 0.5;
    world.chemistry.oxygen.values[0] = 0.5;

    expect(eligibleAgentCount(world.populations[0]!, species, 0.5, 0.5)).toBeGreaterThan(0);
    const first = stepAgents(world, emptyDelta(), 1);
    const second = stepAgents(structuredClone(world), emptyDelta(), 1);
    expect(first).toEqual(second);
    expect(first.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "create")).not.toHaveLength(0);
  });

  it("persists newly emerged agents through the world reducer", () => {
    const world = createWorld(23, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("emergent", "consumer");
    species.traits.cognitivePotential = 1;
    world.species = [species];
    world.populations = [{ ...population, speciesId: species.id }];
    world.fields.biomass.values[0] = 0.5;
    world.chemistry.oxygen.values[0] = 0.5;

    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });

    expect(result.state.agents.length).toBeGreaterThan(0);
    expect(result.state.agents.every((agent) => agent.populationId === population.id)).toBe(true);
  });

  it("removes agents at the end of lifespan and cleans relationship edges", () => {
    const world = createWorld(22, { width: 8, height: 8 });
    const species = createSpecies("mind", "consumer");
    const first = createAgent({ ...population, speciesId: species.id }, species, 0, "test");
    const second = createAgent({ ...population, speciesId: species.id }, species, 1, "test");
    first.age = first.lifespan;
    second.age = 20;
    const relationship = createRelationship("partner", first.id, second.id, 0, 0.8);
    world.species = [species];
    world.populations = [{ ...population, speciesId: species.id }];
    world.agents = [first, second];
    world.relationships = [relationship];

    const delta = stepAgents(world, emptyDelta(), 1);
    expect(delta.entityEffects).toContainEqual({ collection: "agents", operation: "remove", id: first.id });
    expect(delta.relationshipEffects).toContainEqual({ operation: "remove", relationship });
  });

  it("does not let partners who die in the current step produce children", () => {
    const birthCounts = Array.from({ length: 128 }, (_, seed) => {
      const world = createWorld(30_000 + seed, { width: 8, height: 8, formation: "formed" });
      const species = createSpecies(`terminal-family:${seed}`, "consumer");
      const localPopulation = { ...population, speciesId: species.id };
      const first = createAgent(localPopulation, species, 0, `terminal-family:${seed}`);
      const second = createAgent(localPopulation, species, 1, `terminal-family:${seed}`);
      first.age = 25;
      second.age = 25;
      first.traits.fertility = 1;
      second.traits.fertility = 1;
      first.needs.food = 1;
      second.needs.food = 1;
      const relationship = createRelationship("partner", first.id, second.id, 0, 1);
      const family: OrganizationState = {
        id: `family:terminal:${seed}` as OrganizationState["id"],
        type: "family",
        memberIds: [first.id, second.id],
        childOrganizationIds: [],
        regionId: localPopulation.regionId,
        territoryRegionIds: [localPopulation.regionId],
        resources: {},
        status: "active",
      };
      world.species = [species];
      world.populations = [localPopulation];
      world.agents = [first, second];
      world.relationships = [relationship];
      world.organizations = [family];

      const delta = stepAgents(world, emptyDelta(), 100);
      expect(delta.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "remove")).toHaveLength(2);
      return delta.eventDrafts.filter((event) => event.kind === "agent-birth").length;
    });

    expect(birthCounts.every((count) => count === 0)).toBe(true);
  });

  it("lets an operational medical facility reduce end-of-life mortality risk", () => {
    const outcomes = Array.from({ length: 64 }, (_, seed) => {
      const world = createWorld(600 + seed, { width: 8, height: 8, formation: "formed" });
      const species = createSpecies(`medical:${seed}`, "consumer");
      const localPopulation = { ...population, speciesId: species.id };
      const agent = createAgent(localPopulation, species, 0, `medical:${seed}`);
      agent.age = agent.lifespan;
      world.species = [species];
      world.populations = [localPopulation];
      world.agents = [agent];
      const baseline = stepAgents(structuredClone(world), emptyDelta(), 1);
      world.facilities = [{ id: `facility:medical:${seed}`, type: "medicine", regionId: agent.regionId, ownerOrganizationId: "organization:city:medical" as never, level: 3, condition: 1, status: "active", workforceIds: [agent.id], materialInvested: 8, plannedTick: 1, builtTick: 2, lastMaintainedTick: 2, lastIncidentTick: 2 }];
      const protectedDelta = stepAgents(world, emptyDelta(), 1);
      return {
        baselineDied: baseline.entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "remove" && effect.id === agent.id),
        protectedDied: protectedDelta.entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "remove" && effect.id === agent.id),
      };
    });

    expect(outcomes.every((outcome) => outcome.baselineDied)).toBe(true);
    expect(outcomes.some((outcome) => !outcome.protectedDied)).toBe(true);
  });

  it("lets inherited climate adaptation reduce environmental mortality", () => {
    const outcomes = Array.from({ length: 128 }, (_, seed) => {
      const world = createWorld(700 + seed, { width: 8, height: 8, formation: "formed" });
      const species = createSpecies(`selection:${seed}`, "consumer");
      species.traits.temperatureOptimum = 1;
      species.traits.humidityOptimum = 1;
      const localPopulation = { ...population, speciesId: species.id };
      const agent = createAgent(localPopulation, species, 0, `selection:${seed}`);
      agent.age = 20;
      world.fields.temperature.values.fill(0.5);
      world.fields.humidity.values.fill(0.5);
      world.species = [species];
      world.populations = [localPopulation];
      world.agents = [agent];
      const vulnerable = structuredClone(world);
      vulnerable.agents[0]!.traits.thermalTolerance = 0;
      vulnerable.agents[0]!.traits.hydrationRetention = 0;
      const adapted = structuredClone(world);
      adapted.agents[0]!.traits.thermalTolerance = 1;
      adapted.agents[0]!.traits.hydrationRetention = 1;
      return {
        vulnerableDied: stepAgents(vulnerable, emptyDelta(), 10).entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "remove" && effect.id === agent.id),
        adaptedDied: stepAgents(adapted, emptyDelta(), 10).entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "remove" && effect.id === agent.id),
      };
    });

    expect(outcomes.filter((outcome) => outcome.vulnerableDied).length).toBeGreaterThan(outcomes.filter((outcome) => outcome.adaptedDied).length);
    expect(outcomes.some((outcome) => outcome.vulnerableDied && !outcome.adaptedDied)).toBe(true);
  });

  it("records profession experience and workplace memory for active staff", () => {
    const world = createWorld(665, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("worker", "consumer");
    const localPopulation = { ...population, speciesId: species.id };
    const agent = createAgent(localPopulation, species, 0, "worker");
    agent.age = 25;
    world.species = [species];
    world.populations = [localPopulation];
    world.agents = [agent];
    world.facilities = [{ id: "facility:medicine:career", type: "medicine", regionId: agent.regionId, ownerOrganizationId: "organization:city:career" as never, level: 1, condition: 1, status: "active", workforceIds: [agent.id], workforceRequired: 2, workforceEfficiency: 0.5, materialInvested: 4, plannedTick: 1, builtTick: 2, lastMaintainedTick: 2, lastIncidentTick: 2 }];

    const delta = stepAgents(world, emptyDelta(), 1);
    const update = delta.entityEffects.find((effect) => effect.collection === "agents" && effect.operation === "update" && effect.id === agent.id);
    const updated = update?.collection === "agents" ? update.value : undefined;

    expect(updated?.skills["profession:medicine"]).toBeGreaterThan(0);
    expect(updated?.memoryIds).toContain("work:facility:medicine:career");
  });

  it("bounds personal memories while retaining current knowledge and active workplace memories", () => {
    const world = createWorld(666, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("memory", "consumer");
    const localPopulation = { ...population, speciesId: species.id };
    const agent = createAgent(localPopulation, species, 0, "memory");
    agent.knowledgeIds = ["knowledge:current"];
    agent.memoryIds = Array.from({ length: MAX_AGENT_MEMORY_IDS + 32 }, (_, index) => `memory:stale:${String(index).padStart(3, "0")}`);
    agent.memoryIds.push("work:facility:active");
    world.agents = [agent];
    world.facilities = [{
      id: "facility:active",
      type: "medicine",
      regionId: agent.regionId,
      ownerOrganizationId: "organization:city:memory" as never,
      level: 1,
      condition: 1,
      status: "active",
      workforceIds: [agent.id],
      materialInvested: 1,
      plannedTick: 1,
      builtTick: 1,
      lastMaintainedTick: 1,
      lastIncidentTick: 1,
    }];

    const removed = compactAgentMemoryRecords(world);

    expect(removed).toBeGreaterThan(0);
    expect(agent.memoryIds.length).toBeLessThanOrEqual(MAX_AGENT_MEMORY_IDS);
    expect(agent.memoryIds).toContain("knowledge:current");
    expect(agent.memoryIds).toContain("work:facility:active");
    expect(agent.memoryIds).not.toContain("memory:stale:000");
  });

  it("skips already canonical personal memory layouts", () => {
    const world = createWorld(668, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("canonical-memory", "consumer");
    const localPopulation = { ...population, speciesId: species.id };
    const agent = createAgent(localPopulation, species, 0, "canonical-memory");
    agent.knowledgeIds = ["knowledge:alpha", "knowledge:beta"];
    agent.memoryIds = [
      "knowledge:alpha",
      "knowledge:beta",
      "work:facility:active",
      "memory:stale:002",
      "memory:stale:001",
    ];
    world.agents = [agent];
    world.facilities = [{
      id: "facility:active",
      type: "medicine",
      regionId: agent.regionId,
      ownerOrganizationId: "organization:city:memory" as never,
      level: 1,
      condition: 1,
      status: "active",
      workforceIds: [agent.id],
      materialInvested: 1,
      plannedTick: 1,
      builtTick: 1,
      lastMaintainedTick: 1,
      lastIncidentTick: 1,
    }];
    const before = agent.memoryIds;

    expect(compactAgentMemoryRecords(world)).toBe(0);
    expect(agent.memoryIds).toBe(before);
  });

  it("bounds relationship history while preserving family and care ties", () => {
    const world = createWorld(667, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("relationship-archive", "consumer");
    const localPopulation = { ...population, speciesId: species.id };
    const agents = Array.from({ length: MAX_RELATIONSHIPS_PER_AGENT + 12 }, (_, index) =>
      createAgent(localPopulation, species, index, "relationship-archive"));
    const [central, parent, caregiver, partner, ...siblings] = agents;
    if (!central || !parent || !caregiver || !partner) throw new Error("relationship fixture requires four agents");
    world.species = [species];
    world.populations = [localPopulation];
    world.agents = agents;
    world.relationships = [
      createRelationship("parent", parent.id, central.id, 1, 0.2),
      createRelationship("caregiver", caregiver.id, central.id, 2, 0.2),
      createRelationship("partner", central.id, partner.id, 3, 0.2),
      ...siblings.map((sibling, index) => createRelationship("sibling", central.id, sibling.id, 10 + index, 1)),
    ];

    const removed = compactRelationshipRecords(world);
    const retainedIds = new Set(world.relationships.map((relationship) => relationship.id));
    const incidentCounts = new Map<string, number>();
    for (const relationship of world.relationships) {
      for (const agentId of [relationship.fromId, relationship.toId]) {
        incidentCounts.set(agentId, (incidentCounts.get(agentId) ?? 0) + 1);
      }
    }

    expect(removed).toBeGreaterThan(0);
    expect(world.relationships).toHaveLength(MAX_RELATIONSHIPS_PER_AGENT);
    expect(retainedIds).toContain(createRelationship("parent", parent.id, central.id, 1, 0.2).id);
    expect(retainedIds).toContain(createRelationship("caregiver", caregiver.id, central.id, 2, 0.2).id);
    expect(retainedIds).toContain(createRelationship("partner", central.id, partner.id, 3, 0.2).id);
    expect([...incidentCounts.values()].every((count) => count <= MAX_RELATIONSHIPS_PER_AGENT)).toBe(true);
    expect(world.eventArchive.archivedRelationshipCount).toBe(removed);
  });

  it("can produce a child only from an eligible family", () => {
    const worlds = Array.from({ length: 64 }, (_, index) => createWorld(index + 23, { width: 8, height: 8 }));
    const species = createSpecies("fertile", "consumer");
    species.traits.cognitivePotential = 0.6;
    species.blueprint = { ...species.blueprint!, mutationRate: 0.08, inheritanceFidelity: 0.86 };
    const parentPopulation = { ...population, speciesId: species.id, regionId: "region:0:0" as PopulationState["regionId"] };
    const first = createAgent(parentPopulation, species, 0, "birth");
    const second = createAgent(parentPopulation, species, 1, "birth");
    first.age = 25;
    second.age = 25;
    first.traits.fertility = 1;
    second.traits.fertility = 1;
    first.needs.food = 1;
    second.needs.food = 1;
    first.knowledgeIds = ["knowledge:fire"];
    second.knowledgeIds = ["knowledge:fire", "knowledge:tools"];
    first.beliefIds = ["belief:ancestors"];
    second.beliefIds = ["belief:seasons"];
    const olderChild = createAgent(parentPopulation, species, 2, "older-child", [first.id, second.id]);
    olderChild.age = 8;
    const relationship = createRelationship("partner", first.id, second.id, 0, 1);
    const family: OrganizationState = {
      id: "family:test" as OrganizationState["id"],
      type: "family" as const,
      memberIds: [first.id, second.id, olderChild.id],
      childOrganizationIds: [],
      regionId: parentPopulation.regionId,
      territoryRegionIds: [parentPopulation.regionId],
      resources: {},
      status: "active" as const,
    };
    const deltas = worlds.map((world) => {
      world.species = [species];
      world.populations = [parentPopulation];
      world.agents = [first, second, olderChild];
      world.relationships = [relationship];
      world.organizations = [family];
      return stepAgents(world, emptyDelta(), 1);
    });
    expect(deltas.some((delta) => delta.entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "create"))).toBe(true);
    expect(deltas.some((delta) => delta.eventDrafts.some((event) => event.kind === "agent-birth"))).toBe(true);
    expect(deltas.some((delta) => delta.eventDrafts.some((event) => event.kind === "genetic-mutation"))).toBe(true);
    const bornDelta = deltas.find((delta) => delta.eventDrafts.some((event) => event.kind === "agent-birth"));
    const birthEvent = bornDelta?.eventDrafts.find((event) => event.kind === "agent-birth");
    const childId = birthEvent?.payload.agentId;
    const childEffect = bornDelta?.entityEffects.find((effect) => effect.collection === "agents" && effect.id === childId && effect.value);
    const child = childEffect?.collection === "agents" ? childEffect.value : undefined;
    expect(child?.parentIds).toEqual([first.id, second.id]);
    expect(child?.genetics).toMatchObject({ generation: 1, lineageSignature: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(birthEvent?.evidence.generation).toBe(1);
    expect(birthEvent?.evidence.lineageSignature).toBe(child?.genetics?.lineageSignature);
    expect(child?.knowledgeIds).toContain("knowledge:fire");
    expect(child?.knowledgeIds.every((id) => first.knowledgeIds.includes(id) || second.knowledgeIds.includes(id))).toBe(true);
    expect(birthEvent?.evidence.inheritedKnowledge).toBe(child?.knowledgeIds.length);
    expect(birthEvent?.evidence.siblings).toBe(1);
    expect(bornDelta?.relationshipEffects.filter((effect) => effect.operation === "create" && effect.relationship.kind === "caregiver" && effect.relationship.toId === childId)).toHaveLength(2);
    expect(bornDelta?.relationshipEffects).toContainEqual(expect.objectContaining({
      operation: "create",
      relationship: expect.objectContaining({ kind: "sibling", fromId: olderChild.id, toId: childId }),
    }));
    expect(bornDelta?.entityEffects.some((effect) => effect.collection === "organizations" && effect.operation === "update" && effect.value?.memberIds.length === 4)).toBe(true);
  });

  it("moves agents with their migrated population delta", () => {
    const world = createWorld(25, { width: 8, height: 8 });
    const species = createSpecies("migrant", "consumer");
    const first = createAgent({ ...population, speciesId: species.id }, species, 0, "migration");
    world.species = [species];
    world.populations = [{ ...population, speciesId: species.id }];
    world.agents = [first];
    const ecology = emptyDelta();
    ecology.entityEffects.push({
      collection: "populations",
      operation: "update",
      id: population.id,
      value: { ...population, speciesId: species.id, regionId: "region:1:0" as PopulationState["regionId"] },
    });

    const delta = stepAgents(world, ecology, 1);
    expect(delta.entityEffects).toContainEqual(expect.objectContaining({
      collection: "agents",
      operation: "update",
      value: expect.objectContaining({ regionId: "region:1:0" }),
    }));
  });
});
