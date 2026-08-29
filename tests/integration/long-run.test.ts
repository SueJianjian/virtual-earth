import { describe, expect, it } from "vitest";
import { stepWorld } from "../../src/sim/engine.ts";
import { createWorld, isFiniteWorld, worldDigest } from "../../src/sim/world.ts";
import { isEntityHolderId } from "../../src/sim/resources.ts";
import { EVENT_LOG_MAX_COUNT, MAX_EVENT_MILESTONES, MAX_MILESTONE_RELATED_IDS, MAX_STRATEGIC_ROUTE_SUMMARIES } from "../../src/sim/events/ledger.ts";
import { EXTINCT_SPECIES_COMPACT_THRESHOLD, MAX_ARCHIVED_SPECIES_REGIONS, MAX_ARCHIVED_SPECIES_SUMMARIES } from "../../src/sim/ecology/archive.ts";
import { MAX_ECOLOGICAL_RELATIONSHIPS } from "../../src/sim/ecology/interactions.ts";
import { MAX_SUBSTANCE_RESERVE, MAX_SUBSTANCES } from "../../src/sim/environment/substances.ts";
import { MAX_POPULATION_RECORDS } from "../../src/sim/ecology/archive.ts";
import { MAX_BELIEFS_PER_CULTURE, MAX_CULTURE_RECORDS, MAX_KNOWLEDGE_PER_AGENT, MAX_KNOWLEDGE_PER_CULTURE, MAX_KNOWLEDGE_RECORDS } from "../../src/sim/culture/archive.ts";
import { MAX_AGENT_MEMORY_IDS, MAX_DETAILED_AGENTS, MAX_RELATIONSHIP_RECORDS, MAX_RELATIONSHIPS_PER_AGENT } from "../../src/sim/agents/lifecycle.ts";
import { MAX_WORLDVIEW_ENTITIES, MAX_WORLDVIEW_INTERACTIONS, MAX_WORLDVIEW_PHENOMENA, MAX_WORLDVIEW_PRACTICES } from "../../src/sim/worldview/archive.ts";
import { MAX_CHILD_ORGANIZATION_IDS, MAX_DIPLOMATIC_RELATIONS, MAX_ORGANIZATION_RECORDS, MAX_ORGANIZATIONS_PER_SUMMARY } from "../../src/sim/society/archive.ts";
import { MAX_IMMUNITY_IDS_PER_AGENT, MAX_INFECTIONS_PER_AGENT, MAX_PATHOGENS, MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN } from "../../src/sim/health/disease.ts";
import { MAX_FACILITIES_PER_REGION } from "../../src/sim/society/facilities.ts";
import { HERITABLE_AGENT_TRAITS, validAgentGenetics } from "../../src/sim/agents/genetics.ts";
import { ACTIVE_ADAPTIVE_SPECIES_LIMITS } from "../../src/sim/ecology/species.ts";
import { deserializeWorld, serializeWorld } from "../../src/persistence/serialize.ts";
import { MAX_SIMULATION_DAYS, MAX_SIMULATION_YEARS, SIMULATED_YEARS_PER_DAY } from "../../src/sim/time.ts";
import { isOrbitalState } from "../../src/sim/environment/orbit.ts";

describe("long-running worlds", () => {
  const assertDenseWorldHealth = (state: ReturnType<typeof createWorld>): void => {
    expect(isFiniteWorld(state)).toBe(true);
    expect(isOrbitalState(state.orbital)).toBe(true);
    expect(state.orbital.seasonalPhase).toBeGreaterThanOrEqual(0);
    expect(state.orbital.seasonalPhase).toBeLessThan(1);
    expect(state.orbital.solarFlux).toBeGreaterThanOrEqual(0.45);
    expect(state.orbital.solarFlux).toBeLessThanOrEqual(1.8);
    expect(state.events.length).toBeLessThanOrEqual(EVENT_LOG_MAX_COUNT);
    expect(state.eventArchive.milestones.length).toBeLessThanOrEqual(MAX_EVENT_MILESTONES);
    expect(state.eventArchive.strategicRoutes.length).toBeLessThanOrEqual(MAX_STRATEGIC_ROUTE_SUMMARIES);
    expect(state.eventArchive.strategicRoutes.every((route) => [route.cumulativeAmount, route.occurrenceCount, route.firstTick, route.lastTick].every((value) => Number.isFinite(value) && value >= 0)
      && route.occurrenceCount > 0
      && route.fromRegion !== route.toRegion)).toBe(true);
    expect(state.eventArchive.archivedSpeciesSummaries.length).toBeLessThanOrEqual(MAX_ARCHIVED_SPECIES_SUMMARIES);
    expect(state.eventArchive.archivedSpeciesSummaries.every((summary) => summary.lastKnownRegionIds.length <= MAX_ARCHIVED_SPECIES_REGIONS)).toBe(true);
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
    expect(state.facilities.length).toBeLessThanOrEqual(state.fields.elevation.values.length * MAX_FACILITIES_PER_REGION);
    expect(state.lod.summaries.every((summary) => summary.organizations.length <= MAX_ORGANIZATIONS_PER_SUMMARY)).toBe(true);
    expect(state.organizations.length).toBeLessThanOrEqual(state.fields.elevation.values.length * 7 + state.agents.length);
    expect(Object.keys(state.eventArchive.organizationCounts).length).toBeLessThanOrEqual(state.organizations.length);
    expect(Object.keys(state.eventArchive.organizationCounts).every((organizationId) => organizationIds.has(organizationId))).toBe(true);

    const populationSpeciesIds = new Set(state.species.map((species) => species.id));
    const substanceIds = new Set(state.substances.map((substance) => substance.id));
    expect(state.substances.length).toBeLessThanOrEqual(MAX_SUBSTANCES);
    for (const substance of state.substances) {
      expect(substance.parentIds.every((parentId) => substanceIds.has(parentId))).toBe(true);
      expect([...Object.values(substance.composition), ...Object.values(substance.properties)].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect([substance.reserveCapacity, substance.remainingReserve, substance.extractedTotal, substance.depletedTick ?? 0].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      expect(substance.reserveCapacity).toBeLessThanOrEqual(MAX_SUBSTANCE_RESERVE);
      expect(substance.remainingReserve).toBeLessThanOrEqual(substance.reserveCapacity);
      expect(substance.extractedTotal).toBeLessThanOrEqual(substance.reserveCapacity);
    }

    const pathogenIds = new Set(state.pathogens.map((pathogen) => pathogen.id));
    expect(state.pathogens.length).toBeLessThanOrEqual(MAX_PATHOGENS);
    expect(state.pathogens.every((pathogen) => populationSpeciesIds.has(pathogen.hostSpeciesId))).toBe(true);
    for (const pathogen of state.pathogens) {
      expect([pathogen.transmission, pathogen.severity, pathogen.persistence, pathogen.prevalence].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect([pathogen.cumulativeCases, pathogen.cumulativeRecoveries, pathogen.cumulativeDeaths].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      expect(pathogen.regionalOutbreaks.length).toBeLessThanOrEqual(MAX_REGIONAL_OUTBREAKS_PER_PATHOGEN);
      expect(new Set(pathogen.regionalOutbreaks.map((outbreak) => outbreak.regionId)).size).toBe(pathogen.regionalOutbreaks.length);
      expect(pathogen.regionalOutbreaks.every((outbreak) => [outbreak.prevalence, outbreak.firstDetectedTick, outbreak.lastActiveTick].every(Number.isFinite))).toBe(true);
    }
    for (const agent of state.agents) {
      expect(validAgentGenetics(agent.genetics)).toBe(true);
      expect(HERITABLE_AGENT_TRAITS.every((trait) => Number.isFinite(agent.traits[trait]) && agent.traits[trait]! >= 0 && agent.traits[trait]! <= 1)).toBe(true);
      expect(agent.health).toBeDefined();
      expect(agent.health!.infections.length).toBeLessThanOrEqual(MAX_INFECTIONS_PER_AGENT);
      expect(agent.health!.immunityIds.length).toBeLessThanOrEqual(MAX_IMMUNITY_IDS_PER_AGENT);
      expect(agent.health!.infections.every((infection) => pathogenIds.has(infection.pathogenId))).toBe(true);
      expect(agent.health!.immunityIds.every((id) => pathogenIds.has(id))).toBe(true);
      expect(Number.isFinite(agent.health!.vitality) && agent.health!.vitality >= 0 && agent.health!.vitality <= 1).toBe(true);
    }

    const populationIds = new Set(state.populations.map((population) => population.id));
    expect(state.populations.length).toBeLessThanOrEqual(MAX_POPULATION_RECORDS);
    expect(new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`)).size).toBe(state.populations.length);
    for (const population of state.populations) {
      expect(populationSpeciesIds.has(population.speciesId)).toBe(true);
      expect(Number.isFinite(population.count) && population.count >= 0).toBe(true);
      expect(Number.isFinite(population.energy) && population.energy >= 0 && population.energy <= 1).toBe(true);
    }
    const speciesIds = new Set(state.species.map((species) => species.id));
    for (const role of ["producer", "consumer", "decomposer"] as const) {
      const roleSpeciesIds = new Set(state.species.filter((species) => species.role === role).map((species) => species.id));
      const minimumViableCount = role === "producer" ? 1 : 4;
      const activeIds = new Set(state.populations
        .filter((population) => roleSpeciesIds.has(population.speciesId) && population.count >= minimumViableCount)
        .map((population) => population.speciesId));
      expect(activeIds.size).toBeLessThanOrEqual(ACTIVE_ADAPTIVE_SPECIES_LIMITS[role]);
    }
    const ecologicalRelationships = state.ecologicalRelationships ?? [];
    expect(ecologicalRelationships.length).toBeLessThanOrEqual(MAX_ECOLOGICAL_RELATIONSHIPS);
    const ecologicalKeys = new Set<string>();
    for (const relationship of ecologicalRelationships) {
      const key = `${relationship.kind}|${relationship.regionId}|${relationship.fromSpeciesId}|${relationship.toSpeciesId}`;
      expect(ecologicalKeys.has(key)).toBe(false);
      ecologicalKeys.add(key);
      expect(speciesIds.has(relationship.fromSpeciesId)).toBe(true);
      expect(speciesIds.has(relationship.toSpeciesId)).toBe(true);
      const regionMatch = /^region:(\d+):(\d+)$/.exec(relationship.regionId);
      expect(regionMatch).not.toBeNull();
      if (regionMatch) {
        expect(Number(regionMatch[1])).toBeLessThan(state.fields.elevation.width);
        expect(Number(regionMatch[2])).toBeLessThan(state.fields.elevation.height);
      }
      expect([relationship.strength, relationship.lastImpact].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect([relationship.firstTick, relationship.lastTick, relationship.interactionCount].every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
      expect(Number.isFinite(relationship.cumulativeImpact) && relationship.cumulativeImpact >= 0).toBe(true);
      expect(relationship.lastTick).toBeGreaterThanOrEqual(relationship.firstTick);
      expect(relationship.interactionCount).toBeGreaterThan(0);
      expect(["active", "dormant"]).toContain(relationship.status);
      expect(Object.values(relationship.details).every((value) => typeof value !== "number" || Number.isFinite(value))).toBe(true);
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
        expect(!isEntityHolderId(resource.holderId)
          || agentIds.has(resource.holderId)
          || organizationIds.has(resource.holderId)).toBe(true);
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
    expect(state.worldview.interactions.length).toBeLessThanOrEqual(MAX_WORLDVIEW_INTERACTIONS);
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
    const worldviewEntityIds = new Set(state.worldview.entities.map((entity) => entity.id));
    for (const interaction of state.worldview.interactions) {
      const source = state.worldview.entities.find((entity) => entity.id === interaction.sourceEntityId);
      const target = state.worldview.entities.find((entity) => entity.id === interaction.targetEntityId);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(source?.regionId).toBe(interaction.regionId);
      expect(target?.regionId).toBe(interaction.targetRegionId ?? interaction.regionId);
      if (interaction.fusionEntityId) expect(worldviewEntityIds.has(interaction.fusionEntityId)).toBe(true);
      expect(interaction.sourcePackId).not.toBe(interaction.targetPackId);
      expect([interaction.compatibility, interaction.intensity, interaction.attempts, interaction.successes, interaction.failures].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    }
  };

  it("continues from an arbitrary high year and remains restorable", () => {
    const startingYear = 1_000_000_000;
    let state = createWorld(3480, { width: 8, height: 8, formation: "formed", enabledPackIds: ["emergence.original-worldview"] });
    state.years = startingYear;
    for (let step = 0; step < 20; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
    }

    expect(state.years).toBe(startingYear + 20);
    expect(state.tick).toBe(20);
    assertDenseWorldHealth(state);
    const restored = deserializeWorld(serializeWorld(state));
    expect(worldDigest(restored)).toBe(worldDigest(state));
    expect(restored.years).toBe(startingYear + 20);
  });

  it("retains daily calendar progress in remote eras", () => {
    const startingYear = 1_000_000_000;
    let state = createWorld(3481, { width: 8, height: 8, formation: "formed" });
    state.years = startingYear;
    for (let day = 0; day < 731; day += 1) {
      state = stepWorld(state, { elapsedYears: 1 / 365, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
    }

    expect(state.tick).toBe(731);
    expect(state.years).toBeCloseTo(startingYear + 2 + 1 / 365, 8);
    assertDenseWorldHealth(state);
    const restored = deserializeWorld(serializeWorld(state));
    expect(worldDigest(restored)).toBe(worldDigest(state));
  });

  it("keeps an autonomous world advancing across a five-millennial horizon", () => {
    let state = createWorld(3479, { width: 8, height: 8 });
    const initialElevation = Array.from(state.fields.elevation.values);
    for (let step = 0; step < 5_000; step += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
      if ((step + 1) % 1_000 === 0) {
        const restored = deserializeWorld(serializeWorld(state));
        expect(worldDigest(restored)).toBe(worldDigest(state));
        expect(restored.ecologicalRelationships).toEqual(state.ecologicalRelationships);
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

  it("keeps the exact world clock advancing beyond JavaScript safe integers", () => {
    let state = createWorld(8128, { width: 8, height: 8, formation: "formed" });
    state.tick = Number.MAX_SAFE_INTEGER;
    state.simulationDays = MAX_SIMULATION_DAYS;
    state.years = MAX_SIMULATION_DAYS / 365;
    state.timeline = { step: String(BigInt(Number.MAX_SAFE_INTEGER)), days: String(BigInt(MAX_SIMULATION_DAYS)) };

    for (let day = 0; day < 32; day += 1) {
      state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
    }

    expect(state.timeline).toEqual({
      step: String(BigInt(Number.MAX_SAFE_INTEGER) + 32n),
      days: String(BigInt(MAX_SIMULATION_DAYS) + 32n),
    });
    expect(state.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(state.simulationDays).toBe(MAX_SIMULATION_DAYS);
    expect(state.years).toBe(MAX_SIMULATION_DAYS / 365);
    const restored = deserializeWorld(serializeWorld(state));
    expect(restored.timeline).toEqual(state.timeline);
    expect(worldDigest(restored)).toBe(worldDigest(state));
    expect(isFiniteWorld(restored)).toBe(true);
  });

  it("keeps an evolved world stable after numeric clock projections saturate", () => {
    let state = createWorld(8_129, {
      width: 8,
      height: 8,
      formation: "formed",
      enabledPackIds: ["emergence.original-worldview"],
    });
    for (let year = 0; year < 360; year += 1) {
      state = stepWorld(state, { elapsedYears: 1, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
    }

    state.tick = Number.MAX_SAFE_INTEGER;
    state.simulationDays = MAX_SIMULATION_DAYS;
    state.years = MAX_SIMULATION_YEARS;
    state.timeline = {
      step: String(Number.MAX_SAFE_INTEGER),
      days: String(MAX_SIMULATION_DAYS),
    };

    for (let day = 0; day < 730; day += 1) {
      state = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: [] }, { computeDigest: false, mutateState: true }).state;
      if ((day + 1) % 365 === 0) {
        assertDenseWorldHealth(state);
        const restored = deserializeWorld(serializeWorld(state));
        expect(worldDigest(restored)).toBe(worldDigest(state));
        state = restored;
      }
    }

    expect(state.timeline).toEqual({
      step: String(BigInt(Number.MAX_SAFE_INTEGER) + 730n),
      days: String(BigInt(MAX_SIMULATION_DAYS) + 730n),
    });
    expect(state.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(state.simulationDays).toBe(MAX_SIMULATION_DAYS);
    expect(state.years).toBe(MAX_SIMULATION_YEARS);
    const latestSampleDays = state.eventArchive.historySamples.at(-1)?.timelineDays;
    expect(latestSampleDays).toBeDefined();
    expect(BigInt(latestSampleDays!)).toBeGreaterThan(BigInt(MAX_SIMULATION_DAYS));
    expect(BigInt(latestSampleDays!)).toBeLessThanOrEqual(BigInt(MAX_SIMULATION_DAYS) + 730n);
  }, 120_000);

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
      expect(state.agents.length).toBeLessThanOrEqual(MAX_DETAILED_AGENTS);
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
