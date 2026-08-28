import type { SimulationStage } from "../types.ts";
import { stepAgents } from "./lifecycle.ts";

export { compactAgentMemoryRecords, compactRelationshipRecords, createAgent, eligibleAgentCount, MAX_AGENT_MEMORY_IDS, MAX_DETAILED_AGENTS, MAX_RELATIONSHIP_RECORDS, MAX_RELATIONSHIPS_PER_AGENT, stepAgents } from "./lifecycle.ts";
export { createFoodBalanceIndex, foodBalanceFor, foodPerCapitaForAgent, foodSecurityForAgent, foodSecurityForOrganization, foodSecurityForRegion, foodSecurityFromBalance, meanFoodSecurity } from "./food.ts";
export { createFamily, createFamilyIfEligible, createRelationship, familyIdFor, relationshipIdFor } from "./relationships.ts";
export { founderGenetics, founderHeritableTraits, geneticEnvironmentFitness, HERITABLE_AGENT_TRAITS, inheritAgentGenetics, normalizeAgentGenetics, normalizeGeneticRecord, summarizePopulationGenetics, validAgentGenetics } from "./genetics.ts";

export const agentsStage: SimulationStage = {
  id: "agents",
  order: 30,
  run: (state, input, priorDeltas) => stepAgents(state, priorDeltas.get("ecology") ?? {
    fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
    resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
  }, input.elapsedYears),
};
