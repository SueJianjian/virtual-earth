import { forkRandom, randomFloat } from "../random.ts";
import type { ResourceTransaction, RuleApplicationContext, RuleDecision, WorldState, WorldviewContext, WorldviewDelta, WorldviewEffect, WorldviewEntityState } from "../types.ts";
import { getWorldviewPack } from "./registry.ts";
import { simulationStepDistance } from "../time.ts";

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
const MAX_CROSS_REGION_CONTACTS = 96;
const RECENT_CONTACT_WINDOW_STEPS = 64;

type InteractionRoute = "local" | "trade" | "alliance" | "migration" | "war";
type InteractionCandidate = {
  source: WorldviewEntityState;
  target: WorldviewEntityState;
  sourceRegionId: string;
  targetRegionId: string;
  contactStrength: number;
  route: InteractionRoute;
};

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

const regionValue = (event: WorldState["events"][number], key: string): string | undefined => {
  const payload = event.payload[key];
  if (typeof payload === "string" && payload.startsWith("region:")) return payload;
  const evidence = event.evidence[key];
  return typeof evidence === "string" && evidence.startsWith("region:") ? evidence : undefined;
};

const routePriority: Record<InteractionRoute, number> = { local: 0, war: 1, migration: 2, trade: 3, alliance: 4 };

const interactionCandidates = (state: WorldviewContext["state"], currentStep: string): InteractionCandidate[] => {
  const entities = state.worldview.entities
    .filter((entity) => entity.status === "active" && !entity.derivedFromEntityIds?.length)
    .sort((left, right) => right.influence - left.influence || left.id.localeCompare(right.id))
    .slice(0, MAX_INTERACTION_CANDIDATES);
  const populationByRegion = new Map<string, number>();
  for (const population of state.populations) populationByRegion.set(population.regionId, (populationByRegion.get(population.regionId) ?? 0) + population.count);
  const byRegion = new Map<string, WorldviewEntityState[]>();
  for (const entity of entities) {
    const regionEntities = byRegion.get(entity.regionId) ?? [];
    if (regionEntities.length < 8) regionEntities.push(entity);
    byRegion.set(entity.regionId, regionEntities);
  }
  const candidates: InteractionCandidate[] = [];
  const seenPairs = new Set<string>();
  const addCandidate = (candidate: InteractionCandidate): void => {
    if (candidate.source.packId === candidate.target.packId) return;
    const pairKey = [candidate.source.id, candidate.target.id].sort().join("|");
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    candidates.push(candidate);
  };
  for (const [regionId, regionEntities] of [...byRegion.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const localPopulation = populationByRegion.get(regionId) ?? 0;
    for (let sourceIndex = 0; sourceIndex < regionEntities.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < regionEntities.length; targetIndex += 1) {
        const source = regionEntities[sourceIndex]!;
        const target = regionEntities[targetIndex]!;
        if (source.packId === target.packId) continue;
        const ordered = source.id.localeCompare(target.id) <= 0 ? [source, target] as const : [target, source] as const;
        addCandidate({
          source: ordered[0],
          target: ordered[1],
          sourceRegionId: regionId,
          targetRegionId: regionId,
          contactStrength: clamp(localPopulation / 24),
          route: "local",
        });
      }
    }
  }

  const contacts = new Map<string, { fromRegion: string; toRegion: string; strength: number; route: Exclude<InteractionRoute, "local"> }>();
  const addContact = (fromRegion: string, toRegion: string, strength: number, route: Exclude<InteractionRoute, "local">): void => {
    if (fromRegion === toRegion || !byRegion.has(fromRegion) || !byRegion.has(toRegion)) return;
    const key = `${fromRegion}|${toRegion}`;
    const current = contacts.get(key);
    if (!current && contacts.size >= MAX_CROSS_REGION_CONTACTS) {
      const weakest = [...contacts.entries()]
        .sort(([, left], [, right]) => routePriority[left.route] - routePriority[right.route] || left.strength - right.strength || right.fromRegion.localeCompare(left.fromRegion) || right.toRegion.localeCompare(left.toRegion))[0];
      if (!weakest || routePriority[route] < routePriority[weakest[1].route]
        || (routePriority[route] === routePriority[weakest[1].route] && strength <= weakest[1].strength)) return;
      contacts.delete(weakest[0]);
    }
    if (!current || strength > current.strength || (strength === current.strength && routePriority[route] > routePriority[current.route])) {
      contacts.set(key, { fromRegion, toRegion, strength, route });
    }
  };
  const addBidirectionalContact = (left: string, right: string, strength: number, route: Exclude<InteractionRoute, "local">): void => {
    addContact(left, right, strength, route);
    addContact(right, left, strength, route);
  };

  const organizations = state.organizations
    .filter((organization) => organization.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  const organizationsById = new Map(organizations.map((organization) => [organization.id, organization]));
  for (const organization of organizations) {
    for (const [peerId, stance] of Object.entries(organization.diplomacy ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      const peer = organizationsById.get(peerId as WorldState["organizations"][number]["id"]);
      if (!peer || organization.regionId === peer.regionId) continue;
      if (stance === "allied") addBidirectionalContact(organization.regionId, peer.regionId, 0.9, "alliance");
      else if (stance === "trade") addBidirectionalContact(organization.regionId, peer.regionId, 0.72, "trade");
    }
  }

  for (let index = state.events.length - 1; index >= 0 && contacts.size < MAX_CROSS_REGION_CONTACTS; index -= 1) {
    const event = state.events[index];
    if (!event || simulationStepDistance(currentStep, event.timelineStep ?? String(event.tick), RECENT_CONTACT_WINDOW_STEPS + 1) > RECENT_CONTACT_WINDOW_STEPS) continue;
    const fromRegion = regionValue(event, "fromRegion") ?? regionValue(event, "originRegionId");
    const toRegion = regionValue(event, "toRegion");
    if (!fromRegion || !toRegion || fromRegion === toRegion) continue;
    if (event.kind === "interregional-trade") addContact(fromRegion, toRegion, 0.8, "trade");
    else if (event.kind === "diplomatic-alliance") addBidirectionalContact(fromRegion, toRegion, 0.86, "alliance");
    else if (event.kind === "population-migration" || event.kind === "population-dispersal") addContact(fromRegion, toRegion, 0.62, "migration");
    else if (event.kind === "war-displacement" || event.kind === "organization-war") addContact(fromRegion, toRegion, 0.48, "war");
  }

  for (const contact of [...contacts.values()]
    .sort((left, right) => routePriority[right.route] - routePriority[left.route] || right.strength - left.strength || left.fromRegion.localeCompare(right.fromRegion) || left.toRegion.localeCompare(right.toRegion))
    .slice(0, MAX_CROSS_REGION_CONTACTS)) {
    const sourceEntities = byRegion.get(contact.fromRegion) ?? [];
    const targetEntities = byRegion.get(contact.toRegion) ?? [];
    for (const source of sourceEntities) {
      for (const target of targetEntities) {
        addCandidate({
          source,
          target,
          sourceRegionId: contact.fromRegion,
          targetRegionId: contact.toRegion,
          contactStrength: contact.strength,
          route: contact.route,
        });
        if (candidates.length >= MAX_INTERACTION_CANDIDATES) return candidates;
      }
    }
  }
  return candidates;
};

const interactionFor = (state: WorldviewContext["state"], context: WorldviewContext, candidate: InteractionCandidate): { effect: Extract<WorldviewEffect, { kind: "interact-entities" }>; roll: number } | undefined => {
  const { source, target } = candidate;
  const sourcePopulation = state.populations.filter((population) => population.regionId === candidate.sourceRegionId).reduce((sum, population) => sum + population.count, 0);
  const targetPopulation = state.populations.filter((population) => population.regionId === candidate.targetRegionId).reduce((sum, population) => sum + population.count, 0);
  const localPopulation = candidate.sourceRegionId === candidate.targetRegionId ? sourcePopulation : sourcePopulation + targetPopulation;
  const compatibility = pairCompatibility(source, target, localPopulation);
  const contact = candidate.route === "local" ? clamp(localPopulation / 24) : clamp(candidate.contactStrength * (0.65 + Math.min(96, localPopulation) / 240));
  const probability = candidate.route === "local"
    ? clamp(0.025 + contact * 0.04 + Math.min(source.influence, target.influence) * 0.025)
    : clamp(0.035 + contact * 0.09 + Math.min(source.influence, target.influence) * 0.03);
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
      regionId: candidate.sourceRegionId as WorldState["worldview"]["entities"][number]["regionId"],
      ...(candidate.targetRegionId === candidate.sourceRegionId ? {} : { targetRegionId: candidate.targetRegionId as WorldState["worldview"]["entities"][number]["regionId"] }),
      probability,
      compatibility,
      intensity: clamp(0.35 + (1 - compatibility) * 0.45 + roll * 0.2),
      evidence: {
        eligible: true,
        sourcePackId: source.packId,
        targetPackId: target.packId,
         localPopulation,
        sourcePopulation,
        targetPopulation,
        fromRegion: candidate.sourceRegionId,
        toRegion: candidate.targetRegionId,
        route: candidate.route,
        contactStrength: candidate.contactStrength,
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
  const currentStep = context.state.timeline?.step ?? String(context.tick ?? 0);
  for (const candidate of interactionCandidates(context.state, currentStep)) {
    if (interactionCount >= MAX_INTERACTIONS_PER_STEP) break;
    const { source, target } = candidate;
    if (!enabledPacks.has(source.packId) || !enabledPacks.has(target.packId)) continue;
    const result = interactionFor(context.state, context, candidate);
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
         ...(effect.targetRegionId === undefined ? {} : { targetRegionId: effect.targetRegionId }),
         sourcePhenomenonId: source.sourcePhenomenonId ?? null,
         compatibility: effect.compatibility,
         intensity: effect.intensity,
         route: effect.evidence.route ?? "local",
         contactStrength: effect.evidence.contactStrength ?? 0,
      },
      source: "natural",
    });
    interactionCount += 1;
  }
  return delta;
};
