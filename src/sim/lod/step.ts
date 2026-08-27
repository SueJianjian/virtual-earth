import type { AgentsDelta, CultureDelta, EcologyDelta, PopulationState, RegionId, SocietyDelta, StepInput, WorldDelta, WorldState } from "../types.ts";
import { promoteRegion } from "./promote.ts";
import { refreshAggregateSummaryWithEvents, summarizeRegionState } from "./summarize.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

const appendItems = <T>(target: T[], source: readonly T[]): void => {
  for (const item of source) target.push(item);
};

const isNaturalHotspot = (state: WorldState, regionId: RegionId): boolean => {
  const agents = state.agents.filter((candidate) => candidate.regionId === regionId);
  const social = state.organizations.some((organization) =>
    organization.regionId === regionId && organization.status === "active");
  let recentNaturalEvent = false;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (!event || state.tick - event.tick > 2) break;
    if (event.source !== "natural" || event.kind.startsWith("aggregate-")) continue;
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
          const refreshed = refreshAggregateSummaryWithEvents(state, summary, projectedPopulations);
          upsertSummary(delta, refreshed.summary);
          appendItems(delta.eventDrafts, refreshed.events);
        }
      }
      continue;
    }
    if (summary?.mode === "micro" && !hasAgents && !hotspot) {
      const refreshed = refreshAggregateSummaryWithEvents(state, { ...summary, mode: "aggregate" }, projectedPopulations);
      upsertSummary(delta, refreshed.summary);
      appendItems(delta.eventDrafts, refreshed.events);
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
  appendItems(target.fieldChanges, source.fieldChanges);
  appendItems(target.chemistryChanges, source.chemistryChanges);
  appendItems(target.entityEffects, source.entityEffects);
  appendItems(target.relationshipEffects, source.relationshipEffects);
  appendItems(target.resourceTransactions, source.resourceTransactions);
  appendItems(target.worldviewEffects, source.worldviewEffects);
  appendItems(target.eventDrafts, source.eventDrafts);
  if (source.lodEffects) target.lodEffects = [...(target.lodEffects ?? []), ...source.lodEffects];
};
