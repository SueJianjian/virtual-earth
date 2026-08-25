import { describe, expect, it } from "vitest";
import { createOrganization, organizationCapacity } from "../../src/sim/society/organization.ts";
import { attemptOrganizationFormation } from "../../src/sim/society/formation.ts";
import { governOrganization } from "../../src/sim/society/governance.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { SocietyContext } from "../../src/sim/types.ts";

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

  it("can form a tribe under synthetic social conditions without forced upgrades", () => {
    const outcomes = Array.from({ length: 48 }, (_, index) => attemptOrganizationFormation(makeContext(50 + index, 12), "tribe"));
    const formed = outcomes.find((outcome) => outcome.status === "applied");
    expect(formed?.value?.type).toBe("tribe");
    expect(formed?.value?.childOrganizationIds).toEqual([]);
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
});
