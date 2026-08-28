import { describe, expect, it, beforeEach } from "vitest";
import { AUTOSAVE_INTERVAL_STEPS, createSimulationRuntime, MAX_SCENE_STRATEGIC_LINKS, RECENT_REGION_EVENT_LIMIT } from "../../src/worker/runtime.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { clearSimulationStages, registerSimulationStage } from "../../src/sim/engine.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createCultureIdentity } from "../../src/sim/culture/identity.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { DAYS_PER_YEAR, MAX_SIMULATION_DAYS, MAX_SIMULATION_YEARS, SIMULATED_YEARS_PER_DAY } from "../../src/sim/time.ts";
import { snapshotTransferables } from "../../src/worker/transfer.ts";
import { derivePathogen } from "../../src/sim/health/disease.ts";

describe("simulation worker runtime", () => {
  beforeEach(() => clearSimulationStages());

  it("steps deterministically and remains unchanged while paused", () => {
    const runtime = createSimulationRuntime(createWorld(130, { width: 8, height: 8 }));
    runtime.dispatch({ type: "step", count: 1 });
    runtime.dispatch({ type: "pause" });
    const digest = worldDigest(runtime.getState());
    runtime.dispatch({ type: "pause" });
    expect(worldDigest(runtime.getState())).toBe(digest);
    expect(runtime.isPaused()).toBe(true);
  });

  it("advances one simulated day per runtime step", () => {
    const runtime = createSimulationRuntime(createWorld(143, { width: 8, height: 8 }));
    runtime.dispatch({ type: "step", count: 1 });
    expect(runtime.getState().tick).toBe(1);
    expect(runtime.getState().years).toBeCloseTo(SIMULATED_YEARS_PER_DAY, 12);
    runtime.dispatch({ type: "step", count: 364 });
    expect(runtime.getState().years).toBeCloseTo(1, 12);
  });

  it("reports bounded runtime diagnostics after stepping", () => {
    const runtime = createSimulationRuntime(createWorld(146, { width: 8, height: 8 }));
    const messages = runtime.dispatch({ type: "step", count: 2 });
    const snapshot = messages.find((message) => message.type === "snapshot");

    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot") return;
    expect(snapshot.snapshot.runtime).toMatchObject({ measuredSteps: 2, hotEventCount: expect.any(Number), archivedEventCount: expect.any(Number), milestoneCount: expect.any(Number) });
    expect(snapshot.snapshot.runtime?.lastStepMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.snapshot.runtime?.averageStepMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.snapshot.runtime?.peakStepMs).toBeGreaterThanOrEqual(snapshot.snapshot.runtime?.lastStepMs ?? 0);
  });

  it("exposes bounded annual history samples through worker snapshots", () => {
    const runtime = createSimulationRuntime(createWorld(152, { width: 8, height: 8, formation: "formed" }));
    const messages = runtime.dispatch({ type: "step", count: 365 });
    const snapshot = messages.find((message) => message.type === "snapshot");

    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot") return;
    expect(snapshot.snapshot.historySamples).toHaveLength(1);
    expect(snapshot.snapshot.historySamples?.[0]).toMatchObject({ timelineDays: "365", timelineStep: "365" });
    expect(snapshot.snapshot.historySamples).toEqual(snapshot.snapshot.eventArchive?.historySamples);
  });

  it("emits a checkpoint with the newest exact timeline at a bounded interval", () => {
    const runtime = createSimulationRuntime(createWorld(153, { width: 8, height: 8, formation: "formed" }));
    runtime.dispatch({ type: "step", count: AUTOSAVE_INTERVAL_STEPS });
    const checkpoint = runtime.dispatch({ type: "checkpoint" })[0];

    expect(checkpoint?.type).toBe("autosaved");
    if (checkpoint?.type !== "autosaved") return;
    expect(checkpoint.timelineDays).toBe(String(AUTOSAVE_INTERVAL_STEPS));
    expect(JSON.parse(checkpoint.payload)).toMatchObject({ schemaVersion: 1, world: { tick: AUTOSAVE_INTERVAL_STEPS } });
  });

  it("continues through repeated pause, resume, autosave, and restore cycles", () => {
    let runtime = createSimulationRuntime(createWorld(154, {
      width: 8,
      height: 8,
      formation: "formed",
      enabledPackIds: ["emergence.original-worldview"],
    }));
    let expectedTimelineDays = 0;

    for (let cycle = 0; cycle < 12; cycle += 1) {
      runtime.dispatch({ type: "start" });
      runtime.dispatch({ type: "setSpeed", multiplier: ([1, 4, 16, 64] as const)[cycle % 4]! });
      const advanced = runtime.dispatch({ type: "step", count: AUTOSAVE_INTERVAL_STEPS });
      expectedTimelineDays += AUTOSAVE_INTERVAL_STEPS;

      expect(runtime.isPaused()).toBe(false);
      expect(runtime.getState().timeline?.days).toBe(String(expectedTimelineDays));
      const autosave = advanced.find((message) => message.type === "autosaved");
      expect(autosave?.type).toBe("autosaved");
      if (autosave?.type !== "autosaved") return;
      expect(autosave.timelineDays).toBe(String(expectedTimelineDays));

      runtime.dispatch({ type: "pause" });
      expect(runtime.isPaused()).toBe(true);
      const restored = createSimulationRuntime(createWorld(cycle + 10_000, { width: 8, height: 8 }));
      restored.dispatch({ type: "load", payload: autosave.payload });
      expect(worldDigest(restored.getState())).toBe(autosave.digest);
      expect(restored.getState().timeline?.days).toBe(String(expectedTimelineDays));
      runtime = restored;
    }

    expect(runtime.getState().tick).toBe(expectedTimelineDays);
    expect(runtime.getState().timeline?.step).toBe(String(expectedTimelineDays));
  });

  it("keeps the worker running after numeric clock projections saturate", () => {
    const state = createWorld(155, {
      width: 8,
      height: 8,
      formation: "formed",
      enabledPackIds: ["emergence.original-worldview"],
    });
    const boundaryStep = BigInt(Number.MAX_SAFE_INTEGER);
    const boundaryDays = BigInt(MAX_SIMULATION_DAYS);
    state.tick = Number.MAX_SAFE_INTEGER;
    state.simulationDays = MAX_SIMULATION_DAYS;
    state.years = MAX_SIMULATION_YEARS;
    state.timeline = { step: boundaryStep.toString(), days: boundaryDays.toString() };

    const runtime = createSimulationRuntime(state);
    const firstRun = runtime.dispatch({ type: "step", count: 365 });
    expect(firstRun.some((message) => message.type === "error")).toBe(false);
    expect(runtime.getState().timeline).toEqual({
      step: (boundaryStep + 365n).toString(),
      days: (boundaryDays + 365n).toString(),
    });
    expect(runtime.getState().tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(runtime.getState().years).toBe(MAX_SIMULATION_YEARS);
    const firstYearBoundary = boundaryDays + BigInt(DAYS_PER_YEAR - Number(boundaryDays % BigInt(DAYS_PER_YEAR)));
    expect(runtime.getState().eventArchive.historySamples.at(-1)?.timelineDays).toBe(firstYearBoundary.toString());

    const saved = runtime.dispatch({ type: "save" })[0];
    expect(saved?.type).toBe("saved");
    if (saved?.type !== "saved") return;

    const restored = createSimulationRuntime(createWorld(156, { width: 8, height: 8 }));
    const restoredMessages = restored.dispatch({ type: "load", payload: saved.payload });
    expect(restoredMessages).toHaveLength(1);
    expect(restoredMessages[0]?.type).toBe("snapshot");
    expect(worldDigest(restored.getState())).toBe(saved.digest);

    const secondRun = restored.dispatch({ type: "step", count: 365 });
    expect(secondRun.some((message) => message.type === "error")).toBe(false);
    expect(restored.getState().timeline).toEqual({
      step: (boundaryStep + 730n).toString(),
      days: (boundaryDays + 730n).toString(),
    });
    expect(restored.dispatch({ type: "checkpoint" })[0]).toMatchObject({
      type: "autosaved",
      timelineDays: (boundaryDays + 730n).toString(),
    });
  });

  it("keeps authoritative grids attached after transferring a snapshot", () => {
    const runtime = createSimulationRuntime(createWorld(149, { width: 8, height: 8, formation: "formed" }));
    const message = runtime.dispatch({ type: "pause" })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    const received = structuredClone(message.snapshot, { transfer: snapshotTransferables(message.snapshot) });

    expect(message.snapshot.fields.elevation.values.byteLength).toBe(0);
    expect(received.fields.elevation.values).toHaveLength(64);
    expect(runtime.getState().fields.elevation.values).toHaveLength(64);
    expect(runtime.dispatch({ type: "pause" })[0]).toMatchObject({ type: "snapshot", snapshot: { tick: 0 } });
  });

  it("keeps the configured speed in the runtime protocol", () => {
    const runtime = createSimulationRuntime(createWorld(134, { width: 8, height: 8 }));
    runtime.dispatch({ type: "setSpeed", multiplier: 16 });
    expect(runtime.getSpeed()).toBe(16);
    expect(runtime.dispatch({ type: "setSpeed", multiplier: 4 })[0]).toMatchObject({ type: "snapshot", speed: 4 });
  });

  it("normalizes invalid manual step counts into one safe step", () => {
    const runtime = createSimulationRuntime(createWorld(136, { width: 8, height: 8 }));

    runtime.dispatch({ type: "step", count: Number.NaN });
    expect(runtime.getState().tick).toBe(1);

    runtime.dispatch({ type: "step", count: Number.POSITIVE_INFINITY });
    expect(runtime.getState().tick).toBe(2);
  });

  it("resets to the initial seed state and clears runtime diagnostics", () => {
    const initial = createWorld(148, { width: 8, height: 8 });
    const runtime = createSimulationRuntime(initial);
    const initialDigest = worldDigest(initial);
    runtime.dispatch({ type: "step", count: 3 });
    runtime.dispatch({ type: "start" });

    const messages = runtime.dispatch({ type: "reset" });
    const snapshot = messages.find((message) => message.type === "snapshot");

    expect(runtime.isPaused()).toBe(true);
    expect(worldDigest(runtime.getState())).toBe(initialDigest);
    expect(runtime.getState().tick).toBe(0);
    expect(runtime.getState().years).toBe(0);
    expect(snapshot).toMatchObject({ type: "snapshot", paused: true, speed: 1 });
    if (snapshot?.type === "snapshot") expect(snapshot.snapshot.runtime).toMatchObject({ measuredSteps: 0, hotEventCount: 0, archivedEventCount: 0 });
  });

  it("pauses after a simulation failure and preserves the last valid world", () => {
    const runtime = createSimulationRuntime(createWorld(135, { width: 8, height: 8 }));
    const before = worldDigest(runtime.getState());
    runtime.dispatch({ type: "start" });
    registerSimulationStage({
      id: "failing-extension",
      order: 0,
      run: () => { throw new Error("intentional stage failure"); },
    });

    const messages = runtime.dispatch({ type: "step", count: 1 });

    expect(messages).toEqual([{ type: "error", code: "command-failed", message: "intentional stage failure" }]);
    expect(runtime.isPaused()).toBe(true);
    expect(worldDigest(runtime.getState())).toBe(before);
  });

  it("rolls back before a resource failure can partially mutate an in-place step", () => {
    const runtime = createSimulationRuntime(createWorld(147, { width: 8, height: 8 }));
    const before = worldDigest(runtime.getState());
    registerSimulationStage({
      id: "partial-resource-failure",
      order: 0,
      run: () => ({
        fieldChanges: [{ field: "water", index: 0, operation: "add", value: 0.4, causeRuleId: "test" }],
        chemistryChanges: [],
        entityEffects: [],
        relationshipEffects: [],
        resourceTransactions: [{
          id: "missing-food",
          resourceId: "food",
          regionId: "region:0:0" as never,
          amount: 1,
          operation: "consume",
          source: "user",
          sourceId: "test",
          fromHolderId: "missing",
          causeRuleId: "test",
        }],
        worldviewEffects: [],
        eventDrafts: [],
      }),
    });

    const messages = runtime.dispatch({ type: "step", count: 1 });

    expect(messages).toEqual([{ type: "error", code: "command-failed", message: "Insufficient resource balance: missing-food" }]);
    expect(runtime.isPaused()).toBe(true);
    expect(worldDigest(runtime.getState())).toBe(before);
  });

  it("projects agents, relationships, and organizations into the 2.5d scene", () => {
    const state = createWorld(139, { width: 8, height: 8 });
    const regionId = "region:2:2" as never;
    const species = createSpecies("scene", "consumer");
    const population = { id: "population:scene" as never, speciesId: species.id, regionId, count: 12, energy: 1 };
    const agents = [createAgent(population, species, 0, "scene"), createAgent(population, species, 1, "scene")];
    const relationship = createRelationship("partner", agents[0]!.id, agents[1]!.id, 0, 0.8);
    state.species = [species];
    state.populations = [population];
    state.agents = agents;
    state.relationships = [relationship];
    const cultureIdentity = createCultureIdentity("scene:culture", regionId, 2, 2);
    state.cultures = [{ id: "culture:scene" as never, regionId, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8, identity: cultureIdentity }];
    const family = createOrganization("family", regionId, agents.map((agent) => agent.id));
    const city = createOrganization("city", regionId, agents.map((agent) => agent.id));
    state.organizations = [family, city];
    state.worldview.entities = [{
      id: "worldview:scene-sect" as never,
      packId: "emergence.original-worldview",
      kind: "sect",
      name: "晶脉研修会",
      regionId,
      influence: 0.42,
      resourceBalances: { "attunement-energy": 0.3 },
      originTick: 3,
      founderId: agents[0]!.id,
      memberIds: agents.map((agent) => agent.id),
      status: "active",
    }];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "focusRegion", regionId })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.seed).toBe(state.seed);
    expect(message.snapshot.sceneEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: population.id, kind: "population", speciesId: species.id, speciesName: species.name, lifeBlueprint: species.blueprint }),
      expect.objectContaining({ id: agents[0]!.id, kind: "agent", speciesId: species.id, speciesName: species.name, lifeBlueprint: species.blueprint }),
      expect.objectContaining({ kind: "family" }),
      expect.objectContaining({ kind: "city" }),
      expect.objectContaining({ id: "worldview:scene-sect", kind: "sect", worldviewInfluence: 0.42, worldviewStatus: "active" }),
      expect.objectContaining({ id: agents[0]!.id, cultureId: "culture:scene", cultureName: cultureIdentity.name, cultureSignature: cultureIdentity.noveltySignature }),
    ]));
    expect(message.snapshot.cultureIdentityByRegion?.[regionId]).toEqual(cultureIdentity);
    expect(message.snapshot.resources).toEqual(expect.any(Array));
    expect(message.snapshot.organizationDirectory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: city.id, type: "city", regionId }),
    ]));
    expect(message.snapshot.sceneLinks).toContainEqual(expect.objectContaining({
      fromId: agents[0]!.id,
      toId: agents[1]!.id,
      fromRegion: regionId,
      toRegion: regionId,
      kind: "partner",
      scope: "personal",
    }));
    expect(message.snapshot.worldviewEntities).toEqual(state.worldview.entities);
  });

  it("projects only authoritative active or damaged facilities", () => {
    const state = createWorld(140, { width: 8, height: 8, formation: "formed" });
    const regionId = "region:2:2" as never;
    state.knowledge = [
      { id: "knowledge:field", kind: "innovation:subsistence:1", domain: "subsistence", sourceIds: [], credibility: 0.8, transmissionCost: 0.1, forgettingRate: 0.01 },
      { id: "knowledge:clinic", kind: "innovation:medicine:1", domain: "medicine", sourceIds: [], credibility: 0.8, transmissionCost: 0.1, forgettingRate: 0.01 },
    ];
    state.cultures = [{ id: "culture:facilities" as never, regionId, knowledgeIds: state.knowledge.map((record) => record.id), beliefIds: [], transmissionRate: 0.8 }];
    const owner = createOrganization("city", regionId, ["agent:builder" as never]);
    state.organizations = [owner];
    state.facilities = [{
      id: "facility:authoritative",
      type: "subsistence",
      regionId,
      ownerOrganizationId: owner.id,
      level: 2,
      condition: 0.54,
      status: "damaged",
      workforceIds: ["agent:builder" as never],
      materialInvested: 9,
      plannedTick: 2,
      builtTick: 4,
      lastMaintainedTick: 6,
      lastIncidentTick: 8,
    }];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "focusRegion", regionId })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.sceneEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "facility:authoritative", kind: "facility", facilityType: "subsistence", facilityLevel: 2, facilityStatus: "damaged", facilityCondition: 0.54 }),
    ]));
    expect(message.snapshot.facilities).toEqual(state.facilities);
    expect(message.snapshot.sceneEntities?.some((entity) => entity.kind === "facility" && entity.facilityType === "medicine")).toBe(false);
  });

  it("projects emergent substances and precomputed regional richness", () => {
    const state = createWorld(142, { width: 8, height: 8, formation: "formed" });
    const regionId = "region:2:2" as never;
    state.substances = [{
      id: "substance:snapshot",
      name: "霁棱矿",
      kind: "mineral",
      formation: "geological",
      status: "known",
      regionId,
      originTick: 2,
      originYears: 2,
      parentIds: [],
      composition: { carbon: 0.2, nitrogen: 0.2, phosphorus: 0.2, organics: 0.2, oxygen: 0.2 },
      properties: { hardness: 0.8, density: 0.7, reactivity: 0.2, conductivity: 0.6, energyPotential: 0.5, biologicalAffinity: 0.3, stability: 0.9 },
      reserveCapacity: 240,
      remainingReserve: 180,
      extractedTotal: 60,
      discoveredByIds: [],
    }];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "pause" })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.substances).toEqual(state.substances);
    expect(message.snapshot.substanceRichnessByRegion?.[regionId]).toBeGreaterThan(0);
  });

  it("projects bounded pathogens and regional disease prevalence", () => {
    const state = createWorld(143, { width: 8, height: 8, formation: "formed" });
    const regionId = "region:2:2" as never;
    const species = createSpecies("worker-health", "consumer");
    const population = { id: "population:worker-health" as never, speciesId: species.id, regionId, count: 20, energy: 1 };
    const agent = createAgent(population, species, 0, "worker-health");
    const pathogen = { ...derivePathogen(state, regionId, species.id), prevalence: 1, status: "outbreak" as const, cumulativeCases: 1 };
    const destinationRegion = "region:4:2" as never;
    pathogen.regionalOutbreaks = [
      { regionId, status: "outbreak", prevalence: 1, firstDetectedTick: 1, lastActiveTick: 1 },
      { regionId: destinationRegion, status: "outbreak", prevalence: 0.6, firstDetectedTick: 2, lastActiveTick: 2 },
    ];
    agent.health = { vitality: 0.7, infections: [{ pathogenId: pathogen.id, infectedTick: 1, severity: 0.4 }], immunityIds: [] };
    state.species = [species];
    state.populations = [population];
    state.agents = [agent];
    state.pathogens = [pathogen];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "pause" })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.pathogens).toEqual(state.pathogens);
    expect(message.snapshot.diseasePrevalence?.values[2 * 8 + 2]).toBe(1);
    expect(message.snapshot.diseasePrevalence?.values[2 * 8 + 4]).toBeCloseTo(0.6);
    expect(snapshotTransferables(message.snapshot)).toContain(message.snapshot.diseasePrevalence!.values.buffer);
  });

  it("exposes recent supply routes in snapshots for inspection", () => {
    const state = createWorld(141, { width: 8, height: 8, formation: "formed" });
    const region = "region:2:2" as never;
    const destinationRegion = "region:3:2" as never;
    const source = createOrganization("city", region, []);
    const destination = createOrganization("city", destinationRegion, []);
    state.organizations = [source, destination];
    state.events = [{
      id: "event:supply:1",
      tick: 12,
      years: 12,
      kind: "interregional-trade",
      ruleId: "society:interregional-supply-chain",
      source: "natural",
      sourceIds: [source.id, destination.id],
      probability: 1,
      roll: 0,
      evidence: { fromRegion: region, toRegion: destinationRegion, resourceId: "energy", amount: 0.5 },
      payload: { fromOrganizationId: source.id, toOrganizationId: destination.id, fromRegion: region, toRegion: destinationRegion, resourceId: "energy", amount: 0.5 },
    }];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "pause" })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.supplyRoutes).toContainEqual(expect.objectContaining({
      fromOrganizationId: source.id,
      toOrganizationId: destination.id,
      resourceId: "energy",
      totalAmount: 0.5,
      shipmentCount: 1,
    }));
    expect(message.snapshot.sceneLinks).toContainEqual(expect.objectContaining({
      fromId: source.id,
      toId: destination.id,
      fromRegion: region,
      toRegion: destinationRegion,
      kind: "trade",
      scope: "strategic",
    }));
  });

  it("projects persistent diplomacy and directional migration as strategic routes", () => {
    const state = createWorld(146, { width: 8, height: 8, formation: "formed" });
    const firstRegion = "region:1:2" as never;
    const secondRegion = "region:5:2" as never;
    const thirdRegion = "region:3:6" as never;
    const first = createOrganization("city", firstRegion, []);
    const second = createOrganization("state", secondRegion, []);
    const third = createOrganization("federation", thirdRegion, []);
    first.diplomacy = { [second.id]: "trade", [third.id]: "rival" };
    second.diplomacy = { [first.id]: "trade", [third.id]: "allied" };
    third.diplomacy = { [first.id]: "rival", [second.id]: "allied" };
    state.organizations = [first, second, third];
    state.events = [{
      id: "event:migration:strategic",
      tick: 12,
      years: 12,
      kind: "population-migration",
      ruleId: "ecology:local-migration",
      source: "natural",
      sourceIds: ["population:route"],
      probability: 0.4,
      roll: 0.2,
      evidence: { fromRegion: firstRegion, toRegion: thirdRegion, mobility: 0.8 },
      payload: { populationId: "population:route", fromRegion: firstRegion, toRegion: thirdRegion },
    }];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "pause" })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");
    const orderedAlliance = [second, third].sort((left, right) => left.id.localeCompare(right.id));
    const allianceFrom = orderedAlliance[0]!;
    const allianceTo = orderedAlliance[1]!;

    expect(message.snapshot.sceneLinks?.filter((link) => link.scope === "strategic")).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: first.id, toId: second.id, kind: "trade", fromRegion: firstRegion, toRegion: secondRegion }),
      expect.objectContaining({ fromId: first.id, toId: third.id, kind: "border-conflict", fromRegion: firstRegion, toRegion: thirdRegion }),
      expect.objectContaining({ fromId: allianceFrom.id, toId: allianceTo.id, kind: "alliance", fromRegion: allianceFrom.regionId, toRegion: allianceTo.regionId }),
      expect.objectContaining({ fromId: "population:route", toId: "population:route", kind: "migration", fromRegion: firstRegion, toRegion: thirdRegion }),
    ]));
    expect(message.snapshot.sceneLinks?.filter((link) => link.scope === "strategic")).toHaveLength(4);
  });

  it("bounds dense diplomacy before sending strategic scene routes", () => {
    const state = createWorld(147, { width: 32, height: 16, formation: "formed" });
    state.organizations = Array.from({ length: 180 }, (_, index) => createOrganization(
      index % 2 === 0 ? "city" : "state",
      `region:${index % 32}:${Math.floor(index / 32)}` as never,
      [],
    ));
    for (const organization of state.organizations) {
      organization.diplomacy = Object.fromEntries(state.organizations
        .filter((peer) => peer.id !== organization.id)
        .slice(0, 64)
        .map((peer, index) => [peer.id, index % 3 === 0 ? "allied" : index % 3 === 1 ? "trade" : "rival"]));
    }
    state.events = Array.from({ length: 180 }, (_, index) => ({
      id: `event:dense-route:${index}`,
      tick: index,
      years: index / 365,
      kind: "population-migration",
      ruleId: "ecology:local-migration",
      source: "natural" as const,
      sourceIds: [`population:dense-route:${index}`],
      probability: 0.5,
      roll: 0.2,
      evidence: { fromRegion: `region:${index % 32}:${Math.floor(index / 32)}`, toRegion: `region:${(index + 7) % 32}:${Math.floor((index + 7) / 32)}` },
      payload: { populationId: `population:dense-route:${index}`, fromRegion: `region:${index % 32}:${Math.floor(index / 32)}`, toRegion: `region:${(index + 7) % 32}:${Math.floor((index + 7) / 32)}` },
    }));
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "pause" })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.sceneLinks?.filter((link) => link.scope === "strategic")).toHaveLength(MAX_SCENE_STRATEGIC_LINKS);
    expect(message.snapshot.sceneLinks?.every((link) => link.fromRegion !== link.toRegion || link.scope === "personal")).toBe(true);
  });

  it("projects a bounded causal event history for the focused region", () => {
    const state = createWorld(144, { width: 8, height: 8, formation: "formed" });
    const region = "region:2:2" as never;
    const city = createOrganization("city", region, []);
    state.organizations = [city];
    state.events = Array.from({ length: RECENT_REGION_EVENT_LIMIT + 4 }, (_, index) => ({
      id: `event:regional-history:${index}`,
      tick: index,
      years: index,
      kind: index % 2 === 0 ? "flood" : "interregional-trade",
      ruleId: "test:regional-history",
      source: "natural" as const,
      sourceIds: [city.id, ...Array.from({ length: 40 }, (_, sourceIndex) => `agent:history-source:${sourceIndex}`)],
      probability: 0.4,
      roll: 0.2,
      evidence: { regionId: region, intensity: 0.25 },
      payload: {
        regionId: region,
        organizationId: city.id,
        speciesId: "species:history",
        populationId: "population:history",
        cultureId: "culture:history",
        substanceId: "substance:history",
        facilityId: "facility:history",
        pathogenId: "pathogen:history",
        resourceId: "food",
        amount: index + 1,
      },
    }));
    const runtime = createSimulationRuntime(state);
    const before = worldDigest(runtime.getState());
    const message = runtime.dispatch({ type: "focusRegion", regionId: region })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.recentRegionEvents).toHaveLength(RECENT_REGION_EVENT_LIMIT);
    expect(message.snapshot.recentRegionEvents?.[0]).toMatchObject({
      id: `event:regional-history:${RECENT_REGION_EVENT_LIMIT + 3}`,
      organizationIds: [city.id],
      amount: RECENT_REGION_EVENT_LIMIT + 4,
    });
    expect(message.snapshot.recentRegionEvents?.[0]?.relatedIds).toEqual(expect.arrayContaining([
      city.id,
      "culture:history",
      "facility:history",
      "pathogen:history",
      "population:history",
      "species:history",
      "substance:history",
    ]));
    expect(message.snapshot.recentRegionEvents?.[0]?.relatedIds?.length).toBeLessThanOrEqual(32);
    expect(message.snapshot.recentRegionEvents?.every((event) => event.regionIds.includes(region))).toBe(true);
    expect(worldDigest(runtime.getState())).toBe(before);
  });

  it("exposes archived milestones in the focused region history", () => {
    const state = createWorld(145, { width: 8, height: 8, formation: "formed" });
    const region = "region:2:2" as never;
    state.eventArchive.milestones = [{
      id: "event:archived:formation",
      tick: 1,
      years: 1,
      kind: "planet-formation-complete",
      ruleId: "formation:stable-crust",
      source: "natural",
      sourceIds: [],
      regionIds: [region],
      organizationIds: [],
      probability: 1,
      roll: 0,
      details: { regionId: region, name: "稳定地壳形成" },
    }];
    const runtime = createSimulationRuntime(state);
    const message = runtime.dispatch({ type: "focusRegion", regionId: region })[0];
    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");

    expect(message.snapshot.recentRegionEvents).toContainEqual(expect.objectContaining({
      id: "event:archived:formation",
      archived: true,
      name: "稳定地壳形成",
    }));
  });

  it("does not apply the same event ID twice", () => {
    const runtime = createSimulationRuntime(createWorld(131, { width: 8, height: 8 }));
    const event = { id: "user:event:1", kind: "add-water", regionId: "region:0:0" as never, intensity: 0.5, duration: 1, source: "user" as const, payload: { amount: 0.5 } };
    runtime.dispatch({ type: "applyEvent", event });
    const duplicate = runtime.dispatch({ type: "applyEvent", event });
    expect(runtime.getState().events.filter((candidate) => candidate.id === event.id)).toHaveLength(1);
    expect(duplicate).toEqual([{ type: "error", code: "duplicate", message: `Event already applied: ${event.id}` }]);
  });

  it("focuses without changing authoritative digest", () => {
    const runtime = createSimulationRuntime(createWorld(132, { width: 8, height: 8 }));
    const before = worldDigest(runtime.getState());
    runtime.dispatch({ type: "focusRegion", regionId: "region:1:1" as never });
    expect(worldDigest(runtime.getState())).toBe(before);
  });

  it("refreshes the focused projection after authoritative steps", () => {
    const runtime = createSimulationRuntime(createWorld(136, { width: 8, height: 8 }));
    const focused = runtime.dispatch({ type: "focusRegion", regionId: "region:1:1" as never })[0];
    const stepped = runtime.dispatch({ type: "step", count: 1 })[0];
    expect(focused?.type === "snapshot" && focused.snapshot.projection?.sourceRevision).toBe(0);
    expect(stepped?.type === "snapshot" && stepped.snapshot.projection?.sourceRevision).toBe(1);
  });

  it("refreshes aggregate food fields after authoritative resource changes", () => {
    const state = createWorld(137, { width: 8, height: 8 });
    const region = "region:1:1" as never;
    state.lod.summaries = [{
      regionId: region,
      version: 0,
      mode: "aggregate",
      population: 10,
      populationByAge: { bins: {} },
      skillHistogram: { bins: {} },
      cultureHistogram: { bins: {} },
      householdCount: 0,
      organizations: [],
      agentIds: [],
      agentRecords: [],
      relationshipCount: 0,
      relationshipDigest: "0",
      relationshipRecords: [],
      lineage: { descendantCount: 0, generationDepth: 0, knowledgeCarrierCount: 0, knowledgeInheritanceCount: 0, beliefCarrierCount: 0, relationshipCounts: {} },
      familyLineages: [],
      foodBalance: 0,
      foodPerAgent: 0,
      foodSecurity: 0,
      resources: [],
      migrationRate: 0,
      historyIds: [],
      random: { ...state.random },
      canonicalDigest: "0",
    }];
    state.resources = [{ id: "resource:food:aggregate", resourceId: "food", regionId: region, amount: 2, cap: 4, originEventId: "event:food" }];
    const runtime = createSimulationRuntime(state);
    const snapshot = runtime.dispatch({ type: "focusRegion", regionId: region })[0];
    expect(snapshot?.type === "snapshot" && snapshot.snapshot.selectedRegion).toMatchObject({ foodBalance: 2, foodPerAgent: 0.2, foodSecurity: 0.4 });
    expect(snapshot?.type === "snapshot" && snapshot.snapshot.foodSecurity?.values[1 * 8 + 1]).toBeCloseTo(0.4);
  });

  it("uses micro agents, aggregate summaries, then populations for regional food security", () => {
    const state = createWorld(138, { width: 8, height: 8 });
    const species = createSpecies("security", "consumer");
    const microPopulation = { id: "population:micro" as never, speciesId: species.id, regionId: "region:0:0" as never, count: 10, energy: 1 };
    const fallbackPopulation = { id: "population:fallback" as never, speciesId: species.id, regionId: "region:2:0" as never, count: 8, energy: 1 };
    state.species = [species];
    state.populations = [microPopulation, fallbackPopulation];
    state.agents = [
      createAgent(microPopulation, species, 0, "security"),
      createAgent(microPopulation, species, 1, "security"),
    ];
    state.lod.summaries = [{
      regionId: "region:1:0" as never,
      version: 0,
      mode: "aggregate",
      population: 10,
      populationByAge: { bins: {} }, skillHistogram: { bins: {} }, cultureHistogram: { bins: {} }, householdCount: 0,
      organizations: [], agentIds: [], agentRecords: [], relationshipCount: 0, relationshipDigest: "0", relationshipRecords: [],
      lineage: { descendantCount: 0, generationDepth: 0, knowledgeCarrierCount: 0, knowledgeInheritanceCount: 0, beliefCarrierCount: 0, relationshipCounts: {} },
      familyLineages: [],
      foodBalance: 0, foodPerAgent: 0, foodSecurity: 0, resources: [], migrationRate: 0, historyIds: [], random: { ...state.random }, canonicalDigest: "0",
    }];
    state.resources = [
      { id: "food:micro", resourceId: "food", regionId: "region:0:0" as never, amount: 1, cap: 2, originEventId: "event:food" },
      { id: "food:aggregate", resourceId: "food", regionId: "region:1:0" as never, amount: 2, cap: 2, originEventId: "event:food" },
      { id: "food:fallback", resourceId: "food", regionId: "region:2:0" as never, amount: 2, cap: 2, originEventId: "event:food" },
    ];
    const runtime = createSimulationRuntime(state);
    const before = worldDigest(runtime.getState());
    const message = runtime.dispatch({ type: "pause" })[0];

    if (message?.type !== "snapshot") throw new Error("Expected a snapshot");
    expect(Array.from(message.snapshot.foodSecurity?.values.slice(0, 3) ?? [])).toEqual([
      1,
      expect.closeTo(0.4, 5),
      0.5,
    ]);
    expect(worldDigest(runtime.getState())).toBe(before);
  });

  it("restores saves and preserves the current world on load errors", () => {
    const runtime = createSimulationRuntime(createWorld(133, { width: 8, height: 8 }));
    runtime.dispatch({ type: "step", count: 2 });
    const saved = runtime.dispatch({ type: "save" })[0];
    expect(saved?.type).toBe("saved");
    if (saved?.type !== "saved") return;
    const beforeError = worldDigest(runtime.getState());
    const error = runtime.dispatch({ type: "load", payload: "{" });
    expect(error[0]?.type).toBe("error");
    expect(worldDigest(runtime.getState())).toBe(beforeError);
    const restored = createSimulationRuntime(createWorld(1, { width: 8, height: 8 }));
    restored.dispatch({ type: "load", payload: saved.payload });
    expect(worldDigest(restored.getState())).toBe(saved.digest);
  });

  it("restores a read-only focus without changing the authoritative digest", () => {
    const runtime = createSimulationRuntime(createWorld(135, { width: 8, height: 8 }));
    runtime.dispatch({ type: "focusRegion", regionId: "region:2:3" as never });
    const before = worldDigest(runtime.getState());
    const saved = runtime.dispatch({ type: "save" })[0];
    expect(saved?.type).toBe("saved");
    if (saved?.type !== "saved") return;
    const restored = createSimulationRuntime(createWorld(1, { width: 8, height: 8 }));
    const messages = restored.dispatch({ type: "load", payload: saved.payload });
    expect(messages[0]).toMatchObject({ type: "snapshot", snapshot: { focusRegionId: "region:2:3" } });
    expect(worldDigest(restored.getState())).toBe(before);
    expect(restored.getState().observation.projection?.readOnly).toBe(true);
  });
});
