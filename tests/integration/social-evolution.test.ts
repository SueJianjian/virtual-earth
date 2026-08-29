import { describe, expect, it, beforeEach } from "vitest";
import { clearSimulationStages, stepWorld } from "../../src/sim/engine.ts";
import { createWorld } from "../../src/sim/world.ts";

describe("social evolution integration", () => {
  beforeEach(() => clearSimulationStages());

  it("keeps an ineligible world free of social organizations", () => {
    const world = createWorld(80, { width: 8, height: 8 });
    const result = stepWorld(world, { elapsedYears: 10_000, externalEvents: [] });
    expect(result.state.organizations).toEqual([]);
    expect(result.state.agents).toEqual([]);
  });

  it("forms relationships and families when an eligible population persists", () => {
    let state = createWorld(123, { width: 16, height: 8, formation: "formed" });
    for (let index = 0; index < 950; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    expect(state.agents.length).toBeGreaterThanOrEqual(2);
    expect(state.relationships.some((relationship) => relationship.kind === "partner")).toBe(true);
    expect(state.organizations.some((organization) => organization.type === "family")).toBe(true);
    expect(state.events.some((event) => event.kind === "family-formation")).toBe(true);
  }, 45_000);

  it("eventually rebuilds active higher-order organizations after earlier groups collapse", () => {
    let state = createWorld(123, { width: 16, height: 8, formation: "formed" });
    for (let index = 0; index < 1_300; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
      const active = state.organizations.filter((organization) => organization.status === "active");
      if (active.some((organization) => organization.type === "tribe") && active.some((organization) => organization.type === "settlement")) break;
    }

    const activeOrganizations = state.organizations.filter((organization) => organization.status === "active");
    expect(activeOrganizations.some((organization) => organization.type === "tribe" && organization.memberIds.length >= 6)).toBe(true);
    expect(activeOrganizations.some((organization) => organization.type === "settlement" && organization.memberIds.length >= 8)).toBe(true);
    expect(state.events.filter((event) => event.kind === "organization-formation").length).toBeGreaterThan(1);
  }, 45_000);

  it("reaches city-scale organization through sustained local conditions", () => {
    let state = createWorld(123, { width: 16, height: 8, formation: "formed" });
    for (let index = 0; index < 1_200; index += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false }).state;
    }

    const cityFormationEvents = state.events.filter((event) => event.kind === "organization-formation" && event.payload.type === "city");
    expect(cityFormationEvents.some((event) => Number(event.evidence.members) >= 30)).toBe(true);
    const cityFormationCount = (state.eventArchive.organizationFormationCounts.city ?? 0)
      + state.events.filter((event) => event.kind === "organization-formation" && event.payload.type === "city").length;
    expect(cityFormationCount).toBeGreaterThan(0);
    expect(state.events.some((event) => event.kind === "organization-trade")).toBe(true);
    expect(state.resources.filter((resource) => resource.resourceId === "food").reduce((sum, resource) => sum + resource.amount, 0)).toBeGreaterThan(0);
    expect(cityFormationEvents.some((event) => Array.isArray(event.payload.childOrganizationIds) && event.payload.childOrganizationIds.length > 0)).toBe(true);
    const descendants = state.agents.filter((agent) => agent.parentIds.length === 2);
    expect(descendants.length).toBeGreaterThan(0);
    expect(descendants.some((agent) => agent.knowledgeIds.length > 0 || agent.beliefIds.length > 0)).toBe(true);
    expect(state.events.some((event) => event.kind === "agent-birth" && Number(event.evidence.siblings) > 0)).toBe(true);
  }, 45_000);
});
