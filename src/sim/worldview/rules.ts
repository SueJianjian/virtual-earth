import { evaluatePredicates } from "../events/rules.ts";
import type { RuleApplicationContext, StatePredicate, WorldviewEffect, WorldviewRule, WorldviewDelta } from "../types.ts";

const emptyDelta = (): WorldviewDelta => ({ worldviewEffects: [], resourceTransactions: [], eventDrafts: [] });

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
