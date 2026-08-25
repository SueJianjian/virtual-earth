import { hashString } from "../random.ts";
import type { ObservationState, RegionId, RegionProjection, WorldState } from "../types.ts";
import { projectRegion } from "./expand.ts";

const copy = <T>(value: T): T => structuredClone(value);

export const projectMicroRegion = (state: WorldState, regionId: RegionId): RegionProjection => ({
  regionId,
  sourceRevision: state.tick,
  readOnly: true,
  generatedFromDigest: hashString(JSON.stringify({ tick: state.tick, regionId, agents: state.agents.filter((agent) => agent.regionId === regionId).map((agent) => agent.id) })).toString(16),
  agents: copy(state.agents.filter((agent) => agent.regionId === regionId)),
  relationships: copy(state.relationships.filter((relationship) => state.agents.some((agent) => agent.id === relationship.fromId && agent.regionId === regionId) && state.agents.some((agent) => agent.id === relationship.toId && agent.regionId === regionId))),
  organizations: copy(state.organizations.filter((organization) => organization.regionId === regionId)),
});

export const focusRegion = (state: WorldState, regionId: RegionId): ObservationState => {
  const summary = state.lod.summaries.find((candidate) => candidate.regionId === regionId);
  return {
    focusRegionId: regionId,
    projection: summary && summary.mode === "aggregate" ? projectRegion(summary, state.tick) : projectMicroRegion(state, regionId),
  };
};
