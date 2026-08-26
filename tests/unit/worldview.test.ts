import { describe, expect, it, beforeEach } from "vitest";
import { clearSimulationStages, registerSimulationStage, stepWorld } from "../../src/sim/engine.ts";
import { createWorld, assertBlankWorld } from "../../src/sim/world.ts";
import { createWorldviewState, listWorldviewPacks, stepWorldviews } from "../../src/sim/worldview/index.ts";
import { regionIdForWorldview } from "../../src/sim/worldview/rules.ts";
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

  it("registers four mythology motifs plus cultivation without seeding entities", () => {
    const packs = listWorldviewPacks();
    expect(packs.map((pack) => pack.id)).toEqual([
      "cultivation.path",
      "mythology.chinese-motif",
      "mythology.greek-motif",
      "mythology.indian-motif",
      "mythology.norse-motif",
    ]);
    const world = createWorld(100, { width: 8, height: 8, enabledPackIds: packs.map((pack) => pack.id) });
    expect(world.worldview.enabledPackIds).toEqual(packs.map((pack) => pack.id));
    expect(() => assertBlankWorld(world)).not.toThrow();
    expect(world.resources).toEqual([]);
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
});
