import { forkRandom, hashString, randomFloat } from "../../random.ts";
import type {
  AgentState,
  CultureState,
  OrganizationId,
  RuleDecision,
  WorldviewContext,
  WorldviewDelta,
  WorldviewEffect,
  WorldviewPack,
  WorldviewPhenomenonKind,
  WorldviewRule,
} from "../../types.ts";
import { culturalCompatibility, cultureIdentityFor } from "../../culture/identity.ts";
import { knowledgeDiffusionRoutes } from "../../culture/innovation.ts";
import { regionIdForWorldview } from "../rules.ts";

export const ORIGINAL_EMERGENCE_PACK_ID = "emergence.original-worldview";

const emptyDelta = (): WorldviewDelta => ({ worldviewEffects: [], resourceTransactions: [], eventDrafts: [] });
const recordsOf = (context: WorldviewContext, kind: WorldviewPhenomenonKind) =>
  context.state.worldview.phenomena.filter((record) => record.packId === ORIGINAL_EMERGENCE_PACK_ID && record.kind === kind);
const practicesOf = (context: WorldviewContext) =>
  context.state.worldview.practices.filter((practice) => practice.packId === ORIGINAL_EMERGENCE_PACK_ID);

const generatedName = (context: WorldviewContext, stage: WorldviewPhenomenonKind): string => {
  const regionId = regionIdForWorldview(context);
  const index = hashString(`${context.state.seed}:${regionId}:${stage}`);
  const roots = ["潮痕", "岩鸣", "雾脉", "晶息", "光壤", "风核", "深泉", "云纤"];
  const endings: Record<WorldviewPhenomenonKind, string[]> = {
    "natural-anomaly": ["回响", "脉动", "折光", "共振"],
    "cultural-theory": ["假说", "观测律", "循环说", "感应论"],
    "mythic-tradition": ["守望传说", "初声神话", "归潮史诗", "天脉信仰"],
    "verified-principle": ["响应定律", "耦合规律", "转化原理", "共振定则"],
  };
  const root = roots[index % roots.length] ?? "异象";
  const suffixes = endings[stage];
  return `${root}${suffixes[Math.floor(index / roots.length) % suffixes.length] ?? "记录"}`;
};

const generatedPracticeName = (context: WorldviewContext, phenomenonId: string): string => {
  const index = hashString(`${context.state.seed}:${phenomenonId}:practice`);
  const roots = ["调律", "循息", "观潮", "听岩", "纳光", "引泉", "映云", "析晶"];
  const endings = ["训练法", "共鸣法", "静观术", "感应式"];
  return `${roots[index % roots.length] ?? "观测"}${endings[Math.floor(index / roots.length) % endings.length] ?? "训练法"}`;
};

const generatedInstitutionName = (context: WorldviewContext, phenomenonId: string): string => {
  const index = hashString(`${context.state.seed}:${phenomenonId}:institution`);
  const roots = ["潮律", "岩息", "雾环", "晶脉", "光壤", "风弦", "泉鸣", "云析"];
  const endings = ["研修会", "观测院", "共鸣社", "循证流派"];
  return `${roots[index % roots.length] ?? "异象"}${endings[Math.floor(index / roots.length) % endings.length] ?? "研修会"}`;
};

const ambientEnergy = (context: WorldviewContext, phenomenon: { evidence: Record<string, number | string | boolean> }): number => {
  const recordedStrength = Number(phenomenon.evidence.anomalyStrength ?? 0);
  return Math.max(0.04, Math.min(1, recordedStrength * 0.45 + context.metrics.terrainRelief * 1.6 + Math.abs(context.metrics.carbon - context.metrics.oxygen) * 0.4));
};

const practiceCandidates = (context: WorldviewContext, regionId: string): AgentState[] => {
  const practitioners = new Set(practicesOf(context).map((practice) => practice.practitionerId));
  return context.state.agents
    .filter((agent) => agent.regionId === regionId && !practitioners.has(agent.id))
    .filter((agent) => (agent.traits.cognitivePotential ?? 0) >= 0.3 && (agent.skills.observation ?? 0) >= 0.08)
    .sort((left, right) =>
      ((right.traits.cognitivePotential ?? 0) + (right.skills.observation ?? 0))
      - ((left.traits.cognitivePotential ?? 0) + (left.skills.observation ?? 0))
      || left.id.localeCompare(right.id));
};

const organizationForPractice = (
  context: WorldviewContext,
  regionId: string,
  practitionerId: AgentState["id"],
): OrganizationId | undefined => {
  const rank = { family: 1, clan: 2, tribe: 3, settlement: 4, city: 5, state: 6, federation: 7, empire: 8 } as const;
  return context.state.organizations
    .filter((organization) => organization.status === "active"
      && (organization.regionId === regionId || organization.territoryRegionIds.includes(regionId as never))
      && organization.memberIds.includes(practitionerId))
    .sort((left, right) => (rank[right.type] - rank[left.type]) || right.memberIds.length - left.memberIds.length || left.id.localeCompare(right.id))[0]
    ?.id;
};

type BeliefRoute = ReturnType<typeof knowledgeDiffusionRoutes>[number];

const beliefRoutesFor = (context: WorldviewContext): BeliefRoute[] => knowledgeDiffusionRoutes({
  organizations: context.state.organizations,
  events: context.state.events,
  tick: context.tick ?? 0,
}).flatMap((route) => [route, { ...route, first: route.second, second: route.first }]);

const beliefSourceFor = (context: WorldviewContext, regionId: CultureState["regionId"]): { culture: CultureState; beliefId: string; phenomenonId?: string } | undefined => {
  const culture = context.state.cultures
    .filter((candidate) => candidate.regionId === regionId && candidate.beliefIds.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!culture) return undefined;
  const beliefId = [...culture.beliefIds].sort()[0];
  if (!beliefId) return undefined;
  const phenomenon = context.state.worldview.phenomena.find((record) => `belief:${record.id}` === beliefId);
  return { culture, beliefId, ...(phenomenon ? { phenomenonId: phenomenon.id } : {}) };
};

const energyReserveFor = (context: WorldviewContext, regionId: string, holderId: string): number => context.state.resources
  .filter((resource) => resource.resourceId === "attunement-energy" && resource.regionId === regionId && resource.holderId === holderId)
  .reduce((sum, resource) => sum + resource.amount, 0);

type Eligibility = (context: WorldviewContext) => RuleDecision;
type Effect = (context: WorldviewContext, evidence: RuleDecision["evidence"]) => WorldviewEffect;

const causalRule = (id: string, probability: number, eligibility: Eligibility, effect: Effect): WorldviewRule => ({
  id,
  predicates: [],
  evaluate: (context) => {
    const decision = eligibility(context);
    return { ...decision, probability: decision.eligible ? probability : 0 };
  },
  apply: (context) => {
    const decision = eligibility(context as WorldviewContext);
    if (!decision.eligible) return { status: "skipped", delta: emptyDelta() };
    return { status: "applied", value: effect(context as WorldviewContext, decision.evidence), delta: emptyDelta() };
  },
});

const decision = (
  eligible: boolean,
  evidence: RuleDecision["evidence"],
  reason: string,
): RuleDecision => ({ eligible, probability: 0, evidence, reason });

const beliefPropagationRule = causalRule("original-belief-propagation", 0.22, (context) => {
  const cultures = new Map(context.state.cultures.map((culture) => [culture.regionId, culture]));
  const candidates = beliefRoutesFor(context).flatMap((route) => {
    const source = beliefSourceFor(context, route.first);
    const destination = cultures.get(route.second);
    if (!source || !destination || destination.beliefIds.includes(source.beliefId)) return [];
    return [{ route, source, destination }];
  });
  const candidate = candidates[0];
  const compatibility = candidate
    ? culturalCompatibility(cultureIdentityFor(candidate.source.culture), cultureIdentityFor(candidate.destination))
    : 0;
  const evidence = {
    candidateCount: candidates.length,
    sourceRegion: candidate?.route.first ?? "none",
    destinationRegion: candidate?.route.second ?? "none",
    route: candidate?.route.kind ?? "none",
    routeStrength: candidate?.route.strength ?? 0,
    culturalCompatibility: compatibility,
    beliefId: candidate?.source.beliefId ?? "none",
    phenomenonId: candidate?.source.phenomenonId ?? "none",
  };
  const eligible = Boolean(candidate)
    && compatibility >= 0.18
    && candidate!.destination.transmissionRate >= 0.05;
  return decision(eligible, evidence, eligible ? "a real social contact can transmit a local belief to another culture" : "no compatible belief-bearing contact is available");
}, (context, evidence) => {
  const sourceRegion = evidence.sourceRegion as CultureState["regionId"];
  const destinationRegion = evidence.destinationRegion as CultureState["regionId"];
  const source = beliefSourceFor(context, sourceRegion)!;
  const route = beliefRoutesFor(context).find((candidate) => candidate.first === sourceRegion && candidate.second === destinationRegion)!;
  const destination = context.state.cultures.find((culture) => culture.regionId === destinationRegion)!;
  const compatibility = culturalCompatibility(cultureIdentityFor(source.culture), cultureIdentityFor(destination));
  const strength = Math.max(0.01, Math.min(1, route.strength * compatibility * (0.65 + destination.transmissionRate * 0.35)));
  return {
    kind: "propagate-belief",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    beliefId: source.beliefId,
    regionId: destination.regionId,
    sourceIds: [...new Set([...route.sourceIds, source.culture.id])].sort() as AgentState["id"][],
    strength,
  };
});

const observationRule = causalRule("original-anomaly-observation", 0.18, (context) => {
  const anomalyStrength = Math.abs(context.metrics.carbon - context.metrics.oxygen)
    + context.metrics.terrainRelief
    + context.metrics.organics * 0.5
    + context.metrics.waterCoverage * 0.1;
  const evidence = {
    anomalyStrength,
    terrainRelief: context.metrics.terrainRelief,
    chemicalImbalance: Math.abs(context.metrics.carbon - context.metrics.oxygen),
    populationCount: context.metrics.populationCount,
    knowledgeDiversity: context.metrics.knowledgeDiversity,
  };
  const eligible = recordsOf(context, "natural-anomaly").length === 0
    && anomalyStrength >= 0.12
    && context.metrics.populationCount >= 4
    && context.metrics.cognitivePotential >= 0.25
    && context.metrics.knowledgeDiversity >= 1;
  return decision(eligible, evidence, eligible ? "a population can repeatedly observe a measurable anomaly" : "observation requirements are not met");
}, (context, evidence) => ({
  kind: "record-phenomenon",
  packId: ORIGINAL_EMERGENCE_PACK_ID,
  phenomenonKind: "natural-anomaly",
  epistemicStatus: "observed",
  name: generatedName(context, "natural-anomaly"),
  regionId: regionIdForWorldview(context),
  parentIds: [],
  causeRuleId: "original-anomaly-observation",
  evidence,
}));

const theoryRule = causalRule("original-cultural-theory", 0.16, (context) => {
  const observation = recordsOf(context, "natural-anomaly")[0];
  const evidence = {
    hasObservation: Boolean(observation),
    knowledgeDiversity: context.metrics.knowledgeDiversity,
    cognitivePotential: context.metrics.cognitivePotential,
  };
  const eligible = Boolean(observation)
    && recordsOf(context, "cultural-theory").length === 0
    && context.metrics.knowledgeDiversity >= 2
    && context.metrics.cognitivePotential >= 0.3;
  return decision(eligible, evidence, eligible ? "knowledge holders can form a causal explanation" : "theory requirements are not met");
}, (context, evidence) => {
  const observation = recordsOf(context, "natural-anomaly")[0]!;
  return {
    kind: "record-phenomenon",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    phenomenonKind: "cultural-theory",
    epistemicStatus: "hypothesized",
    name: generatedName(context, "cultural-theory"),
    regionId: observation.regionId,
    parentIds: [observation.id],
    causeRuleId: "original-cultural-theory",
    evidence,
  };
});

const mythRule = causalRule("original-mythic-tradition", 0.12, (context) => {
  const theory = recordsOf(context, "cultural-theory")[0];
  const evidence = {
    hasTheory: Boolean(theory),
    populationCount: context.metrics.populationCount,
    knowledgeDiversity: context.metrics.knowledgeDiversity,
  };
  const eligible = Boolean(theory)
    && recordsOf(context, "mythic-tradition").length === 0
    && context.metrics.populationCount >= 8
    && context.metrics.knowledgeDiversity >= 3;
  return decision(eligible, evidence, eligible ? "a knowledge-bearing population can transmit a shared sacred account" : "myth formation requirements are not met");
}, (context, evidence) => {
  const theory = recordsOf(context, "cultural-theory")[0]!;
  return {
    kind: "record-phenomenon",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    phenomenonKind: "mythic-tradition",
    epistemicStatus: "believed",
    name: generatedName(context, "mythic-tradition"),
    regionId: theory.regionId,
    parentIds: [theory.id],
    causeRuleId: "original-mythic-tradition",
    evidence,
  };
});

const verificationRule = causalRule("original-principle-verification", 0.1, (context) => {
  const observation = recordsOf(context, "natural-anomaly")[0];
  const theory = recordsOf(context, "cultural-theory")[0];
  const myth = recordsOf(context, "mythic-tradition")[0];
  const evidence = {
    hasObservation: Boolean(observation),
    hasTheory: Boolean(theory),
    hasMythicTradition: Boolean(myth),
    knowledgeDiversity: context.metrics.knowledgeDiversity,
    populationCount: context.metrics.populationCount,
  };
  const eligible = Boolean(observation && theory && myth)
    && recordsOf(context, "verified-principle").length === 0
    && context.metrics.knowledgeDiversity >= 4
    && context.metrics.populationCount >= 12;
  return decision(eligible, evidence, eligible ? "a tradition can separate repeated evidence from its mythic interpretation" : "verification requirements are not met");
}, (context, evidence) => {
  const observation = recordsOf(context, "natural-anomaly")[0]!;
  const theory = recordsOf(context, "cultural-theory")[0]!;
  const myth = recordsOf(context, "mythic-tradition")[0]!;
  return {
    kind: "record-phenomenon",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    phenomenonKind: "verified-principle",
    epistemicStatus: "verified",
    name: generatedName(context, "verified-principle"),
    regionId: observation.regionId,
    parentIds: [observation.id, theory.id, myth.id],
    causeRuleId: "original-principle-verification",
    evidence,
  };
});

const practiceBeginRule = causalRule("original-practice-begin", 0.22, (context) => {
  const principle = recordsOf(context, "verified-principle")[0];
  const practiceCount = practicesOf(context).filter((practice) => practice.phenomenonId === principle?.id && practice.status === "active").length;
  const candidates = principle ? practiceCandidates(context, principle.regionId) : [];
  const teachers = practicesOf(context)
    .filter((practice) => practice.phenomenonId === principle?.id && practice.status === "active" && practice.attunement >= 0.18)
    .sort((left, right) => right.attunement - left.attunement || left.id.localeCompare(right.id));
  const candidate = candidates[0];
  const evidence = {
    hasVerifiedPrinciple: Boolean(principle),
    candidateCount: candidates.length,
    practiceCount,
    hasTeacher: Boolean(teachers[0]),
  };
  const eligible = Boolean(principle && candidate)
    && practiceCount < 8
    && (practiceCount === 0 || Boolean(teachers[0]));
  return decision(eligible, evidence, eligible ? "a verified principle can be learned through discovery or a qualified teacher" : "practice entry requirements are not met");
}, (context, evidence) => {
  const principle = recordsOf(context, "verified-principle")[0]!;
  const candidate = practiceCandidates(context, principle.regionId)[0]!;
  const teacher = practicesOf(context)
    .filter((practice) => practice.phenomenonId === principle.id && practice.status === "active" && practice.attunement >= 0.18)
    .sort((left, right) => right.attunement - left.attunement || left.id.localeCompare(right.id))[0];
  const organizationId = organizationForPractice(context, principle.regionId, candidate.id);
  return {
    kind: "begin-practice",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    name: generatedPracticeName(context, principle.id),
    phenomenonId: principle.id,
    regionId: principle.regionId,
    practitionerId: candidate.id,
    ...(teacher ? { teacherId: teacher.practitionerId } : {}),
    ...(organizationId ? { organizationId } : {}),
    resourceHolderId: organizationId ?? candidate.id,
    evidence: { ...evidence, practiceOrigin: teacher ? "transmission" : "self-discovery" },
  };
});

const practiceTrainingRule = causalRule("original-practice-training", 1, (context) => {
  const practices = practicesOf(context)
    .filter((practice) => practice.status === "active")
    .sort((left, right) => left.lastTrainedTick - right.lastTrainedTick || left.id.localeCompare(right.id));
  const practice = practices[0];
  const principle = practice ? context.state.worldview.phenomena.find((record) => record.id === practice.phenomenonId && record.epistemicStatus === "verified") : undefined;
  const practitioner = practice ? context.state.agents.find((agent) => agent.id === practice.practitionerId) : undefined;
  const ambient = principle ? ambientEnergy(context, principle) : 0;
  const holderId = practice ? practice.organizationId ?? practice.practitionerId : "";
  const reserve = practice ? energyReserveFor(context, practice.regionId, holderId) : 0;
  const evidence = { hasPractice: Boolean(practice), hasPractitioner: Boolean(practitioner), ambientEnergy: ambient, energyReserve: reserve };
  const eligible = Boolean(practice && principle && practitioner);
  return decision(eligible, evidence, eligible ? "an active practitioner can train against a verified principle" : "no active training target is available");
}, (context, evidence) => {
  const practice = practicesOf(context)
    .filter((candidate) => candidate.status === "active")
    .sort((left, right) => left.lastTrainedTick - right.lastTrainedTick || left.id.localeCompare(right.id))[0]!;
  const practitioner = context.state.agents.find((agent) => agent.id === practice.practitionerId)!;
  const principle = context.state.worldview.phenomena.find((record) => record.id === practice.phenomenonId)!;
  const ambient = ambientEnergy(context, principle);
  const skill = ((practitioner.traits.cognitivePotential ?? 0) + (practitioner.skills.observation ?? 0)) / 2;
  const organization = practice.organizationId ? context.state.organizations.find((candidate) => candidate.id === practice.organizationId) : undefined;
  const publicGoods = organization?.governance?.publicGoods ?? 0;
  const holderId = practice.organizationId ?? practice.practitionerId;
  const reserve = energyReserveFor(context, practice.regionId, holderId);
  const [roll] = randomFloat(forkRandom(context.random, `practice:${practice.id}:${context.random.value}`));
  const chance = Math.max(0.1, Math.min(0.86, 0.18 + skill * 0.42 + practice.energy * 0.18 - practice.failures * 0.04));
  const energyGain = ambient * 0.22;
  const energySpent = 0.045 + practice.attunement * 0.03;
  const resourceMinted = 0.045 + ambient * 0.08 + publicGoods * 0.05;
  const resourceAvailable = reserve + resourceMinted;
  const resourceConsumed = Math.min(energySpent, resourceAvailable);
  const outcome = roll < chance && practice.energy + energyGain >= energySpent && resourceAvailable >= energySpent
    ? "advance"
    : practice.energy + energyGain < energySpent || resourceAvailable < energySpent ? "exhausted" : "setback";
  const attunementDelta = outcome === "advance" ? 0.026 + ambient * 0.018 : outcome === "setback" ? -0.012 : -0.02;
  return {
    kind: "train-practice",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    practiceId: practice.id,
    outcome,
    energyGain,
    energySpent,
    attunementDelta,
    resourceId: "attunement-energy",
    resourceHolderId: holderId,
    resourceMinted,
    resourceConsumed,
    ...(practice.organizationId ? { organizationId: practice.organizationId } : {}),
    evidence: { ...evidence, successChance: chance, trainingRoll: roll, ambientEnergy: ambient, practitionerId: practitioner.id, resourceMinted, resourceConsumed, publicGoods },
  };
});

const practiceInstitutionRule = causalRule("original-practice-institution", 0.24, (context) => {
  const principle = recordsOf(context, "verified-principle")[0];
  const existing = context.state.worldview.entities.some((entity) => entity.packId === ORIGINAL_EMERGENCE_PACK_ID
    && entity.kind === "sect"
    && entity.regionId === principle?.regionId);
  const agents = new Set(context.state.agents.map((agent) => agent.id));
  const practices = practicesOf(context)
    .filter((practice) => practice.phenomenonId === principle?.id && practice.status !== "failed" && agents.has(practice.practitionerId))
    .sort((left, right) => left.originTick - right.originTick || left.id.localeCompare(right.id));
  const teacherLinks = practices.filter((practice) => practice.teacherId && agents.has(practice.teacherId)).length;
  const averageAttunement = practices.reduce((sum, practice) => sum + practice.attunement, 0) / Math.max(1, practices.length);
  const sponsors = new Set(practices.map((practice) => practice.organizationId).filter((id): id is OrganizationId => Boolean(id)));
  const evidence = {
    hasVerifiedPrinciple: Boolean(principle),
    practitionerCount: practices.length,
    teacherLinks,
    averageAttunement,
    sponsorCount: sponsors.size,
    alreadyEstablished: existing,
  };
  const eligible = Boolean(principle)
    && !existing
    && practices.length >= 3
    && teacherLinks >= 2
    && averageAttunement >= 0.08;
  return decision(eligible, evidence, eligible ? "a practice lineage can establish a durable institution" : "institutional lineage requirements are not met");
}, (context, evidence) => {
  const principle = recordsOf(context, "verified-principle")[0]!;
  const agents = new Set(context.state.agents.map((agent) => agent.id));
  const practices = practicesOf(context)
    .filter((practice) => practice.phenomenonId === principle.id && practice.status !== "failed" && agents.has(practice.practitionerId))
    .sort((left, right) => left.originTick - right.originTick || right.attunement - left.attunement || left.id.localeCompare(right.id));
  const founder = practices.find((practice) => !practice.teacherId) ?? practices[0]!;
  const sponsorCounts = new Map<OrganizationId, number>();
  for (const practice of practices) {
    if (!practice.organizationId) continue;
    sponsorCounts.set(practice.organizationId, (sponsorCounts.get(practice.organizationId) ?? 0) + 1);
  }
  const sponsorOrganizationId = [...sponsorCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  const averageAttunement = practices.reduce((sum, practice) => sum + practice.attunement, 0) / practices.length;
  return {
    kind: "propose-entity",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    entityKind: "sect",
    name: generatedInstitutionName(context, principle.id),
    regionId: principle.regionId,
    probability: 0.24,
    influence: Math.min(1, practices.length / 8 * 0.55 + averageAttunement * 0.45),
    sourcePhenomenonId: principle.id,
    founderId: founder.practitionerId,
    memberIds: practices.map((practice) => practice.practitionerId).sort(),
    ...(sponsorOrganizationId ? { sponsorOrganizationId } : {}),
    evidence: { ...evidence, eligible: true },
  };
});

export const originalEmergence: WorldviewPack = {
  id: ORIGINAL_EMERGENCE_PACK_ID,
  version: 1,
  label: "原创现象与文明解释",
  motifs: [],
  resources: [],
  rules: [observationRule, theoryRule, mythRule, verificationRule, practiceBeginRule, practiceTrainingRule, practiceInstitutionRule, beliefPropagationRule],
  templates: [],
};
