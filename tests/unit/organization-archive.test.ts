import { describe, expect, it } from "vitest";
import { compactOrganizationRecords, MAX_CHILD_ORGANIZATION_IDS, MAX_DIPLOMATIC_RELATIONS, MAX_ORGANIZATION_RECORDS } from "../../src/sim/society/archive.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import { stepWorld } from "../../src/sim/engine.ts";
import type { OrganizationState, RegionId } from "../../src/sim/types.ts";

describe("organization archive", () => {
  it("bounds organization records and their graph references", () => {
    const world = createWorld(901, { width: 8, height: 8, formation: "formed" });
    const ids = Array.from({ length: MAX_ORGANIZATION_RECORDS + 32 }, (_, index) => `organization:synthetic:${index}`);
    const childIds = ids.slice(0, MAX_CHILD_ORGANIZATION_IDS + 8) as OrganizationState["childOrganizationIds"];
    const diplomacyIds = ids.slice(0, MAX_DIPLOMATIC_RELATIONS + 8);
    world.organizations = ids.map((id, index) => {
      const organization = createOrganization("city", "region:0:0" as RegionId, []) as OrganizationState;
      organization.id = id as OrganizationState["id"];
      organization.childOrganizationIds = childIds;
      organization.diplomacy = Object.fromEntries(diplomacyIds.map((peerId) => [peerId, index % 2 === 0 ? "allied" : "trade"]));
      return organization;
    });

    const removed = compactOrganizationRecords(world);

    expect(removed).toBe(32);
    expect(world.organizations).toHaveLength(MAX_ORGANIZATION_RECORDS);
    const retainedIds = new Set<string>(world.organizations.map((organization) => organization.id));
    expect(world.organizations.every((organization) => organization.childOrganizationIds.length <= MAX_CHILD_ORGANIZATION_IDS)).toBe(true);
    expect(world.organizations.every((organization) => Object.keys(organization.diplomacy ?? {}).length <= MAX_DIPLOMATIC_RELATIONS)).toBe(true);
    expect(world.organizations.every((organization) => !Object.prototype.hasOwnProperty.call(organization.diplomacy ?? {}, organization.id))).toBe(true);
    expect(world.organizations.every((organization) => organization.childOrganizationIds.every((id) => retainedIds.has(id)))).toBe(true);
    expect(world.organizations.every((organization) => Object.keys(organization.diplomacy ?? {}).every((id) => retainedIds.has(id)))).toBe(true);
    expect(world.eventArchive.archivedOrganizationCount).toBe(32);
    expect(world.eventArchive.archivedOrganizationSummaries).toHaveLength(32);
  });

  it("archives a collapsed organization before removing its live record", () => {
    const world = createWorld(902, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("family", "region:1:1" as RegionId, ["agent:one", "agent:two"]);
    organization.resources = { food: 4.5, materials: 1.25 };
    organization.status = "collapsed";
    world.organizations = [organization];

    const result = stepWorld(world, { elapsedYears: 1, externalEvents: [] });

    expect(result.state.organizations).toEqual([]);
    expect(result.state.eventArchive.archivedOrganizationCount).toBe(1);
    expect(result.state.eventArchive.archivedOrganizationSummaries).toMatchObject([{
      id: organization.id,
      type: "family",
      regionId: "region:1:1",
      status: "collapsed",
      archiveReason: "lifecycle",
      memberCount: 2,
      resourceIds: ["food", "materials"],
      resources: { food: 4.5, materials: 1.25 },
    }]);
  });
});
