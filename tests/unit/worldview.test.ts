import { describe, expect, it, beforeEach } from "vitest";
import { clearSimulationStages, registerSimulationStage, stepWorld } from "../../src/sim/engine.ts";
import { createWorld, assertBlankWorld, isFiniteWorld } from "../../src/sim/world.ts";
import { createWorldviewState, DEFAULT_WORLDVIEW_PACK_IDS, listWorldviewPacks, stepWorldviews } from "../../src/sim/worldview/index.ts";
import { regionIdForWorldview } from "../../src/sim/worldview/rules.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import type { WorldDelta, WorldviewContext } from "../../src/sim/types.ts";
import { originalEmergence } from "../../src/sim/worldview/packs/original-emergence.ts";

const highContext = (state: ReturnType<typeof createWorld>): WorldviewContext => ({
  state,
  random: state.random,
  enabledPackIds: state.worldview.enabledPackIds,
  metrics: {
    meanTemperature: 0.5, meanHumidity: 0.6, waterCoverage: 0.4, nutrientLevel: 0.5, biomass: 0.3, oxygen: 0.1,
    carbon: 0.2, organics: 0.1, oceanCoverage: 0.4, terrainRelief: 0.1,
    populationCount: 80, cognitivePotential: 4, knowledgeDiversity: 5, beliefDiversity: 0, householdCount: 4, settlementDensity: 2,
    tradeVolume: 0, foodSurplus: 0, organizationCapacity: 20, resourceBalance: 0,
    foodSecurity: 0,
  },
});

describe("worldview packs", () => {
  beforeEach(() => clearSimulationStages());

  it("registers the original emergence pack alongside optional legacy motifs without seeding records", () => {
    const packs = listWorldviewPacks();
    expect(packs.map((pack) => pack.id)).toEqual([
      "cultivation.path",
      "emergence.original-worldview",
      "mythology.chinese-motif",
      "mythology.greek-motif",
      "mythology.indian-motif",
      "mythology.norse-motif",
    ]);
    const world = createWorld(100, { width: 8, height: 8, enabledPackIds: packs.map((pack) => pack.id) });
    expect(world.worldview.enabledPackIds).toEqual(packs.map((pack) => pack.id));
    expect(DEFAULT_WORLDVIEW_PACK_IDS).toEqual(["emergence.original-worldview"]);
    expect(() => assertBlankWorld(world)).not.toThrow();
    expect(world.resources).toEqual([]);
    expect(world.worldview.phenomena).toEqual([]);
  });

  it("returns only constrained effects and is deterministic for the same state", () => {
    const first = createWorld(101, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"] });
    const second = structuredClone(first);
    const firstDelta = stepWorldviews(first, highContext(first));
    const secondDelta = stepWorldviews(second, highContext(second));
    expect(firstDelta).toEqual(secondDelta);
    expect(firstDelta.worldviewEffects.every((effect) => "kind" in effect)).toBe(true);
    expect(firstDelta.worldviewEffects.every((effect) => effect.kind !== "propose-entity" || effect.evidence.eligible === true)).toBe(true);
  });

  it("derives a deterministic real region instead of a synthetic origin", () => {
    const world = createWorld(101, { width: 8, height: 8 });
    world.populations = [{ id: "population:region" as never, speciesId: "species:region" as never, regionId: "region:3:2" as never, count: 12, energy: 1 }];
    const first = regionIdForWorldview({ ...highContext(world), state: world });
    const second = regionIdForWorldview({ ...highContext(world), state: structuredClone(world) });
    expect(first).toBe("region:3:2");
    expect(second).toBe(first);
    expect(first).not.toBe("region:origin");
  });

  it("forms a worldview entity only through enabled-pack reducer validation", () => {
    const world = createWorld(102, { width: 8, height: 8, enabledPackIds: ["cultivation.path"] });
    const delta: WorldDelta = {
      fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [],
      worldviewEffects: [{ kind: "propose-entity", packId: "cultivation.path", entityKind: "cultivation-path", regionId: "region:origin" as never, evidence: { eligible: true }, probability: 0.1 }],
    };
    registerSimulationStage({ id: "worldview-test", order: 1, run: () => delta });
    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });
    expect(result.state.worldview.entities).toHaveLength(1);
    expect(result.state.worldview.entities[0]?.kind).toBe("cultivation-path");
  });

  it("generates cross-pack contact from active entities in one real region", () => {
    const regionId = "region:2:2" as never;
    let found: ReturnType<typeof stepWorldviews> | undefined;
    for (let seed = 1; seed <= 256 && !found; seed += 1) {
      const world = createWorld(seed, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif"], formation: "formed" });
      world.populations = [{ id: `population:contact:${seed}` as never, speciesId: "species:contact" as never, regionId, count: 48, energy: 1 }];
      world.worldview.entities = [{
        id: `worldview:contact-source:${seed}` as never,
        packId: "cultivation.path",
        kind: "cultivation-path",
        name: "潮息路径",
        regionId,
        influence: 0.72,
        resourceBalances: {},
        status: "active",
      }, {
        id: `worldview:contact-target:${seed}` as never,
        packId: "mythology.chinese-motif",
        kind: "deity",
        name: "回环神话",
        regionId,
        influence: 0.68,
        resourceBalances: {},
        status: "active",
      }];
      const delta = stepWorldviews(world, highContext(world));
      if (delta.worldviewEffects.some((effect) => effect.kind === "interact-entities")) found = delta;
    }

    expect(found?.worldviewEffects.some((effect) => effect.kind === "interact-entities")).toBe(true);
    expect(found?.eventDrafts.some((event) => event.kind.startsWith("worldview-cross-pack-") && event.sourceIds.length === 2)).toBe(true);
  });

  it("applies conflict, propagation, and fusion as bounded reducer effects", () => {
    const regionId = "region:3:2" as never;
    const makeWorld = () => {
      const world = createWorld(1_308, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif"], formation: "formed" });
      world.worldview.entities = [{ id: "worldview:source" as never, packId: "cultivation.path", kind: "cultivation-path", name: "源路径", regionId, influence: 0.7, resourceBalances: {}, status: "active" }, { id: "worldview:target" as never, packId: "mythology.chinese-motif", kind: "deity", name: "目标神话", regionId, influence: 0.6, resourceBalances: {}, status: "active" }];
      return world;
    };
    const run = (interaction: "conflict" | "propagation" | "fusion") => {
      const world = makeWorld();
      registerSimulationStage({
        id: `worldview-${interaction}-test`,
        order: 1,
        run: () => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [], worldviewEffects: [{ kind: "interact-entities", packId: "cultivation.path", interaction, sourceEntityId: "worldview:source" as never, targetEntityId: "worldview:target" as never, regionId, probability: 1, compatibility: interaction === "fusion" ? 0.9 : 0.3, intensity: 0.8, evidence: { eligible: true } }] }),
      });
      return stepWorld(world, { elapsedYears: 0, externalEvents: [] }, { computeDigest: false }).state;
    };

    const conflict = run("conflict");
    expect(conflict.worldview.interactions[0]).toMatchObject({ kind: "conflict", attempts: 1, successes: 1 });
    expect(conflict.worldview.entities.find((entity) => entity.id === "worldview:target")?.influence).toBeLessThan(0.6);

    clearSimulationStages();
    const propagation = run("propagation");
    expect(propagation.worldview.interactions[0]).toMatchObject({ kind: "propagation", attempts: 1, successes: 1 });
    expect(propagation.worldview.entities.find((entity) => entity.id === "worldview:target")?.influence).toBeGreaterThan(conflict.worldview.entities.find((entity) => entity.id === "worldview:target")?.influence ?? 0);

    clearSimulationStages();
    const fusion = run("fusion");
    const fusionEntity = fusion.worldview.entities.find((entity) => entity.derivedFromEntityIds?.length === 2);
    expect(fusion.worldview.interactions[0]).toMatchObject({ kind: "fusion", status: "resolved", fusionEntityId: fusionEntity?.id });
    expect(fusionEntity).toMatchObject({ derivedFromPackIds: ["cultivation.path", "mythology.chinese-motif"], regionId, fusionCount: 1 });
    expect(isFiniteWorld(fusion)).toBe(true);
  });

  it("deduplicates a worldview entity by pack, kind, and region across repeated evidence", () => {
    let world = createWorld(105, { width: 8, height: 8, enabledPackIds: ["cultivation.path"] });
    let evidence = 0.2;
    registerSimulationStage({
      id: "worldview-repeat",
      order: 1,
      run: () => ({
        fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [],
        worldviewEffects: [{ kind: "propose-entity", packId: "cultivation.path", entityKind: "cultivation-path", regionId: "region:1:1" as never, evidence: { eligible: true, strength: evidence }, probability: 1 }],
      }),
    });

    world = stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    evidence = 0.8;
    world = stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;

    expect(world.worldview.entities).toHaveLength(1);
  });

  it("retires practices and personal energy after the practitioner leaves the live simulation", () => {
    const world = createWorld(106, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"] });
    world.worldview.practices = [{
      id: "practice:orphaned",
      packId: "emergence.original-worldview",
      name: "orphaned",
      phenomenonId: "phenomenon:old",
      regionId: "region:1:1" as never,
      practitionerId: "agent:departed" as never,
      originTick: 1,
      lastTrainedTick: 2,
      attunement: 0.3,
      energy: 0.2,
      attempts: 3,
      failures: 1,
      status: "active",
    }];
    world.resources = [{ id: "resource:orphaned-energy", resourceId: "attunement-energy", regionId: "region:1:1" as never, holderId: "agent:departed", amount: 1, cap: 2, originEventId: "test" }];

    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false });

    expect(result.state.worldview.practices).toEqual([]);
    expect(result.state.resources).toEqual([]);
  });

  it("records energy consumption and a setback instead of silently granting progress", () => {
    const regionId = "region:1:1" as never;
    const world = createWorld(103, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"] });
    const species = createSpecies("practice", "consumer");
    const population = { id: "population:practice" as never, speciesId: species.id, regionId, count: 8, energy: 1 };
    const agent = createAgent(population, species, 0, "practice");
    world.species = [species];
    world.populations = [population];
    world.agents = [agent];
    world.worldview.phenomena = [{
      id: "phenomenon:principle",
      packId: "emergence.original-worldview",
      kind: "verified-principle",
      epistemicStatus: "verified",
      name: "晶息响应定律",
      regionId,
      originTick: 1,
      parentIds: [],
      causeRuleId: "test",
      evidence: {},
    }];
    world.worldview.practices = [{
      id: "practice:one",
      packId: "emergence.original-worldview",
      name: "析晶训练法",
      phenomenonId: "phenomenon:principle",
      regionId,
      practitionerId: agent.id,
      originTick: 1,
      lastTrainedTick: 1,
      attunement: 0.1,
      energy: 0.2,
      attempts: 0,
      failures: 0,
      status: "active",
    }];
    const delta: WorldDelta = {
      fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [],
      worldviewEffects: [{
        kind: "train-practice",
        packId: "emergence.original-worldview",
        practiceId: "practice:one",
        outcome: "setback",
        energyGain: 0.02,
        energySpent: 0.11,
        attunementDelta: -0.012,
        evidence: { trainingRoll: 0.9 },
      }],
    };
    registerSimulationStage({ id: "worldview", order: 70, run: () => delta });

    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });

    const practice = result.state.worldview.practices[0];
    expect(practice?.energy).toBeCloseTo(0.11);
    expect(practice?.attunement).toBeCloseTo(0.088);
    expect(practice).toMatchObject({ attempts: 1, failures: 1, status: "active" });
  });

  it("routes verified-principle training through a sponsoring organization's energy ledger", () => {
    const regionId = "region:2:2" as never;
    const world = createWorld(104, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"] });
    const species = createSpecies("sponsored-practice", "consumer");
    species.traits.cognitivePotential = 1;
    const population = { id: "population:sponsored-practice" as never, speciesId: species.id, regionId, count: 32, energy: 1 };
    const practitioner = createAgent(population, species, 0, "sponsored-practice");
    practitioner.skills.observation = 0.9;
    const city = createOrganization("city", regionId, [practitioner.id]);
    city.governance = { ...city.governance!, publicGoods: 0.8, cohesion: 0.7, stability: 0.7 };
    world.species = [species];
    world.populations = [population];
    world.agents = [practitioner];
    world.organizations = [city];
    world.worldview.phenomena = [{
      id: "phenomenon:sponsored-principle",
      packId: "emergence.original-worldview",
      kind: "verified-principle",
      epistemicStatus: "verified",
      name: "潮痕响应定律",
      regionId,
      originTick: 1,
      parentIds: [],
      causeRuleId: "test",
      evidence: { anomalyStrength: 0.8 },
    }];
    world.worldview.practices = [{
      id: "practice:sponsored",
      packId: "emergence.original-worldview",
      name: "观潮训练法",
      phenomenonId: "phenomenon:sponsored-principle",
      regionId,
      practitionerId: practitioner.id,
      organizationId: city.id,
      originTick: 1,
      lastTrainedTick: 1,
      attunement: 0.2,
      energy: 0.6,
      attempts: 0,
      failures: 0,
      status: "active",
    }];

    const delta = stepWorldviews(world, highContext(world));
    const training = delta.worldviewEffects.find((effect) => effect.kind === "train-practice");
    expect(training).toMatchObject({ organizationId: city.id, resourceId: "attunement-energy", resourceHolderId: city.id });
    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({ operation: "mint", resourceId: "attunement-energy", toHolderId: city.id }));
    expect(delta.resourceTransactions).toContainEqual(expect.objectContaining({ operation: "consume", resourceId: "attunement-energy", fromHolderId: city.id }));

    const initialCohesion = city.governance!.cohesion;
    registerSimulationStage({
      id: "worldview",
      order: 70,
      run: () => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], ...delta }),
    });
    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });
    const reserve = result.state.resources.find((resource) => resource.resourceId === "attunement-energy" && resource.holderId === city.id);

    expect(reserve?.amount).toBeGreaterThan(0);
    expect(result.state.worldview.practices[0]).toMatchObject({ attempts: 1 });
    expect(result.state.organizations[0]?.governance?.cohesion).not.toBe(initialCohesion);
  });

  it("forms and retires an original practice institution from a real teacher lineage", () => {
    const regionId = "region:3:3" as never;
    let world = createWorld(107, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"], formation: "formed" });
    const species = createSpecies("institution", "consumer");
    species.traits.cognitivePotential = 1;
    const population = { id: "population:institution" as never, speciesId: species.id, regionId, count: 24, energy: 1 };
    const teacher = createAgent(population, species, 0, "institution-teacher");
    const students = [createAgent(population, species, 1, "institution-student"), createAgent(population, species, 2, "institution-student")];
    const sponsor = createOrganization("city", regionId, [teacher.id, ...students.map((student) => student.id)]);
    world.species = [species];
    world.populations = [population];
    world.agents = [teacher, ...students];
    world.organizations = [sponsor];
    world.worldview.phenomena = [{
      id: "phenomenon:institution",
      packId: "emergence.original-worldview",
      kind: "verified-principle",
      epistemicStatus: "verified",
      name: "岩息响应定律",
      regionId,
      originTick: 1,
      parentIds: [],
      causeRuleId: "test",
      evidence: { anomalyStrength: 0.8 },
    }];
    const institutionPractices = [teacher, ...students].map((agent, index) => ({
      id: `practice:institution:${index}`,
      packId: "emergence.original-worldview",
      name: "听岩共鸣法",
      phenomenonId: "phenomenon:institution",
      regionId,
      practitionerId: agent.id,
      ...(index > 0 ? { teacherId: teacher.id } : {}),
      organizationId: sponsor.id,
      originTick: index + 2,
      lastTrainedTick: 4,
      attunement: 0.18 - index * 0.02,
      energy: 0.5,
      attempts: 3,
      failures: 0,
      status: "active" as const,
    }));
    world.worldview.practices = institutionPractices;
    const rule = originalEmergence.rules.find((candidate) => candidate.id === "original-practice-institution");
    if (!rule) throw new Error("Expected institution rule");
    const context = highContext(world);
    expect(rule.evaluate(context)).toMatchObject({ eligible: true, evidence: { practitionerCount: 3, teacherLinks: 2 } });
    const outcome = rule.apply(context);
    if (outcome.status !== "applied" || !outcome.value) throw new Error("Expected institution effect");
    expect(outcome.value).toMatchObject({ kind: "propose-entity", entityKind: "sect", founderId: teacher.id, sponsorOrganizationId: sponsor.id });

    registerSimulationStage({
      id: "institution-test",
      order: 1,
      run: () => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [], worldviewEffects: [outcome.value!] }),
    });
    world = stepWorld(world, { elapsedYears: 0, externalEvents: [] }, { computeDigest: false }).state;
    expect(world.worldview.entities[0]).toMatchObject({
      kind: "sect",
      name: expect.stringMatching(/研修会|观测院|共鸣社|循证流派/),
      founderId: teacher.id,
      memberIds: [teacher.id, ...students.map((student) => student.id)].sort(),
      status: "active",
    });

    world.agents = [teacher];
    world = stepWorld(world, { elapsedYears: 0, externalEvents: [] }, { computeDigest: false }).state;
    expect(world.worldview.entities[0]).toMatchObject({
      memberIds: [teacher.id],
      status: "dormant",
      activePractitionerCount: 1,
      dormantSinceTick: world.tick,
    });
    expect(world.events.some((event) => event.kind === "worldview-entity-dormant")).toBe(true);

    world.agents = [teacher, ...students];
    world.worldview.practices.push(...institutionPractices.slice(1));
    const revived = stepWorld(world, { elapsedYears: 0, externalEvents: [] }, { computeDigest: false });
    world = revived.state;

    expect(world.worldview.entities[0]).toMatchObject({
      memberIds: [teacher.id, ...students.map((student) => student.id)].sort(),
      status: "active",
      activePractitionerCount: 3,
      revivalCount: 1,
      lastActiveTick: world.tick,
    });
    expect(revived.events.some((event) => event.kind === "worldview-entity-revived")).toBe(true);
  });
});
