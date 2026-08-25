import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
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
});
