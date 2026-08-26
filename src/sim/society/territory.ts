import { forkRandom, hashString, randomFloat } from "../random.ts";
import type { OrganizationState, OrganizationType, RegionId, WorldDelta, WorldState } from "../types.ts";
import { applyOrganizationConflict } from "./governance.ts";

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

const parseRegion = (regionId: RegionId): { x: number; y: number } | undefined => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  return match ? { x: Number(match[1] ?? 0), y: Number(match[2] ?? 0) } : undefined;
};

export const neighboringRegionIds = (regionId: RegionId, width: number, height: number): RegionId[] => {
  const point = parseRegion(regionId);
  if (!point) return [];
  const { x, y } = point;
  return [
    x + 1 < width ? `region:${x + 1}:${y}` as RegionId : undefined,
    x > 0 ? `region:${x - 1}:${y}` as RegionId : undefined,
    y + 1 < height ? `region:${x}:${y + 1}` as RegionId : undefined,
    y > 0 ? `region:${x}:${y - 1}` as RegionId : undefined,
  ].filter((candidate): candidate is RegionId => Boolean(candidate));
};

const territoriesTouch = (left: OrganizationState, right: OrganizationState, width: number, height: number): boolean => {
  const rightTerritory = new Set(right.territoryRegionIds);
  return left.territoryRegionIds.some((regionId) => rightTerritory.has(regionId)
    || neighboringRegionIds(regionId, width, height).some((neighbor) => rightTerritory.has(neighbor)));
};

const regionScore = (state: WorldState, regionId: RegionId, organization: OrganizationState): number => {
  const point = parseRegion(regionId);
  if (!point) return 0;
  const index = point.y * state.fields.elevation.width + point.x;
  const localAgents = state.agents.filter((agent) => agent.regionId === regionId).length;
  const localOrganizations = state.organizations.filter((candidate) => candidate.regionId === regionId && candidate.status === "active" && candidate.id !== organization.id).length;
  const biomass = state.fields.biomass.values[index] ?? 0;
  const nutrients = state.fields.nutrients.values[index] ?? 0;
  const water = state.fields.water.values[index] ?? 0;
  return localAgents * 0.025 + localOrganizations * 0.08 + biomass * 2.2 + nutrients * 0.25 - Math.max(0, water - 0.72) * 0.5;
};

const expandTerritories = (state: WorldState, delta: WorldDelta): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const organizations = state.organizations
    .filter((organization) => organization.status === "active" && territorialRank[organization.type])
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const organization of organizations) {
    const limit = territoryLimit[organization.type] ?? 1;
    const territory = [...new Set(organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId])].sort();
    if (territory.length >= limit || (state.tick + hashString(organization.id)) % 8 !== 0) continue;
    const territorySet = new Set(territory);
    const candidates = [...new Set(territory.flatMap((regionId) => neighboringRegionIds(regionId, width, height)))]
      .filter((regionId) => !territorySet.has(regionId))
      .map((regionId) => ({ regionId, score: regionScore(state, regionId, organization) }))
      .sort((left, right) => right.score - left.score || left.regionId.localeCompare(right.regionId));
    const target = candidates[0];
    if (!target || target.score < 0.04) continue;
    const peer = organizations.find((candidate) => candidate.id !== organization.id
      && candidate.type === organization.type
      && candidate.territoryRegionIds.includes(target.regionId));
    if (peer) {
      const probability = Math.min(0.55, 0.12 + Math.abs(organization.memberIds.length - peer.memberIds.length) / 500);
      const [roll] = randomFloat(forkRandom(state.random, `border:${organization.id}:${peer.id}:${target.regionId}:${state.tick}`));
      if (roll >= probability) continue;
      const conflict = applyOrganizationConflict(organization, peer, state.tick);
      delta.relationshipEffects.push(...conflict.relationshipEffects);
      delta.eventDrafts.push({
        kind: "border-conflict",
        ruleId: "society:border-conflict",
        sourceIds: [organization.id, peer.id],
        probability,
        roll,
        evidence: { regionId: target.regionId, leftTerritory: territory.length, rightTerritory: peer.territoryRegionIds.length, eligible: true },
        payload: { regionId: target.regionId, leftOrganizationId: organization.id, rightOrganizationId: peer.id },
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

const balanceFor = (state: WorldState, organization: OrganizationState): number => state.resources
  .filter((resource) => resource.resourceId === "food" && resource.regionId === organization.regionId && resource.holderId === organization.id)
  .reduce((sum, resource) => sum + resource.amount, 0);

const addInterregionalTrade = (state: WorldState, delta: WorldDelta): void => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const organizations = state.organizations
    .filter((organization) => organization.status === "active" && ["settlement", "city", "state"].includes(organization.type))
    .sort((left, right) => left.id.localeCompare(right.id));
  const used = new Set<string>();
  for (let leftIndex = 0; leftIndex < organizations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < organizations.length; rightIndex += 1) {
      const left = organizations[leftIndex];
      const right = organizations[rightIndex];
      if (!left || !right || left.type !== right.type || left.regionId === right.regionId || used.has(left.id) || used.has(right.id)) continue;
      if (!territoriesTouch(left, right, width, height)) continue;
      const leftBalance = balanceFor(state, left);
      const rightBalance = balanceFor(state, right);
      const source = leftBalance >= rightBalance ? left : right;
      const destination = source === left ? right : left;
      const sourceBalance = Math.max(leftBalance, rightBalance);
      const destinationBalance = Math.min(leftBalance, rightBalance);
      if (sourceBalance < 0.8 || sourceBalance - destinationBalance < 0.35) continue;
      const probability = Math.min(0.75, 0.22 + (sourceBalance - destinationBalance) * 0.08);
      const [roll] = randomFloat(forkRandom(state.random, `interregional-trade:${source.id}:${destination.id}:${state.tick}`));
      if (roll >= probability) continue;
      const amount = Math.min(0.18, (sourceBalance - 0.5) * 0.12);
      if (amount <= 0.001) continue;
      delta.resourceTransactions.push({
        id: `resource:food:interregional:${state.tick}:${source.id}:${destination.id}`,
        resourceId: "food",
        regionId: source.regionId,
        destinationRegionId: destination.regionId,
        amount,
        operation: "transfer",
        source: "culture",
        sourceId: `${source.id}:${destination.id}`,
        fromHolderId: source.id,
        toHolderId: destination.id,
        causeRuleId: "society:interregional-trade",
      });
      delta.eventDrafts.push({
        kind: "interregional-trade",
        ruleId: "society:interregional-trade",
        sourceIds: [source.id, destination.id],
        probability,
        roll,
        evidence: { fromRegion: source.regionId, toRegion: destination.regionId, amount, sourceBalance, destinationBalance },
        payload: { resourceId: "food", amount, fromOrganizationId: source.id, toOrganizationId: destination.id, fromRegion: source.regionId, toRegion: destination.regionId },
        source: "natural",
      });
      used.add(source.id);
      used.add(destination.id);
    }
  }
};

export const stepTerritories = (state: WorldState): WorldDelta => {
  const delta = emptyDelta();
  expandTerritories(state, delta);
  addInterregionalTrade(state, delta);
  return delta;
};

