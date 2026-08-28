import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { compactPathogenRecords, derivePathogen, finalizeAgentHealth, isCanonicalPathogenState, MAX_PATHOGENS, MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN, normalizePathogenState, pathogenOutbreakForRegion, stepAgentHealth } from "../../src/sim/health/disease.ts";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { createWorld, isFiniteWorld } from "../../src/sim/world.ts";
import { MAX_SIMULATION_DAYS, nextSimulationStep } from "../../src/sim/time.ts";
import type { AgentState, EntityId, PathogenState, RegionId } from "../../src/sim/types.ts";

const region = "region:2:2" as RegionId;

const diseaseWorld = () => {
  const state = createWorld(9_001, { width: 8, height: 8, formation: "formed" });
  const species = createSpecies("disease-host", "consumer");
  const population = { id: "population:disease-host" as EntityId, speciesId: species.id, regionId: region, count: 64, energy: 1 };
  const first = createAgent(population, species, 0, "disease-host");
  const second = createAgent(population, species, 1, "disease-host");
  state.species = [species];
  state.populations = [population];
  state.agents = [first, second];
  state.relationships = [createRelationship("friend", first.id, second.id, 1, 0.9)];
  const index = 2 * 8 + 2;
  state.fields.humidity.values[index] = 0.9;
  state.fields.water.values[index] = 0.7;
  state.fields.temperature.values[index] = 0.65;
  state.chemistry.organics.values[index] = 0.8;
  const pathogen: PathogenState = {
    ...derivePathogen(state, region, species.id),
    transmission: 1,
    severity: 0.5,
    persistence: 1,
    prevalence: 0.5,
    status: "outbreak",
    cumulativeCases: 1,
    regionalOutbreaks: [{ regionId: region, status: "outbreak", prevalence: 0.5, firstDetectedTick: 1, lastActiveTick: 1 }],
  };
  first.health = { vitality: 0.8, infections: [{ pathogenId: pathogen.id, infectedTick: 1, severity: 0.5 }], immunityIds: [] };
  state.pathogens = [pathogen];
  return { state, species, first, second, pathogen };
};

const clonedAgents = (agents: AgentState[]): Map<EntityId, AgentState> =>
  new Map(structuredClone(agents).map((agent) => [agent.id, agent]));

describe("emergent disease and public health", () => {
  it("derives a deterministic original pathogen with bounded traits", () => {
    const { state, species } = diseaseWorld();
    state.tick = 14;
    const first = derivePathogen(state, region, species.id);
    const second = derivePathogen(state, region, species.id);

    expect(first).toEqual(second);
    expect(first.name.length).toBeGreaterThan(1);
    expect(first.noveltySignature).toMatch(/^[0-9a-f]{8}$/);
    expect([first.transmission, first.severity, first.persistence, first.prevalence].every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(isCanonicalPathogenState(first)).toBe(true);
  });

  it("keeps new health and relationship history exact after numeric projections saturate", () => {
    const { state, species, first, second } = diseaseWorld();
    state.tick = Number.MAX_SAFE_INTEGER;
    state.simulationDays = MAX_SIMULATION_DAYS;
    state.years = MAX_SIMULATION_DAYS / 365;
    state.timeline = { step: String(Number.MAX_SAFE_INTEGER), days: String(MAX_SIMULATION_DAYS) };

    const expectedStep = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    const pathogen = derivePathogen(state, region, species.id);
    const relationship = createRelationship("friend", first.id, second.id, Number.MAX_SAFE_INTEGER, 0.6, expectedStep);

    expect(nextSimulationStep(state)).toBe(expectedStep);
    expect(pathogen.originTimelineStep).toBe(expectedStep);
    expect(pathogen.lastActiveTimelineStep).toBe(expectedStep);
    expect(pathogen.regionalOutbreaks[0]?.firstDetectedTimelineStep).toBe(expectedStep);
    expect(relationship.createdTimelineStep).toBe(expectedStep);

    state.pathogens = [pathogen];
    state.relationships = [relationship];
    const restored = deserializeWorld(serializeWorld(state));
    expect(restored.pathogens[0]?.originTimelineStep).toBe(expectedStep);
    expect(restored.relationships[0]?.createdTimelineStep).toBe(expectedStep);
    expect(isFiniteWorld(restored)).toBe(true);
  });

  it("repairs noncanonical outbreak history without mutating the source record", () => {
    const { state, pathogen } = diseaseWorld();
    const laterRegion = "region:7:7" as RegionId;
    pathogen.regionalOutbreaks = [
      { regionId: laterRegion, status: "outbreak", prevalence: 0.05, firstDetectedTick: 4, lastActiveTick: 4 },
      { regionId: region, status: "endemic", prevalence: 0.5, firstDetectedTick: 1, lastActiveTick: 2 },
    ];
    const source = structuredClone(pathogen);

    expect(isCanonicalPathogenState(pathogen)).toBe(false);
    const normalized = normalizePathogenState(pathogen);
    expect(isCanonicalPathogenState(normalized)).toBe(true);
    expect(normalized.regionalOutbreaks.map((outbreak) => outbreak.regionId)).toEqual([region, laterRegion]);
    expect(normalized.regionalOutbreaks.map((outbreak) => outbreak.status)).toEqual(["outbreak", "endemic"]);
    expect(pathogen).toEqual(source);

    const step = stepAgentHealth(state, clonedAgents(state.agents), 0);
    expect(isCanonicalPathogenState(step.pathogens.get(pathogen.id)!)).toBe(true);
    expect(pathogen).toEqual(source);
  });

  it("checks later dense host regions after skipping an earlier sparse group", () => {
    const { state, species } = diseaseWorld();
    const sparseRegion = "region:0:0" as RegionId;
    const sparsePopulation = { id: "population:disease-sparse" as EntityId, speciesId: species.id, regionId: sparseRegion, count: 8, energy: 1 };
    const densePopulation = state.populations[0]!;
    state.populations = [sparsePopulation, densePopulation];
    state.agents = [
      createAgent(sparsePopulation, species, 0, "sparse-host"),
      ...Array.from({ length: 4 }, (_, index) => createAgent(densePopulation, species, index, `dense-host:${index}`)),
    ];
    state.relationships = [];
    state.pathogens = [];
    state.fields.humidity.values.fill(1);
    state.fields.water.values.fill(1);
    state.fields.temperature.values.fill(1);
    state.chemistry.organics.values.fill(1);

    const step = stepAgentHealth(state, clonedAgents(state.agents), 1_000);

    expect(step.events).toContainEqual(expect.objectContaining({
      kind: "pathogen-emergence",
      payload: expect.objectContaining({ regionId: region }),
    }));
  });

  it("spreads through local contact and records outbreak prevalence", () => {
    const { state, second, pathogen } = diseaseWorld();
    const agents = clonedAgents(state.agents);
    const step = stepAgentHealth(state, agents, 40);
    const finalized = finalizeAgentHealth(state, step, agents, new Set());
    const updated = finalized.effects.find((effect) => effect.collection === "pathogens" && effect.id === pathogen.id)?.value as PathogenState | undefined;

    expect(agents.get(second.id)?.health?.infections).toEqual(expect.arrayContaining([expect.objectContaining({ pathogenId: pathogen.id })]));
    expect(updated?.prevalence).toBeGreaterThan(0);
    expect(updated?.cumulativeCases).toBeGreaterThan(pathogen.cumulativeCases);
  });

  it("uses operating medical facilities to reduce disease mortality risk", () => {
    const unprotected = diseaseWorld();
    const protectedWorld = structuredClone(unprotected.state);
    protectedWorld.facilities = [{
      id: "facility:medicine:disease",
      type: "medicine",
      regionId: region,
      ownerOrganizationId: "organization:city:disease" as never,
      level: 3,
      condition: 1,
      status: "active",
      workforceIds: protectedWorld.agents.map((agent) => agent.id),
      workforceRequired: 2,
      workforceEfficiency: 1,
      materialInvested: 10,
      plannedTick: 1,
      builtTick: 2,
      lastMaintainedTick: 2,
      lastIncidentTick: 2,
    }];

    const baseline = stepAgentHealth(unprotected.state, clonedAgents(unprotected.state.agents), 0).mortalityRiskByAgent.get(unprotected.first.id) ?? 0;
    const protectedRisk = stepAgentHealth(protectedWorld, clonedAgents(protectedWorld.agents), 0).mortalityRiskByAgent.get(unprotected.first.id) ?? 0;

    expect(protectedRisk).toBeLessThan(baseline);
  });

  it("uses inherited disease resistance to reduce disease mortality risk", () => {
    const vulnerable = diseaseWorld();
    const resistantState = structuredClone(vulnerable.state);
    vulnerable.state.agents[0]!.traits.diseaseResistance = 0;
    resistantState.agents[0]!.traits.diseaseResistance = 1;

    const vulnerableStep = stepAgentHealth(vulnerable.state, clonedAgents(vulnerable.state.agents), 0);
    const resistantStep = stepAgentHealth(resistantState, clonedAgents(resistantState.agents), 0);

    expect(resistantStep.mortalityRiskByAgent.get(vulnerable.first.id)).toBeLessThan(vulnerableStep.mortalityRiskByAgent.get(vulnerable.first.id)!);
  });

  it("establishes a regional outbreak when an infected carrier reaches another host region", () => {
    const { state, species, pathogen } = diseaseWorld();
    const destination = "region:4:2" as RegionId;
    const destinationPopulation = { id: "population:disease-destination" as EntityId, speciesId: species.id, regionId: destination, count: 32, energy: 1 };
    const carrier = createAgent(destinationPopulation, species, 0, "infected-carrier");
    carrier.health = { vitality: 0.8, infections: [{ pathogenId: pathogen.id, infectedTick: 1, severity: 0.4 }], immunityIds: [] };
    state.populations.push(destinationPopulation);
    state.agents.push(carrier);

    const step = stepAgentHealth(state, clonedAgents(state.agents), 0);
    const destinationOutbreak = pathogenOutbreakForRegion(step.pathogens.get(pathogen.id)!, destination);

    expect(destinationOutbreak?.prevalence).toBeGreaterThan(0);
    expect(step.events).toContainEqual(expect.objectContaining({ kind: "disease-regional-spread", payload: expect.objectContaining({ toRegion: destination, route: "infected-carrier" }) }));
  });

  it("records the destination during finalization when migration lands in the same step", () => {
    const { state, species, first, pathogen } = diseaseWorld();
    const destination = "region:6:2" as RegionId;
    const destinationPopulation = { id: "population:disease-same-step" as EntityId, speciesId: species.id, regionId: destination, count: 24, energy: 1 };
    state.populations.push(destinationPopulation);
    const agents = clonedAgents(state.agents);
    const step = stepAgentHealth(state, agents, 0);
    const migrated = agents.get(first.id)!;
    migrated.regionId = destination;
    migrated.populationId = destinationPopulation.id;

    const finalized = finalizeAgentHealth(state, step, agents, new Set());
    const updated = finalized.effects.find((effect) => effect.collection === "pathogens" && effect.id === pathogen.id)?.value as PathogenState;

    expect(pathogenOutbreakForRegion(updated, destination)?.prevalence).toBeGreaterThan(0);
    expect(finalized.events).toContainEqual(expect.objectContaining({ kind: "disease-regional-spread", payload: expect.objectContaining({ toRegion: destination }) }));
  });

  it("uses recent trade contact to seed an aggregate outbreak in another region", () => {
    const { state, species, pathogen } = diseaseWorld();
    const destination = "region:5:2" as RegionId;
    state.populations.push({ id: "population:disease-trade" as EntityId, speciesId: species.id, regionId: destination, count: 80, energy: 1 });
    state.events = [{
      id: "event:disease-trade",
      tick: state.tick,
      years: state.years,
      kind: "interregional-trade",
      ruleId: "test:trade",
      source: "natural",
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { fromRegion: region, toRegion: destination, amount: 20 },
      payload: { fromRegion: region, toRegion: destination, amount: 20 },
    }];

    const step = stepAgentHealth(state, clonedAgents(state.agents), 40);
    const destinationOutbreak = pathogenOutbreakForRegion(step.pathogens.get(pathogen.id)!, destination);

    expect(destinationOutbreak?.prevalence).toBeGreaterThan(0);
    expect(step.events).toContainEqual(expect.objectContaining({ kind: "disease-regional-spread", payload: expect.objectContaining({ toRegion: destination, route: "interregional-trade" }) }));
  });

  it("bounds the pathogen catalog and removes dangling health references", () => {
    const { state, pathogen, first } = diseaseWorld();
    state.pathogens = Array.from({ length: MAX_PATHOGENS + 12 }, (_, index) => ({ ...pathogen, id: `pathogen:bounded:${index}`, lastActiveTick: index }));
    first.health = {
      vitality: 0.7,
      infections: [{ pathogenId: "pathogen:bounded:0", infectedTick: 1, severity: 0.4 }],
      immunityIds: ["pathogen:missing"],
    };

    expect(compactPathogenRecords(state)).toBe(12);
    expect(state.pathogens).toHaveLength(MAX_PATHOGENS);
    expect(first.health.infections).toHaveLength(0);
    expect(first.health.immunityIds).toHaveLength(0);
    expect(isFiniteWorld(state)).toBe(true);
  });

  it("continues pathogen emergence after dormant history fills the catalog", () => {
    const { state, species } = diseaseWorld();
    const agents = Array.from({ length: 4 }, (_, index) => createAgent(state.populations[0]!, species, index, `recycled-pathogen:${index}`));
    state.agents = agents;
    state.relationships = [];
    state.fields.humidity.values.fill(1);
    state.fields.water.values.fill(1);
    state.fields.temperature.values.fill(1);
    state.chemistry.organics.values.fill(1);
    state.pathogens = Array.from({ length: MAX_PATHOGENS }, (_, index): PathogenState => {
      const pathogen = derivePathogen(state, region, species.id);
      return {
        ...pathogen,
        id: `pathogen:dormant:${String(index).padStart(3, "0")}`,
        name: `Dormant ${index}`,
        status: "dormant",
        prevalence: 0,
        originTick: index + 1,
        lastActiveTick: index + 1,
        regionalOutbreaks: [{
          regionId: region,
          status: "dormant",
          prevalence: 0,
          firstDetectedTick: index + 1,
          lastActiveTick: index + 1,
        }],
      };
    });
    const workingAgents = clonedAgents(state.agents);

    const step = stepAgentHealth(state, workingAgents, 1_000);
    const emergence = step.events.find((event) => event.kind === "pathogen-emergence");

    expect(emergence).toBeDefined();
    expect(step.pathogens.size).toBeGreaterThan(MAX_PATHOGENS);
    state.pathogens = [...step.pathogens.values()];
    state.agents = [...workingAgents.values()];
    expect(compactPathogenRecords(state)).toBe(step.pathogens.size - MAX_PATHOGENS);
    expect(state.pathogens).toHaveLength(MAX_PATHOGENS);
    expect(state.pathogens.some((pathogen) => pathogen.id === emergence?.payload.pathogenId)).toBe(true);
    expect(state.agents.every((agent) => agent.health?.infections.every((infection) => state.pathogens.some((pathogen) => pathogen.id === infection.pathogenId)))).toBe(true);
  });

  it("bounds regional outbreaks while preserving the pathogen origin", () => {
    const { state, pathogen } = diseaseWorld();
    pathogen.regionalOutbreaks = Array.from({ length: MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN + 8 }, (_, index) => ({
      regionId: `region:${index % 8}:${Math.floor(index / 8)}` as RegionId,
      status: index % 3 === 0 ? "outbreak" as const : "dormant" as const,
      prevalence: index % 3 === 0 ? 0.4 : 0,
      firstDetectedTick: index + 1,
      lastActiveTick: index + 1,
    }));
    pathogen.regionalOutbreaks.push({ regionId: region, status: "outbreak", prevalence: 0.5, firstDetectedTick: 1, lastActiveTick: 1 });

    compactPathogenRecords(state);

    expect(state.pathogens[0]?.regionalOutbreaks).toHaveLength(MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN);
    expect(state.pathogens[0]?.regionalOutbreaks.some((outbreak) => outbreak.regionId === region)).toBe(true);
  });

  it("round-trips health history and upgrades older saves", () => {
    const { state } = diseaseWorld();
    const restored = deserializeWorld(serializeWorld(state));
    expect(restored.pathogens).toEqual(state.pathogens);
    expect(restored.agents[0]?.health).toEqual(state.agents[0]?.health);

    const legacyRegional = JSON.parse(serializeWorld(state)) as { world: { pathogens: Array<{ regionalOutbreaks?: unknown }> } };
    delete legacyRegional.world.pathogens[0]?.regionalOutbreaks;
    const upgradedRegional = deserializeWorld(JSON.stringify(legacyRegional));
    expect(upgradedRegional.pathogens[0]?.regionalOutbreaks).toEqual([expect.objectContaining({ regionId: region, prevalence: 0.5 })]);

    const legacy = JSON.parse(serializeWorld(state)) as { world: { pathogens?: unknown; agents: Array<{ health?: unknown }> } };
    delete legacy.world.pathogens;
    for (const agent of legacy.world.agents) delete agent.health;
    const upgraded = deserializeWorld(JSON.stringify(legacy));
    expect(upgraded.pathogens).toEqual([]);
    expect(upgraded.agents.every((agent) => agent.health?.vitality === 1)).toBe(true);
  });
});
