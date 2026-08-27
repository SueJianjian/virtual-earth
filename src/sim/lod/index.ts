import type { SimulationStage } from "../types.ts";
import { stepLod } from "./step.ts";

export { focusRegion, projectMicroRegion } from "./focus.ts";
export { summarizeLineage } from "./lineage.ts";
export { projectRegion } from "./expand.ts";
export { promoteRegion } from "./promote.ts";
export { aggregatePopulationForRegion, refreshAggregateSummary, summarizeRegion, summarizeRegionState } from "./summarize.ts";
export { stepLod } from "./step.ts";

export const lodStage: SimulationStage = {
  id: "lod",
  order: 60,
  run: (state, input, priorDeltas) => stepLod(
    state,
    input,
    priorDeltas.get("culture") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
    priorDeltas.get("society") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
    priorDeltas.get("agents") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
    priorDeltas.get("ecology") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
  ),
};
