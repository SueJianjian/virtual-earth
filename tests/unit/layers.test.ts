import { describe, expect, it } from "vitest";
import { createWorld } from "../../src/sim/world.ts";
import { colorForCell } from "../../src/ui/layers.ts";
import type { WorldSnapshot } from "../../src/worker/protocol.ts";
import { createCultureIdentity } from "../../src/sim/culture/identity.ts";

describe("food security map layer", () => {
  it("uses regional security rather than a global value", () => {
    const world = createWorld(201, { width: 2, height: 1 });
    const snapshot: WorldSnapshot = {
      seed: world.seed,
      tick: 0,
      years: 0,
      formation: world.formation,
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
      seed: world.seed,
      tick: 0,
      years: 0,
      formation: world.formation,
      digest: "",
      fields: world.fields,
      chemistry: world.chemistry,
      metrics: {},
    };

    expect(colorForCell(snapshot, 0, "carbon")).not.toEqual(colorForCell(snapshot, 1, "carbon"));
    expect(colorForCell(snapshot, 0, "oxygen")).not.toEqual(colorForCell(snapshot, 1, "oxygen"));
  });

  it("renders regional emergent-matter richness without scanning global state", () => {
    const world = createWorld(203, { width: 2, height: 1 });
    const snapshot: WorldSnapshot = {
      seed: world.seed,
      tick: 0,
      years: 0,
      formation: world.formation,
      digest: "",
      fields: world.fields,
      chemistry: world.chemistry,
      metrics: {},
      substanceRichnessByRegion: { "region:0:0": 0, "region:1:0": 0.9 },
    };

    expect(colorForCell(snapshot, 0, "substances")).not.toEqual(colorForCell(snapshot, 1, "substances"));
  });

  it("renders a stable cultural distribution from regional identity signatures", () => {
    const world = createWorld(204, { width: 2, height: 1, formation: "formed" });
    const snapshot: WorldSnapshot = {
      seed: world.seed,
      tick: 0,
      years: 0,
      formation: world.formation,
      digest: "",
      fields: world.fields,
      chemistry: world.chemistry,
      metrics: {},
      cultureIdentityByRegion: {
        "region:0:0": createCultureIdentity("culture-map:left", "region:0:0" as never, 2, 2),
        "region:1:0": createCultureIdentity("culture-map:right", "region:1:0" as never, 2, 2),
      },
    };

    expect(colorForCell(snapshot, 0, "culture")).not.toEqual(colorForCell(snapshot, 1, "culture"));
    expect(colorForCell(snapshot, 0, "culture")).toEqual(colorForCell(snapshot, 0, "culture"));
  });
});
