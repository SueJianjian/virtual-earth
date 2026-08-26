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

  it("applies a duration-limited intervention across steps and then expires it", () => {
    const runtime = createSimulationRuntime(createWorld(142, { width: 8, height: 8 }));
    const control = createSimulationRuntime(createWorld(142, { width: 8, height: 8 }));
    const event = createGodEvent("user:heat:duration", "heat", "region:0:0" as never, 1, 2);
    runtime.dispatch({ type: "applyEvent", event });
    control.dispatch({ type: "step", count: 1 });
    const afterFirst = runtime.getState().fields.temperature.values[0] ?? 0;
    const controlFirst = control.getState().fields.temperature.values[0] ?? 0;
    runtime.dispatch({ type: "step", count: 1 });
    control.dispatch({ type: "step", count: 1 });
    const afterSecond = runtime.getState().fields.temperature.values[0] ?? 0;
    const controlSecond = control.getState().fields.temperature.values[0] ?? 0;
    runtime.dispatch({ type: "step", count: 1 });
    control.dispatch({ type: "step", count: 1 });
    const afterExpiry = runtime.getState().fields.temperature.values[0] ?? 0;
    const controlAfterExpiry = control.getState().fields.temperature.values[0] ?? 0;

    expect(afterFirst).toBeGreaterThan(controlFirst);
    expect(afterSecond).toBeGreaterThan(controlSecond);
    expect(afterExpiry).toBeCloseTo(controlAfterExpiry, 6);
  });
});
