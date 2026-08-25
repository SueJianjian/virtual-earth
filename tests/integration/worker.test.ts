import { describe, expect, it, beforeEach } from "vitest";
import { createSimulationRuntime } from "../../src/worker/runtime.ts";
import { createWorld, worldDigest } from "../../src/sim/world.ts";
import { clearSimulationStages } from "../../src/sim/engine.ts";
import { createAgent } from "../../src/sim/agents/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";

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

  it("refreshes the focused projection after authoritative steps", () => {
    const runtime = createSimulationRuntime(createWorld(136, { width: 8, height: 8 }));
    const focused = runtime.dispatch({ type: "focusRegion", regionId: "region:1:1" as never })[0];
    const stepped = runtime.dispatch({ type: "step", count: 1 })[0];
    expect(focused?.type === "snapshot" && focused.snapshot.projection?.sourceRevision).toBe(0);
    expect(stepped?.type === "snapshot" && stepped.snapshot.projection?.sourceRevision).toBe(1);
  });

  it("refreshes aggregate food fields after authoritative resource changes", () => {
    const state = createWorld(137, { width: 8, height: 8 });
    const region = "region:1:1" as never;
    state.lod.summaries = [{
      regionId: region,
      version: 0,
      mode: "aggregate",
      population: 10,
      populationByAge: { bins: {} },
      skillHistogram: { bins: {} },
      cultureHistogram: { bins: {} },
      householdCount: 0,
      organizations: [],
      agentIds: [],
      agentRecords: [],
      relationshipCount: 0,
      relationshipDigest: "0",
      relationshipRecords: [],
      lineage: { descendantCount: 0, generationDepth: 0, knowledgeCarrierCount: 0, knowledgeInheritanceCount: 0, beliefCarrierCount: 0, relationshipCounts: {} },
      familyLineages: [],
      foodBalance: 0,
      foodPerAgent: 0,
      foodSecurity: 0,
      resources: [],
      migrationRate: 0,
      historyIds: [],
      random: { ...state.random },
      canonicalDigest: "0",
    }];
    state.resources = [{ id: "resource:food:aggregate", resourceId: "food", regionId: region, amount: 2, cap: 4, originEventId: "event:food" }];
    const runtime = createSimulationRuntime(state);
    const snapshot = runtime.dispatch({ type: "focusRegion", regionId: region })[0];
    expect(snapshot?.type === "snapshot" && snapshot.snapshot.selectedRegion).toMatchObject({ foodBalance: 2, foodPerAgent: 0.2, foodSecurity: 0.4 });
    expect(snapshot?.type === "snapshot" && snapshot.snapshot.foodSecurityByRegion?.[region]).toBe(0.4);
  });

  it("uses micro agents, aggregate summaries, then populations for regional food security", () => {
    const state = createWorld(138, { width: 8, height: 8 });
    const species = createSpecies("security", "consumer");
    const microPopulation = { id: "population:micro" as never, speciesId: species.id, regionId: "region:0:0" as never, count: 10, energy: 1 };
    const fallbackPopulation = { id: "population:fallback" as never, speciesId: species.id, regionId: "region:2:0" as never, count: 8, energy: 1 };
    state.species = [species];
    state.populations = [microPopulation, fallbackPopulation];
    state.agents = [
      createAgent(microPopulation, species, 0, "security"),
      createAgent(microPopulation, species, 1, "security"),
    ];
    state.lod.summaries = [{
      regionId: "region:1:0" as never,
      version: 0,
      mode: "aggregate",
      population: 10,
      populationByAge: { bins: {} }, skillHistogram: { bins: {} }, cultureHistogram: { bins: {} }, householdCount: 0,
      organizations: [], agentIds: [], agentRecords: [], relationshipCount: 0, relationshipDigest: "0", relationshipRecords: [],
      lineage: { descendantCount: 0, generationDepth: 0, knowledgeCarrierCount: 0, knowledgeInheritanceCount: 0, beliefCarrierCount: 0, relationshipCounts: {} },
      familyLineages: [],
      foodBalance: 0, foodPerAgent: 0, foodSecurity: 0, resources: [], migrationRate: 0, historyIds: [], random: { ...state.random }, canonicalDigest: "0",
    }];
    state.resources = [
      { id: "food:micro", resourceId: "food", regionId: "region:0:0" as never, amount: 1, cap: 2, originEventId: "event:food" },
      { id: "food:aggregate", resourceId: "food", regionId: "region:1:0" as never, amount: 2, cap: 2, originEventId: "event:food" },
      { id: "food:fallback", resourceId: "food", regionId: "region:2:0" as never, amount: 2, cap: 2, originEventId: "event:food" },
    ];
    const runtime = createSimulationRuntime(state);
    const before = worldDigest(runtime.getState());
    const message = runtime.dispatch({ type: "pause" })[0];

    expect(message?.type === "snapshot" && message.snapshot.foodSecurityByRegion).toMatchObject({
      "region:0:0": 1,
      "region:1:0": 0.4,
      "region:2:0": 0.5,
    });
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
