import { describe, expect, it, beforeEach } from "vitest";
import { appendEvents, appendExternalEvents, materializeEvent } from "../../src/sim/events/ledger.ts";
import { derivePhase } from "../../src/sim/events/phase.ts";
import { clearSimulationStages, listSimulationStages, registerSimulationStage, stepWorld } from "../../src/sim/engine.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { RegionId, ResourceTransaction, WorldDelta, WorldEventDraft } from "../../src/sim/types.ts";
import { worldDigest } from "../../src/sim/world.ts";

const draft: WorldEventDraft = {
  kind: "test-event",
  ruleId: "test-rule",
  sourceIds: [],
  probability: 0.5,
  roll: 0.25,
  evidence: { water: 0.5 },
  payload: { stable: true },
  source: "natural",
};

describe("rule engine and event ledger", () => {
  beforeEach(() => clearSimulationStages());

  it("deduplicates stable event IDs", () => {
    const first = materializeEvent(draft, 4, 0);
    expect(appendEvents([first], [draft], 4)).toHaveLength(1);
  });

  it("does not change a natural event ID when evidence key order changes", () => {
    const reordered = { ...draft, evidence: { other: true, water: 0.5 } };
    const original = { ...draft, evidence: { water: 0.5, other: true } };
    expect(materializeEvent(original, 4, 0).id).toBe(materializeEvent(reordered, 4, 0).id);
  });

  it("derives display phase without making it part of world state", () => {
    const world = createWorld(8, { width: 8, height: 8 });
    expect(derivePhase(world)).toBe("primordial");
    expect("phase" in world).toBe(false);
  });

  it("runs only registered data stages and advances the authoritative clock", () => {
    const world = createWorld(12, { width: 8, height: 8 });
    const result = stepWorld(world, { elapsedYears: 100, externalEvents: [] });

    expect(listSimulationStages().map((stage) => stage.id)).toEqual(["environment", "ecology", "agents", "culture", "society", "lod", "worldview"]);
    expect(result.state.tick).toBe(1);
    expect(result.state.years).toBe(100);
    expect(result.state.worldview.entities).toHaveLength(0);
  });

  it("applies each external event once and digests the full authoritative state", () => {
    const world = createWorld(12, { width: 8, height: 8 });
    const external = { ...materializeEvent(draft, 0, 9), kind: "add-water", payload: { amount: 0.1 } };
    const first = stepWorld(world, { elapsedYears: 1, externalEvents: [external] });
    const second = stepWorld(first.state, { elapsedYears: 1, externalEvents: [external] });

    expect(appendExternalEvents([], [external, external])).toHaveLength(1);
    expect(first.state.events.filter((event) => event.id === external.id)).toHaveLength(1);
    expect(second.state.events.filter((event) => event.id === external.id)).toHaveLength(1);
    expect(first.digest).toBe(worldDigest(first.state));
    expect(first.digest).not.toBe(second.digest);
  });

  it("moves resource balances through the typed reducer", () => {
    const world = createWorld(13, { width: 8, height: 8 });
    const regionId = "region:0:0" as RegionId;
    const stage = {
      id: "resource-test",
      order: 1,
      run: (): WorldDelta => ({
        fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], worldviewEffects: [], eventDrafts: [],
        resourceTransactions: [
          { id: "mint-1", resourceId: "food", regionId, amount: 10, operation: "mint", source: "environment", sourceId: "rain", toHolderId: "a", causeRuleId: "test" },
          { id: "transfer-1", resourceId: "food", regionId, amount: 4, operation: "transfer", source: "culture", sourceId: "trade", fromHolderId: "a", toHolderId: "b", causeRuleId: "test" },
          { id: "consume-1", resourceId: "food", regionId, amount: 1, operation: "consume", source: "culture", sourceId: "meal", fromHolderId: "b", causeRuleId: "test" },
          { id: "cross-region-1", resourceId: "food", regionId, destinationRegionId: "region:1:0" as RegionId, amount: 2, operation: "transfer", source: "culture", sourceId: "caravan", fromHolderId: "a", toHolderId: "c", causeRuleId: "test" },
        ] satisfies ResourceTransaction[],
      }),
    };
    clearSimulationStages();
    registerSimulationStage(stage);
    const { state } = stepWorld(world, { elapsedYears: 1, externalEvents: [] });
    expect(state.resources.find((entry) => entry.holderId === "a")?.amount).toBe(4);
    expect(state.resources.find((entry) => entry.holderId === "b")?.amount).toBe(3);
    expect(state.resources.find((entry) => entry.holderId === "c")?.regionId).toBe("region:1:0");
    expect(state.resources.find((entry) => entry.holderId === "c")?.amount).toBe(2);
    expect(state.resources.reduce((sum, entry) => sum + entry.amount, 0)).toBe(9);
  });

  it("keeps default stages when an extension stage is registered", () => {
    clearSimulationStages();
    registerSimulationStage({
      id: "extension",
      order: 35,
      run: () => ({
        fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
        resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
      }),
    });
    stepWorld(createWorld(14, { width: 8, height: 8 }), { elapsedYears: 1, externalEvents: [] });
    expect(listSimulationStages().map((stage) => stage.id)).toEqual(["environment", "ecology", "agents", "extension", "culture", "society", "lod", "worldview"]);
  });
});
