import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { stepTerritories } from "../../src/sim/society/territory.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { WorldState } from "../../src/sim/types.ts";

const territorialWorld = (seed: number): WorldState => {
  const state = createWorld(seed, { width: 8, height: 8 });
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

  it("creates a conserved trade transfer between touching settlements", () => {
    const outcome = Array.from({ length: 128 }, (_, tick) => {
      const state = territorialWorld(700 + tick);
      state.tick = tick;
      const left = createOrganization("settlement", "region:2:2" as never, state.agents.slice(0, 20).map((agent) => agent.id));
      const right = createOrganization("settlement", "region:3:2" as never, state.agents.slice(40, 60).map((agent) => agent.id));
      state.organizations = [left, right];
      state.resources = [{ id: "food:left", resourceId: "food", regionId: left.regionId, holderId: left.id, amount: 2, cap: 5, originEventId: "food" }];
      return stepTerritories(state);
    }).find((delta) => delta.eventDrafts.some((event) => event.kind === "interregional-trade"));

    expect(outcome?.resourceTransactions).toContainEqual(expect.objectContaining({
      operation: "transfer",
      destinationRegionId: "region:3:2",
      causeRuleId: "society:interregional-trade",
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
});
