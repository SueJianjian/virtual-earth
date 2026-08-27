import { describe, expect, it } from "vitest";
import { registerSimulationStage, stepWorld } from "../../src/sim/engine.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { originalEmergence } from "../../src/sim/worldview/packs/original-emergence.ts";
import type { WorldDelta, WorldviewContext } from "../../src/sim/types.ts";

const addFoundationalKnowledge = (state: ReturnType<typeof createWorld>, regionId: ReturnType<typeof createWorld>["cultures"][number]["regionId"]): string[] => {
  const ids = ["knowledge:one", "knowledge:two", "knowledge:three", "knowledge:four"];
  state.knowledge = ids.map((id, index) => ({
    id,
    kind: `practice:observation:${index}`,
    sourceIds: [],
    credibility: 0.7,
    transmissionCost: 0.1,
    forgettingRate: 0.001,
    originRegionId: regionId,
    originTick: 0,
    originYears: 0,
  }));
  return ids;
};

describe("worldview autonomy integration", () => {
  it("does not create supernatural entities from an ineligible blank world", () => {
    const state = createWorld(110, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"] });
    const result = stepWorld(state, { elapsedYears: 100, externalEvents: [] });
    expect(result.state.worldview.entities).toEqual([]);
    expect(worldDigest(result.state)).toBe(result.digest);
  });

  it("places emergent worldview entities in a real active region", () => {
    const packs = ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"];
    let state = createWorld(123, { width: 16, height: 8, enabledPackIds: packs, formation: "formed" });
    for (let index = 0; index < 1_200; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    expect(state.worldview.entities.length).toBeGreaterThan(0);
    expect(state.worldview.discoveredRuleIds.length).toBeGreaterThan(0);
    expect(state.worldview.entities.every((entity) => /^region:\d+:\d+$/.test(entity.regionId))).toBe(true);
    expect(state.worldview.entities.some((entity) => entity.regionId === "region:origin")).toBe(false);
  }, 45_000);

  it("builds original observations, theories, myths and verified principles through a traceable chain", () => {
    const regionId = "region:3:2" as never;
    let state = createWorld(321, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"], formation: "formed" });
    state.species = [{ id: "species:observer" as never, role: "consumer", traits: { cognitivePotential: 0.8 } }];
    state.populations = [{ id: "population:observer" as never, speciesId: state.species[0]!.id, regionId, count: 24, energy: 1 }];
    const knowledgeIds = addFoundationalKnowledge(state, regionId);
    state.cultures = [{
      id: "culture:observer" as never,
      regionId,
      knowledgeIds,
      beliefIds: [],
      transmissionRate: 0.8,
    }];

    for (let index = 0; index < 400 && state.worldview.phenomena.length < 4; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    const records = state.worldview.phenomena;
    expect(records.map((record) => record.epistemicStatus).sort()).toEqual(["believed", "hypothesized", "observed", "verified"]);
    const byId = new Map(records.map((record) => [record.id, record]));
    expect(records.filter((record) => record.epistemicStatus !== "observed").every((record) => record.parentIds.length > 0)).toBe(true);
    expect(records.every((record) => record.parentIds.every((id) => (byId.get(id)?.originTick ?? Infinity) < record.originTick))).toBe(true);
    const myth = records.find((record) => record.epistemicStatus === "believed");
    const verified = records.find((record) => record.epistemicStatus === "verified");
    expect(verified?.parentIds).toContain(myth?.id);
    expect(state.cultures[0]?.beliefIds.some((id) => id.startsWith("belief:phenomenon:"))).toBe(true);
    expect(records.every((record) => record.regionId === regionId)).toBe(true);
  }, 15_000);

  it("allows a qualified practitioner to transmit training from a verified principle", () => {
    const regionId = "region:2:2" as never;
    let state = createWorld(654, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"], formation: "formed" });
    const species = createSpecies("attuned", "consumer");
    species.traits.cognitivePotential = 1;
    const population = { id: "population:attuned" as never, speciesId: species.id, regionId, count: 12, energy: 1 };
    const teacher = createAgent(population, species, 0, "teacher");
    const student = createAgent(population, species, 1, "student");
    teacher.traits.cognitivePotential = 1;
    student.traits.cognitivePotential = 0.95;
    teacher.skills.observation = 0.9;
    student.skills.observation = 0.8;
    state.species = [species];
    state.populations = [population];
    state.agents = [teacher, student];
    state.cultures = [{ id: "culture:attuned" as never, regionId, knowledgeIds: addFoundationalKnowledge(state, regionId), beliefIds: [], transmissionRate: 0.8 }];
    state.worldview.phenomena = [{
      id: "phenomenon:verified",
      packId: "emergence.original-worldview",
      kind: "verified-principle",
      epistemicStatus: "verified",
      name: "云纤耦合规律",
      regionId,
      originTick: 1,
      parentIds: [],
      causeRuleId: "test",
      evidence: { anomalyStrength: 0.9 },
    }];
    state.worldview.practices = [{
      id: "practice:teacher",
      packId: "emergence.original-worldview",
      name: "映云共鸣法",
      phenomenonId: "phenomenon:verified",
      regionId,
      practitionerId: teacher.id,
      originTick: 1,
      lastTrainedTick: 1,
      attunement: 0.24,
      energy: 0.6,
      attempts: 0,
      failures: 0,
      status: "active",
    }];

    for (let index = 0; index < 100 && state.worldview.practices.length < 2; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    const transmitted = state.worldview.practices.find((practice) => practice.practitionerId === student.id);
    expect(transmitted).toMatchObject({ teacherId: teacher.id, phenomenonId: "phenomenon:verified", status: "active" });
    expect(state.worldview.practices.find((practice) => practice.practitionerId === teacher.id)?.attempts).toBeGreaterThan(0);
    expect(state.relationships).toContainEqual(expect.objectContaining({ kind: "teacher", fromId: teacher.id, toId: student.id }));
    expect(state.events.some((event) => event.kind === "worldview-original-practice-begin" && event.payload.practiceOrigin === "transmission")).toBe(true);
  }, 15_000);

  it("propagates an observed belief through a real interregional contact", () => {
    const sourceRegion = "region:2:2" as never;
    const destinationRegion = "region:3:2" as never;
    const state = createWorld(655, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"], formation: "formed" });
    const sourceCulture = { id: "culture:source" as never, regionId: sourceRegion, knowledgeIds: [], beliefIds: ["belief:phenomenon:source"], transmissionRate: 0.8 };
    const destinationCulture = { id: "culture:destination" as never, regionId: destinationRegion, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8 };
    state.cultures = [sourceCulture, destinationCulture];
    state.worldview.phenomena = [{
      id: "phenomenon:source",
      packId: "emergence.original-worldview",
      kind: "mythic-tradition",
      epistemicStatus: "believed",
      name: "source-belief",
      regionId: sourceRegion,
      originTick: 1,
      parentIds: [],
      causeRuleId: "test",
      evidence: {},
    }];
    const source = createOrganization("city", sourceRegion, []);
    const destination = createOrganization("city", destinationRegion, []);
    source.diplomacy = { [destination.id]: "allied" };
    destination.diplomacy = { [source.id]: "allied" };
    state.organizations = [source, destination];
    state.events = [{
      id: "event:alliance",
      tick: 1,
      years: 1,
      kind: "diplomatic-alliance",
      ruleId: "test",
      source: "natural",
      sourceIds: [source.id, destination.id],
      probability: 1,
      roll: 0,
      evidence: { fromRegion: sourceRegion, toRegion: destinationRegion },
      payload: { leftOrganizationId: source.id, rightOrganizationId: destination.id },
    }];

    const rule = originalEmergence.rules.find((candidate) => candidate.id === "original-belief-propagation");
    if (!rule) throw new Error("Expected belief propagation rule");
    const context: WorldviewContext = {
      state,
      random: state.random,
      tick: state.tick,
      years: state.years,
      enabledPackIds: state.worldview.enabledPackIds,
      metrics: {} as never,
    };
    expect(rule.evaluate(context)).toMatchObject({ eligible: true, evidence: { route: "alliance" } });
    const outcome = rule.apply(context);
    if (outcome.status !== "applied" || !outcome.value || outcome.value.kind !== "propagate-belief") throw new Error("Expected belief propagation effect");
    const delta: WorldDelta = {
      fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [],
      worldviewEffects: [outcome.value],
      eventDrafts: [{
        kind: "worldview-original-belief-propagation",
        ruleId: rule.id,
        sourceIds: outcome.value.sourceIds,
        probability: 1,
        roll: 0,
        evidence: { ...rule.evaluate(context).evidence, eligible: true, packId: "emergence.original-worldview" },
        payload: { beliefId: outcome.value.beliefId, regionId: outcome.value.regionId, route: "alliance", strength: outcome.value.strength },
        source: "natural",
      }],
    };
    registerSimulationStage({ id: "belief-propagation-test", order: 69, run: () => delta });
    const result = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false });

    expect(result.state.cultures.find((culture) => culture.id === destinationCulture.id)?.beliefIds).toContain("belief:phenomenon:source");
    expect(result.events.some((event) => event.kind === "worldview-original-belief-propagation")).toBe(true);
    expect(result.events.find((event) => event.kind === "worldview-original-belief-propagation")?.payload).toMatchObject({
      beliefId: "belief:phenomenon:source",
      regionId: destinationRegion,
      route: "alliance",
    });
  });
});
