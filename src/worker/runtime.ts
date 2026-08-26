import { stepWorld, metricsFor } from "../sim/engine.ts";
import { focusRegion, summarizeRegionState } from "../sim/lod/index.ts";
import { deserializeWorld, serializeWorld } from "../persistence/serialize.ts";
import { createWorld, worldDigest } from "../sim/world.ts";
import { foodSecurityFromBalance } from "../sim/agents/food.ts";
import type { WorldEvent, WorldEventInput, WorldState } from "../sim/types.ts";
import type { WorkerCommand, WorkerMessage, WorldSnapshot } from "./protocol.ts";

const cloneFields = (fields: WorldState["fields"]): WorldState["fields"] => structuredClone(fields);
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

export const createSimulationRuntime = (initial: WorldState = createWorld(1, { enabledPackIds: ["cultivation.path", "mythology.chinese-motif", "mythology.greek-motif", "mythology.indian-motif", "mythology.norse-motif"] })): SimulationRuntime => {
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
    return {
      tick: state.tick,
      years: state.years,
      digest,
      ...(observation.focusRegionId ? { focusRegionId: observation.focusRegionId } : {}),
      fields: cloneFields(state.fields),
      metrics: metricsFor(state),
      foodSecurityByRegion: foodSecurityByRegion(state),
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
