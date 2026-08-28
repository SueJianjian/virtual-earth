import { speciesBlueprintFor } from "./blueprints.ts";
import type { ArchivedSpeciesSummary, EntityId, PopulationState, RegionId, SpeciesRole, SpeciesState, WorldState } from "../types.ts";
import { addPersistentTotal } from "../numeric.ts";

export const EXTINCT_SPECIES_RETAIN_COUNT = 128;
export const EXTINCT_SPECIES_COMPACT_THRESHOLD = 160;
export const MAX_ARCHIVED_SPECIES_SUMMARIES = 512;
export const MAX_ARCHIVED_SPECIES_REGIONS = 24;
export const MAX_POPULATION_RECORDS = 1_024;

const populationKey = (population: PopulationState): string =>
  `${population.speciesId}|${population.regionId}`;

const mergePopulation = (target: PopulationState, source: PopulationState): void => {
  const targetCount = Math.max(0, target.count);
  const sourceCount = Math.max(0, source.count);
  const count = targetCount + sourceCount;
  target.energy = count > 0
    ? Math.max(0, Math.min(1, (target.energy * targetCount + source.energy * sourceCount) / count))
    : Math.max(0, Math.min(1, Math.max(target.energy, source.energy)));
  target.count = count;
};

export const compactPopulationRecords = (state: WorldState): number => {
  const validSpeciesIds = new Set(state.species.map((species) => species.id));
  const previousPopulationCount = state.populations.length;
  state.populations = state.populations.filter((population) => validSpeciesIds.has(population.speciesId));
  const removedInvalidSpeciesRecords = previousPopulationCount - state.populations.length;
  const seenKeys = new Set<string>();
  let hasDuplicate = false;
  for (const population of state.populations) {
    population.energy = Math.max(0, Math.min(1, population.energy));
    const key = populationKey(population);
    if (seenKeys.has(key)) hasDuplicate = true;
    else seenKeys.add(key);
  }
  if (!hasDuplicate && state.populations.length <= MAX_POPULATION_RECORDS) return removedInvalidSpeciesRecords;

  const referencedIds = new Set(state.agents.map((agent) => agent.populationId));
  const groups = new Map<string, PopulationState[]>();
  for (const population of state.populations) {
    const group = groups.get(populationKey(population)) ?? [];
    group.push(population);
    groups.set(populationKey(population), group);
  }

  const redirects = new Map<EntityId, EntityId>();
  const coalesced: PopulationState[] = [];
  let removed = removedInvalidSpeciesRecords;
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) =>
      Number(referencedIds.has(right.id)) - Number(referencedIds.has(left.id))
      || right.count - left.count
      || left.id.localeCompare(right.id));
    const canonical = { ...ordered[0]! };
    for (const population of ordered.slice(1)) {
      mergePopulation(canonical, population);
      redirects.set(population.id, canonical.id);
      removed += 1;
    }
    coalesced.push(canonical);
  }

  if (coalesced.length > MAX_POPULATION_RECORDS) {
    const mandatoryIds = new Set<EntityId>();
    for (const agent of state.agents) mandatoryIds.add(redirects.get(agent.populationId) ?? agent.populationId);
    const largestBySpecies = new Map<EntityId, PopulationState>();
    for (const population of coalesced) {
      const current = largestBySpecies.get(population.speciesId);
      if (!current || population.count > current.count || (population.count === current.count && population.id.localeCompare(current.id) < 0)) {
        largestBySpecies.set(population.speciesId, population);
      }
    }
    for (const population of largestBySpecies.values()) mandatoryIds.add(population.id);

    const retainedIds = new Set<EntityId>(mandatoryIds);
    for (const population of [...coalesced].sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))) {
      if (retainedIds.size >= MAX_POPULATION_RECORDS) break;
      retainedIds.add(population.id);
    }
    const retainedBySpecies = new Map<EntityId, PopulationState>();
    for (const population of coalesced) {
      if (!retainedIds.has(population.id)) continue;
      const current = retainedBySpecies.get(population.speciesId);
      if (!current || population.count > current.count || (population.count === current.count && population.id.localeCompare(current.id) < 0)) {
        retainedBySpecies.set(population.speciesId, population);
      }
    }
    for (const population of coalesced) {
      if (retainedIds.has(population.id)) continue;
      const target = retainedBySpecies.get(population.speciesId);
      if (!target) continue;
      mergePopulation(target, population);
      redirects.set(population.id, target.id);
      removed += 1;
    }
    state.populations = coalesced.filter((population) => retainedIds.has(population.id));
  } else {
    state.populations = coalesced;
  }

  for (const agent of state.agents) {
    agent.populationId = redirects.get(agent.populationId) ?? agent.populationId;
  }
  return removed;
};

export const retainArchivedSpeciesSummaries = (
  summaries: readonly ArchivedSpeciesSummary[],
): ArchivedSpeciesSummary[] => {
  const latestById = new Map<EntityId, ArchivedSpeciesSummary>();
  for (const summary of summaries) latestById.set(summary.id, summary);
  return [...latestById.values()].slice(-MAX_ARCHIVED_SPECIES_SUMMARIES);
};

const archivedSpeciesSummaryFor = (state: WorldState, species: SpeciesState): ArchivedSpeciesSummary => {
  const regionalPopulations = state.populations
    .filter((population) => population.speciesId === species.id)
    .sort((left, right) => right.count - left.count || left.regionId.localeCompare(right.regionId));
  const lastKnownRegionIds = [...new Set(regionalPopulations.map((population) => population.regionId))]
    .slice(0, MAX_ARCHIVED_SPECIES_REGIONS) as RegionId[];
  const lastKnownPopulation = regionalPopulations.reduce(
    (total, population) => addPersistentTotal(total, Math.max(0, population.count)),
    0,
  );
  return {
    id: species.id,
    ...(species.name === undefined ? {} : { name: species.name }),
    role: species.role,
    traits: { ...species.traits },
    ...(species.parentId === undefined ? {} : { parentId: species.parentId }),
    ...(species.originRegionId === undefined ? {} : { originRegionId: species.originRegionId }),
    ...(species.originTick === undefined ? {} : { originTick: species.originTick }),
    ...(species.originTimelineStep === undefined ? {} : { originTimelineStep: species.originTimelineStep }),
    ...(species.originYears === undefined ? {} : { originYears: species.originYears }),
    blueprint: structuredClone(speciesBlueprintFor(species)),
    lastKnownPopulation,
    lastKnownRegionIds,
    archivedTick: state.tick,
    ...(state.timeline?.step === undefined ? {} : { archivedTimelineStep: state.timeline.step }),
    ...(state.timeline?.days === undefined ? {} : { archivedTimelineDays: state.timeline.days }),
    archivedYears: state.years,
  };
};

export const compactExtinctSpecies = (state: WorldState): SpeciesState[] => {
  if (state.species.length <= EXTINCT_SPECIES_COMPACT_THRESHOLD) return [];
  const livingSpeciesIds = new Set(
    state.populations
      .filter((population) => population.count > 0.001)
      .map((population) => population.speciesId),
  );
  const extinctSpecies = state.species.filter((species) => !livingSpeciesIds.has(species.id));
  if (extinctSpecies.length <= EXTINCT_SPECIES_COMPACT_THRESHOLD) return [];

  const retainedIds = new Set(
    extinctSpecies.slice(-EXTINCT_SPECIES_RETAIN_COUNT).map((species) => species.id),
  );
  const archived = extinctSpecies.filter((species) => !retainedIds.has(species.id));
  if (archived.length === 0) return [];

  state.eventArchive.archivedSpeciesCount = addPersistentTotal(state.eventArchive.archivedSpeciesCount, archived.length);
  state.eventArchive.archivedSpeciesSummaries = retainArchivedSpeciesSummaries([
    ...(state.eventArchive.archivedSpeciesSummaries ?? []),
    ...archived.map((species) => archivedSpeciesSummaryFor(state, species)),
  ]);
  for (const species of archived) {
    const role = species.role as SpeciesRole;
    state.eventArchive.archivedSpeciesRoleCounts[role] = addPersistentTotal(
      state.eventArchive.archivedSpeciesRoleCounts[role] ?? 0,
      1,
    );
  }
  const archivedIds = new Set(archived.map((species) => species.id));
  state.species = state.species.filter((species) => !archivedIds.has(species.id));
  // A population record is live state, so it must not outlive the species
  // record that gives it meaning. Historical evidence remains in the bounded
  // species archive and event ledger instead.
  state.populations = state.populations.filter((population) => !archivedIds.has(population.speciesId));
  return archived;
};
