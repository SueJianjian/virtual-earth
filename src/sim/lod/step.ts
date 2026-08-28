import type { AgentsDelta, CultureDelta, EcologyDelta, PopulationState, RegionId, SocietyDelta, StepInput, WorldDelta, WorldState } from "../types.ts";
import { MAX_DETAILED_AGENTS } from "../agents/lifecycle.ts";
import { promoteRegion } from "./promote.ts";
import { createRegionSummaryIndex, populationIndexByRegion, refreshAggregateSummaryWithEvents, summarizeRegionState } from "./summarize.ts";
import { simulationStepDistance, simulationStepForWorld } from "../time.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

const appendItems = <T>(target: T[], source: readonly T[]): void => {
  for (const item of source) target.push(item);
};

type RegionActivityIndex = {
  agentCounts: Map<RegionId, number>;
  activeOrganizationRegions: Set<RegionId>;
  recentNaturalEventRegions: Set<RegionId>;
};

const buildRegionActivityIndex = (state: WorldState): RegionActivityIndex => {
  const agentCounts = new Map<RegionId, number>();
  for (const agent of state.agents) {
    agentCounts.set(agent.regionId, (agentCounts.get(agent.regionId) ?? 0) + 1);
  }
  const activeOrganizationRegions = new Set<RegionId>();
  for (const organization of state.organizations) {
    if (organization.status === "active") activeOrganizationRegions.add(organization.regionId);
  }
  const recentNaturalEventRegions = new Set<RegionId>();
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (!event || simulationStepDistance(simulationStepForWorld(state), event.timelineStep ?? String(event.tick)) > 2) break;
    if (event.source !== "natural" || event.kind.startsWith("aggregate-")) continue;
    const eventRegion = event.payload.regionId ?? event.evidence.regionId;
    if (typeof eventRegion === "string") recentNaturalEventRegions.add(eventRegion as RegionId);
  }
  return { agentCounts, activeOrganizationRegions, recentNaturalEventRegions };
};

const isNaturalHotspot = (activity: RegionActivityIndex, regionId: RegionId): boolean => {
  return activity.activeOrganizationRegions.has(regionId)
    || activity.recentNaturalEventRegions.has(regionId)
    || (activity.agentCounts.get(regionId) ?? 0) >= 8;
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
  const projectedAgentIds = new Set(state.agents.map((agent) => agent.id));
  for (const effect of _agents.entityEffects) {
    if (effect.collection !== "agents") continue;
    if (effect.operation === "remove") projectedAgentIds.delete(effect.id);
    else if (effect.value) projectedAgentIds.add(effect.id);
  }
  let availableAgentSlots = Math.max(0, MAX_DETAILED_AGENTS - projectedAgentIds.size);
  const activity = buildRegionActivityIndex(state);
  const summariesByRegion = new Map(state.lod.summaries.map((summary) => [summary.regionId, summary]));
  const regions = new Set([...state.agents.map((agent) => agent.regionId), ...state.lod.summaries.map((summary) => summary.regionId)]);
  const regionsNeedingSummary = new Set<RegionId>();
  for (const regionId of regions) {
    const summary = summariesByRegion.get(regionId);
    const hasAgents = (activity.agentCounts.get(regionId) ?? 0) > 0;
    const hotspot = isNaturalHotspot(activity, regionId);
    if ((summary?.mode === "aggregate" && (hasAgents || !hotspot))
      || (summary?.mode === "micro" && !hasAgents && !hotspot)
      || (!summary && hasAgents)) {
      regionsNeedingSummary.add(regionId);
    }
  }
  const regionSummaryIndex = regionsNeedingSummary.size > 0
    ? createRegionSummaryIndex(state, regionsNeedingSummary)
    : undefined;
  const projectedPopulationByRegion = regionsNeedingSummary.size > 0
    ? populationIndexByRegion(projectedPopulations, regionsNeedingSummary)
    : undefined;
  for (const regionId of [...regions].sort()) {
    const summary = summariesByRegion.get(regionId);
    const hasAgents = (activity.agentCounts.get(regionId) ?? 0) > 0;
    const hotspot = isNaturalHotspot(activity, regionId);
    if (summary?.mode === "aggregate") {
      if (hasAgents) {
        // A legacy save may contain detailed agents beside an aggregate
        // summary. Reconcile it into a normal micro summary before running on.
        upsertSummary(delta, summarizeRegionState(state, regionId, "micro", regionSummaryIndex));
      } else {
        if (hotspot) {
          const promotion = promoteRegion(state, regionId, "rapid-change", availableAgentSlots);
          const promotedAgentCount = promotion.entityEffects.filter((effect) => effect.collection === "agents" && effect.operation === "create").length;
          availableAgentSlots = Math.max(0, availableAgentSlots - promotedAgentCount);
          merge(delta, promotion);
        } else {
          const refreshed = refreshAggregateSummaryWithEvents(state, summary, projectedPopulations, regionSummaryIndex, projectedPopulationByRegion);
          upsertSummary(delta, refreshed.summary);
          appendItems(delta.eventDrafts, refreshed.events);
        }
      }
      continue;
    }
    if (summary?.mode === "micro" && !hasAgents && !hotspot) {
      const refreshed = refreshAggregateSummaryWithEvents(state, { ...summary, mode: "aggregate" }, projectedPopulations, regionSummaryIndex, projectedPopulationByRegion);
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
      upsertSummary(delta, summarizeRegionState(state, regionId, "micro", regionSummaryIndex));
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
