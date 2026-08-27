import type { AgentsDelta, CultureDelta, EcologyDelta, PopulationState, RegionId, SocietyDelta, StepInput, WorldDelta, WorldState } from "../types.ts";
import { promoteRegion } from "./promote.ts";
import { refreshAggregateSummary, summarizeRegionState } from "./summarize.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

const isNaturalHotspot = (state: WorldState, regionId: RegionId): boolean => {
  const agents = state.agents.filter((candidate) => candidate.regionId === regionId);
  const social = state.organizations.some((organization) =>
    organization.regionId === regionId && organization.status === "active");
  let recentNaturalEvent = false;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (!event || state.tick - event.tick > 2) break;
    if (event.source !== "natural") continue;
    const eventRegion = event.payload.regionId ?? event.evidence.regionId;
    if (eventRegion === regionId) {
      recentNaturalEvent = true;
      break;
    }
  }
  return social || recentNaturalEvent || agents.length >= 8;
};

const populationsAfter = (state: WorldState, delta: EcologyDelta): PopulationState[] => {
  const populations = new Map(state.populations.map((population) => [population.id, population]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "populations") continue;
    if (effect.operation === "remove") populations.delete(effect.id);
    else if (effect.value) populations.set(effect.id, effect.value);
  }
  return [...populations.values()];
};

const upsertSummary = (delta: WorldDelta, summary: WorldState["lod"]["summaries"][number]): void => {
  delta.lodEffects = [...(delta.lodEffects ?? []), { operation: "upsert-summary", summary }];
};

export const stepLod = (
  state: WorldState,
  _input: StepInput,
  _culture: CultureDelta,
  _society: SocietyDelta,
  _agents: AgentsDelta,
  ecology: EcologyDelta = emptyDelta(),
): WorldDelta => {
  const delta = emptyDelta();
  const projectedPopulations = populationsAfter(state, ecology);
  const regions = new Set([...state.agents.map((agent) => agent.regionId), ...state.lod.summaries.map((summary) => summary.regionId)]);
  for (const regionId of [...regions].sort()) {
    const summary = state.lod.summaries.find((candidate) => candidate.regionId === regionId);
    const hasAgents = state.agents.some((agent) => agent.regionId === regionId);
    const hotspot = isNaturalHotspot(state, regionId);
    if (summary?.mode === "aggregate") {
      if (hasAgents) {
        // A legacy save may contain detailed agents beside an aggregate
        // summary. Reconcile it into a normal micro summary before running on.
        upsertSummary(delta, summarizeRegionState(state, regionId, "micro"));
      } else {
        if (hotspot) {
          merge(delta, promoteRegion(state, regionId, "rapid-change"));
        } else {
          upsertSummary(delta, refreshAggregateSummary(state, summary, projectedPopulations));
        }
      }
      continue;
    }
    if (summary?.mode === "micro" && !hasAgents && !hotspot) {
      const refreshed = refreshAggregateSummary(state, { ...summary, mode: "aggregate" }, projectedPopulations);
      upsertSummary(delta, refreshed);
      delta.eventDrafts.push({
        kind: "region-summarized",
        ruleId: "natural-deaggregation",
        sourceIds: [...summary.agentIds],
        probability: 1,
        roll: 0,
        evidence: { population: summary.population },
        payload: { regionId },
        source: "natural",
      });
      continue;
    }
    if (!summary && hasAgents) {
      upsertSummary(delta, summarizeRegionState(state, regionId, "micro"));
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
