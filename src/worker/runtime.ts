import { stepWorld, metricsFor } from "../sim/engine.ts";
import { aggregatePopulationForRegion, focusRegion, summarizeRegionState } from "../sim/lod/index.ts";
import { deserializeWorld, serializeWorld } from "../persistence/serialize.ts";
import { createWorld, worldDigest } from "../sim/world.ts";
import { foodSecurityFromBalance } from "../sim/agents/food.ts";
import type { EventMilestone, RegionId, WorldEvent, WorldEventInput, WorldState } from "../sim/types.ts";
import type { OrganizationDirectoryEntry, RuntimeDiagnostics, SceneEntity, SceneLink, SupplyRoute, WorkerCommand, WorkerMessage, WorldSnapshot } from "./protocol.ts";
import { DEFAULT_WORLDVIEW_PACK_IDS } from "../sim/worldview/index.ts";
import { compareSimulationSteps, SIMULATED_YEARS_PER_DAY, timelineForWorld } from "../sim/time.ts";
import { cultureIdentityFor } from "../sim/culture/identity.ts";
import { eventOrganizationIds, eventRegionIds, strategicRouteForEvent } from "../sim/events/ledger.ts";
import { diseasePrevalenceForRegion } from "../sim/health/disease.ts";
import { addPersistentTotal } from "../sim/numeric.ts";
import { substanceReserveRatio } from "../sim/environment/substances.ts";
import { RuntimePerformanceTracker } from "./performance.ts";

const cloneFields = (fields: WorldState["fields"]): WorldState["fields"] => structuredClone(fields);
const cloneChemistry = (chemistry: WorldState["chemistry"]): WorldState["chemistry"] => structuredClone(chemistry);
const substanceRichnessByRegion = (state: WorldState): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const substance of state.substances) {
    const properties = Object.values(substance.properties);
    const utility = properties.reduce((sum, value) => sum + value, 0) / Math.max(1, properties.length);
    const visibility = substance.status === "known" ? 1 : 0.58;
    const reserveVisibility = substance.formation === "engineered" ? 1 : substanceReserveRatio(substance);
    result[substance.regionId] = Math.max(result[substance.regionId] ?? 0, Math.min(1, utility * visibility * reserveVisibility));
  }
  return result;
};
const foodSecurityGrid = (state: WorldState): WorldState["fields"]["water"] => {
  const foodBalances = new Map<string, number>();
  for (const resource of state.resources) {
    if (resource.resourceId !== "food") continue;
    foodBalances.set(resource.regionId, (foodBalances.get(resource.regionId) ?? 0) + resource.amount);
  }
  const agentCounts = new Map<string, number>();
  for (const agent of state.agents) agentCounts.set(agent.regionId, (agentCounts.get(agent.regionId) ?? 0) + 1);
  const populationCounts = new Map<string, number>();
  for (const population of state.populations) populationCounts.set(population.regionId, (populationCounts.get(population.regionId) ?? 0) + population.count);
  const summaryCounts = new Map<string, number>(state.lod.summaries.map((summary): [string, number] => [
    summary.regionId,
    summary.mode === "aggregate" ? aggregatePopulationForRegion(state, summary.regionId, summary.population) : summary.population,
  ]));
  const { width, height } = state.fields.elevation;
  const values = new Float32Array(width * height);
  const relevantRegions = new Set([...foodBalances.keys(), ...agentCounts.keys(), ...populationCounts.keys(), ...summaryCounts.keys()]);
  for (const regionId of relevantRegions) {
    const match = /^region:(\d+):(\d+)$/.exec(regionId);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= width || y < 0 || y >= height) continue;
    const populationCount = agentCounts.get(regionId) || summaryCounts.get(regionId) || populationCounts.get(regionId) || 0;
    values[y * width + x] = foodSecurityFromBalance(foodBalances.get(regionId) ?? 0, populationCount);
  }
  return { width, height, values };
};
const diseasePrevalenceGrid = (state: WorldState): WorldState["fields"]["water"] => {
  const { width, height } = state.fields.elevation;
  const values = new Float32Array(width * height);
  const regions = new Set([
    ...state.agents.map((agent) => agent.regionId),
    ...state.pathogens.flatMap((pathogen) => pathogen.regionalOutbreaks.map((outbreak) => outbreak.regionId)),
  ]);
  for (const regionId of regions) {
    const match = /^region:(\d+):(\d+)$/.exec(regionId);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    values[y * width + x] = diseasePrevalenceForRegion(state, regionId);
  }
  return { width, height, values };
};

const organizationRank: Record<SceneEntity["kind"], number> = {
  agent: 0,
  population: 1,
  facility: 3,
  family: 2,
  clan: 3,
  tribe: 4,
  settlement: 5,
  city: 6,
  state: 7,
  federation: 8,
  empire: 9,
  "cultivation-path": 5,
  sect: 6,
  deity: 8,
};

export const RECENT_REGION_EVENT_LIMIT = 16;
export const AUTOSAVE_INTERVAL_STEPS = 120;
export const MAX_SCENE_DIPLOMATIC_LINKS = 96;
export const MAX_SCENE_EVENT_LINKS = 256;
export const MAX_SCENE_STRATEGIC_LINKS = 128;
export const MAX_SUPPLY_ROUTES = 256;

type EventHistorySource = WorldEvent | EventMilestone;
type EventHistoryCandidate = { event: EventHistorySource; archived: boolean };
const eventScalar = (event: EventHistorySource, key: string): string | number | boolean | undefined => {
  const detailsValue = "details" in event ? event.details[key] : undefined;
  if (typeof detailsValue === "string" || typeof detailsValue === "number" || typeof detailsValue === "boolean") return detailsValue;
  if ("payload" in event) {
    const payloadValue = event.payload[key];
    if (typeof payloadValue === "string" || typeof payloadValue === "number" || typeof payloadValue === "boolean") return payloadValue;
    const evidenceValue = event.evidence[key];
    if (typeof evidenceValue === "string" || typeof evidenceValue === "number" || typeof evidenceValue === "boolean") return evidenceValue;
  }
  return undefined;
};
const eventRegions = (event: EventHistorySource): RegionId[] => "regionIds" in event ? [...event.regionIds] : eventRegionIds(event) as RegionId[];
const eventOrganizations = (event: EventHistorySource): string[] => "organizationIds" in event ? [...event.organizationIds] : eventOrganizationIds(event);
const MAX_RELATED_EVENT_IDS = 32;
const ENTITY_ID_PREFIXES = [
  "agent:", "population:", "species:", "culture:", "facility:", "substance:", "pathogen:", "organization:",
  "worldview:", "phenomenon:", "practice:", "knowledge:", "belief:", "relationship:",
];
const isEntityId = (value: string): boolean => ENTITY_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
const collectEntityIds = (value: unknown, ids: Set<string>, depth = 0): void => {
  if (ids.size >= MAX_RELATED_EVENT_IDS || depth > 4) return;
  if (typeof value === "string") {
    if (isEntityId(value)) ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEntityIds(item, ids, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) collectEntityIds(item, ids, depth + 1);
};
const eventRelatedIds = (event: EventHistorySource): string[] => {
  const ids = new Set<string>();
  if ("details" in event) collectEntityIds(event.details, ids);
  else {
    collectEntityIds(event.payload, ids);
    collectEntityIds(event.evidence, ids);
  }
  for (const id of eventOrganizations(event)) {
    if (ids.size >= MAX_RELATED_EVENT_IDS) break;
    ids.add(id);
  }
  for (const id of event.sourceIds) {
    if (ids.size >= MAX_RELATED_EVENT_IDS) break;
    if (isEntityId(id)) ids.add(id);
  }
  return [...ids].filter(isEntityId).sort().slice(0, MAX_RELATED_EVENT_IDS);
};

const recentRegionEventsFor = (state: WorldState, regionId: RegionId) => {
  const localOrganizationIds = new Set<string>();
  for (const organization of state.organizations) {
    if (organization.regionId === regionId || organization.territoryRegionIds.includes(regionId)) localOrganizationIds.add(organization.id);
  }
  for (const summary of state.lod.summaries) {
    if (summary.regionId !== regionId) continue;
    for (const organization of summary.organizations) localOrganizationIds.add(organization.id);
  }
  const candidates = new Map<string, EventHistoryCandidate>();
  for (const event of state.eventArchive.milestones ?? []) {
    const regionIds = eventRegions(event);
    if (regionIds.includes(regionId) || eventOrganizations(event).some((id) => localOrganizationIds.has(id))) candidates.set(event.id, { event, archived: true });
  }
  for (const event of state.events) {
    const regionIds = eventRegions(event);
    if (regionIds.includes(regionId) || eventOrganizations(event).some((id) => localOrganizationIds.has(id))) candidates.set(event.id, { event, archived: false });
  }
  return [...candidates.values()]
    .sort((left, right) => compareSimulationSteps(right.event.timelineStep ?? String(right.event.tick), left.event.timelineStep ?? String(left.event.tick)) || (right.event.years ?? right.event.tick) - (left.event.years ?? left.event.tick) || right.event.id.localeCompare(left.event.id))
    .slice(0, RECENT_REGION_EVENT_LIMIT)
    .map(({ event, archived }) => {
      const intensity = Number(eventScalar(event, "intensity"));
      const amount = Number(eventScalar(event, "amount"));
      const destinationRegionId = eventScalar(event, "toRegion");
      const name = eventScalar(event, "name");
      const result = eventScalar(event, "result") ?? eventScalar(event, "outcome");
      const resourceId = eventScalar(event, "resourceId");
      const route = eventScalar(event, "route");
      return {
        id: event.id,
        tick: event.tick,
        ...(event.timelineStep === undefined ? {} : { timelineStep: event.timelineStep }),
        ...(event.timelineDays === undefined ? {} : { timelineDays: event.timelineDays }),
        ...(event.years === undefined ? {} : { years: event.years }),
        kind: event.kind,
        ruleId: event.ruleId,
        source: event.source,
        sourceIds: [...event.sourceIds],
        relatedIds: eventRelatedIds(event),
        regionIds: eventRegions(event),
        organizationIds: eventOrganizations(event),
        probability: event.probability,
        ...(archived ? { archived: true } : {}),
        ...(event.position ? { position: [...event.position] as [number, number] } : {}),
        ...("details" in event ? { details: { ...event.details } } : {}),
        ...(Number.isFinite(intensity) ? { intensity } : {}),
        ...(typeof name === "string" ? { name } : {}),
        ...(typeof result === "string" ? { result } : {}),
        ...(typeof resourceId === "string" ? { resourceId } : {}),
        ...(Number.isFinite(amount) ? { amount } : {}),
        ...(typeof route === "string" ? { route } : {}),
        ...(typeof destinationRegionId === "string" && destinationRegionId.startsWith("region:") ? { destinationRegionId: destinationRegionId as RegionId } : {}),
      };
    });
};

const supplyRoutesFor = (state: WorldState): SupplyRoute[] => {
  const routes = new Map<string, SupplyRoute>();
  const add = (route: SupplyRoute): void => {
    const key = `${route.fromOrganizationId}|${route.toOrganizationId}|${route.fromRegion}|${route.toRegion}|${route.resourceId}`;
    const existing = routes.get(key);
    if (!existing) {
      routes.set(key, route);
      return;
    }
    const totalAmount = addPersistentTotal(existing.totalAmount, route.totalAmount);
    existing.totalAmount = totalAmount >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.round(totalAmount * 1_000_000) / 1_000_000;
    existing.shipmentCount = addPersistentTotal(existing.shipmentCount, route.shipmentCount);
    existing.archivedShipmentCount = addPersistentTotal(existing.archivedShipmentCount ?? 0, route.archivedShipmentCount ?? 0);
    const existingFirst = existing.firstTimelineStep ?? String(existing.firstTick ?? existing.lastTick);
    const routeFirst = route.firstTimelineStep ?? String(route.firstTick ?? route.lastTick);
    if (compareSimulationSteps(routeFirst, existingFirst) < 0) {
      existing.firstTick = route.firstTick ?? route.lastTick;
      if (route.firstTimelineStep === undefined) delete existing.firstTimelineStep;
      else existing.firstTimelineStep = route.firstTimelineStep;
      if (route.firstTimelineDays === undefined) delete existing.firstTimelineDays;
      else existing.firstTimelineDays = route.firstTimelineDays;
      if (route.firstYears === undefined) delete existing.firstYears;
      else existing.firstYears = route.firstYears;
    }
    const existingLast = existing.lastTimelineStep ?? String(existing.lastTick);
    const routeLast = route.lastTimelineStep ?? String(route.lastTick);
    if (compareSimulationSteps(routeLast, existingLast) > 0) {
      existing.lastTick = route.lastTick;
      if (route.lastTimelineStep === undefined) delete existing.lastTimelineStep;
      else existing.lastTimelineStep = route.lastTimelineStep;
      if (route.lastTimelineDays === undefined) delete existing.lastTimelineDays;
      else existing.lastTimelineDays = route.lastTimelineDays;
      if (route.lastYears === undefined) delete existing.lastYears;
      else existing.lastYears = route.lastYears;
    }
  };
  for (const route of state.eventArchive.strategicRoutes ?? []) {
    if (route.kind !== "trade" || !route.resourceId) continue;
    add({
      fromOrganizationId: route.fromId,
      toOrganizationId: route.toId,
      fromRegion: route.fromRegion,
      toRegion: route.toRegion,
      resourceId: route.resourceId,
      totalAmount: route.cumulativeAmount,
      shipmentCount: route.occurrenceCount,
      archivedShipmentCount: route.occurrenceCount,
      firstTick: route.firstTick,
      ...(route.firstTimelineStep === undefined ? {} : { firstTimelineStep: route.firstTimelineStep }),
      ...(route.firstTimelineDays === undefined ? {} : { firstTimelineDays: route.firstTimelineDays }),
      ...(route.firstYears === undefined ? {} : { firstYears: route.firstYears }),
      lastTick: route.lastTick,
      ...(route.lastTimelineStep === undefined ? {} : { lastTimelineStep: route.lastTimelineStep }),
      ...(route.lastTimelineDays === undefined ? {} : { lastTimelineDays: route.lastTimelineDays }),
      ...(route.lastYears === undefined ? {} : { lastYears: route.lastYears }),
    });
  }
  let shipmentCount = 0;
  for (let index = state.events.length - 1; index >= 0 && shipmentCount < MAX_SUPPLY_ROUTES; index -= 1) {
    const event = state.events[index];
    if (!event || event.kind !== "interregional-trade") continue;
    const summary = strategicRouteForEvent(event);
    if (!summary || summary.kind !== "trade" || !summary.resourceId) continue;
    shipmentCount += 1;
    add({
      fromOrganizationId: summary.fromId,
      toOrganizationId: summary.toId,
      fromRegion: summary.fromRegion,
      toRegion: summary.toRegion,
      resourceId: summary.resourceId,
      totalAmount: summary.cumulativeAmount,
      shipmentCount: 1,
      archivedShipmentCount: 0,
      firstTick: event.tick,
      ...(event.timelineStep === undefined ? {} : { firstTimelineStep: event.timelineStep }),
      ...(event.timelineDays === undefined ? {} : { firstTimelineDays: event.timelineDays }),
      ...(event.years === undefined ? {} : { firstYears: event.years }),
      lastTick: event.tick,
      ...(event.timelineStep === undefined ? {} : { lastTimelineStep: event.timelineStep }),
      ...(event.timelineDays === undefined ? {} : { lastTimelineDays: event.timelineDays }),
      ...(event.years === undefined ? {} : { lastYears: event.years }),
    });
  }
  return [...routes.values()]
    .sort((left, right) => compareSimulationSteps(right.lastTimelineStep ?? String(right.lastTick), left.lastTimelineStep ?? String(left.lastTick))
      || left.resourceId.localeCompare(right.resourceId)
      || left.fromOrganizationId.localeCompare(right.fromOrganizationId))
    .slice(0, MAX_SUPPLY_ROUTES);
};

const organizationDirectoryFor = (state: WorldState): OrganizationDirectoryEntry[] => {
  const currentEventCounts = new Map<string, number>();
  for (const event of state.events) {
    const organizationIds = [
      ...event.sourceIds,
      ...Object.values(event.payload).filter((value): value is string => typeof value === "string"),
    ].filter((value) => value.startsWith("organization:"));
    for (const organizationId of new Set(organizationIds)) {
      currentEventCounts.set(organizationId, (currentEventCounts.get(organizationId) ?? 0) + 1);
    }
  }
  const resourcesByHolder = new Map<string, Set<string>>();
  for (const resource of state.resources) {
    if (!resource.holderId) continue;
    const resourceIds = resourcesByHolder.get(resource.holderId) ?? new Set<string>();
    resourceIds.add(resource.resourceId);
    resourcesByHolder.set(resource.holderId, resourceIds);
  }
  const entries = new Map<string, OrganizationDirectoryEntry>();
  const addSummary = (regionId: WorldState["lod"]["summaries"][number]["regionId"], organization: WorldState["lod"]["summaries"][number]["organizations"][number]): void => {
    const memberIds = [...organization.memberIds];
    const members = new Set(memberIds);
    const relationshipCount = state.lod.summaries
      .find((summary) => summary.regionId === regionId)
      ?.relationshipRecords.filter((relationship) => members.has(relationship.fromId) && members.has(relationship.toId)).length ?? 0;
    entries.set(organization.id, {
      id: organization.id,
      type: organization.type,
      regionId,
      memberCount: organization.memberCount,
      memberIds,
      childIds: [...organization.childIds],
      resourceIds: [...new Set([...organization.resourceIds, ...(resourcesByHolder.get(organization.id) ?? [])])].sort(),
      historyCount: organization.historyIds.length + (currentEventCounts.get(organization.id) ?? 0),
      archivedHistoryCount: Math.max(organization.archivedHistoryCount ?? 0, state.eventArchive.organizationCounts[organization.id] ?? 0),
      relationshipCount,
      territoryRegionIds: [...organization.territoryRegionIds],
      ...(organization.governance ? { governance: { ...organization.governance } } : {}),
      ...(organization.diplomacy ? { diplomacy: { ...organization.diplomacy } } : {}),
    });
  };
  for (const summary of state.lod.summaries) {
    for (const organization of summary.organizations) addSummary(summary.regionId, organization);
  }
  for (const organization of state.organizations) {
    const members = new Set(organization.memberIds);
    const relationshipCount = state.relationships.filter((relationship) => members.has(relationship.fromId) && members.has(relationship.toId)).length;
    entries.set(organization.id, {
      id: organization.id,
      type: organization.type,
      regionId: organization.regionId,
      memberCount: organization.memberIds.length,
      memberIds: [...organization.memberIds],
      childIds: [...organization.childOrganizationIds],
      resourceIds: [...new Set([...Object.keys(organization.resources), ...(resourcesByHolder.get(organization.id) ?? [])])].sort(),
      historyCount: currentEventCounts.get(organization.id) ?? 0,
      archivedHistoryCount: Math.max(organization.archivedHistoryCount ?? 0, state.eventArchive.organizationCounts[organization.id] ?? 0),
      relationshipCount,
      territoryRegionIds: [...organization.territoryRegionIds],
      ...(organization.governance ? { governance: { ...organization.governance } } : {}),
      ...(organization.diplomacy ? { diplomacy: { ...organization.diplomacy } } : {}),
    });
  }
  return [...entries.values()].sort((left, right) => left.type.localeCompare(right.type) || left.regionId.localeCompare(right.regionId) || left.id.localeCompare(right.id));
};

const sceneFor = (state: WorldState, projection?: WorldState["observation"]["projection"]): { entities: SceneEntity[]; links: SceneLink[] } => {
  const entities = new Map<string, SceneEntity>();
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  const populationById = new Map(state.populations.map((population) => [population.id, population]));
  const culturesByRegion = new Map(state.cultures.map((culture) => [culture.regionId, culture]));
  const lifeFieldsFor = (speciesId: string | undefined): Pick<SceneEntity, "speciesId" | "speciesName" | "lifeBlueprint"> => {
    const species = speciesId ? speciesById.get(speciesId as WorldState["species"][number]["id"]) : undefined;
    return species
      ? {
        speciesId: species.id,
        ...(species.name ? { speciesName: species.name } : {}),
        ...(species.blueprint ? { lifeBlueprint: species.blueprint } : {}),
      }
      : {};
  };
  const cultureFieldsFor = (regionId: SceneEntity["regionId"]): Pick<SceneEntity, "cultureId" | "cultureName" | "cultureSignature"> => {
    const culture = culturesByRegion.get(regionId);
    if (!culture) return {};
    const identity = cultureIdentityFor(culture);
    return { cultureId: culture.id, cultureName: identity.name, cultureSignature: identity.noveltySignature };
  };
  const add = (entity: SceneEntity): void => {
    if (entities.has(entity.id)) return;
    entities.set(entity.id, entity);
  };
  for (const summary of state.lod.summaries) {
    for (const organization of summary.organizations) {
      add({ id: organization.id, kind: organization.type, regionId: summary.regionId, count: organization.memberCount, rank: organizationRank[organization.type], territoryRegionIds: [...organization.territoryRegionIds], ...cultureFieldsFor(summary.regionId) });
    }
  }
  for (const organization of state.organizations) {
    add({ id: organization.id, kind: organization.type, regionId: organization.regionId, count: organization.memberIds.length, rank: organizationRank[organization.type], territoryRegionIds: [...organization.territoryRegionIds], ...cultureFieldsFor(organization.regionId) });
  }
  for (const facility of state.facilities) {
    if (facility.status !== "active" && facility.status !== "damaged") continue;
    add({
      id: facility.id,
      kind: "facility",
      facilityType: facility.type,
      facilityLevel: facility.level,
      facilityCondition: facility.condition,
      facilityStatus: facility.status,
      regionId: facility.regionId,
      count: facility.workforceIds.length,
      rank: organizationRank.facility,
      ...cultureFieldsFor(facility.regionId),
    });
  }
  for (const entity of state.worldview.entities) {
    add({
      id: entity.id,
      kind: entity.kind,
      regionId: entity.regionId,
      count: entity.memberIds?.length ?? Math.max(1, Math.round(entity.influence * 10)),
      rank: organizationRank[entity.kind],
      worldviewInfluence: entity.influence,
      worldviewStatus: entity.status ?? "active",
      ...cultureFieldsFor(entity.regionId),
    });
  }
  for (const population of state.populations) {
    add({ id: population.id, kind: "population", regionId: population.regionId, count: population.count, rank: organizationRank.population, ...lifeFieldsFor(population.speciesId), ...cultureFieldsFor(population.regionId) });
  }
  for (const agent of state.agents) {
    add({ id: agent.id, kind: "agent", regionId: agent.regionId, count: 1, rank: organizationRank.agent, ...lifeFieldsFor(populationById.get(agent.populationId)?.speciesId), ...cultureFieldsFor(agent.regionId) });
  }
  if (projection) {
    for (const organization of projection.organizations) {
      add({ id: organization.id, kind: organization.type, regionId: organization.regionId, count: organization.memberIds.length, rank: organizationRank[organization.type], territoryRegionIds: [...organization.territoryRegionIds], ...cultureFieldsFor(organization.regionId) });
    }
    for (const agent of projection.agents) {
      add({ id: agent.id, kind: "agent", regionId: agent.regionId, count: 1, rank: organizationRank.agent, ...lifeFieldsFor(populationById.get(agent.populationId)?.speciesId), ...cultureFieldsFor(agent.regionId) });
    }
  }
  const personalLinks = projection?.relationships.slice(0, 256).map((relationship): SceneLink | undefined => {
    const from = entities.get(relationship.fromId);
    const to = entities.get(relationship.toId);
    if (!from || !to) return undefined;
    return {
      fromId: relationship.fromId,
      toId: relationship.toId,
      fromRegion: from.regionId,
      toRegion: to.regionId,
      kind: relationship.kind,
      scope: "personal",
      strength: relationship.strength,
    };
  }).filter((link): link is SceneLink => Boolean(link)) ?? [];
  const ecologicalLinks = (state.ecologicalRelationships ?? []).slice(0, 256).map((relationship): SceneLink | undefined => {
    const fromId = typeof relationship.details.fromPopulationId === "string" ? relationship.details.fromPopulationId : relationship.fromSpeciesId;
    const toId = typeof relationship.details.toPopulationId === "string" ? relationship.details.toPopulationId : relationship.toSpeciesId;
    if (!entities.has(fromId) || !entities.has(toId)) return undefined;
    return {
      fromId,
      toId,
      fromRegion: relationship.regionId,
      toRegion: relationship.regionId,
      kind: relationship.kind,
      scope: "personal",
      strength: relationship.strength,
    };
  }).filter((link): link is SceneLink => Boolean(link));

  const organizationLocations = new Map<string, { id: string; regionId: RegionId; diplomacy: Record<string, string> }>();
  for (const summary of state.lod.summaries) {
    for (const organization of summary.organizations) {
      organizationLocations.set(organization.id, { id: organization.id, regionId: summary.regionId, diplomacy: organization.diplomacy ?? {} });
    }
  }
  for (const organization of state.organizations) {
    organizationLocations.set(organization.id, { id: organization.id, regionId: organization.regionId, diplomacy: organization.diplomacy ?? {} });
  }
  const strategicLinks = new Map<string, SceneLink>();
  const addStrategicLink = (link: SceneLink): void => {
    if (link.fromRegion === link.toRegion) return;
    const key = `${link.kind}|${link.fromId}|${link.toId}|${link.fromRegion}|${link.toRegion}`;
    const existing = strategicLinks.get(key);
    if (existing && existing.strength >= link.strength) return;
    if (existing) strategicLinks.delete(key);
    strategicLinks.set(key, link);
  };
  diplomaticLinks: for (const organization of [...organizationLocations.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const [peerId, stance] of Object.entries(organization.diplomacy).sort(([left], [right]) => left.localeCompare(right))) {
      if (organization.id >= peerId) continue;
      const peer = organizationLocations.get(peerId);
      if (!peer || stance === "neutral") continue;
      const kind = stance === "allied" ? "alliance" : stance === "rival" ? "border-conflict" : "trade";
      addStrategicLink({
        fromId: organization.id,
        toId: peer.id,
        fromRegion: organization.regionId,
        toRegion: peer.regionId,
        kind,
        scope: "strategic",
        strength: stance === "allied" ? 0.82 : stance === "rival" ? 0.74 : 0.62,
      });
      if (strategicLinks.size >= MAX_SCENE_DIPLOMATIC_LINKS) break diplomaticLinks;
    }
  }
  for (const route of (state.eventArchive.strategicRoutes ?? []).slice(0, MAX_SCENE_EVENT_LINKS)) {
    const amountStrength = route.kind === "trade" ? Math.log1p(route.cumulativeAmount) / 8 : Math.log1p(route.occurrenceCount) / 5;
    addStrategicLink({
      fromId: route.fromId,
      toId: route.toId,
      fromRegion: route.fromRegion,
      toRegion: route.toRegion,
      kind: route.kind,
      scope: "strategic",
      strength: Math.max(0.12, Math.min(1, 0.24 + amountStrength)),
    });
  }
  const strategicEventKinds = new Set([
    "interregional-trade", "diplomatic-alliance", "border-conflict", "organization-war", "territory-transfer",
    "population-migration", "population-dispersal", "organization-migration", "war-displacement",
  ]);
  const asRegionId = (value: unknown): RegionId | undefined => typeof value === "string" && value.startsWith("region:") ? value as RegionId : undefined;
  for (const event of state.events.filter((candidate) => strategicEventKinds.has(candidate.kind)).slice(-MAX_SCENE_EVENT_LINKS)) {
    const archivedShape = strategicRouteForEvent(event);
    const fromId = archivedShape?.fromId ?? String(event.payload.fromOrganizationId ?? event.payload.leftOrganizationId ?? event.payload.populationId ?? event.sourceIds[0] ?? "");
    const toId = archivedShape?.toId ?? (event.kind === "organization-migration"
      ? String(event.payload.toOrganizationId ?? event.payload.organizationId ?? event.payload.fromOrganizationId ?? event.sourceIds[0] ?? fromId)
      : String(event.payload.toOrganizationId ?? event.payload.rightOrganizationId ?? event.payload.branchPopulationId ?? event.sourceIds[1] ?? fromId));
    const fromRegion = archivedShape?.fromRegion ?? asRegionId(event.payload.fromRegion ?? event.evidence.fromRegion ?? event.evidence.leftRegion)
      ?? entities.get(fromId)?.regionId
      ?? organizationLocations.get(fromId)?.regionId;
    const toRegion = archivedShape?.toRegion ?? asRegionId(event.payload.toRegion ?? event.evidence.toRegion ?? event.evidence.rightRegion)
      ?? entities.get(toId)?.regionId
      ?? organizationLocations.get(toId)?.regionId;
    if (!fromId || !toId || !fromRegion || !toRegion) continue;
    const kind = archivedShape?.kind ?? (event.kind === "interregional-trade" ? "trade"
      : event.kind === "diplomatic-alliance" ? "alliance"
        : event.kind === "population-migration" || event.kind === "population-dispersal" || event.kind === "organization-migration" || event.kind === "war-displacement" ? "migration"
          : "border-conflict");
    const strength = Number(event.payload.amount ?? event.evidence.amount ?? event.evidence.intensity
      ?? event.evidence.displaced ?? event.evidence.branchCount ?? 0.7);
    addStrategicLink({
      fromId,
      toId,
      fromRegion,
      toRegion,
      kind,
      scope: "strategic",
      strength: Number.isFinite(strength) ? Math.max(0.05, strength) : 0.7,
    });
  }
  return {
    entities: [...entities.values()].slice(0, 800),
    links: [...personalLinks, ...ecologicalLinks, ...[...strategicLinks.values()].slice(-MAX_SCENE_STRATEGIC_LINKS)].slice(-(256 + MAX_SCENE_STRATEGIC_LINKS)),
  };
};
const eventFromInput = (state: WorldState, input: WorldEventInput): WorldEvent => ({
  id: input.id,
  tick: state.tick,
  years: state.years,
  kind: input.kind,
  ruleId: `user:${input.kind}`,
  source: "user",
  sourceIds: [],
  probability: Math.max(0, Math.min(1, input.intensity)),
  roll: 0,
  evidence: { regionId: input.regionId, intensity: input.intensity, duration: input.duration },
  payload: { ...input.payload, regionId: input.regionId, duration: input.duration },
});

export type SimulationRuntime = {
  dispatch(command: WorkerCommand): WorkerMessage[];
  getState(): WorldState;
  isPaused(): boolean;
  getSpeed(): 1 | 4 | 16 | 64;
};

export const createSimulationRuntime = (initial: WorldState = createWorld(1, { enabledPackIds: [...DEFAULT_WORLDVIEW_PACK_IDS] })): SimulationRuntime => {
  const initialState = structuredClone(initial);
  let state = structuredClone(initialState);
  let paused = true;
  let speed: 1 | 4 | 16 | 64 = 1;
  let digest = worldDigest(state);
  const now = (): number => typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
  let measuredSteps = 0;
  let lastStepMs = 0;
  let averageStepMs = 0;
  let peakStepMs = 0;
  const performanceTracker = new RuntimePerformanceTracker();
  let stepsSinceAutosave = 0;
  const recordStepDuration = (durationMs: number): void => {
    const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    measuredSteps = addPersistentTotal(measuredSteps, 1);
    lastStepMs = duration;
    averageStepMs = measuredSteps === 1 ? duration : averageStepMs * 0.98 + duration * 0.02;
    peakStepMs = Math.max(peakStepMs, duration);
    performanceTracker.record(duration);
  };
  const resetStepDiagnostics = (): void => {
    measuredSteps = 0;
    lastStepMs = 0;
    averageStepMs = 0;
    peakStepMs = 0;
    performanceTracker.reset();
  };
  const runtimeDiagnostics = (): RuntimeDiagnostics => {
    const rounded = (value: number): number => Number(value.toFixed(3));
    const recent = performanceTracker.diagnostics();
    return {
      measuredSteps,
      lastStepMs: rounded(lastStepMs),
      averageStepMs: rounded(averageStepMs),
      peakStepMs: rounded(peakStepMs),
      recentWindowSteps: recent.recentWindowSteps,
      recentAverageStepMs: rounded(recent.recentAverageStepMs),
      recentP95StepMs: rounded(recent.recentP95StepMs),
      recentSlowStepCount: recent.recentSlowStepCount,
      baselineStepMs: rounded(recent.baselineStepMs),
      recentStepCostRatio: rounded(recent.recentStepCostRatio),
      hotEventCount: state.events.length,
      archivedEventCount: state.eventArchive.archivedEventCount,
      milestoneCount: state.eventArchive.milestones.length,
    };
  };

  const snapshot = (): WorldSnapshot => {
    const observation = state.observation;
    const storedSummary = observation.focusRegionId ? state.lod.summaries.find((summary) => summary.regionId === observation.focusRegionId) : undefined;
    const refreshedAggregate = storedSummary?.mode === "aggregate"
      ? (() => {
        const foodBalance = state.resources
          .filter((resource) => resource.resourceId === "food" && resource.regionId === storedSummary.regionId)
          .reduce((sum, resource) => sum + resource.amount, 0);
        const population = aggregatePopulationForRegion(state, storedSummary.regionId, storedSummary.population);
        return {
          ...storedSummary,
          population,
          foodBalance,
          foodPerAgent: foodBalance / Math.max(1, population),
          foodSecurity: foodSecurityFromBalance(foodBalance, population),
          resources: structuredClone(state.resources.filter((resource) => resource.regionId === storedSummary.regionId)),
        };
      })()
      : undefined;
    const selectedRegion = observation.focusRegionId
      ? storedSummary?.mode === "aggregate"
        ? refreshedAggregate
        : summarizeRegionState(state, observation.focusRegionId, storedSummary?.mode ?? "micro")
      : undefined;
    const recentRegionEvents = observation.focusRegionId ? recentRegionEventsFor(state, observation.focusRegionId) : undefined;
    const projection = observation.focusRegionId ? focusRegion(state, observation.focusRegionId).projection : observation.projection;
    const scene = sceneFor(state, projection);
    return {
      seed: state.seed,
      tick: state.tick,
      years: state.years,
      ...(state.timeline === undefined ? {} : { timeline: structuredClone(state.timeline) }),
      orbital: structuredClone(state.orbital),
      climateCycle: structuredClone(state.climateCycle),
      formation: structuredClone(state.formation),
      tectonics: structuredClone(state.tectonics),
      atmosphere: structuredClone(state.atmosphere),
      ocean: structuredClone(state.ocean),
      eventArchive: structuredClone(state.eventArchive),
      historySamples: structuredClone(state.eventArchive.historySamples ?? []),
      runtime: runtimeDiagnostics(),
      digest,
      ...(observation.focusRegionId ? { focusRegionId: observation.focusRegionId } : {}),
      fields: cloneFields(state.fields),
      chemistry: cloneChemistry(state.chemistry),
      metrics: metricsFor(state),
      foodSecurity: foodSecurityGrid(state),
      diseasePrevalence: diseasePrevalenceGrid(state),
      species: structuredClone(state.species),
      populations: structuredClone(state.populations),
      knowledge: structuredClone(state.knowledge),
      ecologicalRelationships: structuredClone(state.ecologicalRelationships ?? []),
      cultures: structuredClone(state.cultures),
      cultureIdentityByRegion: Object.fromEntries(state.cultures.map((culture) => [culture.regionId, cultureIdentityFor(culture)])),
      facilities: structuredClone(state.facilities),
      substances: structuredClone(state.substances),
      pathogens: structuredClone(state.pathogens),
      resources: structuredClone(state.resources),
      substanceRichnessByRegion: substanceRichnessByRegion(state),
      organizationDirectory: organizationDirectoryFor(state),
      supplyRoutes: supplyRoutesFor(state),
      sceneEntities: scene.entities,
      sceneLinks: scene.links,
      worldviewPhenomena: structuredClone(state.worldview.phenomena),
      worldviewPractices: structuredClone(state.worldview.practices),
      worldviewEntities: structuredClone(state.worldview.entities),
      worldviewInteractions: structuredClone(state.worldview.interactions),
      ...(selectedRegion ? { selectedRegion } : {}),
      ...(recentRegionEvents ? { recentRegionEvents } : {}),
      ...(projection ? { projection: structuredClone(projection) } : {}),
    };
  };
  const autosave = (): WorkerMessage => ({
    type: "autosaved",
    payload: serializeWorld(state),
    digest,
    timelineDays: timelineForWorld(state).days,
  });
  const messages = (): WorkerMessage[] => [{ type: "snapshot", snapshot: snapshot(), paused, speed }];
  const runSteps = (count: number, events: WorldEvent[] = []): WorldEvent[] => {
    let emitted: WorldEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      const started = now();
      const result = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: index === 0 ? events : [] }, { computeDigest: false, mutateState: true });
      recordStepDuration(now() - started);
      state = result.state;
      stepsSinceAutosave += 1;
      for (const event of result.events) emitted.push(event);
    }
    digest = worldDigest(state);
    return emitted;
  };
  const dispatch = (command: WorkerCommand): WorkerMessage[] => {
    try {
      if (command.type === "start") { paused = false; return messages(); }
      if (command.type === "pause") { paused = true; return messages(); }
      if (command.type === "reset") {
        state = structuredClone(initialState);
        digest = worldDigest(state);
        resetStepDiagnostics();
        stepsSinceAutosave = 0;
        paused = true;
        return messages();
      }
      if (command.type === "setSpeed") { speed = command.multiplier; return messages(); }
      if (command.type === "step") {
        const requestedCount = Math.trunc(command.count);
        const count = Number.isFinite(requestedCount)
          ? Math.max(1, Math.min(10_000, requestedCount))
          : 1;
        const events = runSteps(count);
        const response: WorkerMessage[] = [...messages(), { type: "events", events }];
        if (stepsSinceAutosave >= AUTOSAVE_INTERVAL_STEPS) {
          stepsSinceAutosave = 0;
          response.push(autosave());
        }
        return response;
      }
      if (command.type === "applyEvent") {
        if (state.events.some((event) => event.id === command.event.id)) return [{ type: "error", code: "duplicate", message: `Event already applied: ${command.event.id}` }];
        const events = runSteps(1, [eventFromInput(state, command.event)]);
        const response: WorkerMessage[] = [...messages(), { type: "events", events }];
        if (stepsSinceAutosave >= AUTOSAVE_INTERVAL_STEPS) {
          stepsSinceAutosave = 0;
          response.push(autosave());
        }
        return response;
      }
      if (command.type === "focusRegion") {
        state.observation = focusRegion(state, command.regionId);
        return messages();
      }
      if (command.type === "checkpoint") return [autosave()];
      if (command.type === "save") {
        const payload = serializeWorld(state);
        return [{ type: "saved", payload, digest }];
      }
      const candidate = deserializeWorld(command.payload);
      if (candidate.observation.focusRegionId) candidate.observation = focusRegion(candidate, candidate.observation.focusRegionId);
      state = candidate;
      digest = worldDigest(state);
      resetStepDiagnostics();
      stepsSinceAutosave = 0;
      paused = true;
      return messages();
    } catch (error) {
      if (command.type === "step" || command.type === "applyEvent") paused = true;
      return [{ type: "error", code: "command-failed", message: error instanceof Error ? error.message : "Unknown simulation error" }];
    }
  };
  return { dispatch, getState: () => structuredClone(state), isPaused: () => paused, getSpeed: () => speed };
};
