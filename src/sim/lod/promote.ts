import { hashString } from "../random.ts";
import type { HotspotReason, RegionId, WorldDelta, WorldState } from "../types.ts";
import { projectRegion } from "./expand.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

export const promoteRegion = (state: WorldState, regionId: RegionId, reason: Exclude<HotspotReason, "user-focus">): WorldDelta => {
  const delta = emptyDelta();
  const summary = state.lod.summaries.find((candidate) => candidate.regionId === regionId && candidate.mode === "aggregate");
  if (!summary || state.agents.some((agent) => agent.regionId === regionId)) return delta;
  const projection = projectRegion(summary, summary.version);
  for (const agent of projection.agents) delta.entityEffects.push({ collection: "agents", operation: "create", id: agent.id, value: agent });
  for (const relationship of projection.relationships) delta.relationshipEffects.push({ operation: "create", relationship });
  for (const organization of projection.organizations) delta.entityEffects.push({ collection: "organizations", operation: "create", id: organization.id, value: organization });
  delta.lodEffects = [{ operation: "upsert-summary", summary: { ...summary, mode: "micro", version: summary.version + 1 } }];
  delta.eventDrafts.push({ kind: "region-promoted", ruleId: "natural-hotspot", sourceIds: [], probability: 1, roll: 0, evidence: { reason, population: summary.population }, payload: { regionId, generatedFromDigest: summary.canonicalDigest }, source: "natural" });
  return delta;
};
