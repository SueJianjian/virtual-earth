import type {
  WorldEventDraft,
  WorldState,
  WorldviewEntityState,
  WorldviewPracticeState,
} from "../types.ts";
import { getWorldviewPack } from "./registry.ts";
import { addPersistentTotal } from "../numeric.ts";
import { nextSimulationStep, nextSimulationTick } from "../time.ts";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const practiceKey = (packId: string, regionId: string, phenomenonId?: string): string =>
  `${packId}|${regionId}|${phenomenonId ?? "*"}`;

const lifecycleEvent = (
  entity: WorldviewEntityState,
  previousStatus: WorldviewEntityState["status"],
  nextStatus: WorldviewEntityState["status"],
  tick: number,
): WorldEventDraft => ({
  kind: nextStatus === "active" ? "worldview-entity-revived" : "worldview-entity-dormant",
  ruleId: "worldview:entity-lifecycle",
  sourceIds: [...new Set([entity.id, ...(entity.memberIds ?? []), ...(entity.sponsorOrganizationId ? [entity.sponsorOrganizationId] : [])])].sort(),
  probability: 1,
  roll: 0,
  evidence: {
    previousStatus,
    nextStatus,
    supporterCount: entity.supporterCount ?? 0,
    activePractitionerCount: entity.activePractitionerCount ?? 0,
    sponsorCount: entity.sponsorCount ?? 0,
    viability: entity.viability ?? entity.influence,
  },
  payload: {
    entityId: entity.id,
    entityKind: entity.kind,
    name: entity.name ?? entity.id,
    regionId: entity.regionId,
    status: nextStatus,
    tick,
  },
  source: "natural",
});

const activeFor = (
  entity: WorldviewEntityState,
  activePractitionerCount: number,
  supporterCount: number,
  sponsorCount: number,
  energyBalance: number,
): boolean => {
  if (entity.kind === "sect") {
    return activePractitionerCount >= 2
      || (activePractitionerCount >= 1 && supporterCount >= 4 && sponsorCount >= 1 && energyBalance >= 0.04);
  }
  if (entity.kind === "cultivation-path") {
    return activePractitionerCount >= 1 || supporterCount >= 4 || sponsorCount >= 1;
  }
  return supporterCount >= 2 || sponsorCount >= 1 || energyBalance >= 0.08;
};

export const reconcileWorldviewLifecycle = (state: WorldState): WorldEventDraft[] => {
  if (state.worldview.entities.length === 0) return [];

  const nextTick = nextSimulationTick(state);
  const nextStep = nextSimulationStep(state);
  const agentIds = new Set(state.agents.map((agent) => agent.id));
  const activeOrganizations = new Map(
    state.organizations
      .filter((organization) => organization.status === "active")
      .map((organization) => [organization.id, organization]),
  );
  const agentsByRegion = new Map<string, WorldState["agents"]>();
  for (const agent of state.agents) {
    const agents = agentsByRegion.get(agent.regionId) ?? [];
    agents.push(agent);
    agentsByRegion.set(agent.regionId, agents);
  }
  const culturesByRegion = new Map(state.cultures.map((culture) => [culture.regionId, culture]));
  const practicesByKey = new Map<string, WorldviewPracticeState[]>();
  for (const practice of state.worldview.practices) {
    for (const key of [
      practiceKey(practice.packId, practice.regionId),
      practiceKey(practice.packId, practice.regionId, practice.phenomenonId),
    ]) {
      const practices = practicesByKey.get(key) ?? [];
      practices.push(practice);
      practicesByKey.set(key, practices);
    }
  }
  const resourcesByHolder = new Map<string, WorldState["resources"]>();
  for (const resource of state.resources) {
    if (!resource.holderId) continue;
    const resources = resourcesByHolder.get(resource.holderId) ?? [];
    resources.push(resource);
    resourcesByHolder.set(resource.holderId, resources);
  }

  const events: WorldEventDraft[] = [];
  state.worldview.entities = state.worldview.entities.map((entity) => {
    const relevantPractices = entity.kind === "cultivation-path"
      ? practicesByKey.get(practiceKey(entity.packId, entity.regionId)) ?? []
      : entity.sourcePhenomenonId
        ? practicesByKey.get(practiceKey(entity.packId, entity.regionId, entity.sourcePhenomenonId)) ?? []
        : [];
    const livingPractices = relevantPractices.filter((practice) => practice.status !== "failed" && agentIds.has(practice.practitionerId));
    const activePractices = livingPractices.filter((practice) => practice.status === "active");
    const memberIds = entity.kind === "sect"
      ? [...new Set(livingPractices.map((practice) => practice.practitionerId))].sort()
      : [...new Set([...(entity.memberIds ?? []).filter((memberId) => agentIds.has(memberId)), ...livingPractices.map((practice) => practice.practitionerId)])].sort();

    const sponsorIds = new Set(
      [entity.sponsorOrganizationId, ...livingPractices.map((practice) => practice.organizationId)]
        .filter((organizationId): organizationId is NonNullable<typeof organizationId> => Boolean(organizationId && activeOrganizations.has(organizationId))),
    );
    const sponsorOrganizationId = entity.sponsorOrganizationId && sponsorIds.has(entity.sponsorOrganizationId)
      ? entity.sponsorOrganizationId
      : [...sponsorIds].sort()[0];

    const localAgents = agentsByRegion.get(entity.regionId) ?? [];
    const culture = culturesByRegion.get(entity.regionId);
    const beliefId = entity.sourcePhenomenonId ? `belief:${entity.sourcePhenomenonId}` : undefined;
    const supporterCount = beliefId
      ? culture?.beliefIds.includes(beliefId) ? localAgents.length : 0
      : localAgents.length;

    const packResourceIds = new Set([
      ...(getWorldviewPack(entity.packId)?.resources.map((resource) => resource.id) ?? []),
      "attunement-energy",
    ]);
    const holderIds = new Set<string>([...memberIds, ...sponsorIds]);
    const resourceBalances: Record<string, number> = {};
    for (const holderId of holderIds) {
      for (const resource of resourcesByHolder.get(holderId) ?? []) {
        if (!packResourceIds.has(resource.resourceId)) continue;
        resourceBalances[resource.resourceId] = (resourceBalances[resource.resourceId] ?? 0) + resource.amount;
      }
    }
    const energyBalance = Object.values(resourceBalances).reduce((sum, amount) => sum + amount, 0);
    const supportScore = clamp(supporterCount / 8);
    const practiceScore = clamp(activePractices.length / 2);
    const sponsorScore = clamp(sponsorIds.size / 2);
    const energyScore = clamp(energyBalance / 0.2);
    const viability = clamp(
      entity.kind === "sect"
        ? practiceScore * 0.45 + supportScore * 0.2 + sponsorScore * 0.2 + energyScore * 0.15
        : entity.kind === "cultivation-path"
          ? practiceScore * 0.35 + supportScore * 0.35 + sponsorScore * 0.15 + energyScore * 0.15
          : supportScore * 0.55 + sponsorScore * 0.25 + energyScore * 0.2,
    );
    const previousStatus = entity.status ?? "active";
    const status = activeFor(entity, activePractices.length, supporterCount, sponsorIds.size, energyBalance)
      ? "active"
      : "dormant";
    const influenceTarget = status === "active" ? viability : viability * 0.45;
    const influence = clamp(entity.influence * 0.7 + influenceTarget * 0.3);
    const changed = status !== previousStatus;
    const revived = changed && status === "active";
    const next: WorldviewEntityState = {
      ...entity,
      memberIds,
      influence,
      resourceBalances,
      status,
      supporterCount,
      activePractitionerCount: activePractices.length,
      sponsorCount: sponsorIds.size,
      viability,
      lastStatusChangeTick: changed ? nextTick : (entity.lastStatusChangeTick ?? entity.originTick ?? nextTick),
      lastStatusChangeTimelineStep: changed ? nextStep : (entity.lastStatusChangeTimelineStep ?? entity.originTimelineStep ?? nextStep),
      ...(status === "active" ? { lastActiveTick: nextTick, lastActiveTimelineStep: nextStep } : entity.lastActiveTick === undefined ? {} : { lastActiveTick: entity.lastActiveTick }),
      ...(status === "dormant" ? { dormantSinceTick: changed ? nextTick : (entity.dormantSinceTick ?? nextTick), dormantSinceTimelineStep: changed ? nextStep : (entity.dormantSinceTimelineStep ?? nextStep) } : {}),
      revivalCount: addPersistentTotal(entity.revivalCount ?? 0, revived ? 1 : 0),
      ...(sponsorOrganizationId ? { sponsorOrganizationId } : {}),
    };
    if (!sponsorOrganizationId) delete next.sponsorOrganizationId;
    if (changed) events.push(lifecycleEvent(next, previousStatus, status, nextTick));
    return next;
  });
  const entitiesById = new Map(state.worldview.entities.map((entity) => [entity.id, entity]));
  state.worldview.interactions = state.worldview.interactions
    .filter((interaction) => entitiesById.has(interaction.sourceEntityId) && entitiesById.has(interaction.targetEntityId))
    .map((interaction) => {
      if (interaction.kind === "fusion") return interaction.fusionEntityId && entitiesById.has(interaction.fusionEntityId)
        ? { ...interaction, status: "resolved" as const }
        : { ...interaction, status: "dormant" as const };
      const source = entitiesById.get(interaction.sourceEntityId);
      const target = entitiesById.get(interaction.targetEntityId);
      return {
        ...interaction,
        status: source?.status === "active" && target?.status === "active" ? "active" as const : "dormant" as const,
      };
    });
  return events;
};
