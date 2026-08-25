import { describe, expect, it, beforeEach } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { focusRegion, projectRegion, promoteRegion, summarizeRegion, summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { clearSimulationStages } from "../../src/sim/engine.ts";
import type { AgentState, RegionId } from "../../src/sim/types.ts";

const region = "region:0:0" as RegionId;

const populatedWorld = () => {
  const state = createWorld(90, { width: 8, height: 8 });
  const species = createSpecies("lod", "consumer");
  const population = { id: "population:lod" as never, speciesId: species.id, regionId: region, count: 8, energy: 1 };
  state.species = [species];
  state.populations = [population];
  state.agents = Array.from({ length: 4 }, (_, index) => createAgent(population, species, index, "lod"));
  state.relationships = [createRelationship("partner", state.agents[0]!.id, state.agents[1]!.id, 1, 0.8)];
  state.organizations = [createOrganization("family", region, [state.agents[0]!.id, state.agents[1]!.id])];
  return state;
};

describe("conserved multi-scale state", () => {
  beforeEach(() => clearSimulationStages());

  it("focuses without changing authoritative digest or random state", () => {
    const state = populatedWorld();
    const before = worldDigest(state);
    const randomBefore = state.random.value;
    const observation = focusRegion(state, region);
    expect(observation.projection?.readOnly).toBe(true);
    expect(worldDigest(state)).toBe(before);
    expect(state.random.value).toBe(randomBefore);
  });

  it("reconstructs the same projection from the same summary", () => {
    const state = populatedWorld();
    const summary = summarizeRegionState(state, region, "aggregate");
    expect(projectRegion(summary, 4)).toEqual(projectRegion(summary, 4));
    expect(projectRegion(summary, 4).generatedFromDigest).toBe(summary.canonicalDigest);
  });

  it("summarizes population and relationships without losing the source counts", () => {
    const state = populatedWorld();
    const delta = summarizeRegion(state, region);
    const summary = delta.lodEffects?.[0];
    expect(summary?.operation).toBe("upsert-summary");
    if (summary?.operation !== "upsert-summary") return;
    expect(summary.summary.population).toBe(state.agents.length);
    expect(summary.summary.relationshipCount).toBe(state.relationships.length);
    expect(delta.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "remove")).toHaveLength(state.agents.length);
    expect(delta.relationshipEffects.filter((effect) => effect.operation === "remove")).toHaveLength(state.relationships.length);
  });

  it("promotes only an aggregate summary and produces stable micro entities", () => {
    const state = populatedWorld();
    const summary = summarizeRegionState(state, region, "aggregate");
    state.lod.summaries = [summary];
    state.agents = [];
    const delta = promoteRegion(state, region, "rapid-change");
    expect(delta.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "create")).toHaveLength(4);
    expect(delta.relationshipEffects.filter((effect) => effect.operation === "create")).toHaveLength(1);
    expect(delta.lodEffects?.[0]?.operation).toBe("upsert-summary");
    expect(delta.lodEffects?.[0]?.operation === "upsert-summary" && delta.lodEffects[0].summary.mode).toBe("micro");
    if (delta.lodEffects?.[0]?.operation === "upsert-summary") {
      expect(delta.lodEffects[0].summary.organizations.map((organization) => organization.type)).toContain("family");
    }
  });
});
