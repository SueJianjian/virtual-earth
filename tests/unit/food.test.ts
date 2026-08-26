import { describe, expect, it } from "vitest";
import { createAgent, foodPerCapitaForAgent, foodSecurityForAgent, foodSecurityForOrganization, meanFoodSecurity, stepAgents } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { metricsFor } from "../../src/sim/engine.ts";
import { createWorld } from "../../src/sim/world.ts";
import { createRandom } from "../../src/sim/random.ts";
import type { WorldDelta } from "../../src/sim/types.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const fixture = () => {
  const state = createWorld(150, { width: 8, height: 8 });
  const species = createSpecies("food-dependent", "consumer");
  const population = { id: "population:food-dependent" as never, speciesId: species.id, regionId: "region:0:0" as never, count: 0, energy: 1 };
  const agents = [0, 1].map((index) => {
    const agent = createAgent(population, species, index, "food-dependent");
    agent.age = 12;
    return agent;
  });
  const family = createOrganization("family", population.regionId, agents.map((agent) => agent.id));
  state.species = [species];
  state.populations = [population];
  state.agents = agents;
  state.organizations = [family];
  return { state, family, agents };
};

describe("food security", () => {
  it("lets local biomass support an organization before food is stockpiled", () => {
    const { state, family } = fixture();
    state.fields.biomass.values[0] = 0.02;
    state.fields.nutrients.values[0] = 0.5;

    expect(foodSecurityForOrganization(state, family)).toBeGreaterThan(0.45);
  });

  it("turns held food into bounded per-agent security without counting it twice", () => {
    const { state, family, agents } = fixture();
    state.resources = [{
      id: "resource:food:family",
      resourceId: "food",
      regionId: agents[0]!.regionId,
      holderId: family.id,
      amount: 1,
      cap: 1,
      originEventId: "event:food",
    }];

    expect(foodPerCapitaForAgent(state, agents[0]!)).toBeCloseTo(0.5);
    expect(foodSecurityForAgent(state, agents[0]!)).toBe(1);
    expect(meanFoodSecurity(state)).toBe(1);
    expect(metricsFor(state).foodSecurity).toBe(1);
  });

  it("lets held food offset the annual hunger drain in the agent lifecycle", () => {
    const withoutFood = fixture();
    const withFood = fixture();
    withFood.state.resources = [{
      id: "resource:food:family",
      resourceId: "food",
      regionId: withFood.agents[0]!.regionId,
      holderId: withFood.family.id,
      amount: 1,
      cap: 1,
      originEventId: "event:food",
    }];

    const hungry = stepAgents(withoutFood.state, emptyDelta(), 1).entityEffects.find((effect) => effect.collection === "agents" && effect.id === withoutFood.agents[0]!.id && effect.value);
    const fed = stepAgents(withFood.state, emptyDelta(), 1).entityEffects.find((effect) => effect.collection === "agents" && effect.id === withFood.agents[0]!.id && effect.value);
    expect(hungry?.collection === "agents" && hungry.value?.needs.food).toBeCloseTo(0.49);
    expect(fed?.collection === "agents" && fed.value?.needs.food).toBeCloseTo(0.5);
  });

  it("records held food as a positive condition for forming a family", () => {
    const familyEvent = Array.from({ length: 64 }, (_, seed) => {
      const { state, agents } = fixture();
      state.random = createRandom(seed + 1);
      agents.forEach((agent) => {
        agent.age = 25;
        agent.traits.sociality = 1;
        agent.traits.cooperation = 1;
      });
      state.organizations = [createOrganization("clan", agents[0]!.regionId, agents.map((agent) => agent.id))];
      state.resources = [{
        id: "resource:food:clan",
        resourceId: "food",
        regionId: agents[0]!.regionId,
        holderId: state.organizations[0]!.id,
        amount: 1,
        cap: 1,
        originEventId: "event:food",
      }];
      return stepAgents(state, emptyDelta(), 1).eventDrafts.find((event) => event.kind === "family-formation");
    }).find((event) => event !== undefined);
    expect(familyEvent?.evidence.foodSecurity).toBeGreaterThan(0);
  });

  it("reduces hunger mortality without bypassing the lifespan boundary", () => {
    const deathCount = (withFood: boolean): number => Array.from({ length: 2048 }, (_, seed) => {
      const { state, agents } = fixture();
      state.random = createRandom(seed + 1);
      agents.forEach((agent) => {
        agent.age = Math.floor(agent.lifespan * 0.83);
        agent.needs.food = 0;
      });
      if (withFood) {
        state.organizations = [createOrganization("clan", agents[0]!.regionId, agents.map((agent) => agent.id))];
        state.resources = [{ id: "resource:food:clan", resourceId: "food", regionId: agents[0]!.regionId, holderId: state.organizations[0]!.id, amount: 1, cap: 1, originEventId: "event:food" }];
      } else {
        state.organizations = [];
      }
      return stepAgents(state, emptyDelta(), 1).entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "remove").length;
    }).reduce((sum, count) => sum + count, 0);

    expect(deathCount(true)).toBeLessThan(deathCount(false));

    const { state, agents } = fixture();
    agents[0]!.age = agents[0]!.lifespan;
    agents[0]!.needs.food = 0;
    agents[1]!.age = 0;
    agents[1]!.needs.food = 0.5;
    state.organizations = [createOrganization("clan", agents[0]!.regionId, agents.map((agent) => agent.id))];
    state.resources = [{ id: "resource:food:clan", resourceId: "food", regionId: agents[0]!.regionId, holderId: state.organizations[0]!.id, amount: 10, cap: 10, originEventId: "event:food" }];
    const boundaryDelta = stepAgents(state, emptyDelta(), 1);
    expect(boundaryDelta.entityEffects).toContainEqual({ collection: "agents", operation: "remove", id: agents[0]!.id });
    expect(boundaryDelta.eventDrafts.find((event) => event.kind === "agent-death")?.evidence).toMatchObject({ deaths: 1, hungerDeaths: 0, meanFoodSecurity: 1 });
  });
});
