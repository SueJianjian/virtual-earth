import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { applyCultureDelta, attemptKnowledgeDiffusion, attemptKnowledgeInnovation, createKnowledge, knowledgeDiffusionRoutes, stepCulture } from "../../src/sim/culture/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { PopulationState, WorldDelta } from "../../src/sim/types.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

describe("knowledge and culture", () => {
  it("forms culture from social individuals and transmits non-mythic knowledge", () => {
    const world = createWorld(31, { width: 8, height: 8 });
    const species = createSpecies("mind", "consumer");
    const population: PopulationState = {
      id: "population:mind" as PopulationState["id"],
      speciesId: species.id,
      regionId: "region:0:0" as PopulationState["regionId"],
      count: 10,
      energy: 1,
    };
    const first = createAgent(population, species, 0, "culture");
    const second = createAgent(population, species, 1, "culture");
    for (const agent of [first, second]) {
      agent.skills = { observation: 0.8, communication: 0.8, toolUse: 0.4 };
      agent.traits.sociality = 0.8;
    }
    world.agents = [first, second];
    const delta = stepCulture(world, emptyDelta());
    const next = applyCultureDelta(world, delta);

    expect(next.cultures).toHaveLength(1);
    expect(next.cultures[0]?.knowledgeIds.length).toBeGreaterThan(0);
    expect(next.knowledge.every((knowledge) => knowledge.kind.startsWith("practice:"))).toBe(true);
    expect(next.agents.every((agent) => agent.knowledgeIds.length > 0)).toBe(true);
    expect(next.cultures[0]?.beliefIds).toEqual([]);
  });

  it("indexes projected member skills once without retaining stale knowledge kinds", () => {
    const world = createWorld(310, { width: 8, height: 8 });
    const species = createSpecies("projected-mind", "consumer");
    const population: PopulationState = {
      id: "population:projected-mind" as PopulationState["id"],
      speciesId: species.id,
      regionId: "region:1:1" as PopulationState["regionId"],
      count: 10,
      energy: 1,
    };
    const first = createAgent(population, species, 0, "projected-culture");
    const second = createAgent(population, species, 1, "projected-culture");
    first.skills = { observation: 0.8, communication: 0.1, toolUse: 0.1 };
    second.skills = { observation: 0.1, communication: 0.8, toolUse: 0.1 };
    world.agents = [first, second];

    const firstDelta = stepCulture(world, emptyDelta());
    const firstKnowledge = firstDelta.entityEffects
      .filter((effect) => effect.collection === "knowledge" && effect.operation === "create")
      .map((effect) => effect.value)
      .filter((knowledge): knowledge is NonNullable<typeof knowledge> => Boolean(knowledge));
    expect(firstKnowledge).toEqual([
      createKnowledge(population.regionId, "practice:communication", [second]),
      createKnowledge(population.regionId, "practice:observation", [first]),
    ]);

    const updatedFirst = { ...first, skills: { observation: 0.1, communication: 0.1, toolUse: 0.9 } };
    const projected = stepCulture(world, {
      ...emptyDelta(),
      entityEffects: [{ collection: "agents", operation: "update", id: first.id, value: updatedFirst }],
    });
    const projectedKnowledge = projected.entityEffects
      .filter((effect) => effect.collection === "knowledge" && effect.operation === "create")
      .map((effect) => effect.value)
      .filter((knowledge): knowledge is NonNullable<typeof knowledge> => Boolean(knowledge));
    expect(projectedKnowledge).toEqual([
      createKnowledge(population.regionId, "practice:communication", [second]),
      createKnowledge(population.regionId, "practice:toolUse", [updatedFirst]),
    ]);
  });

  it("creates traceable local innovations from conditions rather than a fixed year", () => {
    const world = createWorld(311, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("innovator", "consumer");
    const population: PopulationState = { id: "population:innovator" as never, speciesId: species.id, regionId: "region:2:2" as never, count: 40, energy: 1 };
    const members = Array.from({ length: 8 }, (_, index) => createAgent(population, species, index, "innovator"));
    for (const member of members) {
      member.traits.curiosity = 0.95;
      member.traits.cooperation = 0.8;
      member.skills.observation = 0.9;
      member.skills.communication = 0.8;
      member.skills.toolUse = 0.85;
    }
    const foundations = ["observation", "communication", "toolUse"].map((kind) => createKnowledge(population.regionId, `practice:${kind}`, members));
    const culture = { id: "culture:innovator" as never, regionId: population.regionId, knowledgeIds: foundations.map((knowledge) => knowledge.id), beliefIds: [], transmissionRate: 0.85 };
    world.species = [species];
    world.populations = [population];
    world.agents = members;
    world.knowledge = foundations;
    world.cultures = [culture];
    world.fields.biomass.values.fill(0.18);
    world.fields.nutrients.values.fill(0.7);

    let outcome: ReturnType<typeof attemptKnowledgeInnovation>;
    for (let tick = 0; tick < 256 && !outcome; tick += 1) {
      world.tick = tick;
      world.years = tick * 0.5;
      outcome = attemptKnowledgeInnovation(world, culture, members, new Map(foundations.map((knowledge) => [knowledge.id, knowledge])));
    }

    expect(outcome?.knowledge).toMatchObject({ name: expect.any(String), domain: expect.any(String), originRegionId: population.regionId, parentIds: expect.arrayContaining([foundations[0]!.id]) });
    expect(outcome?.knowledge.sourceIds.length).toBeGreaterThan(0);
    expect(outcome?.event).toMatchObject({ kind: "knowledge-innovation", ruleId: "culture:autonomous-innovation", payload: { knowledgeId: outcome?.knowledge.id } });
    expect(outcome?.event.evidence).toMatchObject({ domainScore: expect.any(Number), curiosity: expect.any(Number), observation: expect.any(Number) });
  });

  it("diffuses recorded knowledge only across an auditable civilization route", () => {
    const world = createWorld(312, { width: 8, height: 8, formation: "formed" });
    const firstRegion = "region:2:2" as never;
    const secondRegion = "region:3:2" as never;
    const sourceCulture = { id: "culture:source" as never, regionId: firstRegion, knowledgeIds: ["knowledge:route"], beliefIds: [], transmissionRate: 0.9 };
    const destinationCulture = { id: "culture:destination" as never, regionId: secondRegion, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8 };
    const knowledge = { id: "knowledge:route", kind: "innovation:navigation:1", name: "潮星定向法", domain: "navigation" as const, sourceIds: [], credibility: 0.9, transmissionCost: 0.12, forgettingRate: 0.01, originRegionId: firstRegion, originTick: 2, originYears: 2, parentIds: [] };
    const first = createOrganization("city", firstRegion, []);
    const second = createOrganization("city", secondRegion, []);
    first.diplomacy = { [second.id]: "trade" };
    second.diplomacy = { [first.id]: "trade" };
    world.cultures = [sourceCulture, destinationCulture];
    world.knowledge = [knowledge];
    world.organizations = [first, second];
    const culturesByRegion = new Map(world.cultures.map((culture) => [culture.regionId, culture]));
    const knowledgeById = new Map([[knowledge.id, knowledge]]);
    expect(knowledgeDiffusionRoutes({ ...world, organizations: [] })).toEqual([]);
    const route = knowledgeDiffusionRoutes(world)[0];
    expect(route).toMatchObject({ kind: "trade", strength: expect.any(Number) });

    let outcome: ReturnType<typeof attemptKnowledgeDiffusion>;
    for (let tick = 0; tick < 256 && !outcome; tick += 1) {
      world.tick = tick;
      outcome = attemptKnowledgeDiffusion(world, culturesByRegion, knowledgeById, route!);
    }

    expect(outcome).toMatchObject({ destinationCultureId: destinationCulture.id, knowledgeId: knowledge.id });
    expect(outcome?.event).toMatchObject({ kind: "knowledge-diffusion", evidence: { route: "trade", fromRegion: firstRegion, toRegion: secondRegion }, payload: { originRegionId: firstRegion } });
  });
});
