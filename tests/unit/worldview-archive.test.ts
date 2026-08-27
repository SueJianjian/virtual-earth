import { describe, expect, it } from "vitest";
import { compactWorldviewRecords, MAX_WORLDVIEW_ENTITIES, MAX_WORLDVIEW_PHENOMENA, MAX_WORLDVIEW_PRACTICES } from "../../src/sim/worldview/archive.ts";
import { createWorld } from "../../src/sim/world.ts";

describe("worldview history compaction", () => {
  it("keeps live references valid while bounding long-lived records", () => {
    const world = createWorld(200, { width: 8, height: 8, enabledPackIds: ["emergence.original-worldview"] });
    const agentId = "agent:keeper" as never;
    const organizationId = "organization:keeper" as never;
    world.agents = [{
      id: agentId,
      populationId: "population:keeper" as never,
      regionId: "region:1:1" as never,
      age: 30,
      lifespan: 80,
      parentIds: [],
      traits: {},
      skills: {},
      needs: {},
      memoryIds: [],
      knowledgeIds: [],
      beliefIds: [],
      relationshipIds: [],
    }];
    world.organizations = [{
      id: organizationId,
      type: "city",
      memberIds: [agentId],
      childOrganizationIds: [],
      regionId: "region:1:1" as never,
      territoryRegionIds: ["region:1:1" as never],
      resources: {},
      status: "active",
    }];
    world.worldview.phenomena = Array.from({ length: MAX_WORLDVIEW_PHENOMENA + 24 }, (_, index) => ({
      id: `phenomenon:${index}`,
      packId: "emergence.original-worldview",
      kind: "verified-principle" as const,
      epistemicStatus: "verified" as const,
      name: `principle-${index}`,
      regionId: "region:1:1" as never,
      originTick: index,
      parentIds: index === 0 ? [] : [`phenomenon:${index - 1}`],
      causeRuleId: "test",
      evidence: {},
    }));
    world.worldview.practices = Array.from({ length: MAX_WORLDVIEW_PRACTICES + 24 }, (_, index) => ({
      id: `practice:${index}`,
      packId: "emergence.original-worldview",
      name: `practice-${index}`,
      phenomenonId: `phenomenon:${index}`,
      regionId: "region:1:1" as never,
      practitionerId: agentId,
      originTick: index,
      lastTrainedTick: index,
      attunement: 0.2,
      energy: 0.2,
      attempts: 1,
      failures: 0,
      status: "active" as const,
      organizationId,
    }));
    world.worldview.entities = Array.from({ length: MAX_WORLDVIEW_ENTITIES + 24 }, (_, index) => ({
      id: `worldview:${index}` as never,
      packId: "emergence.original-worldview",
      kind: "sect" as const,
      regionId: "region:1:1" as never,
      influence: 0.4,
      resourceBalances: {},
      sourcePhenomenonId: `phenomenon:${index}`,
      memberIds: [agentId],
      sponsorOrganizationId: organizationId,
      status: "active" as const,
    }));

    compactWorldviewRecords(world);

    expect(world.worldview.phenomena.length).toBeLessThanOrEqual(MAX_WORLDVIEW_PHENOMENA);
    expect(world.worldview.practices.length).toBeLessThanOrEqual(MAX_WORLDVIEW_PRACTICES);
    expect(world.worldview.entities.length).toBeLessThanOrEqual(MAX_WORLDVIEW_ENTITIES);
    const phenomenonIds = new Set(world.worldview.phenomena.map((phenomenon) => phenomenon.id));
    expect(world.worldview.practices.every((practice) => phenomenonIds.has(practice.phenomenonId))).toBe(true);
    expect(world.worldview.entities.every((entity) => !entity.sourcePhenomenonId || phenomenonIds.has(entity.sourcePhenomenonId))).toBe(true);
    expect(world.worldview.phenomena.every((phenomenon) => phenomenon.parentIds.every((parentId) => phenomenonIds.has(parentId)))).toBe(true);
  });
});
