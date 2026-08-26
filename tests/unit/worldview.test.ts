import { describe, expect, it, beforeEach } from "vitest";
import { clearSimulationStages, registerSimulationStage, stepWorld } from "../../src/sim/engine.ts";
import { createWorld, assertBlankWorld } from "../../src/sim/world.ts";
import { createWorldviewState, DEFAULT_WORLDVIEW_PACK_IDS, listWorldviewPacks, stepWorldviews } from "../../src/sim/worldview/index.ts";
import { regionIdForWorldview } from "../../src/sim/worldview/rules.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import type { WorldDelta, WorldviewContext } from "../../src/sim/types.ts";

const highContext = (state: ReturnType<typeof createWorld>): WorldviewContext => ({
  state,
  random: state.random,
  enabledPackIds: state.worldview.enabledPackIds,
  metrics: {
    meanTemperature: 0.5, meanHumidity: 0.6, waterCoverage: 0.4, nutrientLevel: 0.5, biomass: 0.3, oxygen: 0.1,
    carbon: 0.2, organics: 0.1, oceanCoverage: 0.4, terrainRelief: 0.1,
    populationCount: 80, cognitivePotential: 4, knowledgeDiversity: 5, beliefDiversity: 0, householdCount: 4, settlementDensity: 2,
    tradeVolume: 0, foodSurplus: 0, organizationCapacity: 20, resourceBalance: 0,
    foodSecurity: 0,
  },
});

describe("worldview packs", () => {
  beforeEach(() => clearSimulationStages());

  it("registers the original emergence pack alongside optional legacy motifs without seeding records", () => {
    const packs = listWorldviewPacks();
    expect(packs.map((pack) => pack.id)).toEqual([
      "cultivation.path",
      "emergence.original-worldview",
      "mythology.chinese-motif",
      "mythology.greek-motif",
      "mythology.indian-motif",
      "mythology.norse-motif",
    ]);
    const world = createWorld(100, { width: 8, height: 8, enabledPackIds: packs.map((pack) => pack.id) });
    expect(world.worldview.enabledPackIds).toEqual(packs.map((pack) => pack.id));
    expect(DEFAULT_WORLDVIEW_PACK_IDS).toEqual(["emergence.original-worldview"]);
    expect(() => assertBlankWorld(world)).not.toThrow();
    expect(world.resources).toEqual([]);
    expect(world.worldview.phenomena).toEqual([]);
  });

  it("returns only constrained effects and is deterministic for the same state", () => {
    const first = createWorld(101, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"] });
    const second = structuredClone(first);
    const firstDelta = stepWorldviews(first, highContext(first));
    const secondDelta = stepWorldviews(second, highContext(second));
    expect(firstDelta).toEqual(secondDelta);
    expect(firstDelta.worldviewEffects.every((effect) => "kind" in effect)).toBe(true);
    expect(firstDelta.worldviewEffects.every((effect) => effect.kind !== "propose-entity" || effect.evidence.eligible === true)).toBe(true);
  });

  it("derives a deterministic real region instead of a synthetic origin", () => {
    const world = createWorld(101, { width: 8, height: 8 });
    world.populations = [{ id: "population:region" as never, speciesId: "species:region" as never, regionId: "region:3:2" as never, count: 12, energy: 1 }];
    const first = regionIdForWorldview({ ...highContext(world), state: world });
    const second = regionIdForWorldview({ ...highContext(world), state: structuredClone(world) });
    expect(first).toBe("region:3:2");
    expect(second).toBe(first);
    expect(first).not.toBe("region:origin");
  });

  it("forms a worldview entity only through enabled-pack reducer validation", () => {
    const world = createWorld(102, { width: 8, height: 8, enabledPackIds: ["cultivation.path"] });
    const delta: WorldDelta = {
      fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [],
      worldviewEffects: [{ kind: "propose-entity", packId: "cultivation.path", entityKind: "cultivation-path", regionId: "region:origin" as never, evidence: { eligible: true }, probability: 0.1 }],
    };
    registerSimulationStage({ id: "worldview-test", order: 1, run: () => delta });
    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });
    expect(result.state.worldview.entities).toHaveLength(1);
    expect(result.state.worldview.entities[0]?.kind).toBe("cultivation-path");
  });

  it("records energy consumption and a setback instead of silently granting progress", () => {
    const regionId = "region:1:1" as never;
    const world = createWorld(103, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"] });
    const species = createSpecies("practice", "consumer");
    const population = { id: "population:practice" as never, speciesId: species.id, regionId, count: 8, energy: 1 };
    const agent = createAgent(population, species, 0, "practice");
    world.species = [species];
    world.populations = [population];
    world.agents = [agent];
    world.worldview.phenomena = [{
      id: "phenomenon:principle",
      packId: "emergence.original-worldview",
      kind: "verified-principle",
      epistemicStatus: "verified",
      name: "晶息响应定律",
      regionId,
      originTick: 1,
      parentIds: [],
      causeRuleId: "test",
      evidence: {},
    }];
    world.worldview.practices = [{
      id: "practice:one",
      packId: "emergence.original-worldview",
      name: "析晶训练法",
      phenomenonId: "phenomenon:principle",
      regionId,
      practitionerId: agent.id,
      originTick: 1,
      lastTrainedTick: 1,
      attunement: 0.1,
      energy: 0.2,
      attempts: 0,
      failures: 0,
      status: "active",
    }];
    const delta: WorldDelta = {
      fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], eventDrafts: [],
      worldviewEffects: [{
        kind: "train-practice",
        packId: "emergence.original-worldview",
        practiceId: "practice:one",
        outcome: "setback",
        energyGain: 0.02,
        energySpent: 0.11,
        attunementDelta: -0.012,
        evidence: { trainingRoll: 0.9 },
      }],
    };
    registerSimulationStage({ id: "worldview", order: 70, run: () => delta });

    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });

    const practice = result.state.worldview.practices[0];
    expect(practice?.energy).toBeCloseTo(0.11);
    expect(practice?.attunement).toBeCloseTo(0.088);
    expect(practice).toMatchObject({ attempts: 1, failures: 1, status: "active" });
  });
});
