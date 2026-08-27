import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, isFiniteWorld, worldDigest } from "../../src/sim/world.ts";
import { EVENT_LOG_MAX_COUNT, MAX_EVENT_MILESTONES, MAX_MILESTONE_RELATED_IDS } from "../../src/sim/events/ledger.ts";
import { EXTINCT_SPECIES_COMPACT_THRESHOLD } from "../../src/sim/ecology/archive.ts";
import { MAX_SUBSTANCES } from "../../src/sim/environment/substances.ts";
import { MAX_POPULATION_RECORDS } from "../../src/sim/ecology/archive.ts";
import { MAX_BELIEFS_PER_CULTURE, MAX_CULTURE_RECORDS, MAX_KNOWLEDGE_PER_AGENT, MAX_KNOWLEDGE_PER_CULTURE, MAX_KNOWLEDGE_RECORDS } from "../../src/sim/culture/archive.ts";
import { MAX_AGENT_MEMORY_IDS, MAX_RELATIONSHIP_RECORDS, MAX_RELATIONSHIPS_PER_AGENT } from "../../src/sim/agents/lifecycle.ts";
import { MAX_WORLDVIEW_ENTITIES, MAX_WORLDVIEW_PHENOMENA, MAX_WORLDVIEW_PRACTICES } from "../../src/sim/worldview/archive.ts";
import { MAX_CHILD_ORGANIZATION_IDS, MAX_DIPLOMATIC_RELATIONS, MAX_ORGANIZATION_RECORDS, MAX_ORGANIZATIONS_PER_SUMMARY } from "../../src/sim/society/archive.ts";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";

describe("long-running worlds", () => {
  const assertDenseWorldHealth = (state: ReturnType<typeof createWorld>): void => {
    expect(isFiniteWorld(state)).toBe(true);
    expect(state.events.length).toBeLessThanOrEqual(EVENT_LOG_MAX_COUNT);
    expect(state.eventArchive.milestones.length).toBeLessThanOrEqual(MAX_EVENT_MILESTONES);
    expect(state.eventArchive.milestones.every((milestone) => [
      milestone.sourceIds.length,
      milestone.regionIds.length,
      milestone.organizationIds.length,
    ].every((count) => count <= MAX_MILESTONE_RELATED_IDS)
      && [milestone.tick, milestone.years ?? 0, milestone.probability, milestone.roll].every(Number.isFinite))).toBe(true);
    expect(state.eventArchive.totalEventCount).toBeGreaterThanOrEqual(state.eventArchive.archivedEventCount + state.events.length);
    expect([
      state.eventArchive.totalEventCount,
      state.eventArchive.archivedEventCount,
      state.eventArchive.archivedSpeciesCount,
      state.eventArchive.archivedKnowledgeCount,
      state.eventArchive.archivedCultureCount,
      state.eventArchive.archivedRelationshipCount,
      ...Object.values(state.eventArchive.kindCounts),
      ...Object.values(state.eventArchive.regionCounts),
      ...Object.values(state.eventArchive.organizationCounts),
      ...Object.values(state.eventArchive.organizationFormationCounts),
      ...Object.values(state.eventArchive.tradeVolumeByResource),
      ...Object.values(state.eventArchive.archivedSpeciesRoleCounts),
    ].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);

    const agentIds = new Set<string>(state.agents.map((agent) => agent.id));
    const organizationIds = new Set<string>(state.organizations.map((organization) => organization.id));
    const expectedRelationshipIds = new Map<string, string[]>();
    for (const relationship of state.relationships) {
      expect(agentIds.has(relationship.fromId)).toBe(true);
      expect(agentIds.has(relationship.toId)).toBe(true);
      expect(Number.isFinite(relationship.strength)).toBe(true);
      for (const agentId of [relationship.fromId, relationship.toId]) {
        const ids = expectedRelationshipIds.get(agentId) ?? [];
        ids.push(relationship.id);
        expectedRelationshipIds.set(agentId, ids);
      }
    }
    for (const agent of state.agents) {
      expect(agent.relationshipIds).toEqual([...new Set(expectedRelationshipIds.get(agent.id) ?? [])].sort());
      expect(agent.relationshipIds.length).toBeLessThanOrEqual(MAX_RELATIONSHIPS_PER_AGENT);
    }
    expect(state.relationships.length).toBeLessThanOrEqual(MAX_RELATIONSHIP_RECORDS);
    for (const organization of state.organizations) {
      expect(organization.memberIds.every((memberId) => agentIds.has(memberId))).toBe(true);
      expect(organization.childOrganizationIds.every((childId) => organizationIds.has(childId))).toBe(true);
      expect(organization.childOrganizationIds.length).toBeLessThanOrEqual(MAX_CHILD_ORGANIZATION_IDS);
      expect(Object.keys(organization.diplomacy ?? {}).length).toBeLessThanOrEqual(MAX_DIPLOMATIC_RELATIONS);
      expect(Object.keys(organization.diplomacy ?? {}).every((organizationId) => organizationId !== organization.id && organizationIds.has(organizationId))).toBe(true);
      expect(organization.territoryRegionIds.length).toBeGreaterThan(0);
      expect(new Set(organization.territoryRegionIds).size).toBe(organization.territoryRegionIds.length);
      expect(organization.territoryRegionIds.length).toBeLessThanOrEqual(state.fields.elevation.values.length);
      expect(organization.territoryRegionIds.every((regionId) => /^region:(\d+):(\d+)$/.test(regionId))).toBe(true);
    }
    expect(state.organizations.length).toBeLessThanOrEqual(MAX_ORGANIZATION_RECORDS);
    expect(state.lod.summaries.every((summary) => summary.organizations.length <= MAX_ORGANIZATIONS_PER_SUMMARY)).toBe(true);
    expect(state.organizations.length).toBeLessThanOrEqual(state.fields.elevation.values.length * 7 + state.agents.length);
    expect(Object.keys(state.eventArchive.organizationCounts).length).toBeLessThanOrEqual(state.organizations.length);
    expect(Object.keys(state.eventArchive.organizationCounts).every((organizationId) => organizationIds.has(organizationId))).toBe(true);

    const substanceIds = new Set(state.substances.map((substance) => substance.id));
    expect(state.substances.length).toBeLessThanOrEqual(MAX_SUBSTANCES);
    for (const substance of state.substances) {
      expect(substance.parentIds.every((parentId) => substanceIds.has(parentId))).toBe(true);
      expect([...Object.values(substance.composition), ...Object.values(substance.properties)].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }

    const populationSpeciesIds = new Set(state.species.map((species) => species.id));
    const populationIds = new Set(state.populations.map((population) => population.id));
    expect(state.populations.length).toBeLessThanOrEqual(MAX_POPULATION_RECORDS);
    expect(new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`)).size).toBe(state.populations.length);
    for (const population of state.populations) {
      expect(populationSpeciesIds.has(population.speciesId)).toBe(true);
      expect(Number.isFinite(population.count) && population.count >= 0).toBe(true);
      expect(Number.isFinite(population.energy) && population.energy >= 0 && population.energy <= 1).toBe(true);
    }
    expect(state.agents.every((agent) => populationIds.has(agent.populationId))).toBe(true);
    for (const species of state.species) {
      expect(species.name).toEqual(expect.any(String));
      expect(species.blueprint).toMatchObject({ noveltySignature: expect.any(String) });
      const blueprint = species.blueprint!;
      expect(blueprint.senses.length).toBeGreaterThan(0);
      expect(blueprint.bodyPlan.appendagePairs).toBeGreaterThanOrEqual(0);
      expect(blueprint.bodyPlan.appendagePairs).toBeLessThanOrEqual(6);
      expect([
        blueprint.metabolicEfficiency,
        blueprint.fecundity,
        blueprint.thermalTolerance,
        blueprint.hydrationRetention,
        blueprint.mutationRate,
        blueprint.inheritanceFidelity,
      ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }

    const knowledgeIds = new Set(state.knowledge.map((knowledge) => knowledge.id));
    expect(state.knowledge.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_RECORDS);
    expect(state.cultures.length).toBeLessThanOrEqual(MAX_CULTURE_RECORDS);
    expect(state.cultures.every((culture) => culture.knowledgeIds.length <= MAX_KNOWLEDGE_PER_CULTURE && culture.knowledgeIds.every((id) => knowledgeIds.has(id)))).toBe(true);
    expect(state.cultures.every((culture) => culture.beliefIds.length <= MAX_BELIEFS_PER_CULTURE)).toBe(true);
    for (const culture of state.cultures) {
      expect(culture.identity).toMatchObject({ name: expect.any(String), noveltySignature: expect.any(String), originRegionId: expect.any(String) });
      expect(culture.identity!.traditions.length).toBeLessThanOrEqual(6);
      expect(culture.identity!.generation).toBeGreaterThanOrEqual(0);
      expect(Object.values(culture.identity!.values).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
    expect(state.agents.every((agent) => agent.knowledgeIds.length <= MAX_KNOWLEDGE_PER_AGENT && agent.knowledgeIds.every((id) => knowledgeIds.has(id)))).toBe(true);
    expect(state.agents.every((agent) => agent.memoryIds.length <= MAX_AGENT_MEMORY_IDS)).toBe(true);
    expect(state.knowledge.every((knowledge) => (knowledge.parentIds ?? []).every((id) => knowledgeIds.has(id)))).toBe(true);
    const resourceKeys = new Set<string>();
    for (const resource of state.resources) {
      const key = `${resource.resourceId}|${resource.regionId}|${resource.holderId ?? "world"}`;
      expect(resourceKeys.has(key)).toBe(false);
      resourceKeys.add(key);
      expect(Number.isFinite(resource.amount) && resource.amount >= 0).toBe(true);
      expect(Number.isFinite(resource.cap) && resource.cap >= resource.amount).toBe(true);
      if (resource.holderId) {
        expect(agentIds.has(resource.holderId) || organizationIds.has(resource.holderId)).toBe(true);
      }
    }
    expect(resourceKeys.size).toBeLessThanOrEqual(state.fields.elevation.values.length + 4 * (state.agents.length + state.organizations.length));

    for (const practice of state.worldview.practices) {
      expect(agentIds.has(practice.practitionerId)).toBe(true);
      if (practice.teacherId) expect(agentIds.has(practice.teacherId)).toBe(true);
      if (practice.organizationId) expect(organizationIds.has(practice.organizationId)).toBe(true);
      expect([practice.attunement, practice.energy, practice.attempts, practice.failures].every(Number.isFinite)).toBe(true);
    }
    expect(state.worldview.phenomena.length).toBeLessThanOrEqual(MAX_WORLDVIEW_PHENOMENA);
    expect(state.worldview.practices.length).toBeLessThanOrEqual(MAX_WORLDVIEW_PRACTICES);
    expect(state.worldview.entities.length).toBeLessThanOrEqual(MAX_WORLDVIEW_ENTITIES);
    const phenomenonIds = new Set(state.worldview.phenomena.map((phenomenon) => phenomenon.id));
    expect(state.worldview.practices.every((practice) => phenomenonIds.has(practice.phenomenonId))).toBe(true);
    expect(state.worldview.phenomena.every((phenomenon) => phenomenon.parentIds.every((parentId) => phenomenonIds.has(parentId)))).toBe(true);
    for (const entity of state.worldview.entities) {
      expect((entity.memberIds ?? []).every((memberId) => agentIds.has(memberId))).toBe(true);
      if (entity.sponsorOrganizationId) expect(organizationIds.has(entity.sponsorOrganizationId)).toBe(true);
      expect([entity.influence, entity.viability ?? 0, entity.supporterCount ?? 0, entity.activePractitionerCount ?? 0, entity.sponsorCount ?? 0, entity.revivalCount ?? 0].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      expect(entity.influence).toBeLessThanOrEqual(1);
      expect(entity.viability ?? 0).toBeLessThanOrEqual(1);
      expect(["active", "dormant"]).toContain(entity.status);
    }
  };

  it("continues beyond year 3479 and remains restorable", () => {
    let state = createWorld(3480, { width: 8, height: 8, formation: "formed", enabledPackIds: ["emergence.original-worldview"] });
    state.years = 3_470;
    for (let step = 0; step < 20; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
    }

    expect(state.years).toBe(3_490);
    expect(state.tick).toBe(20);
    assertDenseWorldHealth(state);
    const restored = deserializeWorld(serializeWorld(state));
    expect(worldDigest(restored)).toBe(worldDigest(state));
    expect(restored.years).toBe(3_490);
  });

  it("keeps an autonomous world advancing across a five-millennial horizon", () => {
    let state = createWorld(3479, { width: 8, height: 8 });
    const initialElevation = Array.from(state.fields.elevation.values);
    for (let step = 0; step < 5_000; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
      if ((step + 1) % 1_000 === 0) {
        const restored = deserializeWorld(serializeWorld(state));
        expect(worldDigest(restored)).toBe(worldDigest(state));
        state = restored;
        assertDenseWorldHealth(state);
      }
    }
    expect(state.years).toBe(5_000);
    expect(state.tick).toBe(5_000);
    expect(worldDigest(state)).toMatch(/^[0-9a-f]+$/);
    expect([...state.fields.elevation.values, ...state.fields.water.values].every(Number.isFinite)).toBe(true);
    expect(Object.values(state.chemistry).every((grid) => grid.values.every(Number.isFinite))).toBe(true);
    expect(Array.from(state.fields.elevation.values)).not.toEqual(initialElevation);
    expect(state.fields.biomass.values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(state.events.length).toBeLessThanOrEqual(EVENT_LOG_MAX_COUNT);
    expect(state.eventArchive.totalEventCount).toBe(state.eventArchive.archivedEventCount + state.events.length);
    expect((state.eventArchive.kindCounts.abiogenesis ?? 0) + state.events.filter((event) => event.kind === "abiogenesis").length).toBeGreaterThan(0);
    expect(state.species.some((species) => species.role === "producer")).toBe(true);
    const livingSpeciesIds = new Set(state.populations.map((population) => population.speciesId));
    expect(state.species.filter((species) => !livingSpeciesIds.has(species.id)).length).toBeLessThanOrEqual(EXTINCT_SPECIES_COMPACT_THRESHOLD);
  }, 300_000);

  it("keeps a dense social world healthy while every subsystem is active", () => {
    let state = createWorld(123, {
      width: 16,
      height: 8,
      formation: "formed",
      enabledPackIds: ["emergence.original-worldview"],
    });
    let sawOrganization = false;
    let sawFacility = false;
    let sawPractice = false;
    let sawPhenomenon = false;
    let sawSubstance = false;
    for (let step = 0; step < 1_400; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
      sawOrganization ||= state.organizations.some((organization) => organization.status === "active");
      sawFacility ||= state.facilities.length > 0;
      sawPractice ||= state.worldview.practices.length > 0;
      sawPhenomenon ||= state.worldview.phenomena.length > 0;
      sawSubstance ||= state.substances.length > 0;
      if ((step + 1) % 100 === 0) assertDenseWorldHealth(state);
    }

    assertDenseWorldHealth(state);
    expect(sawOrganization).toBe(true);
    expect(sawFacility).toBe(true);
    expect(sawPractice).toBe(true);
    expect(sawPhenomenon).toBe(true);
    expect(sawSubstance).toBe(true);
    expect(state.agents.length).toBeLessThanOrEqual(256);
    expect(state.lod.summaries.length).toBeLessThanOrEqual(state.fields.elevation.values.length);
    const livingSpeciesIds = new Set(state.populations.map((population) => population.speciesId));
    expect(state.species.filter((species) => !livingSpeciesIds.has(species.id)).length).toBeLessThanOrEqual(EXTINCT_SPECIES_COMPACT_THRESHOLD);
  }, 120_000);
});
