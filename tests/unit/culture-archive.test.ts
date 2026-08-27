import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import { compactCultureRecords, compactKnowledgeRecords, MAX_BELIEFS_PER_CULTURE, MAX_CULTURE_RECORDS, MAX_KNOWLEDGE_PER_AGENT, MAX_KNOWLEDGE_PER_CULTURE, MAX_KNOWLEDGE_RECORDS } from "../../src/sim/culture/archive.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { KnowledgeState, PopulationState, SpeciesState } from "../../src/sim/types.ts";

describe("knowledge archive bounds", () => {
  it("bounds authoritative and holder knowledge while preserving valid provenance", () => {
    const state = createWorld(701, { width: 8, height: 8, formation: "formed" });
    const regionId = "region:1:1" as never;
    const population: PopulationState = { id: "population:knowledge" as never, speciesId: "species:knowledge" as never, regionId, count: 20, energy: 1 };
    const species: SpeciesState = { id: population.speciesId, role: "consumer", traits: { cognitivePotential: 0.8 } };
    state.species = [species];
    state.populations = [population];
    state.agents = [createAgent(population, species, 0, "knowledge-archive")];
    state.knowledge = Array.from({ length: MAX_KNOWLEDGE_RECORDS + 1 }, (_, index): KnowledgeState => ({
      id: `knowledge:bounded:${index}`,
      kind: `innovation:construction:${index}`,
      name: `有界技术 ${index}`,
      domain: "construction",
      sourceIds: [state.agents[0]!.id],
      credibility: (index % 100) / 100,
      transmissionCost: 0.1,
      forgettingRate: 0.01,
      originRegionId: regionId,
      originTick: index,
      originYears: index,
      parentIds: index === 0 ? [] : [`knowledge:bounded:${index - 1}`],
    }));
    const allIds = state.knowledge.map((knowledge) => knowledge.id);
    state.cultures = [{ id: "culture:knowledge" as never, regionId, knowledgeIds: allIds, beliefIds: [], transmissionRate: 0.8 }];
    state.agents[0]!.knowledgeIds = allIds;
    state.agents[0]!.memoryIds = [...allIds, "workplace:retained"];

    expect(compactKnowledgeRecords(state)).toBe(1);

    const retainedIds = new Set(state.knowledge.map((knowledge) => knowledge.id));
    expect(state.knowledge).toHaveLength(MAX_KNOWLEDGE_RECORDS);
    expect(state.cultures[0]!.knowledgeIds.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_PER_CULTURE);
    expect(state.agents[0]!.knowledgeIds.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_PER_AGENT);
    expect(state.cultures[0]!.knowledgeIds.every((id) => retainedIds.has(id))).toBe(true);
    expect(state.agents[0]!.knowledgeIds.every((id) => retainedIds.has(id))).toBe(true);
    expect(state.knowledge.every((knowledge) => (knowledge.parentIds ?? []).every((id) => retainedIds.has(id)))).toBe(true);
    expect(state.agents[0]!.memoryIds).toContain("workplace:retained");
    expect(state.eventArchive.archivedKnowledgeCount).toBe(1);
  });

  it("retains active cultures, bounds beliefs, and archives inactive records", () => {
    const state = createWorld(702, { width: 8, height: 8, formation: "formed" });
    const activeRegionId = "region:active" as never;
    const population: PopulationState = { id: "population:culture" as never, speciesId: "species:culture" as never, regionId: activeRegionId, count: 20, energy: 1 };
    const species: SpeciesState = { id: population.speciesId, role: "consumer", traits: { cognitivePotential: 0.8 } };
    const beliefs = Array.from({ length: MAX_BELIEFS_PER_CULTURE + 6 }, (_, index) => `belief:phenomenon:${index}`);
    state.species = [species];
    state.populations = [population];
    state.agents = [createAgent(population, species, 0, "culture-archive")];
    state.worldview.phenomena = beliefs.map((beliefId, index) => ({
      id: beliefId.slice("belief:".length),
      packId: "test",
      kind: "mythic-tradition" as const,
      epistemicStatus: "believed" as const,
      name: `Phenomenon ${index}`,
      regionId: activeRegionId,
      originTick: index,
      parentIds: [],
      causeRuleId: "test",
      evidence: {},
    }));
    state.cultures = [
      ...Array.from({ length: MAX_CULTURE_RECORDS + 1 }, (_, index) => ({
        id: `culture:inactive:${index}` as never,
        regionId: `region:inactive:${index}` as never,
        knowledgeIds: [],
        beliefIds: [...beliefs],
        transmissionRate: 0.5,
      })),
      { id: "culture:active" as never, regionId: activeRegionId, knowledgeIds: [], beliefIds: [...beliefs], transmissionRate: 0.9 },
    ];

    const removed = compactCultureRecords(state);

    expect(removed).toBe(2);
    expect(state.cultures).toHaveLength(MAX_CULTURE_RECORDS);
    expect(state.cultures.map((culture) => culture.id)).toContain("culture:active");
    expect(state.cultures.every((culture) => culture.beliefIds.length <= MAX_BELIEFS_PER_CULTURE)).toBe(true);
    expect(state.cultures.find((culture) => culture.id === "culture:active")?.beliefIds).toContain("belief:phenomenon:69");
    expect(state.cultures.find((culture) => culture.id === "culture:active")?.beliefIds).not.toContain("belief:phenomenon:0");
    expect(state.eventArchive.archivedCultureCount).toBe(2);
  });
});
