import { describe, expect, it } from "vitest";
import { createAgent, eligibleAgentCount, stepAgents } from "../../src/sim/agents/index.ts";
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
    const world = createWorld(23, { width: 8, height: 8 });
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

  it("can produce a child only from an eligible family", () => {
    const worlds = Array.from({ length: 64 }, (_, index) => createWorld(index + 23, { width: 8, height: 8 }));
    const species = createSpecies("fertile", "consumer");
    species.traits.cognitivePotential = 0.6;
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
    const bornDelta = deltas.find((delta) => delta.eventDrafts.some((event) => event.kind === "agent-birth"));
    const birthEvent = bornDelta?.eventDrafts.find((event) => event.kind === "agent-birth");
    const childId = birthEvent?.payload.agentId;
    const childEffect = bornDelta?.entityEffects.find((effect) => effect.collection === "agents" && effect.id === childId && effect.value);
    const child = childEffect?.collection === "agents" ? childEffect.value : undefined;
    expect(child?.parentIds).toEqual([first.id, second.id]);
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
