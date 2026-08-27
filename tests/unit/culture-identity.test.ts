import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createCultureIdentity, culturalCompatibility, ensureCultureIdentity, evolveCultureIdentity } from "../../src/sim/culture/identity.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { governOrganization } from "../../src/sim/society/governance.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";

const regionId = "region:2:2" as never;

describe("cultural identity", () => {
  it("creates deterministic, bounded identities and recovers legacy records", () => {
    const first = createCultureIdentity("culture:seed", regionId, 12, 3, [], { water: 0.7, nutrients: 0.6, biomass: 0.5 });
    const second = createCultureIdentity("culture:seed", regionId, 12, 3, [], { water: 0.7, nutrients: 0.6, biomass: 0.5 });
    const different = createCultureIdentity("culture:other", regionId, 12, 3, [], { water: 0.7, nutrients: 0.6, biomass: 0.5 });
    const recovered = ensureCultureIdentity({ id: "culture:legacy" as never, regionId, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8 });

    expect(first).toEqual(second);
    expect(first.noveltySignature).not.toBe(different.noveltySignature);
    expect(first.traditions.length).toBeGreaterThan(0);
    expect(first.traditions.length).toBeLessThanOrEqual(6);
    expect(Object.values(first.values).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(recovered.identity).toMatchObject({ name: expect.any(String), originRegionId: regionId, noveltySignature: expect.any(String) });
  });

  it("evolves a traceable identity while preserving bounded values and traditions", () => {
    const first = createCultureIdentity("culture:evolution", regionId, 1, 1);
    const second = evolveCultureIdentity(first, "culture:evolution", 12, [], { water: 0.2, nutrients: 0.9, biomass: 0.1 }, ["construction", "energy", "governance"]);

    expect(second.generation).toBe(1);
    expect(second.originRegionId).toBe(first.originRegionId);
    expect(second.originTick).toBe(first.originTick);
    expect(second.noveltySignature).not.toBe(first.noveltySignature);
    expect(second.traditions.length).toBeLessThanOrEqual(6);
    expect(Object.values(second.values).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });

  it("feeds cultural values into governance and compatibility", () => {
    const makeState = (cooperation: number, stewardship: number) => {
      const state = createWorld(410, { width: 8, height: 8, formation: "formed" });
      const species = createSpecies("culture-governance", "consumer");
      const population = { id: `population:culture:${cooperation}` as never, speciesId: species.id, regionId, count: 32, energy: 1 };
      const agents = Array.from({ length: 32 }, (_, index) => createAgent(population, species, index, "culture-governance"));
      const organization = createOrganization("city", regionId, agents.map((agent) => agent.id));
      const identity = createCultureIdentity(`culture:governance:${cooperation}:${stewardship}`, regionId, 1, 1);
      identity.values = { cooperation, reciprocity: cooperation, hierarchy: 0.5, curiosity: cooperation, tradition: cooperation, stewardship };
      state.species = [species];
      state.populations = [population];
      state.agents = agents;
      state.cultures = [{ id: `culture:governance:${cooperation}` as never, regionId, knowledgeIds: [], beliefIds: [], transmissionRate: 0.8, identity }];
      return { state, organization };
    };
    const low = makeState(0, 0);
    const high = makeState(1, 1);
    const governanceFor = (state: ReturnType<typeof makeState>["state"], organization: ReturnType<typeof makeState>["organization"]) => {
      const update = governOrganization(state, organization).entityEffects.find((effect) => effect.collection === "organizations" && effect.operation === "update");
      if (!update?.value) throw new Error("Expected governed organization update");
      if (!("governance" in update.value)) throw new Error("Expected organization value");
      return update.value.governance!;
    };
    const lowGovernance = governanceFor(low.state, low.organization);
    const highGovernance = governanceFor(high.state, high.organization);
    const identity = high.state.cultures[0]!.identity!;

    expect(highGovernance.publicGoods).toBeGreaterThan(lowGovernance.publicGoods);
    expect(highGovernance.stability).toBeGreaterThan(lowGovernance.stability);
    expect(culturalCompatibility(identity, identity)).toBe(1);
    expect(culturalCompatibility(identity, low.state.cultures[0]!.identity!)).toBeLessThan(1);
  });
});
