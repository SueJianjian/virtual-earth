import type { AgentsDelta, CultureDelta, SocietyDelta, WorldDelta, WorldState } from "../types.ts";
import { summarizeRegionState } from "./summarize.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

export const stepLod = (state: WorldState, _culture: CultureDelta, _society: SocietyDelta, _agents: AgentsDelta): WorldDelta => {
  const delta = emptyDelta();
  const regions = [...new Set(state.agents.map((agent) => agent.regionId))].sort();
  delta.lodEffects = regions.map((regionId) => ({ operation: "upsert-summary" as const, summary: summarizeRegionState(state, regionId, "micro") }));
  return delta;
};
