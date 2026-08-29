import type { WorldState, WorldviewEntityState, WorldviewInteractionState, WorldviewPhenomenonState, WorldviewPracticeState } from "../types.ts";
import { compareSimulationSteps } from "../time.ts";

export const MAX_WORLDVIEW_PHENOMENA = 1_024;
export const MAX_WORLDVIEW_PRACTICES = 512;
export const MAX_WORLDVIEW_ENTITIES = 512;
export const MAX_WORLDVIEW_INTERACTIONS = 256;

const statusRank: Record<WorldviewPracticeState["status"], number> = {
  active: 3,
  dormant: 2,
  failed: 1,
};

const entityStatusRank: Record<WorldviewEntityState["status"], number> = {
  active: 2,
  dormant: 1,
};
const interactionStatusRank: Record<WorldviewInteractionState["status"], number> = {
  active: 3,
  resolved: 2,
  dormant: 1,
};

const comparePractices = (left: WorldviewPracticeState, right: WorldviewPracticeState): number =>
  statusRank[right.status] - statusRank[left.status]
  || compareSimulationSteps(right.lastTrainedTimelineStep ?? String(right.lastTrainedTick), left.lastTrainedTimelineStep ?? String(left.lastTrainedTick))
  || right.attunement - left.attunement
  || left.id.localeCompare(right.id);

const compareEntities = (left: WorldviewEntityState, right: WorldviewEntityState): number =>
  entityStatusRank[right.status] - entityStatusRank[left.status]
  || Number((right.activePractitionerCount ?? 0) > 0) - Number((left.activePractitionerCount ?? 0) > 0)
  || compareSimulationSteps(right.lastActiveTimelineStep ?? String(right.lastActiveTick ?? right.originTick ?? 0), left.lastActiveTimelineStep ?? String(left.lastActiveTick ?? left.originTick ?? 0))
  || right.influence - left.influence
  || left.id.localeCompare(right.id);

const compareInteractions = (left: WorldviewInteractionState, right: WorldviewInteractionState): number =>
  interactionStatusRank[right.status] - interactionStatusRank[left.status]
  || compareSimulationSteps(right.lastInteractionTimelineStep ?? String(right.lastInteractionTick), left.lastInteractionTimelineStep ?? String(left.lastInteractionTick))
  || right.successes - left.successes
  || left.id.localeCompare(right.id);

const comparePhenomena = (
  referencedIds: ReadonlySet<string>,
  left: WorldviewPhenomenonState,
  right: WorldviewPhenomenonState,
): number => Number(referencedIds.has(right.id)) - Number(referencedIds.has(left.id))
  || compareSimulationSteps(right.originTimelineStep ?? String(right.originTick), left.originTimelineStep ?? String(left.originTick))
  || left.id.localeCompare(right.id);

const referencedPhenomenonIds = (state: WorldState, practices: readonly WorldviewPracticeState[], entities: readonly WorldviewEntityState[]): Set<string> => {
  const ids = new Set<string>();
  for (const practice of practices) ids.add(practice.phenomenonId);
  for (const entity of entities) if (entity.sourcePhenomenonId) ids.add(entity.sourcePhenomenonId);
  for (const culture of state.cultures) {
    for (const beliefId of culture.beliefIds) {
      if (beliefId.startsWith("belief:")) ids.add(beliefId.slice("belief:".length));
    }
  }
  return ids;
};

const retainPhenomena = (
  phenomena: readonly WorldviewPhenomenonState[],
  referencedIds: ReadonlySet<string>,
): Set<string> => {
  const byId = new Map(phenomena.map((phenomenon) => [phenomenon.id, phenomenon]));
  const ordered = [...phenomena].sort((left, right) => comparePhenomena(referencedIds, left, right));
  const retained = new Set<string>();

  // Keep causal ancestors near referenced records so reports remain useful.
  for (const root of [...ordered.filter((phenomenon) => referencedIds.has(phenomenon.id)), ...ordered]) {
    const chain: WorldviewPhenomenonState[] = [];
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || retained.has(current.id) || visited.has(current.id)) continue;
      visited.add(current.id);
      chain.push(current);
      for (const parentId of [...current.parentIds].sort().reverse()) {
        const parent = byId.get(parentId);
        if (parent) pending.push(parent);
      }
    }
    for (const phenomenon of chain.reverse()) {
      if (retained.size >= MAX_WORLDVIEW_PHENOMENA) break;
      retained.add(phenomenon.id);
    }
    if (retained.size >= MAX_WORLDVIEW_PHENOMENA) break;
  }
  return retained;
};

export const compactWorldviewRecords = (state: WorldState): { phenomenaRemoved: number; practicesRemoved: number; entitiesRemoved: number; interactionsRemoved: number } => {
  const previousPhenomena = state.worldview.phenomena.length;
  const previousPractices = state.worldview.practices.length;
  const previousEntities = state.worldview.entities.length;
  const previousInteractions = state.worldview.interactions.length;
  const agentIds = new Set(state.agents.map((agent) => agent.id));
  const organizationIds = new Set(state.organizations.map((organization) => organization.id));
  const phenomenonIds = new Set(state.worldview.phenomena.map((phenomenon) => phenomenon.id));
  const referencesAreValid = state.worldview.practices.every((practice) => agentIds.has(practice.practitionerId) && phenomenonIds.has(practice.phenomenonId))
    && state.worldview.entities.every((entity) => (!entity.sponsorOrganizationId || organizationIds.has(entity.sponsorOrganizationId))
      && (!entity.sourcePhenomenonId || phenomenonIds.has(entity.sourcePhenomenonId))
      && (entity.memberIds ?? []).every((memberId) => agentIds.has(memberId)))
    && state.worldview.phenomena.every((phenomenon) => phenomenon.parentIds.every((parentId) => phenomenonIds.has(parentId)))
    && state.worldview.interactions.every((interaction) => {
      const source = state.worldview.entities.find((entity) => entity.id === interaction.sourceEntityId);
      const target = state.worldview.entities.find((entity) => entity.id === interaction.targetEntityId);
      return Boolean(source && target && interaction.fusionEntityId ? state.worldview.entities.some((entity) => entity.id === interaction.fusionEntityId) : source && target);
    })
    && state.cultures.every((culture) => culture.beliefIds.every((beliefId) => !beliefId.startsWith("belief:") || phenomenonIds.has(beliefId.slice("belief:".length))));
  if (previousPhenomena <= MAX_WORLDVIEW_PHENOMENA
    && previousPractices <= MAX_WORLDVIEW_PRACTICES
    && previousEntities <= MAX_WORLDVIEW_ENTITIES
    && previousInteractions <= MAX_WORLDVIEW_INTERACTIONS
    && referencesAreValid) {
    return { phenomenaRemoved: 0, practicesRemoved: 0, entitiesRemoved: 0, interactionsRemoved: 0 };
  }
  const practices = state.worldview.practices
    .filter((practice) => agentIds.has(practice.practitionerId) && phenomenonIds.has(practice.phenomenonId))
    .sort(comparePractices)
    .slice(0, MAX_WORLDVIEW_PRACTICES);
  const entities = state.worldview.entities
    .filter((entity) => !entity.sponsorOrganizationId || organizationIds.has(entity.sponsorOrganizationId))
    .sort(compareEntities)
    .slice(0, MAX_WORLDVIEW_ENTITIES);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const interactions = state.worldview.interactions
    .filter((interaction) => entityIds.has(interaction.sourceEntityId)
      && entityIds.has(interaction.targetEntityId)
      && (!interaction.fusionEntityId || entityIds.has(interaction.fusionEntityId)))
    .sort(compareInteractions)
    .slice(0, MAX_WORLDVIEW_INTERACTIONS);
  const retainedPhenomenonIds = retainPhenomena(state.worldview.phenomena, referencedPhenomenonIds(state, practices, entities));

  state.worldview.phenomena = state.worldview.phenomena
    .filter((phenomenon) => retainedPhenomenonIds.has(phenomenon.id))
    .map((phenomenon) => ({
      ...phenomenon,
      parentIds: phenomenon.parentIds.filter((parentId) => retainedPhenomenonIds.has(parentId)),
    }));
  const retainedIds = new Set(state.worldview.phenomena.map((phenomenon) => phenomenon.id));
  state.worldview.practices = practices.filter((practice) => retainedIds.has(practice.phenomenonId));
  state.worldview.entities = entities
    .filter((entity) => !entity.sourcePhenomenonId || retainedIds.has(entity.sourcePhenomenonId))
    .map((entity) => ({
      ...entity,
      ...(entity.memberIds ? { memberIds: entity.memberIds.filter((memberId) => agentIds.has(memberId)) } : {}),
    }));
  const retainedEntityIds = new Set(state.worldview.entities.map((entity) => entity.id));
  state.worldview.interactions = interactions.filter((interaction) => retainedEntityIds.has(interaction.sourceEntityId)
    && retainedEntityIds.has(interaction.targetEntityId)
    && (!interaction.fusionEntityId || retainedEntityIds.has(interaction.fusionEntityId)));
  for (const culture of state.cultures) {
    culture.beliefIds = culture.beliefIds.filter((beliefId) => !beliefId.startsWith("belief:") || retainedIds.has(beliefId.slice("belief:".length)));
  }

  return {
    phenomenaRemoved: previousPhenomena - state.worldview.phenomena.length,
    practicesRemoved: previousPractices - state.worldview.practices.length,
    entitiesRemoved: previousEntities - state.worldview.entities.length,
    interactionsRemoved: previousInteractions - state.worldview.interactions.length,
  };
};
