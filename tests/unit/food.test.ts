import { describe, expect, it } from "vitest";
import { createAgent, foodPerCapitaForAgent, foodSecurityForAgent, meanFoodSecurity, stepAgents } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { metricsFor } from "../../src/sim/engine.ts";
import { createWorld } from "../../src/sim/world.ts";
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
});
