import { stepWorld, metricsFor } from "../sim/engine.ts";
import { focusRegion, summarizeRegionState } from "../sim/lod/index.ts";
import { deserializeWorld, serializeWorld } from "../persistence/serialize.ts";
import { createWorld, worldDigest } from "../sim/world.ts";
import { foodSecurityFromBalance } from "../sim/agents/food.ts";
import type { WorldEvent, WorldEventInput, WorldState } from "../sim/types.ts";
import type { SceneEntity, SceneLink, WorkerCommand, WorkerMessage, WorldSnapshot } from "./protocol.ts";
import { DEFAULT_WORLDVIEW_PACK_IDS } from "../sim/worldview/index.ts";

const cloneFields = (fields: WorldState["fields"]): WorldState["fields"] => structuredClone(fields);
const cloneChemistry = (chemistry: WorldState["chemistry"]): WorldState["chemistry"] => structuredClone(chemistry);
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
  const summaryCounts = new Map<string, number>(state.lod.summaries.map((summary): [string, number] => [summary.regionId, summary.population]));
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
  family: 2,
  clan: 3,
  tribe: 4,
  settlement: 5,
  city: 6,
  state: 7,
  federation: 8,
  empire: 9,
};

const sceneFor = (state: WorldState, projection?: WorldState["observation"]["projection"]): { entities: SceneEntity[]; links: SceneLink[] } => {
  const entities = new Map<string, SceneEntity>();
  const add = (entity: SceneEntity): void => {
    if (entities.has(entity.id)) return;
    entities.set(entity.id, entity);
  };
  for (const summary of state.lod.summaries) {
    for (const organization of summary.organizations) {
      add({ id: organization.id, kind: organization.type, regionId: summary.regionId, count: organization.memberCount, rank: organizationRank[organization.type], territoryRegionIds: [...organization.territoryRegionIds] });
    }
  }
  for (const organization of state.organizations) {
    add({ id: organization.id, kind: organization.type, regionId: organization.regionId, count: organization.memberIds.length, rank: organizationRank[organization.type], territoryRegionIds: [...organization.territoryRegionIds] });
  }
  for (const population of state.populations) {
    add({ id: population.id, kind: "population", regionId: population.regionId, count: population.count, rank: organizationRank.population });
  }
  for (const agent of state.agents) {
    add({ id: agent.id, kind: "agent", regionId: agent.regionId, count: 1, rank: organizationRank.agent });
  }
  if (projection) {
    for (const organization of projection.organizations) {
      add({ id: organization.id, kind: organization.type, regionId: organization.regionId, count: organization.memberIds.length, rank: organizationRank[organization.type], territoryRegionIds: [...organization.territoryRegionIds] });
    }
    for (const agent of projection.agents) {
      add({ id: agent.id, kind: "agent", regionId: agent.regionId, count: 1, rank: organizationRank.agent });
    }
  }
  const links = projection?.relationships.slice(0, 256).map((relationship): SceneLink => ({
    fromId: relationship.fromId,
    toId: relationship.toId,
    kind: relationship.kind,
    strength: relationship.strength,
  })) ?? [];
  const interregionalLinks = state.events
    .filter((event) => event.kind === "interregional-trade" || event.kind === "border-conflict")
    .slice(-128)
    .map((event): SceneLink | undefined => {
      const fromId = String(event.payload.fromOrganizationId ?? event.payload.leftOrganizationId ?? event.sourceIds[0] ?? "");
      const toId = String(event.payload.toOrganizationId ?? event.payload.rightOrganizationId ?? event.sourceIds[1] ?? "");
      if (!entities.has(fromId) || !entities.has(toId)) return undefined;
      return { fromId, toId, kind: event.kind === "border-conflict" ? "border-conflict" : "trade", strength: Number(event.payload.amount ?? 0.7) };
    })
    .filter((link): link is SceneLink => Boolean(link));
  return { entities: [...entities.values()].slice(0, 800), links: [...links, ...interregionalLinks].slice(-384) };
};
const eventFromInput = (state: WorldState, input: WorldEventInput): WorldEvent => ({
  id: input.id,
  tick: state.tick,
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
  let state = structuredClone(initial);
  let paused = true;
  let speed: 1 | 4 | 16 | 64 = 1;
  let digest = worldDigest(state);

  const snapshot = (): WorldSnapshot => {
    const observation = state.observation;
    const storedSummary = observation.focusRegionId ? state.lod.summaries.find((summary) => summary.regionId === observation.focusRegionId) : undefined;
    const refreshedAggregate = storedSummary?.mode === "aggregate"
      ? (() => {
        const foodBalance = state.resources
          .filter((resource) => resource.resourceId === "food" && resource.regionId === storedSummary.regionId)
          .reduce((sum, resource) => sum + resource.amount, 0);
        return {
          ...storedSummary,
          foodBalance,
          foodPerAgent: foodBalance / Math.max(1, storedSummary.population),
          foodSecurity: foodSecurityFromBalance(foodBalance, storedSummary.population),
          resources: structuredClone(state.resources.filter((resource) => resource.regionId === storedSummary.regionId)),
        };
      })()
      : undefined;
    const selectedRegion = observation.focusRegionId
      ? storedSummary?.mode === "aggregate"
        ? refreshedAggregate
        : summarizeRegionState(state, observation.focusRegionId, storedSummary?.mode ?? "micro")
      : undefined;
    const projection = observation.focusRegionId ? focusRegion(state, observation.focusRegionId).projection : observation.projection;
    const scene = sceneFor(state, projection);
    return {
      tick: state.tick,
      years: state.years,
      digest,
      ...(observation.focusRegionId ? { focusRegionId: observation.focusRegionId } : {}),
      fields: cloneFields(state.fields),
      chemistry: cloneChemistry(state.chemistry),
      metrics: metricsFor(state),
      foodSecurityByRegion: foodSecurityByRegion(state),
      sceneEntities: scene.entities,
      sceneLinks: scene.links,
      worldviewPhenomena: structuredClone(state.worldview.phenomena),
      worldviewPractices: structuredClone(state.worldview.practices),
      ...(selectedRegion ? { selectedRegion } : {}),
      ...(projection ? { projection: structuredClone(projection) } : {}),
    };
  };
  const messages = (): WorkerMessage[] => [{ type: "snapshot", snapshot: snapshot(), paused, speed }];
  const runSteps = (count: number, events: WorldEvent[] = []): WorldEvent[] => {
    let emitted: WorldEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      const previousEventCount = state.events.length;
      const result = stepWorld(state, { elapsedYears: 1, externalEvents: index === 0 ? events : [] }, { computeDigest: false });
      state = result.state;
      emitted = [...emitted, ...state.events.slice(previousEventCount)];
    }
    digest = worldDigest(state);
    return emitted;
  };
  const dispatch = (command: WorkerCommand): WorkerMessage[] => {
    try {
      if (command.type === "start") { paused = false; return messages(); }
      if (command.type === "pause") { paused = true; return messages(); }
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
      paused = true;
      return messages();
    } catch (error) {
      return [{ type: "error", code: "command-failed", message: error instanceof Error ? error.message : "Unknown simulation error" }];
    }
  };
  return { dispatch, getState: () => structuredClone(state), isPaused: () => paused, getSpeed: () => speed };
};
