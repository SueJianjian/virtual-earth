import { describe, expect, it, beforeEach } from "vitest";
import { createGodEvent } from "../../src/ui/god-mode.ts";
import { createSimulationRuntime } from "../../src/worker/runtime.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { clearSimulationStages } from "../../src/sim/engine.ts";

describe("god mode causal events", () => {
  beforeEach(() => clearSimulationStages());

  it("routes interventions through the event ledger and changes environment state", () => {
    const runtime = createSimulationRuntime(createWorld(140, { width: 8, height: 8 }));
    const before = worldDigest(runtime.getState());
    const event = createGodEvent("user:heat:1", "heat", "region:0:0" as never, 1, 1);
    const messages = runtime.dispatch({ type: "applyEvent", event });
    expect(runtime.getState().events.some((candidate) => candidate.id === event.id)).toBe(true);
    expect(worldDigest(runtime.getState())).not.toBe(before);
    expect(messages.some((message) => message.type === "events")).toBe(true);
  });

  it("does not create life directly from seed-life", () => {
    const runtime = createSimulationRuntime(createWorld(141, { width: 8, height: 8 }));
    runtime.dispatch({ type: "applyEvent", event: createGodEvent("user:seed:1", "seed-life", "region:0:0" as never, 1, 1) });
    expect(runtime.getState().species).toEqual([]);
    expect(runtime.getState().populations).toEqual([]);
  });
});
