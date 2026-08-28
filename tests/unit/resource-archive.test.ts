import { describe, expect, it } from "vitest";
import { compactResourceRecords, MAX_RESOURCE_RECORDS } from "../../src/sim/resources.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { RegionId } from "../../src/sim/types.ts";

const regionId = "region:1:1" as RegionId;

describe("resource ledger compaction", () => {
  it("merges duplicate keys and removes invalid entity holders", () => {
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

    expect(removed).toBe(3);
    expect(state.resources).toEqual([{
      id: "resource:first",
      resourceId: "food",
      regionId,
      holderId: organization.id,
      amount: 7,
      cap: 10,
      originEventId: "event:2",
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

  it("keeps opaque accounts while removing missing entity accounts", () => {
    const state = createWorld(903, { width: 8, height: 8, formation: "formed" });
    state.resources = [
      { id: "resource:opaque", resourceId: "food", regionId, holderId: "a", amount: 4, cap: 10, originEventId: "event:opaque" },
      { id: "resource:missing", resourceId: "food", regionId, holderId: "organization:missing", amount: 4, cap: 10, originEventId: "event:missing" },
    ];

    compactResourceRecords(state);

    expect(state.resources).toHaveLength(1);
    expect(state.resources[0]?.holderId).toBe("a");
  });
});
