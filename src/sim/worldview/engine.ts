import { forkRandom, randomFloat } from "../random.ts";
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
      const [roll] = randomFloat(forkRandom(context.random, `worldview:${pack.id}:${rule.id}`));
      if (roll >= decision.probability) continue;
      const outcome = rule.apply(context as RuleApplicationContext);
      if (outcome.status !== "applied" || !outcome.value) continue;
      const effect = outcome.value as WorldviewEffect;
      delta.worldviewEffects.push(effect);
      delta.eventDrafts.push({
        kind: `worldview-${rule.id}`,
        ruleId: rule.id,
        sourceIds: effect.kind === "record-phenomenon" ? effect.parentIds : [],
        probability: decision.probability,
        roll,
        evidence: { ...decision.evidence, eligible: true, packId },
        payload: {
          packId,
          ruleId: rule.id,
          ...(effect.kind === "record-phenomenon" ? {
            name: effect.name,
            phenomenonKind: effect.phenomenonKind,
            epistemicStatus: effect.epistemicStatus,
            regionId: effect.regionId,
          } : effect.kind === "begin-practice" ? {
            name: effect.name,
            practiceOrigin: effect.teacherId ? "transmission" : "self-discovery",
            practitionerId: effect.practitionerId,
            regionId: effect.regionId,
          } : effect.kind === "train-practice" ? {
            practiceId: effect.practiceId,
            outcome: effect.outcome,
            energySpent: effect.energySpent,
            energyGain: effect.energyGain,
          } : {}),
        },
        source: "natural",
      });
    }
  }
  return delta;
};
