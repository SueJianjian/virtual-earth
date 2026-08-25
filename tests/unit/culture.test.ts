import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { applyCultureDelta, stepCulture } from "../../src/sim/culture/index.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { PopulationState, WorldDelta } from "../../src/sim/types.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

describe("knowledge and culture", () => {
  it("forms culture from social individuals and transmits non-mythic knowledge", () => {
    const world = createWorld(31, { width: 8, height: 8 });
    const species = createSpecies("mind", "consumer");
    const population: PopulationState = {
      id: "population:mind" as PopulationState["id"],
      speciesId: species.id,
      regionId: "region:0:0" as PopulationState["regionId"],
      count: 10,
      energy: 1,
    };
    const first = createAgent(population, species, 0, "culture");
    const second = createAgent(population, species, 1, "culture");
    for (const agent of [first, second]) {
      agent.skills = { observation: 0.8, communication: 0.8, toolUse: 0.4 };
      agent.traits.sociality = 0.8;
    }
    world.agents = [first, second];
    const delta = stepCulture(world, emptyDelta());
    const next = applyCultureDelta(world, delta);

    expect(next.cultures).toHaveLength(1);
    expect(next.cultures[0]?.knowledgeIds.length).toBeGreaterThan(0);
    expect(next.knowledge.every((knowledge) => knowledge.kind.startsWith("practice:"))).toBe(true);
    expect(next.agents.every((agent) => agent.knowledgeIds.length > 0)).toBe(true);
    expect(next.cultures[0]?.beliefIds).toEqual([]);
  });
});
