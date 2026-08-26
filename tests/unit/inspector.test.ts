import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { projectMicroRegion, summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import { lineageForSnapshot, renderInspector } from "../../src/ui/inspector.ts";
import type { RegionId } from "../../src/sim/types.ts";
import type { WorldSnapshot } from "../../src/worker/protocol.ts";

const region = "region:0:0" as RegionId;

const lineageSnapshot = (): WorldSnapshot => {
  const state = createWorld(140, { width: 8, height: 8 });
  const species = createSpecies("lineage", "consumer");
  const population = { id: "population:lineage" as never, speciesId: species.id, regionId: region, count: 8, energy: 1 };
  const first = createAgent(population, species, 0, "lineage");
  const second = createAgent(population, species, 1, "lineage");
  const older = createAgent(population, species, 2, "lineage", [first.id, second.id]);
  const younger = createAgent(population, species, 3, "lineage", [first.id, second.id]);
  first.knowledgeIds = ["knowledge:fire"];
  older.knowledgeIds = ["knowledge:fire"];
  younger.beliefIds = ["belief:ancestors"];
  state.species = [species];
  state.populations = [population];
  state.agents = [first, second, older, younger];
  state.relationships = [
    createRelationship("partner", first.id, second.id, 1, 0.8),
    createRelationship("parent", first.id, older.id, 2, 0.9),
    createRelationship("caregiver", second.id, younger.id, 2, 0.8),
    createRelationship("sibling", older.id, younger.id, 2, 0.85),
  ];
  state.organizations = [createOrganization("family", region, state.agents.map((agent) => agent.id))];
  return {
    tick: state.tick,
    years: state.years,
    digest: "test",
    fields: state.fields,
    chemistry: state.chemistry,
    metrics: {},
    projection: projectMicroRegion(state, region),
    selectedRegion: summarizeRegionState(state, region, "micro"),
  };
};

describe("region lineage inspector", () => {
  it("derives live family and inheritance metrics from a micro projection", () => {
    const lineage = lineageForSnapshot(lineageSnapshot());

    expect(lineage).toMatchObject({
      source: "micro",
      householdCount: 1,
      population: 4,
      relationshipCount: 4,
      descendantCount: 2,
      generationDepth: 2,
      knowledgeCarrierCount: 1,
      knowledgeInheritanceCount: 1,
      beliefCarrierCount: 1,
      foodBalance: 0,
      foodPerAgent: 0,
      foodSecurity: 0,
    });
    expect(lineage.relationshipCounts).toMatchObject({ partner: 1, parent: 1, caregiver: 1, sibling: 1 });
    expect(lineage.families[0]?.memberCount).toBe(4);
    expect(lineage.familyLineages[0]).toMatchObject({ memberCount: 4, relationshipCount: 4, descendantCount: 2, knowledgeInheritanceCount: 1 });
  });

  it("uses conserved lineage metrics for an aggregate region", () => {
    const snapshot = lineageSnapshot();
    snapshot.selectedRegion = { ...snapshot.selectedRegion!, mode: "aggregate" };
    snapshot.projection = { ...snapshot.projection!, agents: [], relationships: [], organizations: [] };

    const lineage = lineageForSnapshot(snapshot);

    expect(lineage.source).toBe("aggregate");
    expect(lineage.descendantCount).toBe(2);
    expect(lineage.knowledgeCarrierCount).toBe(1);
    expect(lineage.knowledgeInheritanceCount).toBe(1);
    expect(lineage.relationshipCounts.sibling).toBe(1);
  });

  it("renders physical, ecological and social values with explicit units", () => {
    const snapshot = lineageSnapshot();
    snapshot.worldviewPhenomena = [{
      id: "phenomenon:observed",
      packId: "emergence.original-worldview",
      kind: "natural-anomaly",
      epistemicStatus: "observed",
      name: "晶息回响",
      regionId: region,
      originTick: 12,
      parentIds: [],
      causeRuleId: "original-anomaly-observation",
      evidence: { anomalyStrength: 0.4 },
    }, {
      id: "phenomenon:theory",
      packId: "emergence.original-worldview",
      kind: "cultural-theory",
      epistemicStatus: "hypothesized",
      name: "晶息观测律",
      regionId: region,
      originTick: 18,
      parentIds: ["phenomenon:observed"],
      causeRuleId: "original-cultural-theory",
      evidence: { knowledgeDiversity: 3 },
    }];
    const practitionerId = snapshot.projection?.agents[0]?.id;
    if (!practitionerId) throw new Error("Expected a projected agent for practice report");
    snapshot.worldviewPractices = [{
      id: "practice:crystal",
      packId: "emergence.original-worldview",
      name: "晶息共鸣法",
      phenomenonId: "phenomenon:theory",
      regionId: region,
      practitionerId,
      originTick: 22,
      lastTrainedTick: 24,
      attunement: 0.31,
      energy: 0.42,
      attempts: 4,
      failures: 1,
      status: "active",
    }];
    const element = { innerHTML: "" } as HTMLElement;
    renderInspector(element, snapshot, { x: 0, y: 0, index: 0, regionId: region });

    expect(element.innerHTML).toContain("行星坐标");
    expect(element.innerHTML).toContain("模拟海拔");
    expect(element.innerHTML).toContain("°C");
    expect(element.innerHTML).toContain("m");
    expect(element.innerHTML).toContain("相对浓度");
    expect(element.innerHTML).toContain("户");
    expect(element.innerHTML).toContain("食物单位");
    expect(element.innerHTML).toContain("认知与传说");
    expect(element.innerHTML).toContain("已观测");
    expect(element.innerHTML).toContain("文明理论");
    expect(element.innerHTML).toContain("源自 晶息回响");
    expect(element.innerHTML).toContain("规律训练");
    expect(element.innerHTML).toContain("晶息共鸣法");
    expect(element.innerHTML).toContain("训练中");
    expect(element.innerHTML).toContain("能量 42/100");
  });
});
