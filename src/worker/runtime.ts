import { stepWorld, metricsFor } from "../sim/engine.ts";
import { aggregatePopulationForRegion, focusRegion, summarizeRegionState } from "../sim/lod/index.ts";
import { deserializeWorld, serializeWorld } from "../persistence/serialize.ts";
import { createWorld, worldDigest } from "../sim/world.ts";
import { foodSecurityFromBalance } from "../sim/agents/food.ts";
import type { EventMilestone, RegionId, WorldEvent, WorldEventInput, WorldState } from "../sim/types.ts";
import type { OrganizationDirectoryEntry, RuntimeDiagnostics, SceneEntity, SceneLink, SupplyRoute, WorkerCommand, WorkerMessage, WorldSnapshot } from "./protocol.ts";
import { DEFAULT_WORLDVIEW_PACK_IDS } from "../sim/worldview/index.ts";
import { SIMULATED_YEARS_PER_DAY } from "../sim/time.ts";
import { cultureIdentityFor } from "../sim/culture/identity.ts";
import { eventOrganizationIds, eventRegionIds } from "../sim/events/ledger.ts";

const cloneFields = (fields: WorldState["fields"]): WorldState["fields"] => structuredClone(fields);
const cloneChemistry = (chemistry: WorldState["chemistry"]): WorldState["chemistry"] => structuredClone(chemistry);
const substanceRichnessByRegion = (state: WorldState): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const substance of state.substances) {
    const properties = Object.values(substance.properties);
    const utility = properties.reduce((sum, value) => sum + value, 0) / Math.max(1, properties.length);
    const visibility = substance.status === "known" ? 1 : 0.58;
    result[substance.regionId] = Math.max(result[substance.regionId] ?? 0, Math.min(1, utility * visibility));
  }
  return result;
};
const foodSecurityByRegion = (state: WorldState): Record<string, number> => {
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
  const result: Record<string, number> = {};
  for (let y = 0; y < state.fields.elevation.height; y += 1) {
    for (let x = 0; x < state.fields.elevation.width; x += 1) {
      const regionId = `region:${x}:${y}`;
      const populationCount = agentCounts.get(regionId) || summaryCounts.get(regionId) || populationCounts.get(regionId) || 0;
      result[regionId] = foodSecurityFromBalance(foodBalances.get(regionId) ?? 0, populationCount);
    }
  }
  return result;
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
    .sort((left, right) => (right.event.years ?? right.event.tick) - (left.event.years ?? left.event.tick) || right.event.tick - left.event.tick || right.event.id.localeCompare(left.event.id))
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
        ...(event.years === undefined ? {} : { years: event.years }),
        kind: event.kind,
        ruleId: event.ruleId,
        source: event.source,
        sourceIds: [...event.sourceIds],
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
  let shipmentCount = 0;
  for (let index = state.events.length - 1; index >= 0 && shipmentCount < 256; index -= 1) {
    const event = state.events[index];
    if (!event || event.kind !== "interregional-trade") continue;
    const fromOrganizationId = typeof event.payload.fromOrganizationId === "string" ? event.payload.fromOrganizationId : event.sourceIds[0];
    const toOrganizationId = typeof event.payload.toOrganizationId === "string" ? event.payload.toOrganizationId : event.sourceIds[1];
    const fromRegion = event.payload.fromRegion;
    const toRegion = event.payload.toRegion;
    const resourceId = event.payload.resourceId;
    const amount = Number(event.payload.amount ?? 0);
    if (!fromOrganizationId || !toOrganizationId || typeof fromRegion !== "string" || typeof toRegion !== "string"
      || !["food", "materials", "energy"].includes(String(resourceId)) || !Number.isFinite(amount) || amount <= 0) continue;
    shipmentCount += 1;
    const key = `${fromOrganizationId}|${toOrganizationId}|${resourceId}`;
    const existing = routes.get(key);
    if (existing) {
      existing.totalAmount = Math.round((existing.totalAmount + amount) * 1_000_000) / 1_000_000;
      existing.shipmentCount += 1;
      continue;
    }
    routes.set(key, {
      fromOrganizationId,
      toOrganizationId,
      fromRegion: fromRegion as SupplyRoute["fromRegion"],
      toRegion: toRegion as SupplyRoute["toRegion"],
      resourceId: resourceId as SupplyRoute["resourceId"],
      totalAmount: amount,
      shipmentCount: 1,
      lastTick: event.tick,
      ...(event.years === undefined ? {} : { lastYears: event.years }),
    });
  }
  return [...routes.values()].sort((left, right) => right.lastTick - left.lastTick || left.resourceId.localeCompare(right.resourceId) || left.fromOrganizationId.localeCompare(right.fromOrganizationId));
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
  const links = projection?.relationships.slice(0, 256).map((relationship): SceneLink => ({
    fromId: relationship.fromId,
    toId: relationship.toId,
    kind: relationship.kind,
    strength: relationship.strength,
  })) ?? [];
  const interregionalLinks = state.events
    .filter((event) => event.kind === "interregional-trade" || event.kind === "border-conflict" || event.kind === "organization-war" || event.kind === "diplomatic-alliance")
    .slice(-128)
    .map((event): SceneLink | undefined => {
      const fromId = String(event.payload.fromOrganizationId ?? event.payload.leftOrganizationId ?? event.sourceIds[0] ?? "");
      const toId = String(event.payload.toOrganizationId ?? event.payload.rightOrganizationId ?? event.sourceIds[1] ?? "");
      if (!entities.has(fromId) || !entities.has(toId)) return undefined;
      return { fromId, toId, kind: event.kind === "border-conflict" || event.kind === "organization-war" ? "border-conflict" : "trade", strength: Number(event.payload.amount ?? event.evidence.intensity ?? 0.7) };
    })
    .filter((link): link is SceneLink => Boolean(link));
  return { entities: [...entities.values()].slice(0, 800), links: [...links, ...interregionalLinks].slice(-384) };
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
  const recordStepDuration = (durationMs: number): void => {
    const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    measuredSteps += 1;
    lastStepMs = duration;
    averageStepMs = measuredSteps === 1 ? duration : averageStepMs * 0.98 + duration * 0.02;
    peakStepMs = Math.max(peakStepMs, duration);
  };
  const resetStepDiagnostics = (): void => {
    measuredSteps = 0;
    lastStepMs = 0;
    averageStepMs = 0;
    peakStepMs = 0;
  };
  const runtimeDiagnostics = (): RuntimeDiagnostics => {
    const rounded = (value: number): number => Number(value.toFixed(3));
    return {
      measuredSteps,
      lastStepMs: rounded(lastStepMs),
      averageStepMs: rounded(averageStepMs),
      peakStepMs: rounded(peakStepMs),
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
      formation: structuredClone(state.formation),
      eventArchive: structuredClone(state.eventArchive),
      runtime: runtimeDiagnostics(),
      digest,
      ...(observation.focusRegionId ? { focusRegionId: observation.focusRegionId } : {}),
      fields: cloneFields(state.fields),
      chemistry: cloneChemistry(state.chemistry),
      metrics: metricsFor(state),
      foodSecurityByRegion: foodSecurityByRegion(state),
      species: structuredClone(state.species),
      populations: structuredClone(state.populations),
      knowledge: structuredClone(state.knowledge),
      cultures: structuredClone(state.cultures),
      cultureIdentityByRegion: Object.fromEntries(state.cultures.map((culture) => [culture.regionId, cultureIdentityFor(culture)])),
      facilities: structuredClone(state.facilities),
      substances: structuredClone(state.substances),
      resources: structuredClone(state.resources),
      substanceRichnessByRegion: substanceRichnessByRegion(state),
      organizationDirectory: organizationDirectoryFor(state),
      supplyRoutes: supplyRoutesFor(state),
      sceneEntities: scene.entities,
      sceneLinks: scene.links,
      worldviewPhenomena: structuredClone(state.worldview.phenomena),
      worldviewPractices: structuredClone(state.worldview.practices),
      worldviewEntities: structuredClone(state.worldview.entities),
      ...(selectedRegion ? { selectedRegion } : {}),
      ...(recentRegionEvents ? { recentRegionEvents } : {}),
      ...(projection ? { projection: structuredClone(projection) } : {}),
    };
  };
  const messages = (): WorkerMessage[] => [{ type: "snapshot", snapshot: snapshot(), paused, speed }];
  const runSteps = (count: number, events: WorldEvent[] = []): WorldEvent[] => {
    let emitted: WorldEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      const started = now();
      const result = stepWorld(state, { elapsedYears: SIMULATED_YEARS_PER_DAY, externalEvents: index === 0 ? events : [] }, { computeDigest: false, mutateState: true });
      recordStepDuration(now() - started);
      state = result.state;
      emitted.push(...result.events);
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
        paused = true;
        return messages();
      }
      if (command.type === "setSpeed") { speed = command.multiplier; return messages(); }
      if (command.type === "step") {
        const count = Math.max(1, Math.min(10_000, Math.trunc(command.count)));
        const events = runSteps(count);
        return [...messages(), { type: "events", events }];
      }
      if (command.type === "applyEvent") {
        if (state.events.some((event) => event.id === command.event.id)) return [{ type: "error", code: "duplicate", message: `Event already applied: ${command.event.id}` }];
        const events = runSteps(1, [eventFromInput(state, command.event)]);
        return [...messages(), { type: "events", events }];
      }
      if (command.type === "focusRegion") {
        state.observation = focusRegion(state, command.regionId);
        return messages();
      }
      if (command.type === "save") {
        const payload = serializeWorld(state);
        return [{ type: "saved", payload, digest }];
      }
      const candidate = deserializeWorld(command.payload);
      if (candidate.observation.focusRegionId) candidate.observation = focusRegion(candidate, candidate.observation.focusRegionId);
      state = candidate;
      digest = worldDigest(state);
      resetStepDiagnostics();
      paused = true;
      return messages();
    } catch (error) {
      if (command.type === "step" || command.type === "applyEvent") paused = true;
      return [{ type: "error", code: "command-failed", message: error instanceof Error ? error.message : "Unknown simulation error" }];
    }
  };
  return { dispatch, getState: () => structuredClone(state), isPaused: () => paused, getSpeed: () => speed };
};
