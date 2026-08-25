import type { AgentsDelta, CultureDelta, SocietyContext, SocietyDelta, WorldDelta, WorldState, OrganizationType } from "../types.ts";
import { attemptOrganizationFormation } from "./formation.ts";
import { governOrganization } from "./governance.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const agentsAfter = (state: WorldState, delta: WorldDelta): WorldState["agents"] => {
  const agents = new Map(state.agents.map((agent) => [agent.id, structuredClone(agent)]));
  for (const effect of delta.entityEffects) {
    if (effect.collection !== "agents") continue;
    if (effect.operation === "remove") agents.delete(effect.id);
    else if (effect.value) agents.set(effect.id, structuredClone(effect.value));
  }
  return [...agents.values()];
};

const merge = (target: WorldDelta, source: WorldDelta): void => {
  target.fieldChanges.push(...source.fieldChanges);
  target.chemistryChanges.push(...source.chemistryChanges);
  target.entityEffects.push(...source.entityEffects);
  target.relationshipEffects.push(...source.relationshipEffects);
  target.resourceTransactions.push(...source.resourceTransactions);
  target.worldviewEffects.push(...source.worldviewEffects);
  target.eventDrafts.push(...source.eventDrafts);
};

export const stepSociety = (state: WorldState, culture: CultureDelta, agents: AgentsDelta): SocietyDelta => {
  const delta = emptyDelta();
  const currentAgents = agentsAfter(state, agents);
  const regions = new Map<string, string[]>();
  for (const agent of currentAgents) {
    const ids = regions.get(agent.regionId) ?? [];
    ids.push(agent.id);
    regions.set(agent.regionId, ids);
  }
  const existing = new Set(state.organizations.map((organization) => `${organization.type}:${organization.regionId}`));
  const types: OrganizationType[] = ["clan", "tribe", "settlement", "city", "state", "federation", "empire"];
  for (const [regionId, memberIds] of [...regions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (const type of types) {
      if (existing.has(`${type}:${regionId}`)) continue;
      const context: SocietyContext = {
        state,
        random: state.random,
        metrics: {} as never,
        regionId: regionId as SocietyContext["regionId"],
        candidateMemberIds: [...memberIds].sort() as SocietyContext["candidateMemberIds"],
      };
      merge(delta, attemptOrganizationFormation(context, type).delta);
    }
  }
  for (const organization of state.organizations) merge(delta, governOrganization(state, organization));
  return delta;
};
