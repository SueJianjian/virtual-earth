import type { EntityId, PopulationState, SpeciesRole, SpeciesState, WorldState } from "../types.ts";

export const EXTINCT_SPECIES_RETAIN_COUNT = 128;
export const EXTINCT_SPECIES_COMPACT_THRESHOLD = 160;
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
  const seenKeys = new Set<string>();
  let hasDuplicate = false;
  for (const population of state.populations) {
    population.energy = Math.max(0, Math.min(1, population.energy));
    const key = populationKey(population);
    if (seenKeys.has(key)) hasDuplicate = true;
    else seenKeys.add(key);
  }
  if (!hasDuplicate && state.populations.length <= MAX_POPULATION_RECORDS) return 0;

  const referencedIds = new Set(state.agents.map((agent) => agent.populationId));
  const groups = new Map<string, PopulationState[]>();
  for (const population of state.populations) {
    const group = groups.get(populationKey(population)) ?? [];
    group.push(population);
    groups.set(populationKey(population), group);
  }

  const redirects = new Map<EntityId, EntityId>();
  const coalesced: PopulationState[] = [];
  let removed = 0;
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

  state.eventArchive.archivedSpeciesCount += archived.length;
  for (const species of archived) {
    const role = species.role as SpeciesRole;
    state.eventArchive.archivedSpeciesRoleCounts[role] =
      (state.eventArchive.archivedSpeciesRoleCounts[role] ?? 0) + 1;
  }
  const archivedIds = new Set(archived.map((species) => species.id));
  state.species = state.species.filter((species) => !archivedIds.has(species.id));
  return archived;
};
