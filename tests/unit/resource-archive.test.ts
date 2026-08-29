import { describe, expect, it } from "vitest";
import { compactResourceRecords, MAX_RESOURCE_RECORDS } from "../../src/sim/resources.ts";
import { summarizeRegionState } from "../../src/sim/lod/index.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { RegionId } from "../../src/sim/types.ts";

const regionId = "region:1:1" as RegionId;

describe("resource ledger compaction", () => {
  it("merges duplicate keys and releases invalid entity holders to their region", () => {
    const state = createWorld(901, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("city", regionId, []);
    state.organizations = [organization];
    state.resources = [
      { id: "resource:first", resourceId: "food", regionId, holderId: organization.id, amount: 3, cap: 5, originEventId: "event:1" },
      { id: "resource:second", resourceId: "food", regionId, holderId: organization.id, amount: 4, cap: 10, originEventId: "event:2" },
      { id: "resource:orphan", resourceId: "food", regionId, holderId: "organization:missing", amount: 8, cap: 8, originEventId: "event:3" },
      { id: "resource:zero", resourceId: "energy", regionId, amount: 0, cap: 10, originEventId: "event:4" },
    ];

    const removed = compactResourceRecords(state);

    expect(removed).toBe(2);
    expect(state.resources).toEqual(expect.arrayContaining([
      {
        id: "resource:first",
        resourceId: "food",
        regionId,
        holderId: organization.id,
        amount: 7,
        cap: 10,
        originEventId: "event:2",
      },
      {
        id: "resource:orphan",
        resourceId: "food",
        regionId,
        amount: 8,
        cap: 8,
        originEventId: "event:3",
      },
    ]));
  });

  it("does not retain resources under organizations preserved only in LOD summaries", () => {
    const state = createWorld(904, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("city", regionId, []);
    state.organizations = [organization];
    state.resources = [{ id: "resource:lod-city", resourceId: "materials", regionId, holderId: organization.id, amount: 8, cap: 10, originEventId: "event:lod" }];
    state.lod.summaries = [summarizeRegionState(state, regionId, "aggregate")];
    state.organizations = [];

    compactResourceRecords(state);

    expect(state.resources).toEqual([{
      id: "resource:lod-city",
      resourceId: "materials",
      regionId,
      amount: 8,
      cap: 10,
      originEventId: "event:lod",
    }]);
  });

  it("combines released balances with regional reserves without reducing capacity", () => {
    const state = createWorld(905, { width: 8, height: 8, formation: "formed" });
    state.resources = [
      { id: "resource:regional", resourceId: "food", regionId, amount: 6, cap: 10, originEventId: "event:regional" },
      { id: "resource:departed", resourceId: "food", regionId, holderId: "organization:departed", amount: 8, cap: 10, originEventId: "event:departed" },
    ];

    compactResourceRecords(state);

    expect(state.resources).toEqual([{
      id: "resource:regional",
      resourceId: "food",
      regionId,
      amount: 14,
      cap: 20,
      originEventId: "event:regional",
    }]);
  });

  it("enforces a fixed upper bound for generic long-lived resource accounts", () => {
    const state = createWorld(902, { width: 8, height: 8, formation: "formed" });
    state.resources = Array.from({ length: MAX_RESOURCE_RECORDS + 32 }, (_, index) => ({
      id: `resource:bounded:${index}`,
      resourceId: `resource-${index}`,
      regionId,
      amount: 1,
      cap: 1,
      originEventId: "test",
    }));

    const removed = compactResourceRecords(state);

    expect(removed).toBe(32);
    expect(state.resources).toHaveLength(MAX_RESOURCE_RECORDS);
    expect(new Set(state.resources.map((resource) => `${resource.resourceId}|${resource.regionId}`)).size).toBe(MAX_RESOURCE_RECORDS);
  });

  it("keeps opaque accounts while releasing missing entity accounts", () => {
    const state = createWorld(903, { width: 8, height: 8, formation: "formed" });
    state.resources = [
      { id: "resource:opaque", resourceId: "food", regionId, holderId: "a", amount: 4, cap: 10, originEventId: "event:opaque" },
      { id: "resource:missing", resourceId: "food", regionId, holderId: "organization:missing", amount: 4, cap: 10, originEventId: "event:missing" },
    ];

    compactResourceRecords(state);

    expect(state.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "resource:opaque", holderId: "a" }),
      expect.objectContaining({ id: "resource:missing" }),
    ]));
    expect(state.resources.find((resource) => resource.id === "resource:missing")?.holderId).toBeUndefined();
  });
});
