import { describe, expect, it, beforeEach } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { focusRegion, projectRegion, promoteRegion, stepLod, summarizeRegion, summarizeRegionState } from "../../src/sim/lod/index.ts";
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
    state.agents[2]!.parentIds = [state.agents[0]!.id, state.agents[1]!.id];
    state.agents[2]!.knowledgeIds = ["knowledge:fire"];
    state.agents[2]!.beliefIds = ["belief:ancestors"];
    state.relationships.push(createRelationship("parent", state.agents[0]!.id, state.agents[2]!.id, 2, 0.9));
    state.resources = [{ id: "resource:food:world", resourceId: "food", regionId: region, amount: 1, cap: 10, originEventId: "event:food" }];
    const delta = summarizeRegion(state, region);
    const summary = delta.lodEffects?.[0];
    expect(summary?.operation).toBe("upsert-summary");
    if (summary?.operation !== "upsert-summary") return;
    expect(summary.summary.population).toBe(state.agents.length);
    expect(summary.summary.relationshipCount).toBe(state.relationships.length);
    expect(summary.summary.agentIds).toHaveLength(state.agents.length);
    expect(summary.summary.relationshipRecords.map((relationship) => relationship.id)).toEqual(state.relationships.map((relationship) => relationship.id));
    expect(summary.summary.lineage).toMatchObject({ descendantCount: 1, generationDepth: 2, knowledgeCarrierCount: 1, beliefCarrierCount: 1 });
    expect(summary.summary.lineage.relationshipCounts).toMatchObject({ partner: 1, parent: 1 });
    expect(summary.summary.foodBalance).toBe(1);
    expect(summary.summary.foodPerAgent).toBe(0.25);
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

  it("naturally summarizes a quiet micro region", () => {
    const state = populatedWorld();
    state.agents = [];
    state.relationships = [];
    state.organizations = [];
    state.lod.summaries = [summarizeRegionState(state, region, "micro")];
    const delta = stepLod(state, { elapsedYears: 1, externalEvents: [] }, emptyDelta(), emptyDelta(), emptyDelta());

    expect(delta.lodEffects?.[0]?.operation).toBe("upsert-summary");
    expect(delta.lodEffects?.[0]?.operation === "upsert-summary" && delta.lodEffects[0].summary.mode).toBe("aggregate");
    expect(delta.eventDrafts[0]?.kind).toBe("region-summarized");
  });

  it("promotes an aggregate region only after a recent natural event", () => {
    const state = populatedWorld();
    const summary = summarizeRegionState(state, region, "aggregate");
    state.lod.summaries = [summary];
    state.agents = [];
    state.organizations = [];
    state.events = [{
      id: "event:natural-hotspot",
      tick: state.tick,
      kind: "river-change",
      ruleId: "hydrology:river-change",
      source: "natural",
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { regionId: region },
      payload: { regionId: region },
    }];

    const delta = stepLod(state, { elapsedYears: 1, externalEvents: [] }, emptyDelta(), emptyDelta(), emptyDelta());
    expect(delta.eventDrafts[0]?.kind).toBe("region-promoted");
    expect(delta.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "create")).toHaveLength(summary.population);
    expect(delta.lodEffects?.[0]?.operation === "upsert-summary" && delta.lodEffects[0].summary.mode).toBe("micro");
  });

  it("keeps population and relationship counts stable across explicit summarize and promote", () => {
    const source = populatedWorld();
    const aggregate = summarizeRegionState(source, region, "aggregate");
    const expanded = { ...source, agents: [], relationships: [], organizations: [], lod: { ...source.lod, summaries: [aggregate] } };
    expanded.events = [{
      id: "event:round-trip",
      tick: expanded.tick,
      kind: "rapid-change",
      ruleId: "natural:rapid-change",
      source: "natural",
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { regionId: region },
      payload: { regionId: region },
    }];

    const promotion = stepLod(expanded, { elapsedYears: 1, externalEvents: [] }, emptyDelta(), emptyDelta(), emptyDelta());
    const promotedAgents = promotion.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "create");
    const promotedRelationships = promotion.relationshipEffects.filter((effect) => effect.operation === "create");
    expect(promotedAgents).toHaveLength(aggregate.population);
    expect(promotedRelationships).toHaveLength(aggregate.relationshipCount);

    expect(projectRegion(aggregate, aggregate.version).agents).toHaveLength(aggregate.population);
    expect(projectRegion(aggregate, aggregate.version).relationships).toHaveLength(aggregate.relationshipCount);
  });
});

const emptyDelta = () => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});
