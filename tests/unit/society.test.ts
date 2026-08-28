import { describe, expect, it } from "vitest";
import { createOrganization, organizationCapacity } from "../../src/sim/society/organization.ts";
import { attemptOrganizationFormation } from "../../src/sim/society/formation.ts";
import { createGovernanceIndex, governOrganization } from "../../src/sim/society/governance.ts";
import { stepSociety } from "../../src/sim/society/step.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { SocietyContext, WorldState } from "../../src/sim/types.ts";
import { createFoodBalanceIndex } from "../../src/sim/agents/food.ts";

const makeContext = (seed: number, count: number): SocietyContext => {
  const state = createWorld(seed, { width: 8, height: 8 });
  const species = createSpecies(`social:${seed}`, "consumer");
  species.traits.cognitivePotential = 0.8;
  const population = {
    id: `population:${seed}` as never,
    speciesId: species.id,
    regionId: "region:0:0" as never,
    count: count * 2,
    energy: 1,
  };
  state.species = [species];
  state.populations = [population];
  state.agents = Array.from({ length: count }, (_, index) => {
    const agent = createAgent(population, species, index, `social:${seed}`);
    agent.age = 25;
    agent.traits.cooperation = 0.9;
    agent.traits.sociality = 0.9;
    return agent;
  });
  state.cultures = [{ id: "culture:region-0-0" as never, regionId: "region:0:0" as never, knowledgeIds: ["knowledge:1", "knowledge:2"], beliefIds: [], transmissionRate: 0.8 }];
  state.organizations = Array.from({ length: Math.max(2, Math.floor(count / 2)) }, (_, index) => createOrganization("family", "region:0:0" as never, state.agents.slice(index * 2, index * 2 + 2).map((agent) => agent.id)));
  state.relationships = state.agents.slice(0, -1).map((agent, index) => createRelationship("friend", agent.id, state.agents[index + 1]!.id, 0, 0.7));
  return { state, random: state.random, metrics: {} as never, regionId: "region:0:0" as never, candidateMemberIds: state.agents.map((agent) => agent.id) };
};

describe("emergent society", () => {
  it("does not form a city without population and knowledge conditions", () => {
    const context = makeContext(40, 4);
    expect(attemptOrganizationFormation(context, "city").status).toBe("skipped");
    expect(attemptOrganizationFormation(context, "state").status).toBe("skipped");
  });

  it("rejects an undersized organization before inspecting social ledgers", () => {
    const context = makeContext(401, 4);
    Object.defineProperty(context.state, "relationships", {
      configurable: true,
      get: () => { throw new Error("undersized formation inspected relationships"); },
    });

    expect(attemptOrganizationFormation(context, "city").status).toBe("skipped");
  });

  it("can form a tribe under synthetic social conditions without forced upgrades", () => {
    const outcomes = Array.from({ length: 48 }, (_, index) => attemptOrganizationFormation(makeContext(50 + index, 12), "tribe"));
    const formed = outcomes.find((outcome) => outcome.status === "applied");
    expect(formed?.value?.type).toBe("tribe");
    expect(formed?.value?.childOrganizationIds.length).toBeGreaterThan(0);
  });

  it("reduces capacity with scarce resources and collapses after member loss", () => {
    const context = makeContext(70, 12);
    const organization = createOrganization("settlement", "region:0:0" as never, context.candidateMemberIds);
    const rich = { ...organization, resources: { food: 20 } };
    const poor = { ...organization, resources: { food: 0 } };
    expect(organizationCapacity(rich, context)).toBeGreaterThan(organizationCapacity(poor, context));
    const reducedState = { ...context.state, agents: context.state.agents.slice(0, 1) } as never;
    const delta = governOrganization(reducedState, organization);
    expect(delta.entityEffects).toContainEqual(expect.objectContaining({ operation: "update", value: expect.objectContaining({ status: "collapsed" }) }));
  });

  it("preserves enough baseline capacity for a valid organization", () => {
    const context = makeContext(71, 4);
    const family = createOrganization("family", "region:0:0" as never, context.candidateMemberIds.slice(0, 2));

    expect(organizationCapacity(family, context)).toBeGreaterThanOrEqual(2);
    expect(governOrganization(context.state, family).entityEffects).not.toContainEqual(
      expect.objectContaining({ value: expect.objectContaining({ status: "fragmenting" }) }),
    );
  });

  it("collapses an organization below its type-specific member floor", () => {
    const context = makeContext(72, 4);
    const settlement = createOrganization("settlement", "region:0:0" as never, context.candidateMemberIds);

    expect(governOrganization(context.state, settlement).entityEffects).toContainEqual(
      expect.objectContaining({ value: expect.objectContaining({ status: "collapsed" }) }),
    );
  });

  it("keeps high-order organizations supplied by local members", () => {
    const context = makeContext(73, 36);
    const city = createOrganization("city", "region:0:0" as never, context.candidateMemberIds.slice(0, 2));
    const delta = governOrganization(context.state, city);
    expect(delta.entityEffects).toContainEqual(expect.objectContaining({
      operation: "update",
      value: expect.objectContaining({ memberIds: expect.arrayContaining(context.candidateMemberIds) }),
    }));
  });

  it("derives auditable governance values from supply, cohesion, and membership", () => {
    const context = makeContext(731, 36);
    const city = createOrganization("city", "region:0:0" as never, context.candidateMemberIds);
    const delta = governOrganization(context.state, city);
    const update = delta.entityEffects.find((effect) => effect.collection === "organizations" && effect.id === city.id && effect.operation === "update");

    expect(update?.collection === "organizations" ? update.value?.governance : undefined).toMatchObject({
      stability: expect.any(Number),
      legitimacy: expect.any(Number),
      military: expect.any(Number),
      taxRate: expect.any(Number),
      taxRevenue: expect.any(Number),
    });
    const governance = update?.collection === "organizations" ? update.value?.governance : undefined;
    expect(governance?.stability).toBeGreaterThanOrEqual(0);
    expect(governance?.stability).toBeLessThanOrEqual(1);
    expect(governance?.taxRevenue).toBeGreaterThan(0);
  });

  it("keeps supplied governance indexes identical to direct calculation", () => {
    const context = makeContext(732, 36);
    const city = createOrganization("city", "region:0:0" as never, context.candidateMemberIds);
    const state = structuredClone(context.state) as WorldState;
    state.organizations.push(city);
    state.resources = [
      { id: "resource:local", resourceId: "materials", regionId: city.regionId, holderId: city.id, amount: 4, cap: 10, originEventId: "test" },
      { id: "resource:foreign", resourceId: "materials", regionId: "region:1:0" as never, holderId: city.id, amount: 7, cap: 10, originEventId: "test" },
    ];

    const direct = governOrganization(state, city);
    const indexed = governOrganization(
      state,
      city,
      createGovernanceIndex(state),
      createFoodBalanceIndex(state),
    );

    expect(indexed).toEqual(direct);
  });

  it("puts a large organization under food-driven fragmentation pressure", () => {
    const context = makeContext(74, 80);
    const city = createOrganization("city", "region:0:0" as never, context.candidateMemberIds);
    const poorState = structuredClone(context.state) as WorldState;
    poorState.organizations = [city];
    const poorDelta = governOrganization(poorState, city);
    expect(poorDelta.entityEffects).toContainEqual(expect.objectContaining({
      operation: "update",
      value: expect.objectContaining({ status: "fragmenting" }),
    }));

    const richState = structuredClone(poorState) as WorldState;
    richState.resources = [{ id: "resource:food:city", resourceId: "food", regionId: "region:0:0" as never, holderId: city.id, amount: 80, cap: 100, originEventId: "event:food" }];
    const richDelta = governOrganization(richState, city);
    expect(richDelta.entityEffects).not.toContainEqual(expect.objectContaining({
      value: expect.objectContaining({ status: "fragmenting" }),
    }));
  });

  it("uses governance and energy facilities in annual public administration", () => {
    const context = makeContext(507, 40);
    const city = createOrganization("city", "region:0:0" as never, context.candidateMemberIds);
    const base = structuredClone(context.state) as WorldState;
    base.organizations = [city];
    base.resources = [{ id: "resource:food:city", resourceId: "food", regionId: city.regionId, holderId: city.id, amount: 80, cap: 100, originEventId: "test" }];
    const governanceFor = (state: WorldState) => {
      const update = governOrganization(state, state.organizations[0]!).entityEffects.find((effect) => effect.collection === "organizations" && effect.operation === "update");
      return update?.collection === "organizations" ? update.value?.governance : undefined;
    };
    const baseline = governanceFor(base);
    const supported = structuredClone(base);
    supported.facilities = ["governance", "energy"].map((type, index) => ({
      id: `facility:${type}:government`, type: type as "governance" | "energy", regionId: city.regionId, ownerOrganizationId: city.id,
      level: 3 as const, condition: 1, status: "active" as const, workforceIds: city.memberIds.slice(0, 4), materialInvested: 10,
      plannedTick: 1, builtTick: 2, lastMaintainedTick: 2, lastIncidentTick: index,
    }));
    const facilityBacked = governanceFor(supported);

    expect(facilityBacked?.publicGoods).toBeGreaterThan(baseline?.publicGoods ?? 0);
    expect(facilityBacked?.legitimacy).toBeGreaterThan(baseline?.legitimacy ?? 0);
    expect(facilityBacked?.taxRevenue).toBeGreaterThan(baseline?.taxRevenue ?? 0);
  });

  it("records allocation, trade, and consumption through the resource ledger", () => {
    const context = makeContext(74, 12);
    const left = createOrganization("settlement", "region:0:0" as never, context.candidateMemberIds.slice(0, 8));
    const right = createOrganization("settlement", "region:0:0" as never, context.candidateMemberIds.slice(4, 12));
    const state = structuredClone(context.state) as WorldState;
    state.organizations = [left, right];
    state.resources = [{
      id: "resource:food:world",
      resourceId: "food",
      regionId: "region:0:0" as never,
      amount: 2,
      cap: 10,
      originEventId: "event:food",
    }];

    const delta = stepSociety(state, { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] }, { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
    expect(delta.resourceTransactions.some((transaction) => transaction.operation === "transfer")).toBe(true);
    expect(delta.resourceTransactions.some((transaction) => transaction.operation === "consume")).toBe(true);
    expect(delta.eventDrafts.some((event) => event.kind === "organization-trade")).toBe(true);
  });

  it("can produce a deterministic organization conflict from eligible peers", () => {
    const outcomes = Array.from({ length: 96 }, (_, seed) => {
      const context = makeContext(90 + seed, 60);
      const state = structuredClone(context.state) as WorldState;
      state.organizations = [
        createOrganization("city", "region:0:0" as never, context.candidateMemberIds.slice(0, 30)),
        createOrganization("city", "region:0:0" as never, context.candidateMemberIds.slice(30, 60)),
      ];
      return stepSociety(state, { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] }, { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
    });
    const conflict = outcomes.find((delta) => delta.eventDrafts.some((event) => event.kind === "organization-conflict"));
    expect(conflict?.relationshipEffects).toContainEqual(expect.objectContaining({ relationship: expect.objectContaining({ kind: "rival" }) }));
    expect(conflict?.eventDrafts.find((event) => event.kind === "organization-conflict")?.roll).toBeGreaterThanOrEqual(0);
  });

  it("keeps state, federation, and empire formation as independent evidence-based rules", () => {
    const outcomes = (type: "state" | "federation" | "empire") => Array.from({ length: 96 }, (_, seed) => {
      const context = makeContext(190 + seed, 220);
      const state = structuredClone(context.state) as WorldState;
      state.cultures[0]!.knowledgeIds = ["knowledge:1", "knowledge:2", "knowledge:3", "knowledge:4"];
      const ids = context.candidateMemberIds;
      state.organizations = type === "state"
        ? [createOrganization("settlement", "region:0:0" as never, ids.slice(0, 30)), createOrganization("settlement", "region:0:0" as never, ids.slice(30, 60))]
        : type === "federation"
          ? [createOrganization("city", "region:0:0" as never, ids.slice(0, 30)), createOrganization("city", "region:0:0" as never, ids.slice(30, 60)), createOrganization("city", "region:0:0" as never, ids.slice(60, 90))]
          : [createOrganization("state", "region:0:0" as never, ids.slice(0, 80)), createOrganization("state", "region:0:0" as never, ids.slice(80, 160))];
      return attemptOrganizationFormation({ ...context, state }, type);
    });
    expect(outcomes("state").some((outcome) => outcome.status === "applied")).toBe(true);
    expect(outcomes("federation").some((outcome) => outcome.status === "applied")).toBe(true);
    expect(outcomes("empire").some((outcome) => outcome.status === "applied")).toBe(true);
  }, 15_000);
});
