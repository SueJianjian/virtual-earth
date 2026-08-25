import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createRelationship } from "../../src/sim/agents/relationships.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { projectMicroRegion, summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import { lineageForSnapshot } from "../../src/ui/inspector.ts";
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
      beliefCarrierCount: 1,
      foodBalance: 0,
      foodPerAgent: 0,
      foodSecurity: 0,
    });
    expect(lineage.relationshipCounts).toMatchObject({ partner: 1, parent: 1, caregiver: 1, sibling: 1 });
    expect(lineage.families[0]?.memberCount).toBe(4);
  });

  it("uses conserved lineage metrics for an aggregate region", () => {
    const snapshot = lineageSnapshot();
    snapshot.selectedRegion = { ...snapshot.selectedRegion!, mode: "aggregate" };
    snapshot.projection = { ...snapshot.projection!, agents: [], relationships: [], organizations: [] };

    const lineage = lineageForSnapshot(snapshot);

    expect(lineage.source).toBe("aggregate");
    expect(lineage.descendantCount).toBe(2);
    expect(lineage.knowledgeCarrierCount).toBe(1);
    expect(lineage.relationshipCounts.sibling).toBe(1);
  });
});
