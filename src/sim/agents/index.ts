import type { SimulationStage } from "../types.ts";
import { stepAgents } from "./lifecycle.ts";

export { createAgent, eligibleAgentCount, stepAgents } from "./lifecycle.ts";
export { foodBalanceFor, foodPerCapitaForAgent, foodSecurityForAgent, foodSecurityForOrganization, foodSecurityForRegion, foodSecurityFromBalance, meanFoodSecurity } from "./food.ts";
export { createFamily, createFamilyIfEligible, createRelationship, familyIdFor, relationshipIdFor } from "./relationships.ts";

export const agentsStage: SimulationStage = {
  id: "agents",
  order: 30,
  run: (state, input, priorDeltas) => stepAgents(state, priorDeltas.get("ecology") ?? {
    fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
    resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
  }, input.elapsedYears),
};
