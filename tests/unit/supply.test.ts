import { describe, expect, it } from "vitest";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { stepSupplyChains, supplyTargetFor } from "../../src/sim/society/supply.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { EntityId, FacilityState, RegionId, ResourceTransaction, WorldState } from "../../src/sim/types.ts";

const members = (prefix: string, count = 20): EntityId[] => Array.from({ length: count }, (_, index) => `agent:${prefix}:${index}` as EntityId);

const supplyWorld = (): WorldState => {
  const state = createWorld(1_700, { width: 8, height: 8, formation: "formed" });
  const source = createOrganization("city", "region:2:2" as RegionId, members("source"));
  const destination = createOrganization("city", "region:3:2" as RegionId, members("destination"));
  state.organizations = [source, destination];
  state.resources = [
    { id: "food:source", resourceId: "food", regionId: source.regionId, holderId: source.id, amount: 5, cap: 20, originEventId: "test" },
    { id: "materials:source", resourceId: "materials", regionId: source.regionId, holderId: source.id, amount: 10, cap: 20, originEventId: "test" },
    { id: "energy:source", resourceId: "energy", regionId: source.regionId, holderId: source.id, amount: 4, cap: 20, originEventId: "test" },
  ];
  return state;
};

describe("interregional supply chains", () => {
  it("ships food, materials, and energy toward city target stocks", () => {
    const state = supplyWorld();
    const replayState = structuredClone(state);
    const sourceDiplomacy = state.organizations[0]!.diplomacy;
    const destinationDiplomacy = state.organizations[1]!.diplomacy;
    const delta = stepSupplyChains(state);
    const shipments = delta.resourceTransactions.filter((transaction) => transaction.operation === "transfer");
    const tradeEvents = delta.eventDrafts.filter((event) => event.kind === "interregional-trade");

    expect(new Set(shipments.map((transaction) => transaction.resourceId))).toEqual(new Set(["food", "materials", "energy"]));
    expect(shipments.every((transaction) => transaction.destinationRegionId === state.organizations[1]!.regionId)).toBe(true);
    expect(tradeEvents).toHaveLength(3);
    expect(tradeEvents.map((event) => event.evidence.routeStance)).toEqual(["neutral", "trade", "trade"]);
    expect(state.organizations[0]!.diplomacy).toBe(sourceDiplomacy);
    expect(state.organizations[1]!.diplomacy).toBe(destinationDiplomacy);
    expect(stepSupplyChains(replayState)).toEqual(delta);
    expect(delta.entityEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "organizations", operation: "update", value: expect.objectContaining({ diplomacy: expect.objectContaining({ [state.organizations[1]!.id]: "trade" }) }) }),
    ]));
  });

  it("uses balances after local transactions and never exports a consumed reserve", () => {
    const state = supplyWorld();
    const source = state.organizations[0]!;
    state.resources = [{ id: "food:source", resourceId: "food", regionId: source.regionId, holderId: source.id, amount: 1, cap: 20, originEventId: "test" }];
    const prior: ResourceTransaction[] = [{
      id: "food:local-consumption",
      resourceId: "food",
      regionId: source.regionId,
      amount: 0.9,
      operation: "consume",
      source: "culture",
      sourceId: source.id,
      fromHolderId: source.id,
      causeRuleId: "test",
    }];

    const delta = stepSupplyChains(state, prior);

    expect(delta.resourceTransactions.some((transaction) => transaction.operation === "transfer" && transaction.resourceId === "food")).toBe(false);
  });

  it("uses an established trade relation beyond a shared border and blocks rivals", () => {
    const state = supplyWorld();
    const source = state.organizations[0]!;
    const destination = state.organizations[1]!;
    destination.regionId = "region:6:6" as RegionId;
    destination.territoryRegionIds = [destination.regionId];
    source.diplomacy = { [destination.id]: "trade" };
    destination.diplomacy = { [source.id]: "trade" };

    expect(stepSupplyChains(state).resourceTransactions.some((transaction) => transaction.operation === "transfer")).toBe(true);

    source.diplomacy = { [destination.id]: "rival" };
    destination.diplomacy = { [source.id]: "rival" };
    expect(stepSupplyChains(state).resourceTransactions.some((transaction) => transaction.operation === "transfer")).toBe(false);
  });

  it("consumes operating energy even when only one city exists", () => {
    const state = supplyWorld();
    const city = state.organizations[0]!;
    state.organizations = [city];
    state.resources = [{ id: "energy:city", resourceId: "energy", regionId: city.regionId, holderId: city.id, amount: 2, cap: 20, originEventId: "test" }];
    state.facilities = [{
      id: "facility:clinic",
      type: "medicine",
      regionId: city.regionId,
      ownerOrganizationId: city.id,
      level: 2,
      condition: 1,
      status: "active",
      workforceIds: city.memberIds.slice(0, 2),
      materialInvested: 4,
      plannedTick: 0,
      builtTick: 0,
      lastMaintainedTick: 0,
      lastIncidentTick: 0,
    } satisfies FacilityState];

    const target = supplyTargetFor(state, city, "energy");
    const consumption = stepSupplyChains(state).resourceTransactions.find((transaction) => transaction.causeRuleId === "society:facility-energy-consumption");

    expect(consumption?.amount).toBeCloseTo(target * 0.18, 6);
  });
});
