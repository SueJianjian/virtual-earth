import { describe, expect, it } from "vitest";
import { createWorld } from "../../src/sim/world.ts";
import { colorForCell } from "../../src/ui/layers.ts";
import type { WorldSnapshot } from "../../src/worker/protocol.ts";

describe("food security map layer", () => {
  it("uses regional security rather than a global value", () => {
    const world = createWorld(201, { width: 2, height: 1 });
    const snapshot: WorldSnapshot = {
      tick: 0,
      years: 0,
      digest: "",
      fields: world.fields,
      chemistry: world.chemistry,
      metrics: {},
      foodSecurityByRegion: { "region:0:0": 0, "region:1:0": 1 },
    };

    expect(colorForCell(snapshot, 0, "foodSecurity")).not.toEqual(colorForCell(snapshot, 1, "foodSecurity"));
  });

  it("renders local carbon and oxygen chemistry as distinct overlays", () => {
    const world = createWorld(202, { width: 2, height: 1 });
    world.chemistry.carbon.values.set([0, 1]);
    world.chemistry.oxygen.values.set([0, 1]);
    const snapshot: WorldSnapshot = {
      tick: 0,
      years: 0,
      digest: "",
      fields: world.fields,
      chemistry: world.chemistry,
      metrics: {},
    };

    expect(colorForCell(snapshot, 0, "carbon")).not.toEqual(colorForCell(snapshot, 1, "carbon"));
    expect(colorForCell(snapshot, 0, "oxygen")).not.toEqual(colorForCell(snapshot, 1, "oxygen"));
  });
});
