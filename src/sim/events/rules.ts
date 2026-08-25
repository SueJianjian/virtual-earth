import type {
  EmergenceRule,
  RuleContext,
  RuleDecision,
  StatePredicate,
} from "../types.ts";

const compare = (actual: number, predicate: StatePredicate): boolean => {
  if (predicate.operator === ">=") return actual >= predicate.value;
  if (predicate.operator === "<=") return actual <= predicate.value;
  return actual === predicate.value;
};

export const evaluatePredicates = (
  predicates: StatePredicate[],
  context: RuleContext,
): RuleDecision => {
  const evidence: Record<string, number | string | boolean> = {};
  let eligible = true;
  for (const predicate of predicates) {
    const actual = context.metrics[predicate.metric];
    evidence[`${predicate.subject}.${predicate.metric}`] = actual;
    if (!compare(actual, predicate)) eligible = false;
  }
  return {
    eligible,
    probability: eligible ? 1 : 0,
    evidence,
    reason: eligible ? "all predicates satisfied" : "predicate not satisfied",
  };
};

export const makeRule = (
  id: string,
  predicates: StatePredicate[],
  evaluate: (context: RuleContext) => RuleDecision,
  apply: EmergenceRule["apply"],
): EmergenceRule => ({ id, predicates, evaluate, apply });
