import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import { compactExtinctSpecies, compactPopulationRecords, EXTINCT_SPECIES_RETAIN_COUNT, MAX_ARCHIVED_SPECIES_REGIONS, MAX_ARCHIVED_SPECIES_SUMMARIES, MAX_POPULATION_RECORDS, retainArchivedSpeciesSummaries } from "../../src/sim/ecology/archive.ts";
import { speciesBlueprintFor } from "../../src/sim/ecology/blueprints.ts";
import { createWorld } from "../../src/sim/world.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import type { ArchivedSpeciesSummary, PopulationState, SpeciesState } from "../../src/sim/types.ts";

const species: SpeciesState = {
  id: "species:archive" as never,
  role: "producer",
  traits: { cognitivePotential: 0.5 },
};

describe("ecology archive bounds", () => {
  it("drops population records whose species no longer exists", () => {
    const state = createWorld(599, { width: 8, height: 8, formation: "formed" });
    state.species = [species];
    state.populations = [
      { id: "population:valid" as never, speciesId: species.id, regionId: "region:1:1" as never, count: 10, energy: 1 },
      { id: "population:orphan" as never, speciesId: "species:missing" as never, regionId: "region:1:1" as never, count: 10, energy: 1 },
    ];

    expect(compactPopulationRecords(state)).toBe(1);
    expect(state.populations.map((population) => population.id)).toEqual(["population:valid"]);
  });

  it("removes live population records when their extinct species are archived", () => {
    const state = createWorld(600, { width: 8, height: 8, formation: "formed" });
    const extinct = Array.from({ length: 200 }, (_, index): SpeciesState => ({
      id: `species:extinct:${index}` as never,
      role: "producer",
      traits: {},
    }));
    const living: SpeciesState = { id: "species:living" as never, role: "producer", traits: {} };
    state.species = [...extinct, living];
    state.populations = [
      { id: "population:living" as never, speciesId: living.id, regionId: "region:1:1" as never, count: 10, energy: 1 },
      { id: "population:archived" as never, speciesId: extinct[0]!.id, regionId: "region:1:1" as never, count: 0, energy: 0 },
    ];

    const archived = compactExtinctSpecies(state);

    expect(archived).toHaveLength(200 - EXTINCT_SPECIES_RETAIN_COUNT);
    expect(state.eventArchive.archivedSpeciesSummaries).toHaveLength(200 - EXTINCT_SPECIES_RETAIN_COUNT);
    expect(state.eventArchive.archivedSpeciesSummaries[0]).toMatchObject({
      id: extinct[0]!.id,
      role: "producer",
      lastKnownPopulation: 0,
      lastKnownRegionIds: ["region:1:1"],
      archivedTick: state.tick,
    });
    if (state.timeline) {
      expect(state.eventArchive.archivedSpeciesSummaries[0]).toMatchObject({
        archivedTimelineStep: state.timeline.step,
        archivedTimelineDays: state.timeline.days,
      });
    }
    expect(state.eventArchive.archivedSpeciesSummaries[0]?.blueprint).toBeDefined();
    expect(state.populations).toEqual([
      expect.objectContaining({ id: "population:living", speciesId: living.id }),
    ]);
    expect(state.populations.every((population) => state.species.some((species) => species.id === population.speciesId))).toBe(true);
  });

  it("coalesces duplicate regional populations without losing counts or agent references", () => {
    const state = createWorld(601, { width: 8, height: 8, formation: "formed" });
    const first: PopulationState = { id: "population:first" as never, speciesId: species.id, regionId: "region:1:1" as never, count: 10, energy: 0.2 };
    const second: PopulationState = { id: "population:second" as never, speciesId: species.id, regionId: first.regionId, count: 30, energy: 0.8 };
    state.species = [species];
    state.populations = [first, second];
    state.agents = [createAgent(first, species, 0, "archive-test")];

    expect(compactPopulationRecords(state)).toBe(1);

    expect(state.populations).toHaveLength(1);
    expect(state.populations[0]).toMatchObject({ id: first.id, count: 40, energy: 0.65 });
    expect(state.agents[0]?.populationId).toBe(first.id);
  });

  it("bounds detailed population records while conserving each species total", () => {
    const state = createWorld(602, { width: 8, height: 8, formation: "formed" });
    state.species = [species];
    state.populations = Array.from({ length: MAX_POPULATION_RECORDS + 1 }, (_, index): PopulationState => ({
      id: `population:bounded:${index}` as never,
      speciesId: species.id,
      regionId: `region:${index}:0` as never,
      count: index + 1,
      energy: 0.5,
    }));
    state.agents = [createAgent(state.populations[0]!, species, 0, "bounded-test")];
    const total = state.populations.reduce((sum, population) => sum + population.count, 0);

    expect(compactPopulationRecords(state)).toBe(1);

    expect(state.populations).toHaveLength(MAX_POPULATION_RECORDS);
    expect(state.populations.reduce((sum, population) => sum + population.count, 0)).toBe(total);
    expect(state.populations.some((population) => population.id === state.agents[0]?.populationId)).toBe(true);
    expect(new Set(state.populations.map((population) => `${population.speciesId}|${population.regionId}`)).size).toBe(state.populations.length);
  });

  it("retains a bounded species history index for unbounded timelines", () => {
    const summaries: ArchivedSpeciesSummary[] = Array.from({ length: MAX_ARCHIVED_SPECIES_SUMMARIES + 20 }, (_, index) => {
      const species = createSpecies(`bounded-archive:${index}`, "consumer");
      return {
        id: species.id,
        name: species.name!,
        role: species.role,
        traits: { ...species.traits },
        blueprint: speciesBlueprintFor(species),
        lastKnownPopulation: index,
        lastKnownRegionIds: Array.from({ length: MAX_ARCHIVED_SPECIES_REGIONS + 3 }, (_, regionIndex) => `region:${regionIndex}:0` as never).slice(0, MAX_ARCHIVED_SPECIES_REGIONS),
        archivedTick: index,
        archivedTimelineStep: String(index),
        archivedTimelineDays: String(index),
        archivedYears: index / 365,
      };
    });

    const retained = retainArchivedSpeciesSummaries(summaries);

    expect(retained).toHaveLength(MAX_ARCHIVED_SPECIES_SUMMARIES);
    expect(retained[0]?.id).toBe(summaries[20]?.id);
    expect(retained.at(-1)?.id).toBe(summaries.at(-1)?.id);
    expect(retained.every((summary) => summary.lastKnownRegionIds.length <= MAX_ARCHIVED_SPECIES_REGIONS)).toBe(true);
  });
});
