import type { AgentState, FoodBalanceIndex, OrganizationState, RegionId, WorldState } from "../types.ts";

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

const entryKey = (regionId: string, holderId?: string): string => `${regionId}|${holderId ?? "world"}`;

export const createFoodBalanceIndex = (
  state: Pick<WorldState, "resources" | "organizations">,
): FoodBalanceIndex => {
  const byEntry = new Map<string, number>();
  const byRegion = new Map<string, number>();
  for (const resource of state.resources) {
    if (resource.resourceId !== "food") continue;
    const key = entryKey(resource.regionId, resource.holderId);
    byEntry.set(key, (byEntry.get(key) ?? 0) + resource.amount);
    byRegion.set(resource.regionId, (byRegion.get(resource.regionId) ?? 0) + resource.amount);
  }
  const byAgent = new Map<string, number>();
  for (const organization of state.organizations) {
    if (organization.status !== "active") continue;
    const perCapita = (byEntry.get(entryKey(organization.regionId, organization.id)) ?? 0)
      / Math.max(1, organization.memberIds.length);
    if (perCapita <= 0) continue;
    for (const memberId of organization.memberIds) {
      byAgent.set(memberId, Math.max(byAgent.get(memberId) ?? 0, perCapita));
    }
  }
  return { byEntry, byRegion, byAgent };
};

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
  foodIndex?: FoodBalanceIndex,
): number => {
  const ledgerBalance = foodIndex?.byEntry.get(entryKey(organization.regionId, organization.id))
    ?? foodBalanceFor(state, organization.regionId, organization.id);
  const ledgerSecurity = clamp(ledgerBalance * 2 / Math.max(1, organization.memberIds.length));
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
  foodIndex?: FoodBalanceIndex,
): number => foodSecurityFromBalance(foodIndex?.byRegion.get(regionId) ?? foodBalanceFor(state, regionId), populationCount);

export const foodPerCapitaForAgent = (
  state: Pick<WorldState, "resources" | "organizations">,
  agent: AgentState,
  foodIndex?: FoodBalanceIndex,
): number => {
  if (foodIndex) return foodIndex.byAgent.get(agent.id) ?? 0;
  const sources = state.organizations
    .filter((organization) => organization.status === "active" && organization.regionId === agent.regionId && organization.memberIds.includes(agent.id))
    .map((organization) => foodBalanceFor(state, agent.regionId, organization.id) / Math.max(1, organization.memberIds.length));
  return Math.max(0, ...sources);
};

export const foodSecurityForAgent = (
  state: Pick<WorldState, "resources" | "organizations">,
  agent: AgentState,
  foodIndex?: FoodBalanceIndex,
): number => clamp(foodPerCapitaForAgent(state, agent, foodIndex) * 2);

export const meanFoodSecurity = (
  state: Pick<WorldState, "resources" | "organizations" | "agents">,
  suppliedIndex?: FoodBalanceIndex,
): number => {
  if (state.agents.length === 0) return 0;
  const foodIndex = suppliedIndex ?? createFoodBalanceIndex(state);
  return state.agents.reduce((sum, agent) => sum + foodSecurityForAgent(state, agent, foodIndex), 0) / state.agents.length;
};
