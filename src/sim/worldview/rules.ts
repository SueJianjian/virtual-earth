import { evaluatePredicates } from "../events/rules.ts";
import type { RegionId, RuleApplicationContext, RuleContext, StatePredicate, WorldviewEffect, WorldviewRule, WorldviewDelta } from "../types.ts";

const emptyDelta = (): WorldviewDelta => ({ worldviewEffects: [], resourceTransactions: [], eventDrafts: [] });

const regionWithHighestScore = (scores: Map<string, number>): RegionId | undefined => {
  const ranked = [...scores.entries()].sort(([leftId, leftScore], [rightId, rightScore]) =>
    rightScore - leftScore || leftId.localeCompare(rightId));
  return ranked[0]?.[0] as RegionId | undefined;
};

export const regionIdForWorldview = (context: RuleContext): RegionId => {
  if (context.regionId) return context.regionId;

  const populationScores = new Map<string, number>();
  for (const population of context.state.populations) {
    populationScores.set(population.regionId, (populationScores.get(population.regionId) ?? 0) + population.count);
  }
  const populationRegion = regionWithHighestScore(populationScores);
  if (populationRegion) return populationRegion;

  const agentScores = new Map<string, number>();
  for (const agent of context.state.agents) {
    agentScores.set(agent.regionId, (agentScores.get(agent.regionId) ?? 0) + 1);
  }
  const agentRegion = regionWithHighestScore(agentScores);
  if (agentRegion) return agentRegion;

  const organizationScores = new Map<string, number>();
  for (const organization of context.state.organizations) {
    organizationScores.set(organization.regionId, (organizationScores.get(organization.regionId) ?? 0) + organization.memberIds.length);
  }
  const organizationRegion = regionWithHighestScore(organizationScores);
  if (organizationRegion) return organizationRegion;

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const width = context.state.fields.biomass.width;
  for (let index = 0; index < context.state.fields.biomass.values.length; index += 1) {
    const score = (context.state.fields.biomass.values[index] ?? 0) + (context.state.fields.water.values[index] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return `region:${bestIndex % width}:${Math.floor(bestIndex / width)}` as RegionId;
};

export const ruleFromPredicates = (
  id: string,
  predicates: StatePredicate[],
  probability: number,
  effect: (context: RuleApplicationContext, evidence: Record<string, number | string | boolean>) => WorldviewEffect,
): WorldviewRule => ({
  id,
  predicates,
  evaluate: (context) => {
    const decision = evaluatePredicates(predicates, context);
    return { ...decision, probability: decision.eligible ? probability : 0 };
  },
  apply: (context) => {
    const decision = evaluatePredicates(predicates, context);
    if (!decision.eligible) return { status: "skipped", delta: emptyDelta() };
    return { status: "applied", value: effect(context, { ...decision.evidence, eligible: true }), delta: emptyDelta() };
  },
});
