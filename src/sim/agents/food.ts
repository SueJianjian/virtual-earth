import type { AgentState, OrganizationState, RegionId, WorldState } from "../types.ts";

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

export const foodSecurityFromBalance = (balance: number, populationCount: number): number =>
  clamp(balance * 2 / Math.max(1, populationCount));

export const foodBalanceFor = (
  state: Pick<WorldState, "resources">,
  regionId: RegionId,
  holderId?: string,
): number => state.resources
  .filter((resource) => resource.resourceId === "food" && resource.regionId === regionId && resource.holderId === holderId)
  .reduce((sum, resource) => sum + resource.amount, 0);

export const foodSecurityForOrganization = (
  state: Pick<WorldState, "resources">,
  organization: Pick<OrganizationState, "id" | "regionId" | "memberIds">,
): number => clamp(foodBalanceFor(state, organization.regionId, organization.id) * 2 / Math.max(1, organization.memberIds.length));

export const foodSecurityForRegion = (
  state: Pick<WorldState, "resources">,
  regionId: RegionId,
  populationCount: number,
): number => foodSecurityFromBalance(foodBalanceFor(state, regionId), populationCount);

export const foodPerCapitaForAgent = (state: Pick<WorldState, "resources" | "organizations">, agent: AgentState): number => {
  const sources = state.organizations
    .filter((organization) => organization.status === "active" && organization.regionId === agent.regionId && organization.memberIds.includes(agent.id))
    .map((organization) => foodBalanceFor(state, agent.regionId, organization.id) / Math.max(1, organization.memberIds.length));
  return Math.max(0, ...sources);
};

export const foodSecurityForAgent = (state: Pick<WorldState, "resources" | "organizations">, agent: AgentState): number =>
  clamp(foodPerCapitaForAgent(state, agent) * 2);

export const meanFoodSecurity = (state: Pick<WorldState, "resources" | "organizations" | "agents">): number => {
  if (state.agents.length === 0) return 0;
  return state.agents.reduce((sum, agent) => sum + foodSecurityForAgent(state, agent), 0) / state.agents.length;
};
