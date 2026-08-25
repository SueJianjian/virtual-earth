import { forkRandom, randomChance } from "../random.ts";
import type { RuleApplicationContext, RuleDecision, WorldState, WorldviewContext, WorldviewDelta, WorldviewEffect } from "../types.ts";
import { getWorldviewPack } from "./registry.ts";

const emptyDelta = (): WorldviewDelta => ({ worldviewEffects: [], resourceTransactions: [], eventDrafts: [] });

export const stepWorldviews = (_state: WorldState, context: WorldviewContext): WorldviewDelta => {
  const delta = emptyDelta();
  for (const packId of [...context.enabledPackIds].sort()) {
    const pack = getWorldviewPack(packId);
    if (!pack) continue;
    for (const rule of pack.rules) {
      const decision: RuleDecision = rule.evaluate(context);
      if (!decision.eligible || decision.probability <= 0) continue;
      const [accepted] = randomChance(forkRandom(context.random, `worldview:${pack.id}:${rule.id}`), decision.probability);
      if (!accepted) continue;
      const outcome = rule.apply(context as RuleApplicationContext);
      if (outcome.status !== "applied" || !outcome.value) continue;
      delta.worldviewEffects.push(outcome.value as WorldviewEffect);
      delta.eventDrafts.push({
        kind: `worldview-${rule.id}`,
        ruleId: rule.id,
        sourceIds: [],
        probability: decision.probability,
        roll: 0,
        evidence: { ...decision.evidence, eligible: true, packId },
        payload: { packId, ruleId: rule.id },
        source: "natural",
      });
    }
  }
  return delta;
};
