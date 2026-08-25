import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";

describe("world persistence", () => {
  it("round-trips authoritative state and typed grids", () => {
    const world = createWorld(120, { width: 8, height: 8, enabledPackIds: ["cultivation.path"] });
    world.observation = { focusRegionId: "region:1:1" as never };
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.fields.elevation.values).toBeInstanceOf(Float32Array);
    expect(worldDigest(restored)).toBe(worldDigest(world));
    expect(restored.observation).toEqual({ focusRegionId: "region:1:1" });
    expect(restored.worldview.enabledPackIds).toEqual(["cultivation.path"]);
  });

  it("rejects malformed and unsupported saves", () => {
    expect(() => deserializeWorld("not-json")).toThrow("valid JSON");
    expect(() => deserializeWorld(JSON.stringify({ schemaVersion: 2, world: {} }))).toThrow("Unsupported");
    expect(() => deserializeWorld(JSON.stringify({ schemaVersion: 1, world: {} }))).toThrow("missing required fields");
  });

  it("adds conservative lineage defaults to older region summaries", () => {
    const world = createWorld(121, { width: 8, height: 8 });
    world.lod.summaries = [summarizeRegionState(world, "region:0:0" as never, "aggregate")];
    const legacy = JSON.parse(serializeWorld(world)) as { world: { lod: { summaries: Array<{ lineage?: unknown }> } } };
    delete legacy.world.lod.summaries[0]?.lineage;
    delete (legacy.world.lod.summaries[0] as { agentRecords?: unknown }).agentRecords;
    delete (legacy.world.lod.summaries[0] as { familyLineages?: unknown }).familyLineages;
    delete (legacy.world.lod.summaries[0] as { foodBalance?: number; foodPerAgent?: number; foodSecurity?: number }).foodBalance;
    delete (legacy.world.lod.summaries[0] as { foodBalance?: number; foodPerAgent?: number; foodSecurity?: number }).foodPerAgent;
    delete (legacy.world.lod.summaries[0] as { foodBalance?: number; foodPerAgent?: number; foodSecurity?: number }).foodSecurity;

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.lod.summaries[0]?.lineage).toEqual({
      descendantCount: 0,
      generationDepth: 0,
      knowledgeCarrierCount: 0,
      knowledgeInheritanceCount: 0,
      beliefCarrierCount: 0,
      relationshipCounts: {},
    });
    expect(restored.lod.summaries[0]).toMatchObject({ foodBalance: 0, foodPerAgent: 0, foodSecurity: 0 });
    expect(restored.lod.summaries[0]?.agentRecords).toEqual([]);
  });
});
