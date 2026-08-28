import { hashString } from "../random.ts";
import type { HotspotReason, RegionId, WorldDelta, WorldState } from "../types.ts";
import { MAX_DETAILED_AGENTS } from "../agents/lifecycle.ts";
import { projectRegion } from "./expand.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });

export const promoteRegion = (
  state: WorldState,
  regionId: RegionId,
  reason: Exclude<HotspotReason, "user-focus">,
  maximumNewAgents = MAX_DETAILED_AGENTS,
): WorldDelta => {
  const delta = emptyDelta();
  const summary = state.lod.summaries.find((candidate) => candidate.regionId === regionId && candidate.mode === "aggregate");
  if (!summary || state.agents.some((agent) => agent.regionId === regionId)) return delta;
  const availableAgentSlots = Math.max(0, Math.min(maximumNewAgents, MAX_DETAILED_AGENTS - state.agents.length));
  if (availableAgentSlots === 0) return delta;
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  const backingPopulation = [...state.populations]
    .filter((population) => population.regionId === regionId && population.count > 0)
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))[0];
  const backingSpecies = backingPopulation
    ? speciesById.get(backingPopulation.speciesId)
    : state.species.filter((species) => species.role === "consumer").sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!backingPopulation && !backingSpecies) return delta;
  const populationId = backingPopulation?.id ?? `population:lod:${hashString(`${state.seed}:${regionId}`).toString(16)}` as WorldState["populations"][number]["id"];
  if (!backingPopulation && backingSpecies) {
    delta.entityEffects.push({
      collection: "populations",
      operation: "create",
      id: populationId,
      value: {
        id: populationId,
        speciesId: backingSpecies.id,
        regionId,
        count: Math.max(1, summary.population),
        energy: Math.max(0, Math.min(1, summary.foodSecurity)),
      },
    });
  }
  const projection = projectRegion(summary, summary.version, availableAgentSlots, summary.versionStep, populationId);
  for (const agent of projection.agents) delta.entityEffects.push({ collection: "agents", operation: "create", id: agent.id, value: agent });
  for (const relationship of projection.relationships) delta.relationshipEffects.push({ operation: "create", relationship });
  for (const organization of projection.organizations) delta.entityEffects.push({ collection: "organizations", operation: "create", id: organization.id, value: organization });
  delta.lodEffects = [{
    operation: "upsert-summary",
    summary: {
      ...summary,
      mode: "micro",
      version: summary.version + 1,
      ...(summary.versionStep === undefined ? {} : { versionStep: summary.versionStep }),
    },
  }];
  delta.eventDrafts.push({ kind: "region-promoted", ruleId: "natural-hotspot", sourceIds: [], probability: 1, roll: 0, evidence: { reason, population: summary.population }, payload: { regionId, generatedFromDigest: summary.canonicalDigest }, source: "natural" });
  return delta;
};
