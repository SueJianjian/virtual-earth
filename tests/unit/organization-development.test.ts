import { describe, expect, it } from "vitest";
import {
  isOrganizationDevelopmentSummary,
  MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES,
  normalizeOrganizationDevelopment,
  recordOrganizationDevelopment,
  retainOrganizationDevelopment,
} from "../../src/sim/society/development.ts";
import { createOrganization } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { OrganizationDevelopmentSummary } from "../../src/sim/types.ts";

const summaryFor = (id: string, latestActivityTick = 1): OrganizationDevelopmentSummary => ({
  id: id as OrganizationDevelopmentSummary["id"],
  type: "family",
  eventCount: 1,
  memberCount: 2,
  peakMemberCount: 2,
  territoryCount: 1,
  peakTerritoryCount: 1,
  formationCount: 1,
  splitCount: 0,
  dissolutionCount: 0,
  conflictCount: 0,
  warCount: 0,
  migrationCount: 0,
  expansionCount: 0,
  territoryTransferCount: 0,
  allianceCount: 0,
  tradeCount: 0,
  tradeVolume: 0,
  tradeVolumeByResource: {},
  facilityPlannedCount: 0,
  facilityConstructedCount: 0,
  facilityUpgradedCount: 0,
  facilityDamagedCount: 0,
  facilityMaintainedCount: 0,
  facilityAbandonedCount: 0,
  facilityRetiredCount: 0,
  milestoneIds: [],
  firstActivityTick: 1,
  firstActivityTimelineStep: "1",
  firstActivityTimelineDays: "365",
  firstActivityYears: 1,
  latestActivityTick,
  latestActivityTimelineStep: String(latestActivityTick),
  latestActivityTimelineDays: String(latestActivityTick * 365),
  latestActivityYears: latestActivityTick,
});

describe("organization development archive", () => {
  it("restores family summaries and rejects invalid trade values", () => {
    const family = summaryFor("family:lineage");
    expect(isOrganizationDevelopmentSummary(family)).toBe(true);
    expect(normalizeOrganizationDevelopment({ [family.id]: family })).toEqual({ [family.id]: family });
    expect(isOrganizationDevelopmentSummary({
      ...family,
      tradeVolumeByResource: { food: Number.NaN },
    })).toBe(false);
  });

  it("restores aggregate organization summaries", () => {
    const aggregate = summaryFor("aggregate:organization:family:region:15:2:0");

    expect(isOrganizationDevelopmentSummary(aggregate)).toBe(true);
    expect(normalizeOrganizationDevelopment({ [aggregate.id]: aggregate })).toEqual({ [aggregate.id]: aggregate });
  });

  it("keeps current organizations inside the bounded archive", () => {
    const records = Object.fromEntries(
      Array.from({ length: MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES + 1 }, (_, index) => {
        const id = "organization:historical:" + index;
        return [id, summaryFor(id, index)];
      }),
    );
    const currentId = "organization:historical:0";
    const normalized = normalizeOrganizationDevelopment(records, new Set([currentId]));

    expect(Object.keys(normalized)).toHaveLength(MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES);
    expect(normalized[currentId]).toBeDefined();
    expect(normalized["organization:historical:2048"]).toBeDefined();
  });

  it("incrementally evicts multiple least preferred historical summaries", () => {
    const records = Object.fromEntries([
      ...Array.from({ length: MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES - 1 }, (_, index) => {
        const id = "organization:recent:" + index;
        return [id, summaryFor(id, index + 100)];
      }),
      ...Array.from({ length: 3 }, (_, index) => {
        const id = "organization:old:" + index;
        return [id, summaryFor(id, index)];
      }),
      ["organization:current", summaryFor("organization:current", 0)],
    ]);

    const retained = retainOrganizationDevelopment(records, new Set(["organization:current"]));

    expect(Object.keys(retained)).toHaveLength(MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES);
    expect(Array.from({ length: 3 }, (_, index) => retained["organization:old:" + index])).toEqual(Array(3).fill(undefined));
    expect(retained["organization:current"]).toBeDefined();
  });

  it("does not clone a development archive that is already within capacity", () => {
    const records = Object.fromEntries(Array.from({ length: MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES }, (_, index) => {
      const id = "organization:bounded:" + index;
      return [id, summaryFor(id, index)];
    }));

    expect(retainOrganizationDevelopment(records)).toBe(records);
  });

  it("evicts the least preferred historical summary in place for a new current organization", () => {
    const state = createWorld(11, { width: 8, height: 8, formation: "formed" });
    const records = Object.fromEntries(Array.from({ length: MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES }, (_, index) => {
      const id = "organization:historical:" + index;
      return [id, summaryFor(id, index)];
    }));
    const current = createOrganization("family", "region:1:1" as never, []);
    state.eventArchive.organizationDevelopment = records;
    state.organizations = [current];

    recordOrganizationDevelopment(state);

    expect(state.eventArchive.organizationDevelopment).toBe(records);
    expect(Object.keys(records)).toHaveLength(MAX_ORGANIZATION_DEVELOPMENT_SUMMARIES);
    expect(records["organization:historical:0"]).toBeUndefined();
    expect(records[current.id]).toMatchObject({ id: current.id, memberCount: 0, territoryCount: 1 });
  });
});
