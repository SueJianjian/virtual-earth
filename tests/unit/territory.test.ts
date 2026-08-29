import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { neighboringRegionIds, stepTerritories, territoriesTouch, touchingDiplomaticOrganizationPairs } from "../../src/sim/society/territory.ts";
import { stepSupplyChains } from "../../src/sim/society/supply.ts";
import { governanceForOrganization } from "../../src/sim/society/organization.ts";
import { createFoodBalanceIndex } from "../../src/sim/agents/food.ts";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { WorldState } from "../../src/sim/types.ts";

const territorialWorld = (seed: number): WorldState => {
  const state = createWorld(seed, { width: 8, height: 8, formation: "formed" });
  const species = createSpecies(`territory:${seed}`, "consumer");
  species.traits.cognitivePotential = 0.8;
  const firstPopulation = { id: `population:left:${seed}` as never, speciesId: species.id, regionId: "region:2:2" as never, count: 80, energy: 1 };
  const secondPopulation = { id: `population:right:${seed}` as never, speciesId: species.id, regionId: "region:3:2" as never, count: 80, energy: 1 };
  const leftAgents = Array.from({ length: 40 }, (_, index) => createAgent(firstPopulation, species, index, `left:${seed}`));
  const rightAgents = Array.from({ length: 40 }, (_, index) => createAgent(secondPopulation, species, index, `right:${seed}`));
  state.species = [species];
  state.populations = [firstPopulation, secondPopulation];
  state.agents = [...leftAgents, ...rightAgents];
  state.fields.biomass.values.fill(0.1);
  state.fields.nutrients.values.fill(0.5);
  return state;
};

describe("cross-region territories", () => {
  it("treats opposite horizontal edges as neighboring planetary regions", () => {
    expect(neighboringRegionIds("region:0:3" as never, 8, 8)).toEqual([
      "region:1:3",
      "region:7:3",
      "region:0:4",
      "region:0:2",
    ]);
  });

  it("indexes every touching diplomatic organization pair in stable ID order", () => {
    const state = territorialWorld(431);
    const organizations = [
      createOrganization("city", "region:0:2" as never, []),
      createOrganization("state", "region:7:2" as never, []),
      createOrganization("federation", "region:3:3" as never, []),
      createOrganization("empire", "region:4:3" as never, []),
      createOrganization("city", "region:1:6" as never, []),
      createOrganization("state", "region:1:6" as never, []),
      createOrganization("federation", "region:6:6" as never, []),
    ];
    organizations[4]!.territoryRegionIds = ["region:1:6", "region:2:6"] as never;
    organizations[6]!.territoryRegionIds = ["region:3:6"] as never;

    const candidates = organizations
      .filter((organization) => organization.status === "active" && ["city", "state", "federation", "empire"].includes(organization.type))
      .sort((left, right) => left.id.localeCompare(right.id));
    const expected = candidates.flatMap((left, leftIndex) => candidates
      .slice(leftIndex + 1)
      .filter((right) => left.regionId !== right.regionId && territoriesTouch(left, right, 8, 8))
      .map((right) => [left.id, right.id]));
    const indexed = touchingDiplomaticOrganizationPairs(organizations, 8, 8)
      .map(([left, right]) => [left.id, right.id]);

    expect(indexed).toEqual(expected);
    expect(indexed).toContainEqual([organizations[0]!.id, organizations[1]!.id]);
    expect(indexed.some(([leftId, rightId]) => leftId === organizations[4]!.id && rightId === organizations[5]!.id)).toBe(false);
  });

  it("preserves territorial outcomes when reusing the current food balance index", () => {
    const state = territorialWorld(1_505);
    state.tick = 5;
    const left = createOrganization("city", "region:2:2" as never, state.agents.slice(0, 40).map((agent) => agent.id));
    const right = createOrganization("city", "region:3:2" as never, state.agents.slice(40).map((agent) => agent.id));
    left.diplomacy = { [right.id]: "rival" };
    right.diplomacy = { [left.id]: "rival" };
    state.organizations = [left, right];
    state.resources = [{ id: "resource:food:left", resourceId: "food", regionId: left.regionId, holderId: left.id, amount: 8, cap: 10, originEventId: "food" }];

    expect(stepTerritories(state, createFoodBalanceIndex(state))).toEqual(stepTerritories(state));
  });

  it("expands an active city into one contiguous neighboring region", () => {
    const outcome = Array.from({ length: 128 }, (_, tick) => {
      const state = territorialWorld(500 + tick);
      state.tick = tick;
      state.organizations = [createOrganization("city", "region:2:2" as never, state.agents.slice(0, 40).map((agent) => agent.id))];
      return stepTerritories(state);
    }).find((delta) => delta.eventDrafts.some((event) => event.kind === "territory-expansion"));

    const update = outcome?.entityEffects.find((effect) => effect.collection === "organizations" && effect.operation === "update");
    expect(update?.collection === "organizations" ? update.value?.territoryRegionIds : undefined).toHaveLength(2);
    expect(outcome?.eventDrafts.find((event) => event.kind === "territory-expansion")?.evidence.territorySize).toBe(2);
  });

  it("moves a pressured organization with members, represented population, and held resources", () => {
    const outcome = Array.from({ length: 128 }, (_, seed) => {
      const state = territorialWorld(1_900 + seed);
      state.tick = seed;
      state.fields.biomass.values.fill(0);
      state.fields.nutrients.values.fill(0.04);
      state.fields.temperature.values.fill(0.1);
      state.fields.humidity.values.fill(0.1);
      state.fields.water.values.fill(0.05);
      const currentRegion = "region:2:2" as never;
      const destinationRegion = "region:2:3" as never;
      const destinationIndex = 3 * state.fields.elevation.width + 2;
      state.fields.biomass.values[destinationIndex] = 0.86;
      state.fields.nutrients.values[destinationIndex] = 0.8;
      state.fields.temperature.values[destinationIndex] = 0.5;
      state.fields.humidity.values[destinationIndex] = 0.55;
      state.fields.water.values[destinationIndex] = 0.45;
      const organization = createOrganization("city", currentRegion, state.agents.slice(0, 40).map((agent) => agent.id));
      organization.governance = { ...governanceForOrganization(organization), stability: 0.18 };
      state.organizations = [organization];
      state.resources = [
        { id: "resource:migration:food", resourceId: "food", regionId: currentRegion, holderId: organization.id, amount: 0.1, cap: 10, originEventId: "test" },
        { id: "resource:migration:materials", resourceId: "materials", regionId: currentRegion, holderId: organization.id, amount: 3, cap: 10, originEventId: "test" },
      ];
      return { state, delta: stepTerritories(state), organization };
    }).find(({ delta }) => delta.eventDrafts.some((event) => event.kind === "organization-migration"));

    expect(outcome).toBeDefined();
    const migration = outcome?.delta.eventDrafts.find((event) => event.kind === "organization-migration");
    const organization = outcome?.organization;
    const organizationUpdate = outcome?.delta.entityEffects.find((effect) => effect.collection === "organizations" && effect.operation === "update");
    const movedAgents = outcome?.delta.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "update" && effect.value?.regionId === "region:2:3") ?? [];
    const destinationPopulation = outcome?.delta.entityEffects.find((effect) => effect.collection === "populations" && effect.operation === "create" && effect.value?.regionId === "region:2:3");
    expect(organizationUpdate?.collection === "organizations" ? organizationUpdate.value : undefined).toMatchObject({
      regionId: "region:2:3",
      territoryRegionIds: ["region:2:3"],
      status: "migrating",
    });
    expect(movedAgents).toHaveLength(40);
    expect(destinationPopulation?.value).toMatchObject({ regionId: "region:2:3", count: 80 });
    expect(outcome?.delta.resourceTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: "food", destinationRegionId: "region:2:3", amount: 0.1, causeRuleId: "society:organization-migration" }),
      expect.objectContaining({ resourceId: "materials", destinationRegionId: "region:2:3", amount: 3, causeRuleId: "society:organization-migration" }),
    ]));
    expect(migration).toMatchObject({
      probability: expect.any(Number),
      evidence: expect.objectContaining({ fromRegion: "region:2:2", toRegion: "region:2:3", movedMemberCount: 40, movedPopulationCount: 80 }),
      payload: expect.objectContaining({ organizationId: organization?.id, reason: "food-shortage" }),
    });
  });

  it("moves owned facilities with an organization before facility maintenance", () => {
    const state = territorialWorld(2_050);
    state.tick = 1;
    state.fields.biomass.values.fill(0);
    state.fields.nutrients.values.fill(0.04);
    state.fields.temperature.values.fill(0.1);
    state.fields.humidity.values.fill(0.1);
    state.fields.water.values.fill(0.05);
    const destinationIndex = 3 * state.fields.elevation.width + 2;
    state.fields.biomass.values[destinationIndex] = 0.86;
    state.fields.nutrients.values[destinationIndex] = 0.8;
    state.fields.temperature.values[destinationIndex] = 0.5;
    state.fields.humidity.values[destinationIndex] = 0.55;
    state.fields.water.values[destinationIndex] = 0.45;
    const organization = createOrganization("city", "region:2:2" as never, state.agents.slice(0, 40).map((agent) => agent.id));
    organization.governance = { ...governanceForOrganization(organization), stability: 0.18 };
    state.organizations = [organization];
    state.resources = [{ id: "resource:migration:facility-materials", resourceId: "materials", regionId: organization.regionId, holderId: organization.id, amount: 4, cap: 10, originEventId: "test" }];
    state.facilities = [{
      id: "facility:migration:construction",
      type: "construction",
      regionId: organization.regionId,
      ownerOrganizationId: organization.id,
      level: 1,
      condition: 0.7,
      status: "damaged",
      workforceIds: state.agents.slice(0, 3).map((agent) => agent.id),
      workforceRequired: 3,
      workforceEfficiency: 1,
      materialInvested: 3,
      plannedTick: 0,
      builtTick: 0,
      lastMaintainedTick: 0,
      lastIncidentTick: 0,
    }];

    const outcome = Array.from({ length: 128 }, (_, seed) => {
      const candidate = structuredClone(state);
      candidate.seed += seed;
      candidate.random = { value: candidate.random.value + seed };
      return { delta: stepTerritories(candidate), candidate };
    }).find(({ delta }) => delta.eventDrafts.some((event) => event.kind === "organization-migration"));

    const facilityUpdate = outcome?.delta.entityEffects.find((effect) => effect.collection === "facilities" && effect.operation === "update" && effect.id === "facility:migration:construction");
    expect(facilityUpdate?.collection === "facilities" ? facilityUpdate.value : undefined).toMatchObject({ regionId: "region:2:3" });
  });

  it("does not move shared members away from a neighboring organization", () => {
    const state = territorialWorld(2_100);
    state.tick = 1;
    state.fields.biomass.values.fill(0);
    state.fields.nutrients.values.fill(0.04);
    state.fields.temperature.values.fill(0.1);
    state.fields.humidity.values.fill(0.1);
    state.fields.water.values.fill(0.05);
    const destinationIndex = 3 * state.fields.elevation.width + 2;
    state.fields.biomass.values[destinationIndex] = 0.86;
    state.fields.nutrients.values[destinationIndex] = 0.8;
    state.fields.temperature.values[destinationIndex] = 0.5;
    state.fields.humidity.values[destinationIndex] = 0.55;
    state.fields.water.values[destinationIndex] = 0.45;
    const sharedMembers = state.agents.slice(0, 40).map((agent) => agent.id);
    const organization = createOrganization("city", "region:2:2" as never, sharedMembers);
    const peer = createOrganization("state", "region:2:2" as never, sharedMembers);
    organization.governance = { ...governanceForOrganization(organization), stability: 0.18 };
    peer.governance = { ...governanceForOrganization(peer), stability: 0.18 };
    state.organizations = [organization, peer];

    const delta = stepTerritories(state);

    expect(delta.eventDrafts.some((event) => event.kind === "organization-migration")).toBe(false);
    expect(delta.entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "update")).toBe(false);
  });

  it("creates a conserved trade transfer between touching settlements", () => {
    const outcome = Array.from({ length: 128 }, (_, tick) => {
      const state = territorialWorld(700 + tick);
      state.tick = tick;
      const left = createOrganization("settlement", "region:2:2" as never, state.agents.slice(0, 20).map((agent) => agent.id));
      const right = createOrganization("settlement", "region:3:2" as never, state.agents.slice(40, 60).map((agent) => agent.id));
      state.organizations = [left, right];
      state.resources = [{ id: "food:left", resourceId: "food", regionId: left.regionId, holderId: left.id, amount: 2, cap: 5, originEventId: "food" }];
      return stepSupplyChains(state);
    }).find((delta) => delta.eventDrafts.some((event) => event.kind === "interregional-trade"));

    expect(outcome?.resourceTransactions).toContainEqual(expect.objectContaining({
      operation: "transfer",
      destinationRegionId: "region:3:2",
      causeRuleId: "society:interregional-trade",
    }));
    expect(outcome?.entityEffects.some((effect) => effect.collection === "organizations"
      && effect.operation === "update"
      && Object.values(effect.value?.diplomacy ?? {}).includes("trade"))).toBe(true);
  });

  it("allows touching settlements to trade across the planetary map seam", () => {
    const outcome = Array.from({ length: 128 }, (_, tick) => {
      const state = territorialWorld(800 + tick);
      state.tick = tick;
      const west = createOrganization("settlement", "region:0:2" as never, state.agents.slice(0, 20).map((agent) => agent.id));
      const east = createOrganization("settlement", "region:7:2" as never, state.agents.slice(40, 60).map((agent) => agent.id));
      state.organizations = [west, east];
      state.resources = [{ id: "food:west", resourceId: "food", regionId: west.regionId, holderId: west.id, amount: 2, cap: 5, originEventId: "food" }];
      return stepSupplyChains(state);
    }).find((delta) => delta.eventDrafts.some((event) => event.kind === "interregional-trade"));

    expect(outcome?.eventDrafts).toContainEqual(expect.objectContaining({
      kind: "interregional-trade",
      evidence: expect.objectContaining({ fromRegion: "region:0:2", toRegion: "region:7:2" }),
    }));
  });

  it("records a border conflict when peer cities contest the same cell", () => {
    const outcome = Array.from({ length: 256 }, (_, tick) => {
      const state = territorialWorld(900 + tick);
      state.tick = tick;
      const left = createOrganization("city", "region:2:2" as never, state.agents.slice(0, 40).map((agent) => agent.id));
      const right = createOrganization("city", "region:3:2" as never, state.agents.slice(40).map((agent) => agent.id));
      state.organizations = [left, right];
      return stepTerritories(state);
    }).find((delta) => delta.eventDrafts.some((event) => event.kind === "border-conflict"));

    expect(["region:2:2", "region:3:2"]).toContain(outcome?.eventDrafts.find((event) => event.kind === "border-conflict")?.payload.regionId);
    expect(outcome?.relationshipEffects).toContainEqual(expect.objectContaining({ relationship: expect.objectContaining({ kind: "rival" }) }));
  });

  it("settles an interregional war into casualties, population losses, and a territorial outcome", () => {
    const state = territorialWorld(1_505);
    state.tick = 5;
    const left = createOrganization("city", "region:2:2" as never, state.agents.slice(0, 40).map((agent) => agent.id));
    const right = createOrganization("city", "region:3:2" as never, state.agents.slice(40).map((agent) => agent.id));
    left.diplomacy = { [right.id]: "rival" };
    right.diplomacy = { [left.id]: "rival" };
    left.governance = { ...governanceForOrganization(left), military: 0.95, stability: 0.9, cohesion: 0.9, lastConflictTick: -1 };
    right.governance = { ...governanceForOrganization(right), military: 0.12, stability: 0.18, cohesion: 0.2, lastConflictTick: -1 };
    state.organizations = [left, right];
    state.resources = [{ id: "resource:food:left", resourceId: "food", regionId: left.regionId, holderId: left.id, amount: 8, cap: 10, originEventId: "food" }];
    const result = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false });

    const war = result.events.find((event) => event.kind === "organization-war");
    expect(war).toMatchObject({ payload: expect.objectContaining({ result: expect.stringMatching(/conquest|absorbed|repelled/) }) });
    expect(war?.evidence.casualties).toBeGreaterThan(0);
    expect(result.state.agents.length).toBeLessThan(state.agents.length);
    expect(result.state.populations.reduce((sum, population) => sum + population.count, 0)).toBeLessThan(state.populations.reduce((sum, population) => sum + population.count, 0));
    expect(result.state.organizations.some((organization) => organization.governance?.lastConflictTick === state.tick)).toBe(true);
    expect(result.events.some((event) => event.kind === "territory-transfer")).toBe(true);
    const displaced = Array.isArray(war?.payload.displaced) ? war.payload.displaced.map(String) : [];
    const winner = result.state.organizations.find((organization) => organization.id === war?.payload.winnerOrganizationId);
    const loser = result.state.organizations.find((organization) => organization.id === war?.payload.loserOrganizationId);
    expect(displaced.length).toBeGreaterThan(0);
    expect(displaced.every((agentId) => winner?.memberIds.includes(agentId as never))).toBe(true);
    expect(displaced.every((agentId) => !loser?.memberIds.includes(agentId as never))).toBe(true);
  });
});
