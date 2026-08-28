import type { SimulationStage, WorldEvent, WorldEventDraft } from "../types.ts";
import { stepSociety } from "./step.ts";
import { nextSimulationStep, nextSimulationTick, projectedYearsAfterStep, simulationStepForWorld } from "../time.ts";

export { createOrganization, minimumMembersFor, organizationCapacity, organizationIdFor } from "./organization.ts";
export { attemptOrganizationFormation, createSocietyEligibilityIndex } from "./formation.ts";
export { applyOrganizationConflict, createGovernanceIndex, governOrganization } from "./governance.ts";
export { neighboringRegionIds, stepTerritories, territoriesTouch } from "./territory.ts";
export { stepSupplyChains, supplyTargetFor, type SupplyResourceId } from "./supply.ts";
export { compactFacilityRecords, facilityEffectProfileForRegion, facilityEffectProfilesForState, facilityIdFor, facilityOperationalEffect, facilityWorkforceRequiredFor, MAX_FACILITY_RECORDS, stepFacilities } from "./facilities.ts";
export { archiveOrganizationRecords, compactOrganizationRecords, isArchivedOrganizationSummary, retainArchivedOrganizationSummaries, MAX_ARCHIVED_ORGANIZATION_MEMBERS, MAX_ARCHIVED_ORGANIZATION_RESOURCES, MAX_ARCHIVED_ORGANIZATION_SUMMARIES, MAX_CHILD_ORGANIZATION_IDS, MAX_DIPLOMATIC_RELATIONS, MAX_ORGANIZATION_RECORDS, MAX_ORGANIZATION_TERRITORY_REGIONS, MAX_ORGANIZATIONS_PER_SUMMARY } from "./archive.ts";
export { stepSociety } from "./step.ts";

const eventFromDraft = (draft: WorldEventDraft, state: Parameters<SimulationStage["run"]>[0], input: Parameters<SimulationStage["run"]>[1], index: number): WorldEvent => ({
  id: `transient:${draft.ruleId}:${nextSimulationStep(state)}:${index}`,
  tick: nextSimulationTick(state),
  timelineStep: nextSimulationStep(state),
  ...(draft.years === undefined ? { years: projectedYearsAfterStep(state, input.elapsedYears) } : { years: draft.years }),
  kind: draft.kind,
  ruleId: draft.ruleId,
  ...(draft.position ? { position: draft.position } : {}),
  source: draft.source,
  sourceIds: [...draft.sourceIds],
  probability: draft.probability,
  roll: draft.roll,
  evidence: { ...draft.evidence },
  payload: { ...draft.payload },
});

export const societyStage: SimulationStage = {
  id: "society",
  order: 50,
  run: (state, input, priorDeltas) => {
    const environmentalIncidents = (priorDeltas.get("environment")?.eventDrafts ?? [])
      .filter((draft) => ["volcano", "earthquake", "drought", "flood"].includes(draft.kind))
      .map((draft, index) => eventFromDraft(draft, state, input, index));
    return stepSociety(
      state,
      priorDeltas.get("culture") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
      priorDeltas.get("agents") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
      priorDeltas.get("ecology") ?? { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] },
      [...input.externalEvents, ...environmentalIncidents],
    );
  },
};
