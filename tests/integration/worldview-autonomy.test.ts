import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";

describe("worldview autonomy integration", () => {
  it("does not create supernatural entities from an ineligible blank world", () => {
    const state = createWorld(110, { width: 8, height: 8, enabledPackIds: ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"] });
    const result = stepWorld(state, { elapsedYears: 100, externalEvents: [] });
    expect(result.state.worldview.entities).toEqual([]);
    expect(worldDigest(result.state)).toBe(result.digest);
  });

  it("places emergent worldview entities in a real active region", () => {
    const packs = ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"];
    let state = createWorld(123, { width: 16, height: 8, enabledPackIds: packs });
    for (let index = 0; index < 1_200; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    expect(state.worldview.entities.length).toBeGreaterThan(0);
    expect(state.worldview.discoveredRuleIds.length).toBeGreaterThan(0);
    expect(state.worldview.entities.every((entity) => /^region:\d+:\d+$/.test(entity.regionId))).toBe(true);
    expect(state.worldview.entities.some((entity) => entity.regionId === "region:origin")).toBe(false);
  }, 15_000);

  it("builds original observations, theories, myths and verified principles through a traceable chain", () => {
    const regionId = "region:3:2" as never;
    let state = createWorld(321, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"] });
    state.species = [{ id: "species:observer" as never, role: "consumer", traits: { cognitivePotential: 0.8 } }];
    state.populations = [{ id: "population:observer" as never, speciesId: state.species[0]!.id, regionId, count: 24, energy: 1 }];
    state.cultures = [{
      id: "culture:observer" as never,
      regionId,
      knowledgeIds: ["knowledge:one", "knowledge:two", "knowledge:three", "knowledge:four"],
      beliefIds: [],
      transmissionRate: 0.8,
    }];

    for (let index = 0; index < 400 && state.worldview.phenomena.length < 4; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    const records = state.worldview.phenomena;
    expect(records.map((record) => record.epistemicStatus).sort()).toEqual(["believed", "hypothesized", "observed", "verified"]);
    const byId = new Map(records.map((record) => [record.id, record]));
    expect(records.filter((record) => record.epistemicStatus !== "observed").every((record) => record.parentIds.length > 0)).toBe(true);
    expect(records.every((record) => record.parentIds.every((id) => (byId.get(id)?.originTick ?? Infinity) < record.originTick))).toBe(true);
    const myth = records.find((record) => record.epistemicStatus === "believed");
    const verified = records.find((record) => record.epistemicStatus === "verified");
    expect(verified?.parentIds).toContain(myth?.id);
    expect(state.cultures[0]?.beliefIds.some((id) => id.startsWith("belief:phenomenon:"))).toBe(true);
    expect(records.every((record) => record.regionId === regionId)).toBe(true);
  }, 15_000);
});
