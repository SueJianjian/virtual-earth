import type { SimulationStage } from "../types.ts";
import { stepCulture } from "./step.ts";

export { applyCultureDelta, stepCulture } from "./step.ts";
export { createKnowledge, knowledgeIdFor, knowledgeKindsFor } from "./knowledge.ts";
export { attemptKnowledgeDiffusion, attemptKnowledgeInnovation, knowledgeDiffusionRoutes } from "./innovation.ts";
export { createCultureIdentity, cultureIdentityFor, culturalCompatibility, ensureCultureIdentity, evolveCultureIdentity } from "./identity.ts";
export { compactCultureRecords, compactKnowledgeRecords, MAX_BELIEFS_PER_CULTURE, MAX_CULTURE_RECORDS, MAX_KNOWLEDGE_PER_AGENT, MAX_KNOWLEDGE_PER_CULTURE, MAX_KNOWLEDGE_RECORDS } from "./archive.ts";
export { technologyAdoptionKey, technologyDomainLabels, technologyDomainLevels, technologyProfileForRegion, technologyProfilesForState } from "./technology.ts";

export const cultureStage: SimulationStage = {
  id: "culture",
  order: 40,
  run: (state, _input, priorDeltas) => stepCulture(state, priorDeltas.get("agents") ?? {
    fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
    resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
  }),
};
