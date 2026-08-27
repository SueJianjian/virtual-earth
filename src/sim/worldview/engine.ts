import { forkRandom, randomFloat } from "../random.ts";
import type { ResourceTransaction, RuleApplicationContext, RuleDecision, WorldState, WorldviewContext, WorldviewDelta, WorldviewEffect } from "../types.ts";
import { getWorldviewPack } from "./registry.ts";

const emptyDelta = (): WorldviewDelta => ({ worldviewEffects: [], resourceTransactions: [], eventDrafts: [] });

const appendItems = <T>(target: T[], source: readonly T[]): void => {
  for (const item of source) target.push(item);
};

const sourceIdsFor = (effect: WorldviewEffect): string[] => {
  if (effect.kind === "record-phenomenon") return [...effect.parentIds];
  if (effect.kind === "propagate-belief") return [...effect.sourceIds];
  if (effect.kind === "begin-practice") return [effect.practitionerId, ...(effect.teacherId ? [effect.teacherId] : []), ...(effect.organizationId ? [effect.organizationId] : [])];
  if (effect.kind === "train-practice") return [effect.practiceId, ...(effect.organizationId ? [effect.organizationId] : [])];
  if (effect.kind === "propose-entity") return [...(effect.memberIds ?? []), ...(effect.founderId ? [effect.founderId] : []), ...(effect.sponsorOrganizationId ? [effect.sponsorOrganizationId] : [])];
  return [];
};

const energyTransactionsFor = (effect: WorldviewEffect, state: Pick<WorldState, "worldview">, stepKey: number): ResourceTransaction[] => {
  if (effect.kind === "begin-practice") {
    const holderId = effect.resourceHolderId ?? effect.organizationId ?? effect.practitionerId;
    return [{
      id: `resource:attunement:begin:${stepKey}:${effect.practitionerId}:${effect.phenomenonId}`,
      resourceId: "attunement-energy",
      regionId: effect.regionId,
      amount: 0.18,
      operation: "mint",
      source: "worldview",
      sourceId: effect.practitionerId,
      toHolderId: holderId,
      causeRuleId: "worldview:practice-entry-energy",
    }];
  }
  if (effect.kind !== "train-practice" || !effect.resourceId || !effect.resourceHolderId) return [];
  const practice = state.worldview.practices.find((candidate) => candidate.id === effect.practiceId);
  if (!practice) return [];
  const minted = Math.max(0, effect.resourceMinted ?? 0);
  const consumed = Math.max(0, effect.resourceConsumed ?? 0);
  const transactions: ResourceTransaction[] = [];
  if (minted > 0) {
    transactions.push({
      id: `resource:${effect.resourceId}:ambient:${stepKey}:${effect.practiceId}`,
      resourceId: effect.resourceId,
      regionId: practice.regionId,
      amount: minted,
      operation: "mint",
      source: "worldview",
      sourceId: effect.practiceId,
      toHolderId: effect.resourceHolderId,
      causeRuleId: "worldview:practice-ambient-energy",
    });
  }
  if (consumed > 0) {
    transactions.push({
      id: `resource:${effect.resourceId}:training:${stepKey}:${effect.practiceId}`,
      resourceId: effect.resourceId,
      regionId: practice.regionId,
      amount: consumed,
      operation: "consume",
      source: "worldview",
      sourceId: effect.practiceId,
      fromHolderId: effect.resourceHolderId,
      causeRuleId: "worldview:practice-energy-consumption",
    });
  }
  return transactions;
};

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
      appendItems(delta.resourceTransactions, energyTransactionsFor(effect, context.state, context.random.value));
      delta.eventDrafts.push({
        kind: `worldview-${rule.id}`,
        ruleId: rule.id,
        sourceIds: sourceIdsFor(effect),
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
          } : effect.kind === "propagate-belief" ? {
            beliefId: effect.beliefId,
            regionId: effect.regionId,
            sourceIds: effect.sourceIds,
            strength: effect.strength,
          } : effect.kind === "begin-practice" ? {
            name: effect.name,
            practiceOrigin: effect.teacherId ? "transmission" : "self-discovery",
            practitionerId: effect.practitionerId,
            regionId: effect.regionId,
            organizationId: effect.organizationId ?? null,
          } : effect.kind === "train-practice" ? {
            practiceId: effect.practiceId,
            outcome: effect.outcome,
            energySpent: effect.energySpent,
            energyGain: effect.energyGain,
            resourceId: effect.resourceId ?? null,
            resourceMinted: effect.resourceMinted ?? 0,
            resourceConsumed: effect.resourceConsumed ?? 0,
            organizationId: effect.organizationId ?? null,
          } : effect.kind === "propose-entity" ? {
            name: effect.name ?? null,
            entityKind: effect.entityKind,
            regionId: effect.regionId,
            founderId: effect.founderId ?? null,
            memberCount: effect.memberIds?.length ?? 0,
            sourcePhenomenonId: effect.sourcePhenomenonId ?? null,
            sponsorOrganizationId: effect.sponsorOrganizationId ?? null,
          } : {}),
        },
        source: "natural",
      });
    }
  }
  return delta;
};
