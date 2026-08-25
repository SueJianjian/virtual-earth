import type { SimulationStage } from "../types.ts";
import { stepCulture } from "./step.ts";

export { applyCultureDelta, stepCulture } from "./step.ts";
export { createKnowledge, knowledgeIdFor, knowledgeKindsFor } from "./knowledge.ts";

export const cultureStage: SimulationStage = {
  id: "culture",
  order: 40,
  run: (state, _input, priorDeltas) => stepCulture(state, priorDeltas.get("agents") ?? {
    fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
    resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
  }),
};
