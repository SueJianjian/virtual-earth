import type { SimulationStage } from "../types.ts";
import { stepSociety } from "./step.ts";

export { createOrganization, minimumMembersFor, organizationCapacity, organizationIdFor } from "./organization.ts";
export { attemptOrganizationFormation } from "./formation.ts";
export { applyOrganizationConflict, governOrganization } from "./governance.ts";
export { stepSociety } from "./step.ts";

export const societyStage: SimulationStage = {
  id: "society",
  order: 50,
  run: (state, _input, priorDeltas) => stepSociety(
    state,
    priorDeltas.get("culture") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
    priorDeltas.get("agents") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
  ),
};
