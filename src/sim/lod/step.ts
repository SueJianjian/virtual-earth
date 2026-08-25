import type { AgentsDelta, CultureDelta, RegionId, SocietyDelta, StepInput, WorldDelta, WorldState } from "../types.ts";
import { promoteRegion } from "./promote.ts";
import { summarizeRegion, summarizeRegionState } from "./summarize.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

const isNaturalHotspot = (state: WorldState, regionId: RegionId): boolean => {
  const agents = state.agents.filter((candidate) => candidate.regionId === regionId);
  const social = state.organizations.some((organization) =>
    organization.regionId === regionId && organization.status === "active");
  const recentNaturalEvent = state.events.some((event) => {
    if (event.source !== "natural" || state.tick - event.tick > 2) return false;
    const eventRegion = event.payload.regionId ?? event.evidence.regionId;
    return eventRegion === regionId;
  });
  return social || recentNaturalEvent || agents.length >= 8;
};

export const stepLod = (state: WorldState, _input: StepInput, _culture: CultureDelta, _society: SocietyDelta, _agents: AgentsDelta): WorldDelta => {
  const delta = emptyDelta();
  const regions = new Set([...state.agents.map((agent) => agent.regionId), ...state.lod.summaries.map((summary) => summary.regionId)]);
  for (const regionId of [...regions].sort()) {
    const summary = state.lod.summaries.find((candidate) => candidate.regionId === regionId);
    const hasAgents = state.agents.some((agent) => agent.regionId === regionId);
    const hotspot = isNaturalHotspot(state, regionId);
    if (summary?.mode === "aggregate") {
      if (hotspot) merge(delta, promoteRegion(state, regionId, "rapid-change"));
      continue;
    }
    if (summary?.mode === "micro" && !hasAgents && !hotspot) {
      merge(delta, summarizeRegion(state, regionId));
      continue;
    }
    if (!summary && hasAgents) {
      delta.lodEffects = [
        ...(delta.lodEffects ?? []),
        { operation: "upsert-summary", summary: summarizeRegionState(state, regionId, "micro") },
      ];
    }
  }
  return delta;
};

const merge = (target: WorldDelta, source: WorldDelta): void => {
  target.fieldChanges.push(...source.fieldChanges);
  target.chemistryChanges.push(...source.chemistryChanges);
  target.entityEffects.push(...source.entityEffects);
  target.relationshipEffects.push(...source.relationshipEffects);
  target.resourceTransactions.push(...source.resourceTransactions);
  target.worldviewEffects.push(...source.worldviewEffects);
  target.eventDrafts.push(...source.eventDrafts);
  if (source.lodEffects) target.lodEffects = [...(target.lodEffects ?? []), ...source.lodEffects];
};
