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
  state: Pick<WorldState, "resources" | "fields">,
  organization: Pick<OrganizationState, "id" | "regionId" | "memberIds">,
): number => {
  const ledgerSecurity = clamp(foodBalanceFor(state, organization.regionId, organization.id) * 2 / Math.max(1, organization.memberIds.length));
  const match = /^region:(\d+):(\d+)$/.exec(organization.regionId);
  if (!match) return ledgerSecurity;
  const x = Math.max(0, Math.min(state.fields.biomass.width - 1, Number(match[1] ?? 0)));
  const y = Math.max(0, Math.min(state.fields.biomass.height - 1, Number(match[2] ?? 0)));
  const index = y * state.fields.biomass.width + x;
  const ecosystemSecurity = clamp(
    (state.fields.biomass.values[index] ?? 0) * 24
    + (state.fields.nutrients.values[index] ?? 0) * 0.06,
  );
  return Math.max(ledgerSecurity, ecosystemSecurity);
};

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
