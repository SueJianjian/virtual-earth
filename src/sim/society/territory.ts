import { forkRandom, hashString, randomFloat } from "../random.ts";
import type { DiplomaticStance, EntityId, FoodBalanceIndex, OrganizationState, OrganizationType, RegionId, WorldDelta, WorldState } from "../types.ts";
import { applyOrganizationConflict } from "./governance.ts";
import { diplomacyForOrganization, governanceForOrganization } from "./organization.ts";
import { createFoodBalanceIndex, foodSecurityForOrganization } from "../agents/food.ts";
import { technologyProfileForRegion } from "../culture/technology.ts";
import { culturalCompatibility, cultureIdentityFor } from "../culture/identity.ts";

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
  activeOrganizationCountByRegion: ReadonlyMap<string, number>;
  agentCountByRegion: ReadonlyMap<string, number>;
};

const createTerritoryIndex = (state: WorldState): TerritoryIndex => {
  const agentCountByRegion = new Map<string, number>();
  const agentIds = new Set<string>();
  for (const agent of state.agents) {
    agentIds.add(agent.id);
    agentCountByRegion.set(agent.regionId, (agentCountByRegion.get(agent.regionId) ?? 0) + 1);
  }
  const activeOrganizationCountByRegion = new Map<string, number>();
  for (const organization of state.organizations) {
    if (organization.status !== "active") continue;
    activeOrganizationCountByRegion.set(organization.regionId, (activeOrganizationCountByRegion.get(organization.regionId) ?? 0) + 1);
  }
  return { agentIds, activeOrganizationCountByRegion, agentCountByRegion };
};

const territoryFor = (organization: OrganizationState): RegionId[] => [...new Set(
  organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId],
)].sort();

const relationBetween = (left: OrganizationState, right: OrganizationState): DiplomaticStance =>
  left.diplomacy?.[right.id] ?? right.diplomacy?.[left.id] ?? "neutral";

const culturalLinkFor = (state: WorldState, left: OrganizationState, right: OrganizationState): {
  compatibility: number;
  leftCultureName?: string;
  rightCultureName?: string;
  leftLanguage?: string;
  rightLanguage?: string;
} => {
  const leftCulture = state.cultures.find((culture) => culture.regionId === left.regionId);
  const rightCulture = state.cultures.find((culture) => culture.regionId === right.regionId);
  if (!leftCulture || !rightCulture) return { compatibility: 0.75 };
  const leftIdentity = cultureIdentityFor(leftCulture);
  const rightIdentity = cultureIdentityFor(rightCulture);
  return {
    compatibility: culturalCompatibility(leftIdentity, rightIdentity),
    leftCultureName: leftIdentity.name,
    rightCultureName: rightIdentity.name,
    leftLanguage: leftIdentity.languageFamily,
    rightLanguage: rightIdentity.languageFamily,
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

export const neighboringRegionIds = (regionId: RegionId, width: number, height: number): RegionId[] => {
  const point = parseRegion(regionId);
  if (!point) return [];
  const { x, y } = point;
  return [...new Set([
    width > 1 ? `region:${(x + 1) % width}:${y}` as RegionId : undefined,
    width > 1 ? `region:${(x + width - 1) % width}:${y}` as RegionId : undefined,
    y + 1 < height ? `region:${x}:${y + 1}` as RegionId : undefined,
    y > 0 ? `region:${x}:${y - 1}` as RegionId : undefined,
  ].filter((candidate): candidate is RegionId => Boolean(candidate)))];
};

export const territoriesTouch = (left: OrganizationState, right: OrganizationState, width: number, height: number): boolean => {
  const rightTerritory = new Set(territoryFor(right));
  return territoryFor(left).some((regionId) => rightTerritory.has(regionId)
    || neighboringRegionIds(regionId, width, height).some((neighbor) => rightTerritory.has(neighbor)));
};

type OrganizationPair = readonly [OrganizationState, OrganizationState];

export const touchingDiplomaticOrganizationPairs = (
  organizations: OrganizationState[],
  width: number,
  height: number,
): OrganizationPair[] => {
  const candidates = organizations
    .filter((organization) => organization.status === "active" && diplomaticTypes.has(organization.type))
    .sort((left, right) => left.id.localeCompare(right.id));
  const territoryOwners = new Map<RegionId, number[]>();
  const territories = candidates.map((organization, index) => {
    const territory = territoryFor(organization);
    for (const regionId of territory) {
      const owners = territoryOwners.get(regionId) ?? [];
      owners.push(index);
      territoryOwners.set(regionId, owners);
    }
    return territory;
  });
  const contactKeys = new Set<string>();
  const neighboringCache = new Map<RegionId, RegionId[]>();
  const neighborsFor = (regionId: RegionId): RegionId[] => {
    const cached = neighboringCache.get(regionId);
    if (cached) return cached;
    const neighbors = neighboringRegionIds(regionId, width, height);
    neighboringCache.set(regionId, neighbors);
    return neighbors;
  };

  for (let index = 0; index < candidates.length; index += 1) {
    const organization = candidates[index];
    if (!organization) continue;
    for (const regionId of territories[index] ?? []) {
      for (const nearbyRegionId of [regionId, ...neighborsFor(regionId)]) {
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
  const organizations = state.organizations
    .filter((organization) => organization.status === "active" && territorialRank[organization.type])
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const organization of organizations) {
    const limit = territoryLimit[organization.type] ?? 1;
    const territory = territoryFor(organization);
    if (territory.length >= limit || (state.tick + hashString(organization.id)) % 8 !== 0) continue;
    const territorySet = new Set(territory);
    const candidates = [...new Set(territory.flatMap((regionId) => neighboringRegionIds(regionId, width, height)))]
      .filter((regionId) => !territorySet.has(regionId))
      .map((regionId) => ({ regionId, score: regionScore(state, regionId, organization, index) }))
      .sort((left, right) => right.score - left.score || left.regionId.localeCompare(right.regionId));
    const target = candidates[0];
    if (!target || target.score < 0.04) continue;
    const peer = organizations.find((candidate) => candidate.id !== organization.id
      && candidate.type === organization.type
      && territoryFor(candidate).includes(target.regionId));
    if (peer) {
      const culturalLink = culturalLinkFor(state, organization, peer);
      const probability = Math.min(0.55, (0.12 + Math.abs(organization.memberIds.length - peer.memberIds.length) / 500) * (0.72 + (1 - culturalLink.compatibility) * 0.28));
      const [roll] = randomFloat(forkRandom(state.random, `border:${organization.id}:${peer.id}:${target.regionId}:${state.tick}`));
      if (roll >= probability) continue;
      const conflict = applyOrganizationConflict(organization, peer, state.tick);
      delta.relationshipEffects.push(...conflict.relationshipEffects);
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: organization.id, value: withRelation(organization, peer, "rival") });
      delta.entityEffects.push({ collection: "organizations", operation: "update", id: peer.id, value: withRelation(peer, organization, "rival") });
      delta.eventDrafts.push({
        kind: "border-conflict",
        ruleId: "society:border-conflict",
        sourceIds: [organization.id, peer.id],
        probability,
        roll,
        evidence: { regionId: target.regionId, leftTerritory: territory.length, rightTerritory: territoryFor(peer).length, culturalCompatibility: culturalLink.compatibility, leftCulture: culturalLink.leftCultureName ?? "none", rightCulture: culturalLink.rightCultureName ?? "none", eligible: true },
        payload: { regionId: target.regionId, leftOrganizationId: organization.id, rightOrganizationId: peer.id, culturalCompatibility: culturalLink.compatibility, leftCulture: culturalLink.leftCultureName ?? "none", rightCulture: culturalLink.rightCultureName ?? "none" },
        source: "natural",
      });
      continue;
    }
    const probability = Math.min(0.72, 0.1 + target.score * 0.18 + Math.min(0.24, organization.memberIds.length / 800));
    const [roll] = randomFloat(forkRandom(state.random, `territory:${organization.id}:${target.regionId}:${state.tick}`));
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

const addDiplomaticPacts = (state: WorldState, delta: WorldDelta, organizations: OrganizationState[], pairs?: OrganizationPair[]): void => {
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
    const culturalLink = culturalLinkFor(state, left, right);
    const probability = Math.min(0.1, (0.018 + readiness * 0.055 + (relation === "trade" ? 0.018 : 0)) * (0.66 + culturalLink.compatibility * 0.34));
    const [roll] = randomFloat(forkRandom(state.random, `alliance:${left.id}:${right.id}:${state.tick}`));
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

const militaryPower = (state: WorldState, organization: OrganizationState): number => {
  const governance = governanceForOrganization(organization);
  const technology = technologyProfileForRegion(state, organization.regionId);
  return Math.max(1, organization.memberIds.length)
    * (0.35 + governance.military + technology.construction * 0.12 + technology.energy * 0.08)
    * (0.55 + governance.stability)
    * (0.7 + Math.min(0.3, territoryFor(organization).length * 0.03));
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

const addPopulationLosses = (state: WorldState, delta: WorldDelta, casualtyIds: ReadonlySet<EntityId>): Record<string, number> => {
  const detailedCounts = new Map<string, number>();
  for (const agent of state.agents) detailedCounts.set(String(agent.populationId), (detailedCounts.get(String(agent.populationId)) ?? 0) + 1);
  const losses = new Map<string, number>();
  for (const agent of state.agents) {
    if (!casualtyIds.has(agent.id)) continue;
    const populationId = String(agent.populationId);
    const population = state.populations.find((candidate) => String(candidate.id) === populationId);
    if (!population) continue;
    const representedCount = Math.max(1, detailedCounts.get(populationId) ?? 1);
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

const resolveInterregionalWars = (state: WorldState, delta: WorldDelta, organizations: OrganizationState[], index: TerritoryIndex, foodIndex: ReturnType<typeof createFoodBalanceIndex>, pairs?: OrganizationPair[]): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const engaged = new Set<string>();
  for (const [left, right] of pairs ?? touchingDiplomaticOrganizationPairs(organizations, width, height)) {
    if (engaged.has(left.id) || engaged.has(right.id)) continue;
      const pairKey = [left.id, right.id].sort().join(":");
      const stance = relationBetween(left, right);
      if (stance === "allied" || stance === "trade") continue;
      const leftGovernance = governanceForOrganization(left);
      const rightGovernance = governanceForOrganization(right);
      const lastConflict = Math.max(leftGovernance.lastConflictTick, rightGovernance.lastConflictTick);
      if (lastConflict >= 0 && state.tick - lastConflict < 12) continue;
      const leftFood = foodSecurityForOrganization(state, left, foodIndex);
      const rightFood = foodSecurityForOrganization(state, right, foodIndex);
      const scarcity = 1 - Math.min(leftFood, rightFood);
      const culturalLink = culturalLinkFor(state, left, right);
      const probability = Math.min(0.18, ((stance === "rival" ? 0.08 : 0.018) + scarcity * 0.035 + (left.type === right.type ? 0.012 : 0)) * (0.7 + (1 - culturalLink.compatibility) * 0.3));
      const [roll] = randomFloat(forkRandom(state.random, `war:${left.id}:${right.id}:${state.tick}`));
      if (roll >= probability) continue;
      const leftTechnology = technologyProfileForRegion(state, left.regionId);
      const rightTechnology = technologyProfileForRegion(state, right.regionId);
      const leftPower = militaryPower(state, left);
      const rightPower = militaryPower(state, right);
      const [battleRoll] = randomFloat(forkRandom(state.random, `battle:${left.id}:${right.id}:${state.tick}`));
      const leftWinChance = clamp(0.5 + (leftPower - rightPower) / Math.max(1, leftPower + rightPower) * 0.7, 0.2, 0.8);
      const winner = battleRoll < leftWinChance ? left : right;
      const loser = winner.id === left.id ? right : left;
      const winnerPower = winner.id === left.id ? leftPower : rightPower;
      const loserPower = loser.id === left.id ? leftPower : rightPower;
      const intensity = clamp(0.35 + Math.abs(winnerPower - loserPower) / Math.max(1, winnerPower + loserPower) * 0.65, 0.35, 1);
      const casualtyCount = Math.max(1, Math.min(4, Math.ceil(Math.min(left.memberIds.length, right.memberIds.length) * (0.02 + intensity * 0.035))));
      const reserved = new Set<EntityId>();
      const winnerCasualties = new Set(selectAgents(state, winner, Math.max(1, Math.floor(casualtyCount * 0.55)), `winner:${pairKey}:${state.tick}`, reserved, index.agentIds));
      for (const id of winnerCasualties) reserved.add(id);
      const loserCasualties = new Set(selectAgents(state, loser, casualtyCount, `loser:${pairKey}:${state.tick}`, reserved, index.agentIds));
      const casualtyIds = new Set<EntityId>([...winnerCasualties, ...loserCasualties]);
      const displacementCount = Math.min(3, Math.max(0, Math.ceil(loser.memberIds.length * (0.015 + intensity * 0.035))));
      const displacedIds = new Set(selectAgents(state, loser, displacementCount + casualtyIds.size, `displaced:${pairKey}:${state.tick}`, casualtyIds, index.agentIds)
        .filter((id) => !casualtyIds.has(id))
        .slice(0, displacementCount));
      const winnerTerritory = territoryFor(winner);
      const loserTerritory = territoryFor(loser);
      const contestedRegion = loserTerritory
        .filter((regionId) => winnerTerritory.some((owned) => owned === regionId || neighboringRegionIds(owned, width, height).includes(regionId)))
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
      const conflict = applyOrganizationConflict(left, right, state.tick);
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
        const agent = state.agents.find((candidate) => candidate.id === displacedId);
        if (agent) delta.entityEffects.push({ collection: "agents", operation: "update", id: displacedId, value: { ...agent, regionId: winner.regionId } });
      }
      const populationLosses = addPopulationLosses(state, delta, casualtyIds);
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
  const pairs = touchingDiplomaticOrganizationPairs(organizations, state.fields.elevation.width, state.fields.elevation.height);
  addDiplomaticPacts({ ...state, organizations }, delta, organizations, pairs);
  organizations = organizationsAfter(state, delta);
  const currentById = new Map(organizations.map((organization) => [organization.id, organization]));
  const currentPairs = pairs.flatMap(([left, right]) => {
    const currentLeft = currentById.get(left.id);
    const currentRight = currentById.get(right.id);
    return currentLeft && currentRight ? [[currentLeft, currentRight] as const] : [];
  });
  resolveInterregionalWars({ ...state, organizations }, delta, organizations, index, foodIndex, currentPairs);
  return delta;
};
