import { forkRandom, randomFloat } from "../random.ts";
import type { ResourceTransaction, RuleApplicationContext, RuleDecision, WorldState, WorldviewContext, WorldviewDelta, WorldviewEffect, WorldviewEntityState } from "../types.ts";
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
  if (effect.kind === "interact-entities") return [effect.sourceEntityId, effect.targetEntityId];
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

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const MAX_INTERACTIONS_PER_STEP = 4;
const MAX_INTERACTION_CANDIDATES = 128;

const pairCompatibility = (source: WorldviewEntityState, target: WorldviewEntityState, localPopulation: number): number => {
  const kindAffinity = source.kind === target.kind
    ? 0.82
    : source.kind === "cultivation-path" || target.kind === "cultivation-path"
      ? 0.62
      : 0.48;
  const influenceAffinity = 1 - Math.abs(source.influence - target.influence);
  const populationContact = clamp(localPopulation / 24);
  return clamp(kindAffinity * 0.5 + influenceAffinity * 0.25 + populationContact * 0.25);
};

const interactionCandidates = (state: WorldviewContext["state"]): Array<[WorldviewEntityState, WorldviewEntityState]> => {
  const entities = state.worldview.entities
    .filter((entity) => entity.status === "active" && !entity.derivedFromEntityIds?.length)
    .sort((left, right) => right.influence - left.influence || left.id.localeCompare(right.id))
    .slice(0, MAX_INTERACTION_CANDIDATES);
  const agentsByRegion = new Map<string, number>();
  for (const population of state.populations) agentsByRegion.set(population.regionId, (agentsByRegion.get(population.regionId) ?? 0) + population.count);
  const byRegion = new Map<string, WorldviewEntityState[]>();
  for (const entity of entities) {
    const regionEntities = byRegion.get(entity.regionId) ?? [];
    if (regionEntities.length < 8) regionEntities.push(entity);
    byRegion.set(entity.regionId, regionEntities);
  }
  const candidates: Array<[WorldviewEntityState, WorldviewEntityState]> = [];
  for (const [regionId, regionEntities] of [...byRegion.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const localPopulation = agentsByRegion.get(regionId) ?? 0;
    for (let sourceIndex = 0; sourceIndex < regionEntities.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < regionEntities.length; targetIndex += 1) {
        const source = regionEntities[sourceIndex]!;
        const target = regionEntities[targetIndex]!;
        if (source.packId === target.packId) continue;
        const ordered = source.id.localeCompare(target.id) <= 0 ? [source, target] as const : [target, source] as const;
        const sourceEntity = ordered[0];
        const targetEntity = ordered[1];
        const compatibility = pairCompatibility(sourceEntity, targetEntity, localPopulation);
        if (compatibility > 0) candidates.push([sourceEntity, targetEntity]);
      }
    }
  }
  return candidates;
};

const interactionFor = (state: WorldviewContext["state"], context: WorldviewContext, source: WorldviewEntityState, target: WorldviewEntityState): { effect: Extract<WorldviewEffect, { kind: "interact-entities" }>; roll: number } | undefined => {
  const localPopulation = state.populations.filter((population) => population.regionId === source.regionId).reduce((sum, population) => sum + population.count, 0);
  const compatibility = pairCompatibility(source, target, localPopulation);
  const contact = clamp(localPopulation / 24);
  const probability = clamp(0.025 + contact * 0.04 + Math.min(source.influence, target.influence) * 0.025);
  const [roll] = randomFloat(forkRandom(context.random, `worldview:interaction:${source.id}:${target.id}`));
  if (roll >= probability) return undefined;
  const [kindRoll] = randomFloat(forkRandom(context.random, `worldview:interaction-kind:${source.id}:${target.id}`));
  const interaction = compatibility >= 0.72 && kindRoll < 0.42
    ? "fusion"
    : compatibility >= 0.48 && kindRoll < 0.72
      ? "propagation"
      : "conflict";
  return {
    roll,
    effect: {
      kind: "interact-entities",
      packId: source.packId,
      interaction,
      sourceEntityId: source.id,
      targetEntityId: target.id,
      regionId: source.regionId,
      probability,
      compatibility,
      intensity: clamp(0.35 + (1 - compatibility) * 0.45 + roll * 0.2),
      evidence: {
        eligible: true,
        sourcePackId: source.packId,
        targetPackId: target.packId,
        localPopulation,
        compatibility,
        contact,
      },
    },
  };
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
  const enabledPacks = new Set(context.enabledPackIds);
  let interactionCount = 0;
  for (const [source, target] of interactionCandidates(context.state)) {
    if (interactionCount >= MAX_INTERACTIONS_PER_STEP) break;
    if (!enabledPacks.has(source.packId) || !enabledPacks.has(target.packId)) continue;
    const result = interactionFor(context.state, context, source, target);
    if (!result) continue;
    const { effect, roll } = result;
    delta.worldviewEffects.push(effect);
    delta.eventDrafts.push({
      kind: `worldview-cross-pack-${effect.interaction}`,
      ruleId: `worldview:cross-pack-${effect.interaction}`,
      sourceIds: sourceIdsFor(effect),
      probability: effect.probability,
      roll,
      evidence: { ...effect.evidence },
      payload: {
        interaction: effect.interaction,
        sourceEntityId: effect.sourceEntityId,
        targetEntityId: effect.targetEntityId,
        sourcePackId: source.packId,
        targetPackId: target.packId,
        regionId: effect.regionId,
        compatibility: effect.compatibility,
        intensity: effect.intensity,
      },
      source: "natural",
    });
    interactionCount += 1;
  }
  return delta;
};
