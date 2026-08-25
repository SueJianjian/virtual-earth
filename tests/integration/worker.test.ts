import { describe, expect, it, beforeEach } from "vitest";
import { createSimulationRuntime } from "../../src/worker/runtime.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { clearSimulationStages } from "../../src/sim/engine.ts";

describe("simulation worker runtime", () => {
  beforeEach(() => clearSimulationStages());

  it("steps deterministically and remains unchanged while paused", () => {
    const runtime = createSimulationRuntime(createWorld(130, { width: 8, height: 8 }));
    runtime.dispatch({ type: "step", count: 1 });
    runtime.dispatch({ type: "pause" });
    const digest = worldDigest(runtime.getState());
    runtime.dispatch({ type: "pause" });
    expect(worldDigest(runtime.getState())).toBe(digest);
    expect(runtime.isPaused()).toBe(true);
  });

  it("keeps the configured speed in the runtime protocol", () => {
    const runtime = createSimulationRuntime(createWorld(134, { width: 8, height: 8 }));
    runtime.dispatch({ type: "setSpeed", multiplier: 16 });
    expect(runtime.getSpeed()).toBe(16);
    expect(runtime.dispatch({ type: "setSpeed", multiplier: 4 })[0]).toMatchObject({ type: "snapshot", speed: 4 });
  });

  it("does not apply the same event ID twice", () => {
    const runtime = createSimulationRuntime(createWorld(131, { width: 8, height: 8 }));
    const event = { id: "user:event:1", kind: "add-water", regionId: "region:0:0" as never, intensity: 0.5, duration: 1, source: "user" as const, payload: { amount: 0.5 } };
    runtime.dispatch({ type: "applyEvent", event });
    const duplicate = runtime.dispatch({ type: "applyEvent", event });
    expect(runtime.getState().events.filter((candidate) => candidate.id === event.id)).toHaveLength(1);
    expect(duplicate).toEqual([{ type: "error", code: "duplicate", message: `Event already applied: ${event.id}` }]);
  });

  it("focuses without changing authoritative digest", () => {
    const runtime = createSimulationRuntime(createWorld(132, { width: 8, height: 8 }));
    const before = worldDigest(runtime.getState());
    runtime.dispatch({ type: "focusRegion", regionId: "region:1:1" as never });
    expect(worldDigest(runtime.getState())).toBe(before);
  });

  it("restores saves and preserves the current world on load errors", () => {
    const runtime = createSimulationRuntime(createWorld(133, { width: 8, height: 8 }));
    runtime.dispatch({ type: "step", count: 2 });
    const saved = runtime.dispatch({ type: "save" })[0];
    expect(saved?.type).toBe("saved");
    if (saved?.type !== "saved") return;
    const beforeError = worldDigest(runtime.getState());
    const error = runtime.dispatch({ type: "load", payload: "{" });
    expect(error[0]?.type).toBe("error");
    expect(worldDigest(runtime.getState())).toBe(beforeError);
    const restored = createSimulationRuntime(createWorld(1, { width: 8, height: 8 }));
    restored.dispatch({ type: "load", payload: saved.payload });
    expect(worldDigest(restored.getState())).toBe(saved.digest);
  });

  it("restores a read-only focus without changing the authoritative digest", () => {
    const runtime = createSimulationRuntime(createWorld(135, { width: 8, height: 8 }));
    runtime.dispatch({ type: "focusRegion", regionId: "region:2:3" as never });
    const before = worldDigest(runtime.getState());
    const saved = runtime.dispatch({ type: "save" })[0];
    expect(saved?.type).toBe("saved");
    if (saved?.type !== "saved") return;
    const restored = createSimulationRuntime(createWorld(1, { width: 8, height: 8 }));
    const messages = restored.dispatch({ type: "load", payload: saved.payload });
    expect(messages[0]).toMatchObject({ type: "snapshot", snapshot: { focusRegionId: "region:2:3" } });
    expect(worldDigest(restored.getState())).toBe(before);
    expect(restored.getState().observation.projection?.readOnly).toBe(true);
  });
});
