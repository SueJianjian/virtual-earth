import type { DiplomaticStance, FacilityState, OrganizationState, OrganizationType, RegionId, ResourceTransaction, WorldDelta, WorldState } from "../types.ts";
import { facilityEffectProfilesForState } from "./facilities.ts";
import { diplomacyForOrganization } from "./organization.ts";
import { neighboringRegionIdsCached } from "./territory.ts";
import { simulationStepForWorld } from "../time.ts";

export type SupplyResourceId = "food" | "materials" | "energy";

const supplyResources: Array<{ id: SupplyResourceId; shipmentCapacity: number }> = [
  { id: "food", shipmentCapacity: 0.6 },
  { id: "materials", shipmentCapacity: 1.2 },
  { id: "energy", shipmentCapacity: 0.8 },
];

const civicTypes = new Set<OrganizationType>(["settlement", "city", "state", "federation", "empire"]);
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const balanceKey = (resourceId: string, regionId: RegionId, holderId?: string): string => `${resourceId}|${regionId}|${holderId ?? "world"}`;

const relationBetween = (left: OrganizationState, right: OrganizationState): DiplomaticStance =>
  left.diplomacy?.[right.id] ?? right.diplomacy?.[left.id] ?? "neutral";

const projectedBalances = (state: WorldState, transactions: ResourceTransaction[]): Map<string, number> => {
  const balances = new Map<string, number>();
  const caps = new Map<string, number>();
  for (const resource of state.resources) {
    const key = balanceKey(resource.resourceId, resource.regionId, resource.holderId);
    balances.set(key, (balances.get(key) ?? 0) + resource.amount);
    caps.set(key, Math.max(caps.get(key) ?? 0, resource.cap));
  }
  const change = (resourceId: string, regionId: RegionId, holderId: string | undefined, amount: number): void => {
    const key = balanceKey(resourceId, regionId, holderId);
    const cap = caps.get(key) ?? Number.MAX_SAFE_INTEGER;
    balances.set(key, Math.max(0, Math.min(cap, (balances.get(key) ?? 0) + amount)));
    if (!caps.has(key)) caps.set(key, cap);
  };
  for (const transaction of transactions) {
    if (transaction.operation === "mint") {
      change(transaction.resourceId, transaction.regionId, transaction.toHolderId, transaction.amount);
    } else if (transaction.operation === "transfer") {
      change(transaction.resourceId, transaction.regionId, transaction.fromHolderId, -transaction.amount);
      change(transaction.resourceId, transaction.destinationRegionId ?? transaction.regionId, transaction.toHolderId, transaction.amount);
    } else {
      change(transaction.resourceId, transaction.regionId, transaction.fromHolderId ?? transaction.toHolderId, -transaction.amount);
    }
  }
  return balances;
};

export const supplyTargetFor = (
  state: WorldState,
  organization: OrganizationState,
  resourceId: SupplyResourceId,
  facilitiesByOwner?: ReadonlyMap<OrganizationState["id"], FacilityState[]>,
): number => {
  const facilities = facilitiesByOwner?.get(organization.id)
    ?? state.facilities.filter((facility) => facility.ownerOrganizationId === organization.id && facility.status !== "abandoned");
  if (resourceId === "food") {
    const subsistenceReserve = facilities.filter((facility) => facility.type === "subsistence").reduce((sum, facility) => sum + facility.level * 0.04, 0);
    return rounded(Math.min(5, Math.max(0.12, organization.memberIds.length * 0.006 + subsistenceReserve)));
  }
  if (resourceId === "materials") {
    const assetDemand = facilities.reduce((sum, facility) => {
      if (facility.status === "planned") return sum + 1.4 * facility.level;
      if (facility.status === "damaged") return sum + 0.6 * facility.level;
      return sum + 0.15 * facility.level;
    }, 0);
    return rounded(Math.min(14, 0.4 + organization.memberIds.length * 0.008 + assetDemand));
  }
  const operatingDemand = facilities
    .filter((facility) => facility.status === "active" || facility.status === "damaged")
    .reduce((sum, facility) => sum + (facility.type === "energy" ? 0.04 : 0.14) * facility.level, 0);
  return rounded(Math.min(6, Math.max(0.1, organization.memberIds.length * 0.002 + operatingDemand)));
};

type SupplyRouteCandidate = { organizationId: OrganizationState["id"]; direct: boolean; stance: DiplomaticStance };

type SupplyTargets = ReadonlyMap<SupplyResourceId, ReadonlyMap<OrganizationState["id"], number>>;

const supplyTargetsFor = (
  state: WorldState,
  organizations: readonly OrganizationState[],
  facilitiesByOwner: ReadonlyMap<OrganizationState["id"], FacilityState[]>,
): SupplyTargets => new Map(
  supplyResources.map((resource) => [
    resource.id,
    new Map(organizations.map((organization) => [
      organization.id,
      supplyTargetFor(state, organization, resource.id, facilitiesByOwner),
    ])),
  ]),
);

const routeCandidatesFor = (state: WorldState, organizations: OrganizationState[]): ReadonlyMap<string, SupplyRouteCandidate[]> => {
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const organizationsById = new Map(organizations.map((organization) => [organization.id, organization]));
  const territoriesByOrganizationId = new Map(organizations.map((organization) => [
    organization.id,
    organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [organization.regionId],
  ]));
  const territory = (organization: OrganizationState): RegionId[] =>
    territoriesByOrganizationId.get(organization.id) ?? [organization.regionId];
  const organizationsByRegion = new Map<RegionId, Set<OrganizationState["id"]>>();
  for (const organization of organizations) {
    for (const regionId of territory(organization)) {
      const entries = organizationsByRegion.get(regionId) ?? new Set<OrganizationState["id"]>();
      entries.add(organization.id);
      organizationsByRegion.set(regionId, entries);
    }
  }
  const diplomaticPeers = new Map<OrganizationState["id"], Set<OrganizationState["id"]>>();
  for (const organization of organizations) {
    for (const [peerIdValue, stance] of Object.entries(organization.diplomacy ?? {})) {
      const peerId = peerIdValue as OrganizationState["id"];
      if ((stance !== "trade" && stance !== "allied") || !organizationsById.has(peerId)) continue;
      const ownPeers = diplomaticPeers.get(organization.id) ?? new Set<OrganizationState["id"]>();
      const otherPeers = diplomaticPeers.get(peerId) ?? new Set<OrganizationState["id"]>();
      ownPeers.add(peerId);
      otherPeers.add(organization.id);
      diplomaticPeers.set(organization.id, ownPeers);
      diplomaticPeers.set(peerId, otherPeers);
    }
  }
  const result = new Map<OrganizationState["id"], SupplyRouteCandidate[]>();
  for (const destination of organizations) {
    const candidates = new Map<OrganizationState["id"], SupplyRouteCandidate>();
    const nearbyRegions = new Set(territory(destination).flatMap((regionId) => [regionId, ...neighboringRegionIdsCached(regionId, width, height)]));
    for (const regionId of nearbyRegions) {
      for (const organizationId of organizationsByRegion.get(regionId) ?? []) {
        if (organizationId === destination.id) continue;
        const source = organizationsById.get(organizationId);
        if (!source || source.regionId === destination.regionId) continue;
        const stance = relationBetween(source, destination);
        if (stance !== "rival") candidates.set(source.id, { organizationId: source.id, direct: true, stance });
      }
    }
    for (const organizationId of diplomaticPeers.get(destination.id) ?? []) {
      const organization = organizationsById.get(organizationId);
      if (!organization || organization.regionId === destination.regionId) continue;
      const stance = relationBetween(organization, destination);
      const existing = candidates.get(organization.id);
      if (!existing) candidates.set(organization.id, { organizationId: organization.id, direct: false, stance });
      else existing.stance = stance;
    }
    result.set(destination.id, [...candidates.values()].sort((left, right) => Number(right.direct) - Number(left.direct) || left.organizationId.localeCompare(right.organizationId)));
  }
  return result;
};

const withRelation = (organization: OrganizationState, other: OrganizationState, stance: DiplomaticStance): OrganizationState => ({
  ...organization,
  diplomacy: { ...diplomacyForOrganization(organization), [other.id]: stance },
});

export const stepSupplyChains = (state: WorldState, priorTransactions: ResourceTransaction[] = []): WorldDelta => {
  const delta: WorldDelta = {
    fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
    resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
  };
  const organizations = state.organizations
    .filter((organization) => organization.status === "active" && civicTypes.has(organization.type))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (organizations.length === 0) return delta;

  const balances = projectedBalances(state, priorTransactions);
  const facilityEffects = facilityEffectProfilesForState(state);
  const currentOrganizations = new Map(organizations.map((organization) => [organization.id, organization]));
  const routeCandidates = routeCandidatesFor(state, organizations);
  const facilitiesByOwner = new Map<OrganizationState["id"], FacilityState[]>();
  for (const facility of state.facilities) {
    if (facility.status === "abandoned") continue;
    const facilities = facilitiesByOwner.get(facility.ownerOrganizationId) ?? [];
    facilities.push(facility);
    facilitiesByOwner.set(facility.ownerOrganizationId, facilities);
  }
  const targetsByResource = supplyTargetsFor(state, organizations, facilitiesByOwner);
  const relationsRecorded = new Set<string>();

  for (const resource of supplyResources) {
    const targets = targetsByResource.get(resource.id) ?? new Map<OrganizationState["id"], number>();
    const balanceFor = (organization: OrganizationState): number => balances.get(balanceKey(resource.id, organization.regionId, organization.id)) ?? 0;
    const destinations = organizations
      .map((organization) => ({ organization, shortage: (targets.get(organization.id) ?? 0) - balanceFor(organization) }))
      .filter((candidate) => candidate.shortage > 0.001)
      .sort((left, right) => right.shortage - left.shortage || left.organization.id.localeCompare(right.organization.id));

    for (const destinationEntry of destinations) {
      let destination = currentOrganizations.get(destinationEntry.organization.id) ?? destinationEntry.organization;
      let shortage = Math.max(0, (targets.get(destination.id) ?? 0) - balanceFor(destination));
      const sources = (routeCandidates.get(destination.id) ?? [])
        .map((route) => ({
          organization: currentOrganizations.get(route.organizationId)!,
          route,
          surplus: balanceFor(currentOrganizations.get(route.organizationId)!) - (targets.get(route.organizationId) ?? 0) * 1.1,
        }))
        .filter((candidate) => candidate.organization && candidate.surplus > 0.001)
        .sort((left, right) => Number(right.route.direct) - Number(left.route.direct) || right.surplus - left.surplus || left.organization.id.localeCompare(right.organization.id));

      for (const sourceEntry of sources) {
        if (shortage <= 0.001) break;
        destination = currentOrganizations.get(destination.id) ?? destination;
        const source = currentOrganizations.get(sourceEntry.organization.id) ?? sourceEntry.organization;
        const sourceBalance = balanceFor(source);
        const destinationBalance = balanceFor(destination);
        const sourceTarget = targets.get(source.id) ?? 0;
        const destinationTarget = targets.get(destination.id) ?? 0;
        const surplus = Math.max(0, sourceBalance - sourceTarget * 1.1);
        const routeStance = relationBetween(source, destination);
        if (routeStance === "rival") continue;
        const navigation = ((facilityEffects.get(source.regionId)?.navigation ?? 0) + (facilityEffects.get(destination.regionId)?.navigation ?? 0)) / 2;
        const routeCapacity = 1 + navigation * 0.7 + (routeStance === "allied" ? 0.25 : routeStance === "trade" ? 0.15 : 0);
        const amount = Math.min(sourceBalance, rounded(Math.min(surplus, shortage, resource.shipmentCapacity * routeCapacity)));
        if (amount <= 0.001) continue;

        delta.resourceTransactions.push({
          id: `resource:${resource.id}:interregional:${simulationStepForWorld(state)}:${source.id}:${destination.id}`,
          resourceId: resource.id,
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
        balances.set(balanceKey(resource.id, source.regionId, source.id), sourceBalance - amount);
        balances.set(balanceKey(resource.id, destination.regionId, destination.id), destinationBalance + amount);
        shortage = rounded(shortage - amount);
        delta.eventDrafts.push({
          kind: "interregional-trade",
          ruleId: "society:interregional-supply-chain",
          sourceIds: [source.id, destination.id],
          probability: 1,
          roll: 0,
          evidence: {
            fromRegion: source.regionId,
            toRegion: destination.regionId,
            resourceId: resource.id,
            amount,
            sourceBalance,
            sourceTarget,
            destinationBalance,
            destinationTarget,
            directRoute: sourceEntry.route.direct,
            routeStance,
          },
          payload: {
            resourceId: resource.id,
            amount,
            fromOrganizationId: source.id,
            toOrganizationId: destination.id,
            fromRegion: source.regionId,
            toRegion: destination.regionId,
            routeKind: sourceEntry.route.direct ? "border" : "established",
          },
          source: "natural",
        });

        if (routeStance === "neutral") {
          const relationKey = [source.id, destination.id].sort().join("|");
          if (!relationsRecorded.has(relationKey)) {
            const updatedSource = withRelation(source, destination, "trade");
            const updatedDestination = withRelation(destination, source, "trade");
            currentOrganizations.set(source.id, updatedSource);
            currentOrganizations.set(destination.id, updatedDestination);
            delta.entityEffects.push({ collection: "organizations", operation: "update", id: source.id, value: updatedSource });
            delta.entityEffects.push({ collection: "organizations", operation: "update", id: destination.id, value: updatedDestination });
            relationsRecorded.add(relationKey);
          }
        }
      }
    }
  }

  for (const organization of organizations) {
    const available = balances.get(balanceKey("energy", organization.regionId, organization.id)) ?? 0;
    const target = targetsByResource.get("energy")?.get(organization.id) ?? 0.1;
    const amount = Math.min(available, rounded(target * 0.18));
    if (amount <= 0.001) continue;
    delta.resourceTransactions.push({
      id: `resource:energy:operations:${simulationStepForWorld(state)}:${organization.id}`,
      resourceId: "energy",
      regionId: organization.regionId,
      amount,
      operation: "consume",
      source: "culture",
      sourceId: organization.id,
      fromHolderId: organization.id,
      causeRuleId: "society:facility-energy-consumption",
    });
  }
  return delta;
};
