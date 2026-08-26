import { forkRandom, hashString, randomFloat } from "../../random.ts";
import type {
  AgentState,
  RuleDecision,
  WorldviewContext,
  WorldviewDelta,
  WorldviewEffect,
  WorldviewPack,
  WorldviewPhenomenonKind,
  WorldviewRule,
} from "../../types.ts";
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
  const practiceCount = practicesOf(context).filter((practice) => practice.phenomenonId === principle?.id && practice.status !== "failed").length;
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
  return {
    kind: "begin-practice",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    name: generatedPracticeName(context, principle.id),
    phenomenonId: principle.id,
    regionId: principle.regionId,
    practitionerId: candidate.id,
    ...(teacher ? { teacherId: teacher.practitionerId } : {}),
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
  const evidence = { hasPractice: Boolean(practice), hasPractitioner: Boolean(practitioner), ambientEnergy: ambient };
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
  const [roll] = randomFloat(forkRandom(context.random, `practice:${practice.id}:${context.random.value}`));
  const chance = Math.max(0.1, Math.min(0.86, 0.18 + skill * 0.42 + practice.energy * 0.18 - practice.failures * 0.04));
  const energyGain = ambient * 0.22;
  const energySpent = 0.07 + practice.attunement * 0.04;
  const outcome = roll < chance && practice.energy + energyGain >= energySpent
    ? "advance"
    : practice.energy + energyGain < energySpent ? "exhausted" : "setback";
  const attunementDelta = outcome === "advance" ? 0.026 + ambient * 0.018 : outcome === "setback" ? -0.012 : -0.02;
  return {
    kind: "train-practice",
    packId: ORIGINAL_EMERGENCE_PACK_ID,
    practiceId: practice.id,
    outcome,
    energyGain,
    energySpent,
    attunementDelta,
    evidence: { ...evidence, successChance: chance, trainingRoll: roll, ambientEnergy: ambient, practitionerId: practitioner.id },
  };
});

export const originalEmergence: WorldviewPack = {
  id: ORIGINAL_EMERGENCE_PACK_ID,
  version: 1,
  label: "原创现象与文明解释",
  motifs: [],
  resources: [],
  rules: [observationRule, theoryRule, mythRule, verificationRule, practiceBeginRule, practiceTrainingRule],
  templates: [],
};
