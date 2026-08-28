import { describe, expect, it } from "vitest";
import { createWorld } from "../../src/sim/world.ts";
import { messageTransferables, snapshotTransferables } from "../../src/worker/transfer.ts";
import type { WorldSnapshot } from "../../src/worker/protocol.ts";

describe("worker snapshot transfer", () => {
  it("transfers every dense grid buffer exactly once", () => {
    const world = createWorld(205, { width: 8, height: 8, formation: "formed" });
    const snapshot: WorldSnapshot = {
      seed: world.seed,
      tick: world.tick,
      years: world.years,
      formation: world.formation,
      digest: "test",
      fields: structuredClone(world.fields),
      chemistry: structuredClone(world.chemistry),
      metrics: {},
      foodSecurity: { width: 8, height: 8, values: new Float32Array(64) },
      diseasePrevalence: { width: 8, height: 8, values: new Float32Array(64) },
    };

    const buffers = snapshotTransferables(snapshot);

    expect(buffers).toHaveLength(13);
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(buffers).toContain(snapshot.fields.water.values.buffer);
    expect(buffers).toContain(snapshot.chemistry.oxygen.values.buffer);
    expect(buffers).toContain(snapshot.foodSecurity!.values.buffer);
    expect(buffers).toContain(snapshot.diseasePrevalence!.values.buffer);
    expect(messageTransferables({ type: "events", events: [] })).toEqual([]);

    const received = structuredClone(snapshot, { transfer: buffers });
    expect(snapshot.fields.water.values.byteLength).toBe(0);
    expect(received.fields.water.values).toHaveLength(64);
    expect(received.foodSecurity?.values).toHaveLength(64);
    expect(received.diseasePrevalence?.values).toHaveLength(64);
  });
});
