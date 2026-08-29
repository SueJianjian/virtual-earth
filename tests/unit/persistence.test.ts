import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { archiveOrganizationRecords } from "../../src/sim/society/archive.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import { validAgentGenetics } from "../../src/sim/agents/genetics.ts";
import { speciesBlueprintFor } from "../../src/sim/ecology/blueprints.ts";
import type { ArchivedSpeciesSummary } from "../../src/sim/types.ts";

describe("world persistence", () => {
  it("round-trips authoritative state and typed grids", () => {
    const world = createWorld(120, { width: 8, height: 8, enabledPackIds: ["cultivation.path"] });
    world.observation = { focusRegionId: "region:1:1" as never };
    world.worldview.phenomena = [{
      id: "phenomenon:persistence",
      packId: "cultivation.path",
      kind: "verified-principle",
      epistemicStatus: "verified",
      name: "持久化规律",
      regionId: "region:1:1" as never,
      originTick: 4,
      parentIds: [],
      causeRuleId: "test",
      evidence: {},
    }];
    world.worldview.practices = [{
      id: "practice:persistence",
      packId: "cultivation.path",
      name: "持久化训练法",
      phenomenonId: "phenomenon:persistence",
      regionId: "region:1:1" as never,
      practitionerId: "agent:persistence" as never,
      teacherId: "agent:teacher" as never,
      originTick: 5,
      lastTrainedTick: 8,
      attunement: 0.26,
      energy: 0.48,
      attempts: 6,
      failures: 2,
      status: "active",
    }];
    world.worldview.interactions = [{
      id: "worldview-interaction:persistence",
      kind: "propagation",
      sourceEntityId: "worldview:source" as never,
      targetEntityId: "worldview:target" as never,
      sourcePackId: "cultivation.path",
      targetPackId: "emergence.original-worldview",
      regionId: "region:1:1" as never,
      targetRegionId: "region:6:1" as never,
      originTick: 6,
      lastInteractionTick: 8,
      attempts: 3,
      successes: 2,
      failures: 1,
      compatibility: 0.66,
      intensity: 0.42,
      status: "active",
    }];
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.fields.elevation.values).toBeInstanceOf(Float32Array);
    expect(worldDigest(restored)).toBe(worldDigest(world));
    expect(restored.observation).toEqual({ focusRegionId: "region:1:1" });
    expect(restored.worldview.enabledPackIds).toEqual(["cultivation.path"]);
    expect(restored.worldview.practices[0]).toMatchObject({
      teacherId: "agent:teacher",
      energy: 0.48,
      attempts: 6,
      failures: 2,
    });
    expect(restored.worldview.interactions).toEqual(world.worldview.interactions);
  });

  it("rejects malformed and unsupported saves", () => {
    expect(() => deserializeWorld("not-json")).toThrow("valid JSON");
    expect(() => deserializeWorld(JSON.stringify({ schemaVersion: 2, world: {} }))).toThrow("Unsupported");
    expect(() => deserializeWorld(JSON.stringify({ schemaVersion: 1, world: {} }))).toThrow("missing required fields");
  });

  it("rejects saves with an invalid simulation clock", () => {
    const save = JSON.parse(serializeWorld(createWorld(120, { width: 8, height: 8 }))) as { world: { tick: number; years: number } };
    save.world.tick = -1;
    expect(() => deserializeWorld(JSON.stringify(save))).toThrow("missing required fields");

    save.world.tick = 0;
    save.world.years = -1;
    expect(() => deserializeWorld(JSON.stringify(save))).toThrow("invalid simulation time");
  });

  it("adds conservative lineage defaults to older region summaries", () => {
    const world = createWorld(121, { width: 8, height: 8 });
    world.lod.summaries = [summarizeRegionState(world, "region:0:0" as never, "aggregate")];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { lod: { summaries: Array<{ lineage?: unknown }> } } };
    delete legacy.world.lod.summaries[0]?.lineage;
    delete (legacy.world.lod.summaries[0] as { agentRecords?: unknown }).agentRecords;
    delete (legacy.world.lod.summaries[0] as { familyLineages?: unknown }).familyLineages;
    delete (legacy.world.lod.summaries[0] as { foodBalance?: number; foodPerAgent?: number; foodSecurity?: number }).foodBalance;
    delete (legacy.world.lod.summaries[0] as { foodBalance?: number; foodPerAgent?: number; foodSecurity?: number }).foodPerAgent;
    delete (legacy.world.lod.summaries[0] as { foodBalance?: number; foodPerAgent?: number; foodSecurity?: number }).foodSecurity;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.lod.summaries[0]?.lineage).toEqual({
      descendantCount: 0,
      generationDepth: 0,
      knowledgeCarrierCount: 0,
      knowledgeInheritanceCount: 0,
      beliefCarrierCount: 0,
      relationshipCounts: {},
    });
    expect(restored.lod.summaries[0]).toMatchObject({ foodBalance: 0, foodPerAgent: 0, foodSecurity: 0 });
    expect(restored.lod.summaries[0]?.agentRecords).toEqual([]);
  });

  it("restores a center territory for organizations from older saves", () => {
    const world = createWorld(122, { width: 8, height: 8 });
    const regionId = "region:2:3" as never;
    world.organizations = [createOrganization("city", regionId, [])];
    world.lod.summaries = [summarizeRegionState(world, regionId, "aggregate")];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { organizations: Array<{ territoryRegionIds?: unknown }>; lod: { summaries: Array<{ organizations: Array<{ territoryRegionIds?: unknown }> }> } } };
    delete legacy.world.organizations[0]?.territoryRegionIds;
    delete legacy.world.lod.summaries[0]?.organizations[0]?.territoryRegionIds;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.organizations[0]?.territoryRegionIds).toEqual([regionId]);
    expect(restored.lod.summaries[0]?.organizations[0]?.territoryRegionIds).toEqual([regionId]);
  });

  it("adds default governance and diplomacy records to organizations from older saves", () => {
    const world = createWorld(125, { width: 8, height: 8 });
    const regionId = "region:2:3" as never;
    world.organizations = [createOrganization("state", regionId, [])];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { organizations: Array<{ governance?: unknown; diplomacy?: unknown }> } };
    delete legacy.world.organizations[0]?.governance;
    delete legacy.world.organizations[0]?.diplomacy;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.organizations[0]?.governance).toMatchObject({ stability: expect.any(Number), military: expect.any(Number), taxRate: expect.any(Number) });
    expect(restored.organizations[0]?.diplomacy).toEqual({});
  });

  it("restores an empty phenomenon ledger for saves created before causal worldview records", () => {
    const world = createWorld(123, { width: 8, height: 8, enabledPackIds: ["cultivation.path"] });
    const legacy = JSON.parse(serializeWorld(world)) as { world: { worldview: { phenomena?: unknown; practices?: unknown; interactions?: unknown } } };
    delete legacy.world.worldview.phenomena;
    delete legacy.world.worldview.practices;
    delete legacy.world.worldview.interactions;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.worldview.phenomena).toEqual([]);
    expect(restored.worldview.practices).toEqual([]);
    expect(restored.worldview.interactions).toEqual([]);
    expect(restored.worldview.enabledPackIds).toEqual(["cultivation.path"]);
  });

  it("treats saves created before formation tracking as already formed planets", () => {
    const world = createWorld(124, { width: 8, height: 8, formation: "formed" });
    const legacy = JSON.parse(serializeWorld(world)) as { world: { formation?: unknown } };
    delete legacy.world.formation;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.formation).toMatchObject({ phase: "stable-crust", progress: 1, bodyCount: 1 });
  });

  it("round-trips facility assets and defaults older saves to an empty facility ledger", () => {
    const world = createWorld(126, { width: 8, height: 8, formation: "formed" });
    const owner = createOrganization("city", "region:1:1" as never, ["agent:builder" as never]);
    world.organizations = [owner];
    world.facilities = [{ id: "facility:persisted", type: "construction", regionId: owner.regionId, ownerOrganizationId: owner.id, level: 2, condition: 0.72, status: "damaged", workforceIds: owner.memberIds, materialInvested: 12, plannedTick: 2, builtTick: 4, lastMaintainedTick: 8, lastIncidentTick: 10 }];

    expect(deserializeWorld(serializeWorld(world)).facilities).toEqual(world.facilities);

    const legacy = JSON.parse(serializeWorld(world)) as { world: { facilities?: unknown } };
    delete legacy.world.facilities;
    expect(deserializeWorld(JSON.stringify(legacy)).facilities).toEqual([]);
  });

  it("round-trips emergent substances and defaults older saves to an empty ledger", () => {
    const world = createWorld(128, { width: 8, height: 8, formation: "formed" });
    world.substances = [{
      id: "substance:persisted",
      name: "澜核晶",
      kind: "crystal",
      formation: "hydrothermal",
      status: "known",
      regionId: "region:1:1" as never,
      originTick: 4,
      originYears: 4 / 365,
      parentIds: [],
      composition: { carbon: 0.3, nitrogen: 0.2, phosphorus: 0.2, organics: 0.1, oxygen: 0.2 },
      properties: { hardness: 0.82, density: 0.66, reactivity: 0.18, conductivity: 0.74, energyPotential: 0.69, biologicalAffinity: 0.22, stability: 0.88 },
      reserveCapacity: 240,
      remainingReserve: 180,
      extractedTotal: 60,
      discoveredByIds: ["agent:discoverer" as never],
      discoveryTick: 8,
      discoveryYears: 8 / 365,
    }];

    expect(deserializeWorld(serializeWorld(world)).substances).toEqual(world.substances);

    const legacy = JSON.parse(serializeWorld(world)) as { world: { substances?: Array<{ reserveCapacity?: unknown; remainingReserve?: unknown; extractedTotal?: unknown }> } };
    delete legacy.world.substances?.[0]?.reserveCapacity;
    delete legacy.world.substances?.[0]?.remainingReserve;
    delete legacy.world.substances?.[0]?.extractedTotal;
    const upgraded = deserializeWorld(JSON.stringify(legacy));
    expect(upgraded.substances[0]).toMatchObject({
      reserveCapacity: expect.any(Number),
      remainingReserve: expect.any(Number),
      extractedTotal: 0,
    });

    delete legacy.world.substances;
    expect(deserializeWorld(JSON.stringify(legacy)).substances).toEqual([]);
  });

  it("upgrades pre-blueprint species without invalidating an older world", () => {
    const world = createWorld(129, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("legacy-life", "consumer");
    world.species = [species];
    world.populations = [{ id: "population:legacy-life" as never, speciesId: species.id, regionId: "region:1:1" as never, count: 12, energy: 0.8 }];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { species: Array<{ name?: unknown; blueprint?: unknown }> } };
    delete legacy.world.species[0]?.name;
    delete legacy.world.species[0]?.blueprint;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.species[0]).toMatchObject({ name: expect.any(String), blueprint: expect.objectContaining({ noveltySignature: expect.any(String) }) });
  });

  it("round-trips genetics and deterministically upgrades older agents", () => {
    const world = createWorld(1_291, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("persisted-genetics", "consumer");
    const population = { id: "population:persisted-genetics" as never, speciesId: species.id, regionId: "region:1:1" as never, count: 32, energy: 1 };
    const agent = createAgent(population, species, 0, "persisted-genetics");
    world.species = [species];
    world.populations = [population];
    world.agents = [agent];
    world.lod.summaries = [summarizeRegionState(world, population.regionId, "aggregate")];

    expect(deserializeWorld(serializeWorld(world)).agents[0]?.genetics).toEqual(agent.genetics);

    const legacy = JSON.parse(serializeWorld(world)) as { world: { agents: Array<{ genetics?: unknown }>; lod: { summaries: Array<{ agentRecords: Array<{ genetics?: unknown }> }> } } };
    delete legacy.world.agents[0]?.genetics;
    delete legacy.world.lod.summaries[0]?.agentRecords[0]?.genetics;
    const first = deserializeWorld(JSON.stringify(legacy));
    const second = deserializeWorld(JSON.stringify(legacy));

    expect(validAgentGenetics(first.agents[0]?.genetics)).toBe(true);
    expect(validAgentGenetics(first.lod.summaries[0]?.agentRecords[0]?.genetics)).toBe(true);
    expect(second.agents[0]?.genetics).toEqual(first.agents[0]?.genetics);
  });

  it("restores deterministic cultural identities for older cultural records", () => {
    const world = createWorld(130, { width: 8, height: 8, formation: "formed" });
    const regionId = "region:2:3" as never;
    world.cultures = [{ id: "culture:legacy" as never, regionId, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8 }];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { cultures: Array<{ identity?: unknown }> } };
    delete legacy.world.cultures[0]?.identity;

    const first = deserializeWorld(JSON.stringify(legacy));
    const second = deserializeWorld(JSON.stringify(legacy));

    expect(first.cultures[0]?.identity).toMatchObject({ originRegionId: regionId, name: expect.any(String), noveltySignature: expect.any(String) });
    expect(second.cultures[0]?.identity).toEqual(first.cultures[0]?.identity);
  });

  it("restores a bounded event archive for saves created before history compaction", () => {
    const world = createWorld(127, { width: 8, height: 8, formation: "formed" });
    world.events = [{
      id: "event:legacy-history",
      tick: 3,
      years: 3,
      kind: "legacy-history",
      ruleId: "test",
      source: "natural",
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: {},
      payload: {},
    }];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { eventArchive?: unknown } };
    delete legacy.world.eventArchive;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.eventArchive).toMatchObject({ totalEventCount: 1, archivedEventCount: 0, firstEventTick: 3, latestEventTick: 3 });
    expect(restored.eventArchive.kindCounts).toEqual({});
    expect(restored.eventArchive.archivedSpeciesCount).toBe(0);
    expect(restored.eventArchive.archivedKnowledgeCount).toBe(0);
    expect(restored.eventArchive.archivedCultureCount).toBe(0);
    expect(restored.eventArchive.archivedRelationshipCount).toBe(0);
    expect(restored.eventArchive.archivedSpeciesRoleCounts).toEqual({});
    expect(restored.eventArchive.archivedSpeciesSummaries).toEqual([]);
    expect(restored.eventArchive.archivedOrganizationCount).toBe(0);
    expect(restored.eventArchive.archivedOrganizationSummaries).toEqual([]);
  });

  it("round-trips bounded extinct species history with exact archive time", () => {
    const world = createWorld(1_283, { width: 8, height: 8, formation: "formed" });
    const species = createSpecies("archived-persistence", "consumer", "species:ancestor" as never, {
      regionId: "region:2:3" as never,
      tick: 18,
      years: 18 / 365,
      timelineStep: "18",
    });
    const summary: ArchivedSpeciesSummary = {
      id: species.id,
      name: species.name!,
      role: species.role,
      traits: { ...species.traits },
      parentId: species.parentId!,
      originRegionId: species.originRegionId!,
      originTick: species.originTick!,
      originTimelineStep: species.originTimelineStep!,
      originYears: species.originYears!,
      blueprint: speciesBlueprintFor(species),
      lastKnownPopulation: 42,
      lastKnownRegionIds: ["region:2:3" as never],
      archivedTick: 720,
      archivedTimelineStep: "720",
      archivedTimelineDays: "720",
      archivedYears: 720 / 365,
    };
    world.eventArchive.archivedSpeciesSummaries = [summary];

    const restored = deserializeWorld(serializeWorld(world));

    expect(restored.eventArchive.archivedSpeciesSummaries).toEqual([summary]);
  });

  it("round-trips bounded historical organization summaries", () => {
    const world = createWorld(1_284, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("city", "region:2:3" as never, ["agent:one", "agent:two"]);
    organization.status = "collapsed";
    organization.resources = { food: 6.5, energy: 1.75 };
    organization.governance!.lastConflictTimelineStep = "17";
    archiveOrganizationRecords(world, [organization], "lifecycle");

    const restored = deserializeWorld(serializeWorld(world));

    expect(restored.eventArchive.archivedOrganizationCount).toBe(1);
    expect(restored.eventArchive.archivedOrganizationSummaries).toEqual(world.eventArchive.archivedOrganizationSummaries);
  });

  it("round-trips causal event milestones without restoring the hot ledger", () => {
    const world = createWorld(128, { width: 8, height: 8, formation: "formed" });
    world.eventArchive.milestones = [{
      id: "event:milestone:persistence",
      tick: 42,
      years: 42,
      kind: "substance-discovery",
      ruleId: "environment:substance-discovery",
      source: "natural",
      sourceIds: ["agent:discoverer"],
      regionIds: ["region:1:1" as never],
      organizationIds: [],
      probability: 0.8,
      roll: 0.2,
      details: { name: "曜凝复晶", substanceId: "substance:1", intensity: 0.4 },
    }];
    world.events = [];

    const restored = deserializeWorld(serializeWorld(world));

    expect(restored.events).toEqual([]);
    expect(restored.eventArchive.milestones).toEqual(world.eventArchive.milestones);
  });

  it("round-trips bounded long-term history samples", () => {
    const world = createWorld(1_281, { width: 8, height: 8, formation: "formed" });
    world.eventArchive.historySamples = [{
      tick: 365,
      years: 1,
      timelineStep: "365",
      timelineDays: "365",
      meanTemperature: 0.5,
      oceanCoverage: 0.4,
      biomass: 0.2,
      oxygen: 0.1,
      organics: 0.05,
      populationCount: 12,
      speciesCount: 2,
      organizationCount: 1,
      facilityCount: 1,
      knowledgeCount: 3,
      foodSecurity: 0.8,
      diseasePrevalence: 0.02,
    }];

    const restored = deserializeWorld(serializeWorld(world));

    expect(restored.eventArchive.historySamples).toEqual(world.eventArchive.historySamples);
  });

  it("round-trips an exact timeline beyond JavaScript safe integers", () => {
    const world = createWorld(1_292, { width: 8, height: 8, formation: "formed" });
    world.timeline = {
      step: "9007199254740992",
      days: "9007199254740993",
    };
    world.tick = Number.MAX_SAFE_INTEGER;
    world.simulationDays = Number.MAX_SAFE_INTEGER;
    world.years = Number.MAX_SAFE_INTEGER / 365;

    const restored = deserializeWorld(serializeWorld(world));

    expect(restored.timeline).toEqual(world.timeline);
    expect(worldDigest(restored)).toBe(worldDigest(world));
  });
});
