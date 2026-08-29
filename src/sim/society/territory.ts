import { forkRandom, hashString, randomFloat } from "../random.ts";
import type { DiplomaticStance, EntityId, FoodBalanceIndex, OrganizationState, OrganizationType, RegionId, WorldDelta, WorldState } from "../types.ts";
import { applyOrganizationConflict } from "./governance.ts";
import { diplomacyForOrganization, governanceForOrganization, minimumMembersFor } from "./organization.ts";
import { createFoodBalanceIndex, foodSecurityForOrganization } from "../agents/food.ts";
import { technologyProfileForRegion } from "../culture/technology.ts";
import { culturalCompatibility, cultureIdentityFor } from "../culture/identity.ts";
import { eventsForOrganization } from "../events/index.ts";
import { compareSimulationSteps, simulationStepDistance, simulationStepForWorld, simulationStepModulo } from "../time.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const territorialRank: Partial<Record<OrganizationType, number>> = {
  settlement: 1,
  city: 2,
  state: 3,
  federation: 4,
  empire: 5,
};

const territoryLimit: Partial<Record<OrganizationType, number>> = {
  settlement: 2,
  city: 5,
  state: 18,
  federation: 48,
  empire: 120,
};

const diplomaticTypes = new Set<OrganizationType>(["city", "state", "federation", "empire"]);

type TerritoryIndex = {
  agentIds: ReadonlySet<string>;
  agentsById: ReadonlyMap<EntityId, WorldState["agents"][number]>;
  populationsById: ReadonlyMap<string, WorldState["populations"][number]>;
  speciesById: ReadonlyMap<string, WorldState["species"][number]>;
  cultureIdentitiesByRegion: ReadonlyMap<RegionId, ReturnType<typeof cultureIdentityFor>>;
  territoryByOrganizationId: ReadonlyMap<string, RegionId[]>;
  facilitiesByOwner: ReadonlyMap<string, ReadonlyArray<WorldState["facilities"][number]>>;
  detailedCountByPopulation: ReadonlyMap<string, number>;
  populationBySpeciesRegion: ReadonlyMap<string, WorldState["populations"][number]>;
  resourcesByHolderRegion: ReadonlyMap<string, ReadonlyArray<WorldState["resources"][number]>>;
  resourcesByHolderRegionType: ReadonlyMap<string, WorldState["resources"][number]>;
  activeOrganizationCountByRegion: ReadonlyMap<string, number>;
  agentCountByRegion: ReadonlyMap<string, number>;
};

const holderRegionKey = (holderId: string, regionId: RegionId): string => `${holderId}|${regionId}`;
const holderRegionTypeKey = (holderId: string, regionId: RegionId, resourceId: string): string => `${holderRegionKey(holderId, regionId)}|${resourceId}`;
const speciesRegionKey = (speciesId: string, regionId: RegionId): string => `${speciesId}|${regionId}`;

const createTerritoryIndex = (state: WorldState): TerritoryIndex => {
  const agentCountByRegion = new Map<string, number>();
  const agentIds = new Set<string>();
  const agentsById = new Map<EntityId, WorldState["agents"][number]>();
  const detailedCountByPopulation = new Map<string, number>();
  for (const agent of state.agents) {
    agentIds.add(agent.id);
    agentsById.set(agent.id, agent);
    agentCountByRegion.set(agent.regionId, (agentCountByRegion.get(agent.regionId) ?? 0) + 1);
    const populationId = String(agent.populationId);
    detailedCountByPopulation.set(populationId, (detailedCountByPopulation.get(populationId) ?? 0) + 1);
  }
  const populationsById = new Map<string, WorldState["populations"][number]>();
  const populationBySpeciesRegion = new Map<string, WorldState["populations"][number]>();
  for (const population of state.populations) {
    populationsById.set(String(population.id), population);
    const key = speciesRegionKey(String(population.speciesId), population.regionId);
    if (!populationBySpeciesRegion.has(key)) populationBySpeciesRegion.set(key, population);
  }
  const speciesById = new Map<string, WorldState["species"][number]>();
  for (const species of state.species) speciesById.set(String(species.id), species);
  const cultureIdentitiesByRegion = new Map<RegionId, ReturnType<typeof cultureIdentityFor>>();
  for (const culture of state.cultures) {
    if (!cultureIdentitiesByRegion.has(culture.regionId)) cultureIdentitiesByRegion.set(culture.regionId, cultureIdentityFor(culture));
  }
  const territoryByOrganizationId = new Map<string, RegionId[]>();
  for (const organization of state.organizations) territoryByOrganizationId.set(organization.id, territoryFor(organization));
  const facilitiesByOwner = new Map<string, WorldState["facilities"]>();
  for (const facility of state.facilities) {
    if (!facility.ownerOrganizationId) continue;
    const entries = facilitiesByOwner.get(facility.ownerOrganizationId) ?? [];
    entries.push(facility);
    facilitiesByOwner.set(facility.ownerOrganizationId, entries);
  }
  const resourcesByHolderRegion = new Map<string, WorldState["resources"]>();
  const resourcesByHolderRegionType = new Map<string, WorldState["resources"][number]>();
  for (const resource of state.resources) {
    if (!resource.holderId) continue;
    const regionKey = holderRegionKey(resource.holderId, resource.regionId);
    const entries = resourcesByHolderRegion.get(regionKey) ?? [];
    entries.push(resource);
    resourcesByHolderRegion.set(regionKey, entries);
    const typeKey = holderRegionTypeKey(resource.holderId, resource.regionId, resource.resourceId);
    if (!resourcesByHolderRegionType.has(typeKey)) resourcesByHolderRegionType.set(typeKey, resource);
  }
  const activeOrganizationCountByRegion = new Map<string, number>();
  for (const organization of state.organizations) {
    if (organization.status !== "active") continue;
    activeOrganizationCountByRegion.set(organization.regionId, (activeOrganizationCountByRegion.get(organization.regionId) ?? 0) + 1);
  }
  return {
    agentIds,
    agentsById,
    populationsById,
    speciesById,
    cultureIdentitiesByRegion,
    territoryByOrganizationId,
    facilitiesByOwner,
    detailedCountByPopulation,
    populationBySpeciesRegion,
    resourcesByHolderRegion,
    resourcesByHolderRegionType,
    activeOrganizationCountByRegion,
    agentCountByRegion,
  };
};

const territoryFor = (organization: OrganizationState): RegionId[] => [...new Set(
  organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId],
)].sort();

const relationBetween = (left: OrganizationState, right: OrganizationState): DiplomaticStance =>
  left.diplomacy?.[right.id] ?? right.diplomacy?.[left.id] ?? "neutral";

const culturalLinkFor = (
  state: WorldState,
  left: OrganizationState,
  right: OrganizationState,
  cultureIdentitiesByRegion?: ReadonlyMap<RegionId, ReturnType<typeof cultureIdentityFor>>,
): {
  compatibility: number;
  leftCultureName?: string;
  rightCultureName?: string;
  leftLanguage?: string;
  rightLanguage?: string;
} => {
  const leftIdentity = cultureIdentitiesByRegion?.get(left.regionId);
  const rightIdentity = cultureIdentitiesByRegion?.get(right.regionId);
  if (leftIdentity && rightIdentity) {
    return {
      compatibility: culturalCompatibility(leftIdentity, rightIdentity),
      leftCultureName: leftIdentity.name,
      rightCultureName: rightIdentity.name,
      leftLanguage: leftIdentity.languageFamily,
      rightLanguage: rightIdentity.languageFamily,
    };
  }
  const leftCulture = state.cultures.find((culture) => culture.regionId === left.regionId);
  const rightCulture = state.cultures.find((culture) => culture.regionId === right.regionId);
  if (!leftCulture || !rightCulture) return { compatibility: 0.75 };
  const fallbackLeftIdentity = cultureIdentityFor(leftCulture);
  const fallbackRightIdentity = cultureIdentityFor(rightCulture);
  return {
    compatibility: culturalCompatibility(fallbackLeftIdentity, fallbackRightIdentity),
    leftCultureName: fallbackLeftIdentity.name,
    rightCultureName: fallbackRightIdentity.name,
    leftLanguage: fallbackLeftIdentity.languageFamily,
    rightLanguage: fallbackRightIdentity.languageFamily,
  };
};

const withRelation = (organization: OrganizationState, other: OrganizationState, stance: DiplomaticStance): OrganizationState => ({
  ...organization,
  diplomacy: { ...diplomacyForOrganization(organization), [other.id]: stance },
});

const organizationsAfter = (state: WorldState, delta: WorldDelta): WorldState["organizations"] => {
  const organizations = new Map(state.organizations.map((organization) => [organization.id, organization]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "organizations") continue;
    if (effect.operation === "remove") organizations.delete(effect.id);
    else if (effect.value) organizations.set(effect.id, effect.value);
  }
  return [...organizations.values()];
};

const parseRegion = (regionId: RegionId): { x: number; y: number } | undefined => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  return match ? { x: Number(match[1] ?? 0), y: Number(match[2] ?? 0) } : undefined;
};

const MAX_NEIGHBOR_GRID_CACHES = 8;
const neighboringRegionCaches = new Map<string, Map<RegionId, RegionId[]>>();

export const neighboringRegionIdsCached = (regionId: RegionId, width: number, height: number): RegionId[] => {
  const point = parseRegion(regionId);
  if (!point) return [];
  const gridKey = `${width}x${height}`;
  let gridCache = neighboringRegionCaches.get(gridKey);
  if (!gridCache) {
    if (neighboringRegionCaches.size >= MAX_NEIGHBOR_GRID_CACHES) neighboringRegionCaches.clear();
    gridCache = new Map<RegionId, RegionId[]>();
    neighboringRegionCaches.set(gridKey, gridCache);
  }
  const cached = gridCache.get(regionId);
  if (cached) return cached;
  const { x, y } = point;
  const neighbors = [...new Set([
    width > 1 ? `region:${(x + 1) % width}:${y}` as RegionId : undefined,
    width > 1 ? `region:${(x + width - 1) % width}:${y}` as RegionId : undefined,
    y + 1 < height ? `region:${x}:${y + 1}` as RegionId : undefined,
    y > 0 ? `region:${x}:${y - 1}` as RegionId : undefined,
  ].filter((candidate): candidate is RegionId => Boolean(candidate)))];
  gridCache.set(regionId, neighbors);
  return neighbors;
};

export const neighboringRegionIds = (regionId: RegionId, width: number, height: number): RegionId[] =>
  [...neighboringRegionIdsCached(regionId, width, height)];

export const territoriesTouch = (left: OrganizationState, right: OrganizationState, width: number, height: number): boolean => {
  const rightTerritory = new Set(territoryFor(right));
  return territoryFor(left).some((regionId) => rightTerritory.has(regionId)
    || neighboringRegionIdsCached(regionId, width, height).some((neighbor) => rightTerritory.has(neighbor)));
};

type OrganizationPair = readonly [OrganizationState, OrganizationState];

export const touchingDiplomaticOrganizationPairs = (
  organizations: OrganizationState[],
  width: number,
  height: number,
  territoriesByOrganizationId?: ReadonlyMap<OrganizationState["id"], RegionId[]>,
): OrganizationPair[] => {
  const candidates = organizations
    .filter((organization) => organization.status === "active" && diplomaticTypes.has(organization.type))
    .sort((left, right) => left.id.localeCompare(right.id));
  const territoryOwners = new Map<RegionId, number[]>();
  const territoryOf = (organization: OrganizationState): RegionId[] =>
    territoriesByOrganizationId?.get(organization.id) ?? territoryFor(organization);
  const territories = candidates.map((organization, index) => {
    const territory = territoryOf(organization);
    for (const regionId of territory) {
      const owners = territoryOwners.get(regionId) ?? [];
      owners.push(index);
      territoryOwners.set(regionId, owners);
    }
    return territory;
  });
  const contactKeys = new Set<string>();

  for (let index = 0; index < candidates.length; index += 1) {
    const organization = candidates[index];
    if (!organization) continue;
    for (const regionId of territories[index] ?? []) {
      for (const nearbyRegionId of [regionId, ...neighboringRegionIdsCached(regionId, width, height)]) {
        for (const peerIndex of territoryOwners.get(nearbyRegionId) ?? []) {
          if (peerIndex === index) continue;
          const leftIndex = Math.min(index, peerIndex);
          const rightIndex = Math.max(index, peerIndex);
          const left = candidates[leftIndex];
          const right = candidates[rightIndex];
          if (!left || !right || left.regionId === right.regionId) continue;
          contactKeys.add(`${leftIndex}:${rightIndex}`);
        }
      }
    }
  }

  return [...contactKeys]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort(([leftIndex, leftPeerIndex], [rightIndex, rightPeerIndex]) => leftIndex - rightIndex || leftPeerIndex - rightPeerIndex)
    .flatMap(([leftIndex, rightIndex]) => {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      return left && right ? [[left, right] as const] : [];
    });
};

const regionScore = (state: WorldState, regionId: RegionId, organization: OrganizationState, territoryIndex: TerritoryIndex): number => {
  const point = parseRegion(regionId);
  if (!point) return 0;
  const cellIndex = point.y * state.fields.elevation.width + point.x;
  const localAgents = territoryIndex.agentCountByRegion.get(regionId) ?? 0;
  const activeOrganizations = territoryIndex.activeOrganizationCountByRegion.get(regionId) ?? 0;
  const localOrganizations = activeOrganizations - (organization.status === "active" && organization.regionId === regionId ? 1 : 0);
  const biomass = state.fields.biomass.values[cellIndex] ?? 0;
  const nutrients = state.fields.nutrients.values[cellIndex] ?? 0;
  const water = state.fields.water.values[cellIndex] ?? 0;
  return localAgents * 0.025 + localOrganizations * 0.08 + biomass * 2.2 + nutrients * 0.25 - Math.max(0, water - 0.72) * 0.5;
};

const expandTerritories = (state: WorldState, delta: WorldDelta, index: TerritoryIndex): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const currentStep = simulationStepForWorld(state);
  const organizations = state.organizations
    .filter((organization) => organization.status === "active" && territorialRank[organization.type])
    .sort((left, right) => left.id.localeCompare(right.id));
  const peerByTypeAndRegion = new Map<string, OrganizationState>();
  for (const organization of organizations) {
    for (const regionId of index.territoryByOrganizationId.get(organization.id) ?? territoryFor(organization)) {
      const key = `${organization.type}|${regionId}`;
      if (!peerByTypeAndRegion.has(key)) peerByTypeAndRegion.set(key, organization);
    }
  }
  for (const organization of organizations) {
    const limit = territoryLimit[organization.type] ?? 1;
    const territory = index.territoryByOrganizationId.get(organization.id) ?? territoryFor(organization);
    if (territory.length >= limit || (simulationStepModulo(currentStep, 8) + hashString(organization.id)) % 8 !== 0) continue;
    const territorySet = new Set(territory);
      const candidates = [...new Set(territory.flatMap((regionId) => neighboringRegionIdsCached(regionId, width, height)))]
      .filter((regionId) => !territorySet.has(regionId))
      .map((regionId) => ({ regionId, score: regionScore(state, regionId, organization, index) }))
      .sort((left, right) => right.score - left.score || left.regionId.localeCompare(right.regionId));
    const target = candidates[0];
    if (!target || target.score < 0.04) continue;
    const peer = peerByTypeAndRegion.get(`${organization.type}|${target.regionId}`);
    if (peer) {
      const culturalLink = culturalLinkFor(state, organization, peer, index.cultureIdentitiesByRegion);
      const probability = Math.min(0.55, (0.12 + Math.abs(organization.memberIds.length - peer.memberIds.length) / 500) * (0.72 + (1 - culturalLink.compatibility) * 0.28));
      const [roll] = randomFloat(forkRandom(state.random, `border:${organization.id}:${peer.id}:${target.regionId}:${currentStep}`));
      if (roll >= probability) continue;
      const conflict = applyOrganizationConflict(organization, peer, state.tick, simulationStepForWorld(state));
      for (const relationshipEffect of conflict.relationshipEffects) delta.relationshipEffects.push(relationshipEffect);
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: withRelation(organization, peer, "rival") });
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: peer.id, value: withRelation(peer, organization, "rival") });
      delta.eventDrafts.push({
        kind: "border-conflict",
        ruleId: "society:border-conflict",
        sourceIds: [organization.id, peer.id],
        probability,
        roll,
        evidence: { regionId: target.regionId, leftRegion: organization.regionId, rightRegion: peer.regionId, leftTerritory: territory.length, rightTerritory: territoryFor(peer).length, culturalCompatibility: culturalLink.compatibility, leftCulture: culturalLink.leftCultureName ?? "none", rightCulture: culturalLink.rightCultureName ?? "none", eligible: true },
        payload: { regionId: target.regionId, leftOrganizationId: organization.id, rightOrganizationId: peer.id, fromRegion: organization.regionId, toRegion: peer.regionId, culturalCompatibility: culturalLink.compatibility, leftCulture: culturalLink.leftCultureName ?? "none", rightCulture: culturalLink.rightCultureName ?? "none" },
        source: "natural",
      });
      continue;
    }
    const probability = Math.min(0.72, 0.1 + target.score * 0.18 + Math.min(0.24, organization.memberIds.length / 800));
    const [roll] = randomFloat(forkRandom(state.random, `territory:${organization.id}:${target.regionId}:${currentStep}`));
    if (roll >= probability) continue;
    const territoryRegionIds = [...territory, target.regionId].sort();
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: { ...organization, territoryRegionIds } });
    delta.eventDrafts.push({
      kind: "territory-expansion",
      ruleId: "society:territory-expansion",
      sourceIds: [organization.id],
      probability,
      roll,
      evidence: { fromRegion: organization.regionId, toRegion: target.regionId, territorySize: territoryRegionIds.length, regionScore: target.score },
      payload: { organizationId: organization.id, type: organization.type, fromRegion: organization.regionId, toRegion: target.regionId, territoryRegionIds },
      source: "natural",
    });
  }
};

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

const average = (left: number, right: number): number => (left + right) / 2;

const migrationOrganizationTypes = new Set<OrganizationType>(["settlement", "city", "state", "federation", "empire"]);
const ORGANIZATION_MIGRATION_COOLDOWN = 24;

const environmentalSuitabilityFor = (state: WorldState, regionId: RegionId): number => {
  const point = parseRegion(regionId);
  if (!point) return 0;
  const index = point.y * state.fields.elevation.width + point.x;
  const temperature = state.fields.temperature.values[index] ?? 0.5;
  const humidity = state.fields.humidity.values[index] ?? 0.5;
  const water = state.fields.water.values[index] ?? 0;
  const biomass = state.fields.biomass.values[index] ?? 0;
  const nutrients = state.fields.nutrients.values[index] ?? 0;
  const thermalComfort = 1 - Math.min(1, Math.abs(temperature - 0.5) * 2);
  const moistureComfort = 1 - Math.min(1, Math.abs(water - 0.45) * 2);
  return clamp(biomass * 0.48 + nutrients * 0.14 + thermalComfort * 0.18 + moistureComfort * 0.12 + humidity * 0.08);
};

const migrationRecentlyRecorded = (state: WorldState, organizationId: string, currentStep: string): boolean => eventsForOrganization(state.events, organizationId).some((event) => {
  if (event.kind !== "organization-migration") return false;
  if (!event.sourceIds.includes(organizationId) && event.payload.organizationId !== organizationId) return false;
  const eventStep = event.timelineStep ?? String(event.tick);
  return compareSimulationSteps(currentStep, eventStep) >= 0
    && simulationStepDistance(currentStep, eventStep) < ORGANIZATION_MIGRATION_COOLDOWN;
});

const populationIdForMigration = (speciesId: string, regionId: RegionId): EntityId =>
  `population:${hashString(`${speciesId}:${regionId}`).toString(16)}` as EntityId;

const migrateOrganizationMembers = (
  state: WorldState,
  delta: WorldDelta,
  organization: OrganizationState,
  destinationRegionId: RegionId,
  memberIds: readonly EntityId[],
  index: TerritoryIndex,
): number => {
  const movedByPopulation = new Map<string, number>();
  const membersByPopulation = new Map<string, EntityId[]>();
  for (const memberId of memberIds) {
    const agent = index.agentsById.get(memberId);
    if (!agent || agent.regionId !== organization.regionId) continue;
    const populationId = String(agent.populationId);
    movedByPopulation.set(populationId, (movedByPopulation.get(populationId) ?? 0) + 1);
    const members = membersByPopulation.get(populationId) ?? [];
    members.push(memberId);
    membersByPopulation.set(populationId, members);
  }

  const destinationPopulationBySpecies = new Map<string, WorldState["populations"][number]>();
  const populationUpdates = new Map<string, WorldState["populations"][number]>();
  const createdPopulationIds = new Set<string>();
  const destinationPopulationIdByAgent = new Map<string, EntityId>();
  let movedPopulationCount = 0;

  for (const [populationId, movedAgentCount] of [...movedByPopulation.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const source = index.populationsById.get(populationId);
    if (!source || movedAgentCount <= 0) continue;
    const detailedCount = Math.max(1, index.detailedCountByPopulation.get(populationId) ?? movedAgentCount);
    const species = index.speciesById.get(String(source.speciesId));
    const minimumViableCount = species?.role === "producer" ? 1 : 4;
    const allDetailedAgentsMoved = movedAgentCount >= detailedCount;
    const representedCount = Math.max(1, Math.round(source.count / detailedCount));
    const maximumTransfer = allDetailedAgentsMoved ? source.count : Math.max(0, source.count - minimumViableCount);
    const transferred = Math.min(maximumTransfer, representedCount * movedAgentCount);
    if (transferred <= 0) continue;

    const destinationPopulationId = populationIdForMigration(source.speciesId, destinationRegionId);
    const existingDestination = destinationPopulationBySpecies.get(String(source.speciesId))
      ?? index.populationBySpeciesRegion.get(speciesRegionKey(String(source.speciesId), destinationRegionId));
    const destination = existingDestination ?? {
      ...source,
      id: destinationPopulationId,
      regionId: destinationRegionId,
      count: 0,
      energy: Math.max(0.1, source.energy * 0.78),
    };
    const priorDestinationCount = destinationPopulationBySpecies.get(String(source.speciesId))?.count
      ?? (existingDestination ? existingDestination.count : 0);
    const nextDestinationCount = priorDestinationCount + transferred;
    const nextDestinationEnergy = (destination.energy * Math.max(0, priorDestinationCount) + Math.max(0.1, source.energy * 0.78) * transferred)
      / Math.max(1, nextDestinationCount);
    const nextDestination = {
      ...destination,
      count: nextDestinationCount,
      energy: clamp(nextDestinationEnergy),
    };
    destinationPopulationBySpecies.set(String(source.speciesId), nextDestination);
    populationUpdates.set(String(source.id), { ...source, count: source.count - transferred });
    populationUpdates.set(String(nextDestination.id), nextDestination);
    if (!existingDestination) createdPopulationIds.add(String(nextDestination.id));
    for (const memberId of membersByPopulation.get(populationId) ?? []) destinationPopulationIdByAgent.set(memberId, nextDestination.id);
    movedPopulationCount += transferred;
  }

  for (const population of populationUpdates.values()) {
    const isDestination = population.regionId === destinationRegionId;
    const operation = isDestination && createdPopulationIds.has(String(population.id)) ? "create" : "update";
    delta.entityEffects.push({ collection: "populations", operation, id: population.id, value: population });
  }
  for (const memberId of memberIds) {
    const agent = index.agentsById.get(memberId);
    if (!agent || agent.regionId !== organization.regionId) continue;
    const populationId = destinationPopulationIdByAgent.get(agent.id);
    delta.entityEffects.push({
      collection: "agents",
      operation: "update",
      id: agent.id,
      value: { ...agent, regionId: destinationRegionId, ...(populationId ? { populationId } : {}) },
    });
  }
  return movedPopulationCount;
};

const migrateOrganizationFacilities = (
  state: WorldState,
  delta: WorldDelta,
  organization: OrganizationState,
  destinationRegionId: RegionId,
  index: TerritoryIndex,
): void => {
  for (const facility of index.facilitiesByOwner.get(organization.id) ?? []) {
    if (facility.status === "abandoned") continue;
    delta.entityEffects.push({
      collection: "facilities",
      operation: "update",
      id: facility.id,
      value: { ...facility, regionId: destinationRegionId },
    });
  }
};

const migrateOrganizations = (
  state: WorldState,
  delta: WorldDelta,
  index: TerritoryIndex,
  foodIndex: FoodBalanceIndex,
  territoryLookup?: ReadonlyMap<OrganizationState["id"], RegionId[]>,
): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const currentStep = simulationStepForWorld(state);
  const organizations = state.organizations
    .filter((organization) => organization.status === "active" && migrationOrganizationTypes.has(organization.type))
    .sort((left, right) => (territorialRank[right.type] ?? 0) - (territorialRank[left.type] ?? 0) || left.id.localeCompare(right.id));
  const territoriesByOrganizationId = territoryLookup
    ?? new Map(organizations.map((organization) => [organization.id, territoryFor(organization)]));
  const occupiedRegions = new Set([...territoriesByOrganizationId.values()].flat());
  const claimedDestinations = new Set<RegionId>();
  const movedAgents = new Set<EntityId>();
  const activeMembershipCounts = new Map<EntityId, number>();
  for (const candidate of state.organizations.filter((organization) => organization.status === "active")) {
    for (const memberId of new Set(candidate.memberIds)) {
      activeMembershipCounts.set(memberId, (activeMembershipCounts.get(memberId) ?? 0) + 1);
    }
  }
  const newlyCreatedOrganizationIds = new Set(delta.entityEffects
    .filter((effect) => effect.collection === "organizations" && effect.operation === "create")
    .map((effect) => effect.id));

  for (const organization of organizations) {
    if (newlyCreatedOrganizationIds.has(organization.id)
      || organization.memberIds.length < minimumMembersFor(organization.type)
      || organization.memberIds.some((memberId) => (activeMembershipCounts.get(memberId) ?? 0) > 1)
      || migrationRecentlyRecorded(state, organization.id, currentStep)) continue;
    const governance = governanceForOrganization(organization);
    if (governance.lastConflictTimelineStep === currentStep) continue;
    const currentHabitat = environmentalSuitabilityFor(state, organization.regionId);
    const foodSecurity = foodSecurityForOrganization(state, organization, foodIndex);
    const pressure = clamp((1 - foodSecurity) * 0.55 + (1 - currentHabitat) * 0.25 + (1 - governance.stability) * 0.2);
    if (pressure < 0.62) continue;
    const fromTerritory = territoriesByOrganizationId.get(organization.id) ?? [organization.regionId];
    const ownTerritory = new Set(fromTerritory);
    const target = [...new Set(fromTerritory.flatMap((regionId) => neighboringRegionIdsCached(regionId, width, height)))]
      .filter((regionId) => !ownTerritory.has(regionId) && !claimedDestinations.has(regionId))
      .filter((regionId) => !occupiedRegions.has(regionId))
      .map((regionId) => {
        const habitat = environmentalSuitabilityFor(state, regionId);
        return {
          regionId,
          habitat,
          score: habitat * 0.82 + Math.min(0.18, (index.agentCountByRegion.get(regionId) ?? 0) * 0.01),
        };
      })
      .sort((left, right) => right.score - left.score || left.regionId.localeCompare(right.regionId))[0];
    if (!target || target.score <= currentHabitat + Math.max(0.06, pressure * 0.04)) continue;
    const technology = technologyProfileForRegion(state, organization.regionId);
    const advantage = target.score - currentHabitat;
    const probability = clamp(0.05 + pressure * 0.35 + advantage * 0.55 + technology.navigation * 0.08, 0.05, 0.75);
    const [roll] = randomFloat(forkRandom(state.random, `organization-migration:${organization.id}:${target.regionId}:${currentStep}`));
    if (roll >= probability) continue;
    const movingMembers = organization.memberIds
      .filter((memberId) => !movedAgents.has(memberId))
      .filter((memberId) => index.agentIds.has(memberId))
      .sort();
    const movedPopulationCount = migrateOrganizationMembers(state, delta, organization, target.regionId, movingMembers, index);
    const resourceEntries = (index.resourcesByHolderRegion.get(holderRegionKey(organization.id, organization.regionId)) ?? [])
      .filter((resource) => resource.amount > 0.000000001)
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId) || left.id.localeCompare(right.id));
    let carriedResourceAmount = 0;
    for (const resource of resourceEntries) {
      const destination = index.resourcesByHolderRegionType.get(holderRegionTypeKey(organization.id, target.regionId, resource.resourceId));
      const destinationCapacity = destination ? Math.max(0, destination.cap - destination.amount) : resource.amount;
      const carried = Math.min(resource.amount, destinationCapacity);
      if (carried <= 0.000000001) continue;
      carriedResourceAmount += carried;
      delta.resourceTransactions.push({
        id: `resource:${resource.resourceId}:organization-migration:${currentStep}:${organization.id}:${resource.id}`,
        resourceId: resource.resourceId,
        regionId: organization.regionId,
        destinationRegionId: target.regionId,
        amount: carried,
        operation: "transfer",
        source: "culture",
        sourceId: organization.id,
        fromHolderId: organization.id,
        toHolderId: organization.id,
        causeRuleId: "society:organization-migration",
      });
    }
    for (const memberId of movingMembers) movedAgents.add(memberId);
    migrateOrganizationFacilities(state, delta, organization, target.regionId, index);
    const migratedOrganization: OrganizationState = {
      ...organization,
      regionId: target.regionId,
      territoryRegionIds: [target.regionId],
      status: "migrating",
    };
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: migratedOrganization });
    delta.eventDrafts.push({
      kind: "organization-migration",
      ruleId: "society:organization-migration",
      sourceIds: [organization.id, ...movingMembers.slice(0, 32)],
      probability,
      roll,
      evidence: {
        fromRegion: organization.regionId,
        toRegion: target.regionId,
        pressure,
        foodSecurity,
        currentHabitat,
        destinationHabitat: target.habitat,
        movedMemberCount: movingMembers.length,
        movedPopulationCount,
        carriedResourceAmount,
        abandonedTerritoryCount: Math.max(0, fromTerritory.length - 1),
        eligible: true,
      },
      payload: {
        organizationId: organization.id,
        fromOrganizationId: organization.id,
        fromRegion: organization.regionId,
        toRegion: target.regionId,
        fromTerritoryRegionIds: fromTerritory,
        toTerritoryRegionIds: [target.regionId],
        movedMemberCount: movingMembers.length,
        movedPopulationCount,
        carriedResourceAmount,
        reason: foodSecurity < 0.2 ? "food-shortage" : currentHabitat < 0.3 ? "environmental-pressure" : "governance-pressure",
      },
      source: "natural",
    });
    claimedDestinations.add(target.regionId);
    for (const regionId of fromTerritory) occupiedRegions.delete(regionId);
    occupiedRegions.add(target.regionId);
  }
};

const addDiplomaticPacts = (
  state: WorldState,
  delta: WorldDelta,
  organizations: OrganizationState[],
  pairs?: OrganizationPair[],
  cultureIdentitiesByRegion?: ReadonlyMap<RegionId, ReturnType<typeof cultureIdentityFor>>,
): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  for (const [left, right] of pairs ?? touchingDiplomaticOrganizationPairs(organizations, width, height)) {
    const relation = relationBetween(left, right);
    if (relation === "rival" || relation === "allied") continue;
    const leftGovernance = governanceForOrganization(left);
    const rightGovernance = governanceForOrganization(right);
    const readiness = average(
      leftGovernance.stability + leftGovernance.legitimacy + leftGovernance.cohesion,
      rightGovernance.stability + rightGovernance.legitimacy + rightGovernance.cohesion,
    ) / 3;
    if (readiness < 0.52) continue;
    const culturalLink = culturalLinkFor(state, left, right, cultureIdentitiesByRegion);
    const probability = Math.min(0.1, (0.018 + readiness * 0.055 + (relation === "trade" ? 0.018 : 0)) * (0.66 + culturalLink.compatibility * 0.34));
      const [roll] = randomFloat(forkRandom(state.random, `alliance:${left.id}:${right.id}:${simulationStepForWorld(state)}`));
    if (roll >= probability) continue;
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: left.id, value: withRelation(left, right, "allied") });
    delta.entityEffects.push({ collection: "organizations", operation: "update", id: right.id, value: withRelation(right, left, "allied") });
    delta.eventDrafts.push({
      kind: "diplomatic-alliance",
      ruleId: "society:diplomatic-alliance",
      sourceIds: [left.id, right.id],
      probability,
      roll,
      evidence: { fromRegion: left.regionId, toRegion: right.regionId, readiness, previousStance: relation, culturalCompatibility: culturalLink.compatibility, leftCulture: culturalLink.leftCultureName ?? "none", rightCulture: culturalLink.rightCultureName ?? "none" },
      payload: { leftOrganizationId: left.id, rightOrganizationId: right.id, stance: "allied", culturalCompatibility: culturalLink.compatibility, leftCulture: culturalLink.leftCultureName ?? "none", rightCulture: culturalLink.rightCultureName ?? "none" },
      source: "natural",
    });
  }
};

const militaryPower = (state: WorldState, organization: OrganizationState, territorySize = territoryFor(organization).length): number => {
  const governance = governanceForOrganization(organization);
  const technology = technologyProfileForRegion(state, organization.regionId);
  return Math.max(1, organization.memberIds.length)
    * (0.35 + governance.military + technology.construction * 0.12 + technology.energy * 0.08)
    * (0.55 + governance.stability)
    * (0.7 + Math.min(0.3, territorySize * 0.03));
};

const selectAgents = (
  state: WorldState,
  organization: OrganizationState,
  count: number,
  label: string,
  reserved: ReadonlySet<EntityId>,
  agentIds: ReadonlySet<string>,
): EntityId[] => organization.memberIds
  .filter((memberId) => agentIds.has(memberId) && !reserved.has(memberId))
  .sort((left, right) => hashString(`${label}:${left}`) - hashString(`${label}:${right}`) || left.localeCompare(right))
  .slice(0, Math.max(0, count)) as EntityId[];

const addPopulationLosses = (state: WorldState, delta: WorldDelta, casualtyIds: ReadonlySet<EntityId>, index: TerritoryIndex): Record<string, number> => {
  const losses = new Map<string, number>();
  for (const agent of state.agents) {
    if (!casualtyIds.has(agent.id)) continue;
    const populationId = String(agent.populationId);
    const population = index.populationsById.get(populationId);
    if (!population) continue;
    const representedCount = Math.max(1, index.detailedCountByPopulation.get(populationId) ?? 1);
    const representedLoss = Math.max(1, Math.round(population.count / representedCount));
    losses.set(populationId, (losses.get(populationId) ?? 0) + representedLoss);
  }
  for (const population of state.populations) {
    const loss = losses.get(String(population.id));
    if (!loss) continue;
    delta.entityEffects.push({
      collection: "populations",
      operation: "update",
      id: population.id,
      value: { ...population, count: Math.max(0, population.count - loss) },
    });
  }
  return Object.fromEntries(losses);
};

const organizationAfterWar = (
  organization: OrganizationState,
  other: OrganizationState,
  governance: ReturnType<typeof governanceForOrganization>,
  casualtyIds: ReadonlySet<EntityId>,
  territoryRegionIds: RegionId[],
  status: OrganizationState["status"] = "active",
  admittedIds: ReadonlySet<EntityId> = new Set(),
  departedIds: ReadonlySet<EntityId> = new Set(),
): OrganizationState => ({
  ...organization,
  memberIds: [...new Set([...organization.memberIds.filter((id) => !casualtyIds.has(id) && !departedIds.has(id)), ...admittedIds])].sort() as OrganizationState["memberIds"],
  territoryRegionIds: [...new Set(territoryRegionIds)].sort(),
  status,
  governance,
  diplomacy: { ...diplomacyForOrganization(organization), [other.id]: "rival" },
});

type InheritedOrganizationAssets = {
  resourceAmount: number;
  resourceTypes: string[];
  facilityCount: number;
};

const inheritAbsorbedOrganizationAssets = (
  state: WorldState,
  delta: WorldDelta,
  winner: OrganizationState,
  loser: OrganizationState,
  index: TerritoryIndex,
): InheritedOrganizationAssets => {
  const currentStep = simulationStepForWorld(state);
  const resourceTypes = new Set<string>();
  let resourceAmount = 0;
  for (const resource of state.resources
    .filter((candidate) => candidate.holderId === loser.id && candidate.amount > 0.000000001)
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId) || left.regionId.localeCompare(right.regionId) || left.id.localeCompare(right.id))) {
    resourceAmount += resource.amount;
    resourceTypes.add(resource.resourceId);
    delta.resourceTransactions.push({
      id: `resource:${resource.resourceId}:organization-absorption:${currentStep}:${loser.id}:${resource.id}`,
      resourceId: resource.resourceId,
      regionId: resource.regionId,
      amount: resource.amount,
      operation: "transfer",
      source: "culture",
      sourceId: `${winner.id}:${loser.id}`,
      fromHolderId: loser.id,
      toHolderId: winner.id,
      causeRuleId: "society:organization-absorption",
    });
  }

  let facilityCount = 0;
  for (const facility of index.facilitiesByOwner.get(loser.id) ?? []) {
    if (facility.status === "abandoned") continue;
    facilityCount += 1;
    delta.entityEffects.push({
      collection: "facilities",
      operation: "update",
      id: facility.id,
      value: { ...facility, ownerOrganizationId: winner.id },
    });
  }
  return { resourceAmount, resourceTypes: [...resourceTypes].sort(), facilityCount };
};

const resolveInterregionalWars = (
  state: WorldState,
  delta: WorldDelta,
  organizations: OrganizationState[],
  index: TerritoryIndex,
  foodIndex: ReturnType<typeof createFoodBalanceIndex>,
  pairs?: OrganizationPair[],
  territoryLookup?: Map<OrganizationState["id"], RegionId[]>,
): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const engaged = new Set<string>();
  const territoriesByOrganizationId = territoryLookup
    ?? new Map(organizations.map((organization) => [organization.id, territoryFor(organization)]));
  for (const [left, right] of pairs ?? touchingDiplomaticOrganizationPairs(organizations, width, height)) {
    if (engaged.has(left.id) || engaged.has(right.id)) continue;
      const pairKey = [left.id, right.id].sort().join(":");
      const stance = relationBetween(left, right);
      if (stance === "allied" || stance === "trade") continue;
      const leftGovernance = governanceForOrganization(left);
      const rightGovernance = governanceForOrganization(right);
      const currentStep = simulationStepForWorld(state);
      const recentConflict = [leftGovernance, rightGovernance].some((governance) => {
        const conflictStep = governance.lastConflictTimelineStep ?? String(governance.lastConflictTick);
        return governance.lastConflictTick >= 0 && compareSimulationSteps(currentStep, conflictStep) >= 0
          && simulationStepDistance(currentStep, conflictStep) < 12;
      });
      if (recentConflict) continue;
      const leftFood = foodSecurityForOrganization(state, left, foodIndex);
      const rightFood = foodSecurityForOrganization(state, right, foodIndex);
      const scarcity = 1 - Math.min(leftFood, rightFood);
      const culturalLink = culturalLinkFor(state, left, right, index.cultureIdentitiesByRegion);
      const probability = Math.min(0.18, ((stance === "rival" ? 0.08 : 0.018) + scarcity * 0.035 + (left.type === right.type ? 0.012 : 0)) * (0.7 + (1 - culturalLink.compatibility) * 0.3));
      const [roll] = randomFloat(forkRandom(state.random, `war:${left.id}:${right.id}:${currentStep}`));
      if (roll >= probability) continue;
      const leftTechnology = technologyProfileForRegion(state, left.regionId);
      const rightTechnology = technologyProfileForRegion(state, right.regionId);
      const leftTerritory = territoriesByOrganizationId.get(left.id) ?? [left.regionId];
      const rightTerritory = territoriesByOrganizationId.get(right.id) ?? [right.regionId];
      const leftPower = militaryPower(state, left, leftTerritory.length);
      const rightPower = militaryPower(state, right, rightTerritory.length);
      const [battleRoll] = randomFloat(forkRandom(state.random, `battle:${left.id}:${right.id}:${currentStep}`));
      const leftWinChance = clamp(0.5 + (leftPower - rightPower) / Math.max(1, leftPower + rightPower) * 0.7, 0.2, 0.8);
      const winner = battleRoll < leftWinChance ? left : right;
      const loser = winner.id === left.id ? right : left;
      const winnerPower = winner.id === left.id ? leftPower : rightPower;
      const loserPower = loser.id === left.id ? leftPower : rightPower;
      const intensity = clamp(0.35 + Math.abs(winnerPower - loserPower) / Math.max(1, winnerPower + loserPower) * 0.65, 0.35, 1);
      const casualtyCount = Math.max(1, Math.min(4, Math.ceil(Math.min(left.memberIds.length, right.memberIds.length) * (0.02 + intensity * 0.035))));
      const reserved = new Set<EntityId>();
      const winnerCasualties = new Set(selectAgents(state, winner, Math.max(1, Math.floor(casualtyCount * 0.55)), `winner:${pairKey}:${currentStep}`, reserved, index.agentIds));
      for (const id of winnerCasualties) reserved.add(id);
      const loserCasualties = new Set(selectAgents(state, loser, casualtyCount, `loser:${pairKey}:${currentStep}`, reserved, index.agentIds));
      const casualtyIds = new Set<EntityId>([...winnerCasualties, ...loserCasualties]);
      const displacementCount = Math.min(3, Math.max(0, Math.ceil(loser.memberIds.length * (0.015 + intensity * 0.035))));
      const displacedIds = new Set(selectAgents(state, loser, displacementCount + casualtyIds.size, `displaced:${pairKey}:${currentStep}`, casualtyIds, index.agentIds)
        .filter((id) => !casualtyIds.has(id))
        .slice(0, displacementCount));
      const winnerTerritory = territoriesByOrganizationId.get(winner.id) ?? [winner.regionId];
      const loserTerritory = territoriesByOrganizationId.get(loser.id) ?? [loser.regionId];
      const contestedRegion = loserTerritory
        .filter((regionId) => winnerTerritory.some((owned) => owned === regionId || neighboringRegionIdsCached(owned, width, height).includes(regionId)))
        .sort()[0] ?? loser.regionId;
      const decisive = winnerPower >= loserPower * 1.18 || governanceForOrganization(loser).stability < 0.28;
      const canTransfer = !winnerTerritory.includes(contestedRegion)
        && (winnerTerritory.length < (territoryLimit[winner.type] ?? Number.MAX_SAFE_INTEGER) || decisive);
      const absorbed = canTransfer && decisive && loserTerritory.length <= 1 && winner.type === loser.type && ["state", "federation", "empire"].includes(winner.type);
      const nextWinnerTerritory = canTransfer ? [...winnerTerritory, contestedRegion] : winnerTerritory;
      const nextLoserTerritory = absorbed
        ? []
        : loserTerritory.length > 1 && canTransfer
          ? loserTerritory.filter((regionId) => regionId !== contestedRegion)
          : loserTerritory;
      const winnerNextGovernance = {
        ...governanceForOrganization(winner),
        stability: clamp(governanceForOrganization(winner).stability - 0.008 + (decisive ? 0.012 : 0)),
        legitimacy: clamp(governanceForOrganization(winner).legitimacy + (decisive ? 0.012 : -0.006)),
        treasury: clamp(governanceForOrganization(winner).treasury - 0.018),
        warWeariness: clamp(governanceForOrganization(winner).warWeariness + 0.045 + intensity * 0.025),
        lastConflictTick: state.tick,
        lastConflictTimelineStep: currentStep,
      };
      const loserNextGovernance = {
        ...governanceForOrganization(loser),
        stability: clamp(governanceForOrganization(loser).stability - 0.08 - intensity * 0.08),
        legitimacy: clamp(governanceForOrganization(loser).legitimacy - 0.06 - intensity * 0.06),
        cohesion: clamp(governanceForOrganization(loser).cohesion - 0.07 - intensity * 0.08),
        treasury: clamp(governanceForOrganization(loser).treasury - 0.05 - intensity * 0.05),
        publicGoods: clamp(governanceForOrganization(loser).publicGoods - 0.04 - intensity * 0.04),
        warWeariness: clamp(governanceForOrganization(loser).warWeariness + 0.1 + intensity * 0.08),
        lastConflictTick: state.tick,
        lastConflictTimelineStep: currentStep,
      };
      const winnerUpdate = organizationAfterWar(
        winner,
        loser,
        winnerNextGovernance,
        casualtyIds,
        nextWinnerTerritory,
        "active",
        displacedIds,
      );
      const loserUpdate = organizationAfterWar(
        loser,
        winner,
        loserNextGovernance,
        casualtyIds,
        nextLoserTerritory,
        absorbed ? "collapsed" : loserNextGovernance.stability < 0.18 ? "fragmenting" : "active",
        new Set(),
        displacedIds,
      );
      if (absorbed) {
        winnerUpdate.childOrganizationIds = [...new Set([...winner.childOrganizationIds, ...loser.childOrganizationIds, loser.id])].sort();
      }
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: winner.id, value: winnerUpdate });
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: loser.id, value: loserUpdate });
      const inheritedAssets = absorbed
        ? inheritAbsorbedOrganizationAssets(state, delta, winner, loser, index)
        : { resourceAmount: 0, resourceTypes: [], facilityCount: 0 };
      territoriesByOrganizationId.set(winner.id, nextWinnerTerritory);
      territoriesByOrganizationId.set(loser.id, nextLoserTerritory);
      const conflict = applyOrganizationConflict(left, right, state.tick, simulationStepForWorld(state));
      for (const effect of conflict.relationshipEffects) {
        if (!casualtyIds.has(effect.relationship.fromId) && !casualtyIds.has(effect.relationship.toId)) delta.relationshipEffects.push(effect);
      }
      for (const casualtyId of casualtyIds) {
        delta.entityEffects.push({ collection: "agents", operation: "remove", id: casualtyId });
      }
      for (const relationship of state.relationships) {
        if (casualtyIds.has(relationship.fromId) || casualtyIds.has(relationship.toId)) delta.relationshipEffects.push({ operation: "remove", relationship });
      }
      for (const displacedId of displacedIds) {
        const agent = index.agentsById.get(displacedId);
        if (agent) delta.entityEffects.push({ collection: "agents", operation: "update", id: displacedId, value: { ...agent, regionId: winner.regionId } });
      }
      const populationLosses = addPopulationLosses(state, delta, casualtyIds, index);
      delta.eventDrafts.push({
        kind: "organization-war",
        ruleId: "society:interregional-war",
        sourceIds: [left.id, right.id, ...casualtyIds],
        probability,
        roll,
        evidence: {
          leftRegion: left.regionId,
          rightRegion: right.regionId,
          leftPower,
          rightPower,
          winner: winner.id,
          battleRoll,
          winChance: left.id === winner.id ? leftWinChance : 1 - leftWinChance,
          intensity,
          casualties: casualtyIds.size,
          displaced: displacedIds.size,
          territoryTransferred: canTransfer,
          leftConstruction: leftTechnology.construction,
          leftEnergy: leftTechnology.energy,
          rightConstruction: rightTechnology.construction,
          rightEnergy: rightTechnology.energy,
          culturalCompatibility: culturalLink.compatibility,
          leftCulture: culturalLink.leftCultureName ?? "none",
          rightCulture: culturalLink.rightCultureName ?? "none",
          inheritedResourceAmount: inheritedAssets.resourceAmount,
          inheritedResourceTypes: inheritedAssets.resourceTypes.length,
          inheritedFacilities: inheritedAssets.facilityCount,
        },
        payload: {
          leftOrganizationId: left.id,
          rightOrganizationId: right.id,
          winnerOrganizationId: winner.id,
          loserOrganizationId: loser.id,
          result: absorbed ? "absorbed" : decisive ? "conquest" : "repelled",
          territoryTransferred: canTransfer ? contestedRegion : null,
          casualties: [...casualtyIds],
          displaced: [...displacedIds],
          populationLosses,
          culturalCompatibility: culturalLink.compatibility,
          leftCulture: culturalLink.leftCultureName ?? "none",
          rightCulture: culturalLink.rightCultureName ?? "none",
          inheritedAssets: {
            resourceAmount: inheritedAssets.resourceAmount,
            resourceTypes: inheritedAssets.resourceTypes,
            facilityCount: inheritedAssets.facilityCount,
          },
        },
        source: "natural",
      });
      if (canTransfer) {
        delta.eventDrafts.push({
          kind: "territory-transfer",
          ruleId: "society:war-territory-transfer",
          sourceIds: [winner.id, loser.id],
          probability: 1,
          roll: 0,
          evidence: { regionId: contestedRegion, winner: winner.id, loser: loser.id, territorySize: nextWinnerTerritory.length },
          payload: { regionId: contestedRegion, fromOrganizationId: loser.id, toOrganizationId: winner.id, absorbed },
          source: "natural",
        });
      }
      if (displacedIds.size > 0) {
        delta.eventDrafts.push({
          kind: "war-displacement",
          ruleId: "society:war-displacement",
          sourceIds: [loser.id, winner.id, ...displacedIds],
          probability: 1,
          roll: 0,
          evidence: { fromRegion: loser.regionId, toRegion: winner.regionId, displaced: displacedIds.size },
          payload: { fromOrganizationId: loser.id, toOrganizationId: winner.id, fromRegion: loser.regionId, toRegion: winner.regionId, agentIds: [...displacedIds] },
          source: "natural",
        });
      }
      engaged.add(left.id);
      engaged.add(right.id);
  }
};

export const stepTerritories = (state: WorldState, suppliedFoodIndex?: FoodBalanceIndex): WorldDelta => {
  const delta = emptyDelta();
  const index = createTerritoryIndex(state);
  const foodIndex = suppliedFoodIndex ?? createFoodBalanceIndex(state);
  expandTerritories(state, delta, index);
  let organizations = organizationsAfter(state, delta);
  const territoryLookup = new Map(organizations.map((organization) => [organization.id, territoryFor(organization)]));
  const pairs = touchingDiplomaticOrganizationPairs(organizations, state.fields.elevation.width, state.fields.elevation.height, territoryLookup);
  addDiplomaticPacts({ ...state, organizations }, delta, organizations, pairs, index.cultureIdentitiesByRegion);
  organizations = organizationsAfter(state, delta);
  const currentById = new Map(organizations.map((organization) => [organization.id, organization]));
  const currentPairs = pairs.flatMap(([left, right]) => {
    const currentLeft = currentById.get(left.id);
    const currentRight = currentById.get(right.id);
    return currentLeft && currentRight ? [[currentLeft, currentRight] as const] : [];
  });
  resolveInterregionalWars({ ...state, organizations }, delta, organizations, index, foodIndex, currentPairs, territoryLookup);
  const postConflictOrganizations = organizationsAfter(state, delta);
  migrateOrganizations({ ...state, organizations: postConflictOrganizations }, delta, index, foodIndex, territoryLookup);
  return delta;
};
