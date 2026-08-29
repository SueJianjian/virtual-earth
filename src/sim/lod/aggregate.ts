import { forkRandom, hashString, randomFloat } from "../random.ts";
import { MAX_KNOWLEDGE_PER_CULTURE } from "../culture/archive.ts";
import { createCultureIdentity } from "../culture/identity.ts";
import { defaultGovernanceFor, minimumMembersFor } from "../society/organization.ts";
import { MAX_ORGANIZATIONS_PER_SUMMARY } from "../society/archive.ts";
import type {
  AggregateKnowledgeSummary,
  CultureIdentity,
  CultureValues,
  KnowledgeDomain,
  OrganizationSummary,
  OrganizationType,
  RegionCultureSummary,
  RegionId,
  RegionSocietySummary,
  RegionSummary,
  WorldEvent,
  WorldEventDraft,
  WorldState,
} from "../types.ts";
import { compareSimulationSteps, nextSimulationTick, projectedYearsAfterStep, simulationStepForWorld } from "../time.ts";

export const MAX_AGGREGATE_ORGANIZATIONS = 4_096;
export const MAX_AGGREGATE_COUNTER = 1_000_000_000;

const organizationTypes: OrganizationType[] = ["family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"];
const domains: KnowledgeDomain[] = ["subsistence", "construction", "navigation", "medicine", "governance", "energy"];
const languageFamilies: CultureIdentity["languageFamily"][] = ["pulse-tonal", "scent-glyph", "gesture-lattice", "resonant-vowel", "light-pattern"];
const communicationStyles: CultureIdentity["communicationStyle"][] = ["consensus", "council", "lineage", "merit", "ritual"];

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const boundedCounter = (value: number): number => Math.max(0, Math.min(MAX_AGGREGATE_COUNTER, Math.floor(finite(value))));
const rounded = (value: number): number => Math.round(clamp(finite(value)) * 1_000_000) / 1_000_000;
const exactStep = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? value : fallback;
const latestStep = (left: string, right: string): string => compareSimulationSteps(left, right) >= 0 ? left : right;
const stepBefore = (step: string): string => {
  const value = BigInt(step);
  return value > 0n ? (value - 1n).toString() : "0";
};

const environmentFor = (state: WorldState, regionId: RegionId) => {
  const match = /^region:(\d+):(\d+)$/.exec(regionId);
  const x = Number(match?.[1] ?? 0);
  const y = Number(match?.[2] ?? 0);
  const width = state.fields.elevation.width;
  const index = Math.max(0, Math.min(state.fields.elevation.values.length - 1, y * width + x));
  return {
    elevation: finite(state.fields.elevation.values[index] ?? 0.5, 0.5),
    water: finite(state.fields.water.values[index] ?? 0.5, 0.5),
    humidity: finite(state.fields.humidity.values[index] ?? 0.5, 0.5),
    nutrients: finite(state.fields.nutrients.values[index] ?? 0.5, 0.5),
    biomass: finite(state.fields.biomass.values[index] ?? 0.5, 0.5),
    carbon: finite(state.chemistry.carbon.values[index] ?? 0.2, 0.2),
    oxygen: finite(state.chemistry.oxygen.values[index] ?? 0.1, 0.1),
    organics: finite(state.chemistry.organics.values[index] ?? 0.1, 0.1),
  };
};

export const socialPotentialForRegion = (
  state: WorldState,
  regionId: RegionId,
  populations: readonly WorldState["populations"][number][] = state.populations,
): number => {
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  let total = 0;
  let potential = 0;
  for (const population of populations) {
    const count = finite(population.count);
    if (population.regionId !== regionId || count <= 0) continue;
    const species = speciesById.get(population.speciesId);
    const cognitivePotential = species?.role === "consumer" ? clamp(finite(species.traits.cognitivePotential ?? 0, 0)) : 0;
    total += count;
    potential += count * cognitivePotential;
  }
  return total > 0 ? clamp(potential / total) : 0;
};

export const socialPopulationForRegion = (
  state: WorldState,
  regionId: RegionId,
  populations: readonly WorldState["populations"][number][] = state.populations,
): number => {
  const speciesById = new Map(state.species.map((species) => [species.id, species]));
  return Math.max(0, populations
    .filter((population) => population.regionId === regionId && finite(population.count) > 0)
    .reduce((sum, population) => {
      const species = speciesById.get(population.speciesId);
      const potential = species?.role === "consumer" ? clamp(finite(species.traits.cognitivePotential ?? 0, 0)) : 0;
      return sum + finite(population.count) * potential;
    }, 0));
};

const cultureValuesFor = (
  environment: ReturnType<typeof environmentFor>,
  socialPopulation: number,
  cohesion: number,
): CultureValues => {
  const socialFactor = clamp(Math.log1p(Math.max(0, socialPopulation)) / 6);
  return {
    cooperation: rounded(0.16 + environment.biomass * 0.22 + cohesion * 0.3 + socialFactor * 0.18),
    reciprocity: rounded(0.14 + environment.nutrients * 0.24 + environment.water * 0.18 + cohesion * 0.18),
    hierarchy: rounded(0.12 + socialFactor * 0.38 + (1 - cohesion) * 0.18),
    curiosity: rounded(0.12 + (1 - environment.biomass) * 0.14 + environment.organics * 0.24 + socialFactor * 0.22),
    tradition: rounded(0.22 + socialFactor * 0.3 + cohesion * 0.18),
    stewardship: rounded(environment.water * 0.24 + environment.nutrients * 0.2 + environment.biomass * 0.24 + cohesion * 0.18),
  };
};

const identityFor = (
  state: WorldState,
  regionId: RegionId,
  socialPopulation: number,
  cohesion: number,
  previous?: CultureIdentity,
): CultureIdentity => {
  const environment = environmentFor(state, regionId);
  const base = previous ?? createCultureIdentity(`aggregate:${state.seed}:${regionId}`, regionId, state.tick, state.years, [], environment, undefined, simulationStepForWorld(state));
  return { ...base, values: cultureValuesFor(environment, socialPopulation, cohesion) };
};

const knowledgeSort = (left: AggregateKnowledgeSummary, right: AggregateKnowledgeSummary): number =>
  compareSimulationSteps(right.originTimelineStep ?? String(right.originTick), left.originTimelineStep ?? String(left.originTick))
  || (right.credibility - left.credibility)
  || left.id.localeCompare(right.id);

const boundedKnowledge = (knowledge: readonly AggregateKnowledgeSummary[]): AggregateKnowledgeSummary[] => {
  const unique = new Map<string, AggregateKnowledgeSummary>();
  for (const item of knowledge) {
    if (!item || typeof item.id !== "string") continue;
    unique.set(item.id, {
      ...item,
      credibility: clamp(finite(item.credibility, 0.2)),
      transmissionCost: clamp(finite(item.transmissionCost, 0.5)),
      forgettingRate: clamp(finite(item.forgettingRate, 0.02)),
      originTick: Math.max(0, Math.floor(finite(item.originTick))),
      originTimelineStep: exactStep(item.originTimelineStep, String(Math.max(0, Math.floor(finite(item.originTick))))),
      originYears: Math.max(0, finite(item.originYears)),
      parentIds: [...new Set((Array.isArray(item.parentIds) ? item.parentIds : []).filter((id) => typeof id === "string"))],
    });
  }
  const selected = [...unique.values()].sort(knowledgeSort).slice(0, MAX_KNOWLEDGE_PER_CULTURE);
  const ids = new Set(selected.map((item) => item.id));
  return selected
    .map((item) => ({ ...item, parentIds: item.parentIds.filter((id) => ids.has(id)) }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const emptyOrganizationCounts = (): Record<OrganizationType, number> => ({
  family: 0,
  clan: 0,
  tribe: 0,
  settlement: 0,
  city: 0,
  state: 0,
  federation: 0,
  empire: 0,
});

const organizationCountsFrom = (organizations: readonly OrganizationSummary[]): Record<OrganizationType, number> => {
  const counts = emptyOrganizationCounts();
  for (const organization of organizations) counts[organization.type] = Math.min(MAX_AGGREGATE_ORGANIZATIONS, counts[organization.type] + 1);
  return counts;
};

const averageGovernance = (organizations: readonly OrganizationSummary[]): Pick<RegionSocietySummary, "cohesion" | "stability" | "legitimacy" | "military" | "publicGoods"> => {
  const governance = organizations.map((organization) => organization.governance).filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (governance.length === 0) return { cohesion: 0.45, stability: 0.45, legitimacy: 0.45, military: 0.18, publicGoods: 0.28 };
  const mean = (key: "cohesion" | "stability" | "legitimacy" | "military" | "publicGoods") =>
    governance.reduce((sum, value) => sum + finite(value[key]), 0) / governance.length;
  return { cohesion: clamp(mean("cohesion")), stability: clamp(mean("stability")), legitimacy: clamp(mean("legitimacy")), military: clamp(mean("military")), publicGoods: clamp(mean("publicGoods")) };
};

export const initialAggregateCulture = (state: WorldState, regionId: RegionId, socialPopulation: number): RegionCultureSummary => {
  const identity = identityFor(state, regionId, socialPopulation, 0.45);
  return {
    id: `culture:aggregate:${regionId.replaceAll(":", "-")}` as RegionCultureSummary["id"],
    identity,
    knowledge: [],
    beliefCount: 0,
    transmissionRate: clamp(0.08 + Math.log1p(Math.max(0, socialPopulation)) * 0.05),
    memoryStrength: clamp(0.12 + Math.log1p(Math.max(0, socialPopulation)) * 0.04),
    innovationCount: 0,
    lastChangeTick: state.tick,
    lastChangeTimelineStep: simulationStepForWorld(state),
  };
};

export const initialAggregateSociety = (previous: RegionSummary): RegionSocietySummary => {
  const governance = averageGovernance(previous.organizations);
  const counts = organizationCountsFrom(previous.organizations);
  return {
    organizationCounts: counts,
    organizationCapacity: Math.max(0, previous.organizations.reduce((sum, organization) => sum + Math.max(0, organization.memberCount), 0)),
    ...governance,
    tradeVolume: 0,
    conflictPressure: 0,
    infrastructureLevel: 0,
    lastChangeTick: previous.version,
    lastChangeTimelineStep: previous.versionStep ?? String(previous.version),
  };
};

const domainScores = (
  environment: ReturnType<typeof environmentFor>,
  socialPopulation: number,
  socialPotential: number,
  culture: RegionCultureSummary,
  society: RegionSocietySummary,
): Array<{ domain: KnowledgeDomain; score: number }> => {
  const socialFactor = clamp(Math.log1p(Math.max(0, socialPopulation)) / 7);
  const organizationFactor = clamp(society.organizationCapacity / Math.max(1, socialPopulation * 4));
  const knownCount = (domain: KnowledgeDomain): number => culture.knowledge.filter((item) => item.domain === domain).length;
  const scores: Record<KnowledgeDomain, number> = {
    subsistence: environment.biomass * 0.34 + environment.nutrients * 0.28 + socialPotential * 0.16 + culture.identity.values.curiosity * 0.14 - knownCount("subsistence") * 0.08,
    construction: environment.elevation * 0.18 + environment.nutrients * 0.12 + organizationFactor * 0.32 + culture.identity.values.curiosity * 0.2 + society.publicGoods * 0.18 - knownCount("construction") * 0.08,
    navigation: environment.water * 0.32 + environment.humidity * 0.14 + socialFactor * 0.18 + culture.identity.values.curiosity * 0.2 + society.tradeVolume / MAX_AGGREGATE_COUNTER * 0.12 - knownCount("navigation") * 0.08,
    medicine: environment.biomass * 0.2 + environment.organics * 0.25 + society.publicGoods * 0.12 + culture.identity.values.curiosity * 0.28 + culture.identity.values.cooperation * 0.1 - knownCount("medicine") * 0.08,
    governance: organizationFactor * 0.38 + culture.identity.values.cooperation * 0.2 + culture.identity.values.hierarchy * 0.18 + society.legitimacy * 0.24 - knownCount("governance") * 0.08,
    energy: Math.abs(environment.carbon - environment.oxygen) * 0.2 + environment.organics * 0.16 + environment.elevation * 0.14 + culture.identity.values.curiosity * 0.28 + society.infrastructureLevel * 0.18 - knownCount("energy") * 0.08,
  };
  return domains.map((domain) => ({ domain, score: clamp(scores[domain]) })).sort((left, right) => right.score - left.score || left.domain.localeCompare(right.domain));
};

const event = (
  kind: string,
  ruleId: string,
  regionId: RegionId,
  sourceId: string,
  probability: number,
  roll: number,
  evidence: Record<string, number | string | boolean>,
  payload: Record<string, unknown>,
): WorldEventDraft => ({ kind, ruleId, sourceIds: [sourceId], probability, roll, evidence: { regionId, ...evidence }, payload: { regionId, ...payload }, source: "natural" });

export type AggregateEvolution = {
  socialPopulation: number;
  culture: RegionCultureSummary;
  society: RegionSocietySummary;
  events: WorldEventDraft[];
};

export const evolveAggregateRegion = (
  state: WorldState,
  previous: RegionSummary,
  population: number,
  socialPotential: number,
  foodBalance: number,
  foodSecurity: number,
  recentEvents: readonly WorldEvent[] = [],
): AggregateEvolution => {
  const regionId = previous.regionId;
  const simulationStep = simulationStepForWorld(state);
  const environment = environmentFor(state, regionId);
  const priorSociety = previous.societySummary ?? initialAggregateSociety(previous);
  const priorCulture = previous.cultureSummary ?? initialAggregateCulture(state, regionId, previous.socialPopulation ?? previous.population);
  const society: RegionSocietySummary = {
    organizationCounts: Object.fromEntries(organizationTypes.map((type) => [type, boundedCounter(priorSociety.organizationCounts?.[type] ?? 0)])) as Record<OrganizationType, number>,
    organizationCapacity: boundedCounter(priorSociety.organizationCapacity),
    cohesion: clamp(finite(priorSociety.cohesion, 0.45)),
    stability: clamp(finite(priorSociety.stability, 0.45)),
    legitimacy: clamp(finite(priorSociety.legitimacy, 0.45)),
    military: clamp(finite(priorSociety.military, 0.18)),
    publicGoods: clamp(finite(priorSociety.publicGoods, 0.28)),
    tradeVolume: Math.min(MAX_AGGREGATE_COUNTER, Math.max(0, finite(priorSociety.tradeVolume))),
    conflictPressure: clamp(finite(priorSociety.conflictPressure)),
    infrastructureLevel: clamp(finite(priorSociety.infrastructureLevel)),
    lastChangeTick: Math.max(0, Math.floor(finite(priorSociety.lastChangeTick, state.tick))),
    lastChangeTimelineStep: exactStep(priorSociety.lastChangeTimelineStep, previous.versionStep ?? String(priorSociety.lastChangeTick)),
  };
  const events: WorldEventDraft[] = [];
  const totalPopulation = Math.max(0, finite(population));
  const previousSocialPopulation = Math.max(0, finite(previous.socialPopulation ?? previous.population));
  const socialFactor = clamp(Math.log1p(totalPopulation) / 7);
  const socialCapacity = socialPotential < 0.08
    ? 0
    : Math.min(totalPopulation, Math.max(0, Math.sqrt(totalPopulation) * (1.6 + socialPotential * 2.4) * (0.55 + environment.biomass * 0.45)));
  const pressure = clamp((1 - foodSecurity) * 0.5 + (1 - environment.biomass) * 0.18 + (1 - socialPotential) * 0.12);
  const socialRate = foodSecurity * 0.055 + environment.biomass * 0.025 + socialPotential * 0.025;
  const socialPopulation = totalPopulation <= 0
    ? 0
    : Math.max(0, Math.min(totalPopulation, previousSocialPopulation + (socialCapacity - previousSocialPopulation) * (0.025 + socialRate) - previousSocialPopulation * pressure * 0.012));

  const recentConflicts = recentEvents.filter((candidate) => candidate.kind.includes("conflict") || candidate.kind.includes("war")).length;
  const recentTrade = recentEvents.filter((candidate) => candidate.kind.includes("trade")).reduce((sum, candidate) => sum + Math.max(0, Number(candidate.payload.amount ?? candidate.evidence.amount ?? 0)), 0);
  const disasterPressure = recentEvents.filter((candidate) => ["drought", "flood", "earthquake", "volcano"].includes(candidate.kind)).length;
  const stress = clamp(pressure + recentConflicts * 0.025 + disasterPressure * 0.04 + society.conflictPressure * 0.18);
  const desiredCohesion = clamp(priorCulture.identity.values.cooperation * 0.45 + priorCulture.identity.values.reciprocity * 0.2 + foodSecurity * 0.2 + environment.biomass * 0.15 - stress * 0.2);
  const desiredStability = clamp(desiredCohesion * 0.45 + foodSecurity * 0.25 + society.infrastructureLevel * 0.15 + priorCulture.identity.values.stewardship * 0.15 - stress * 0.16);
  const desiredLegitimacy = clamp(desiredCohesion * 0.32 + foodSecurity * 0.2 + society.publicGoods * 0.3 + priorCulture.identity.values.reciprocity * 0.18 - stress * 0.12);
  const desiredInfrastructure = clamp(society.infrastructureLevel * 0.94 + (society.organizationCounts.settlement + society.organizationCounts.city * 2) * 0.006 + foodSecurity * 0.025 + priorCulture.knowledge.filter((item) => item.domain === "construction").length * 0.012 - stress * 0.018);
  const blend = (before: number, target: number, rate = 0.08): number => rounded(before * (1 - rate) + target * rate);
  society.cohesion = blend(society.cohesion, desiredCohesion);
  society.stability = blend(society.stability, desiredStability);
  society.legitimacy = blend(society.legitimacy, desiredLegitimacy);
  society.military = blend(society.military, clamp((society.organizationCounts.state + society.organizationCounts.empire * 2) / 24 + stress * 0.35));
  society.publicGoods = blend(society.publicGoods, clamp(desiredInfrastructure * 0.62 + desiredLegitimacy * 0.38));
  society.infrastructureLevel = blend(society.infrastructureLevel, desiredInfrastructure);
  society.conflictPressure = blend(society.conflictPressure, clamp(stress * 0.72 + recentConflicts * 0.04));
  society.tradeVolume = Math.min(MAX_AGGREGATE_COUNTER, Math.max(0, finite(society.tradeVolume) + recentTrade + (society.organizationCounts.city + society.organizationCounts.state * 2) * foodSecurity * 0.025));

  const culture = structuredClone(priorCulture);
  culture.lastChangeTick = Math.max(0, Math.floor(finite(culture.lastChangeTick, state.tick)));
  culture.lastChangeTimelineStep = exactStep(culture.lastChangeTimelineStep, previous.versionStep ?? String(culture.lastChangeTick));
  culture.knowledge = boundedKnowledge(culture.knowledge);
  culture.beliefCount = boundedCounter(culture.beliefCount);
  culture.innovationCount = boundedCounter(culture.innovationCount);
  const cultureCohesion = society.cohesion;
  const targetValues = cultureValuesFor(environment, socialPopulation, cultureCohesion);
  const beforeIdentity = culture.identity;
  const identityValues = Object.fromEntries(Object.keys(targetValues).map((key) => {
    const field = key as keyof CultureValues;
    return [field, rounded(beforeIdentity.values[field] * 0.965 + targetValues[field] * 0.035)];
  })) as CultureValues;
  const [languageRoll] = randomFloat(forkRandom(state.random, `aggregate-language:${regionId}:${simulationStep}`));
  const [styleRoll] = randomFloat(forkRandom(state.random, `aggregate-style:${regionId}:${simulationStep}`));
  const language = languageRoll < 0.0025 + culture.identity.values.curiosity * 0.004
    ? languageFamilies[hashString(`${state.seed}:${regionId}:${simulationStep}:language`) % languageFamilies.length]!
    : beforeIdentity.languageFamily;
  const communicationStyle = styleRoll < 0.0025 + culture.identity.values.curiosity * 0.004
    ? communicationStyles[hashString(`${state.seed}:${regionId}:${simulationStep}:style`) % communicationStyles.length]!
    : beforeIdentity.communicationStyle;
  const valuesChanged = Object.keys(identityValues).some((key) => Math.abs(beforeIdentity.values[key as keyof CultureValues] - identityValues[key as keyof CultureValues]) > 0.018);
  const identityChanged = valuesChanged || language !== beforeIdentity.languageFamily || communicationStyle !== beforeIdentity.communicationStyle;
  culture.identity = {
    ...beforeIdentity,
    values: identityValues,
    languageFamily: language,
    communicationStyle,
    generation: identityChanged ? Math.min(MAX_AGGREGATE_COUNTER, beforeIdentity.generation + 1) : beforeIdentity.generation,
    noveltySignature: identityChanged
      ? hashString(`aggregate-culture:${beforeIdentity.noveltySignature}:${simulationStep}:${language}:${communicationStyle}`).toString(16).padStart(8, "0")
      : beforeIdentity.noveltySignature,
  };
  culture.transmissionRate = blend(culture.transmissionRate, clamp(0.06 + socialFactor * 0.28 + society.cohesion * 0.28 + foodSecurity * 0.18));
  culture.memoryStrength = blend(culture.memoryStrength, clamp(culture.transmissionRate * 0.55 + socialPotential * 0.25 + society.cohesion * 0.2));
  let meaningfulCultureChange = identityChanged;

  const candidate = domainScores(environment, socialPopulation, socialPotential, culture, society)[0];
  const domainCount = candidate ? culture.knowledge.filter((item) => item.domain === candidate.domain).length : 0;
  const innovationProbability = candidate && socialPopulation >= 3 && culture.memoryStrength >= 0.16 && domainCount < 6
    ? clamp(0.006 + culture.identity.values.curiosity * 0.018 + socialPotential * 0.016 + foodSecurity * 0.012 + candidate.score * 0.02, 0, 0.085)
    : 0;
  const [innovationRoll] = randomFloat(forkRandom(state.random, `aggregate-innovation:${regionId}:${simulationStep}`));
  if (candidate && innovationProbability > 0 && innovationRoll < innovationProbability) {
    const parentIds = culture.knowledge.slice().sort(knowledgeSort).slice(0, 3).map((item) => item.id);
    const id = `aggregate-knowledge:${hashString(`${state.seed}:${regionId}:${candidate.domain}:${domainCount + 1}:${simulationStep}`).toString(16)}`;
    const innovation: AggregateKnowledgeSummary = {
      id,
      kind: `aggregate-innovation:${candidate.domain}`,
      name: `local-${candidate.domain}-${domainCount + 1}`,
      domain: candidate.domain,
      credibility: clamp(0.24 + candidate.score * 0.5 + culture.memoryStrength * 0.2),
      transmissionCost: clamp(0.5 - culture.transmissionRate * 0.24),
      forgettingRate: clamp(0.035 - culture.memoryStrength * 0.02, 0.001, 0.04),
      originRegionId: regionId,
      originTick: nextSimulationTick(state),
      originTimelineStep: simulationStep,
      originYears: projectedYearsAfterStep(state, 1),
      parentIds,
    };
    culture.knowledge = boundedKnowledge([...culture.knowledge, innovation]);
    culture.innovationCount = Math.min(MAX_AGGREGATE_COUNTER, culture.innovationCount + 1);
    meaningfulCultureChange = true;
    events.push(event("aggregate-culture-innovation", "lod:aggregate-cultural-innovation", regionId, culture.id, innovationProbability, innovationRoll, { domain: candidate.domain, score: candidate.score, socialPopulation, socialPotential, parentCount: parentIds.length }, { cultureId: culture.id, knowledgeId: innovation.id, domain: candidate.domain, name: innovation.name, parentIds }));
  }

  const [beliefRoll] = randomFloat(forkRandom(state.random, `aggregate-belief:${regionId}:${simulationStep}`));
  const beliefProbability = culture.knowledge.length >= 2 && socialPopulation >= 4
    ? clamp(0.003 + culture.identity.values.tradition * 0.012 + culture.identity.values.curiosity * 0.008 + society.cohesion * 0.008)
    : 0;
  if (beliefProbability > 0 && beliefRoll < beliefProbability && culture.beliefCount < 64) {
    culture.beliefCount += 1;
    meaningfulCultureChange = true;
    events.push(event("aggregate-belief-emergence", "lod:aggregate-belief-emergence", regionId, culture.id, beliefProbability, beliefRoll, { knowledgeCount: culture.knowledge.length, beliefCount: culture.beliefCount, socialPopulation }, { cultureId: culture.id, beliefCount: culture.beliefCount }));
  } else if (socialPopulation <= 0) {
    culture.beliefCount = Math.max(0, Math.floor(culture.beliefCount * 0.995));
  }

  const minimumPopulation: Record<OrganizationType, number> = { family: 2, clan: 4, tribe: 6, settlement: 8, city: 30, state: 50, federation: 100, empire: 200 };
  const scale: Record<OrganizationType, number> = { family: 4, clan: 12, tribe: 30, settlement: 60, city: 120, state: 400, federation: 1_000, empire: 3_000 };
  const targetFor = (type: OrganizationType): number => {
    if (socialPopulation < minimumPopulation[type]) return 0;
    return Math.min(MAX_AGGREGATE_ORGANIZATIONS, Math.max(1, Math.floor(socialPopulation / scale[type])));
  };
  const eligibleFor = (type: OrganizationType): boolean => {
    if (socialPopulation < minimumPopulation[type]) return false;
    if (type === "family") return true;
    if (type === "clan") return society.organizationCounts.family >= 2;
    if (type === "tribe") return society.organizationCounts.family >= 2 && society.organizationCounts.clan >= 1;
    if (type === "settlement") return society.organizationCounts.tribe >= 1 && culture.knowledge.length >= 1;
    if (type === "city") return society.organizationCounts.settlement >= 1 && culture.knowledge.length >= 2;
    if (type === "state") return society.organizationCounts.city + society.organizationCounts.settlement >= 2 && culture.knowledge.length >= 2;
    if (type === "federation") return society.organizationCounts.state + society.organizationCounts.city >= 3;
    return society.organizationCounts.state >= 2 && culture.knowledge.length >= 4;
  };
  for (const type of organizationTypes) {
    const current = society.organizationCounts[type];
    if (!eligibleFor(type) || current >= targetFor(type)) continue;
    const gap = targetFor(type) - current;
    const probability = clamp(0.012 + Math.min(0.06, gap * 0.004) + foodSecurity * 0.035 + society.cohesion * 0.025, 0.005, 0.18);
    const [roll] = randomFloat(forkRandom(state.random, `aggregate-organization:${regionId}:${type}:${simulationStep}`));
    if (roll >= probability) continue;
    society.organizationCounts[type] = Math.min(MAX_AGGREGATE_ORGANIZATIONS, current + 1);
    society.lastChangeTick = state.tick;
    society.lastChangeTimelineStep = simulationStep;
    events.push(event("aggregate-organization-formation", `lod:aggregate-organization-${type}`, regionId, culture.id, probability, roll, { type, previousCount: current, count: society.organizationCounts[type], socialPopulation, foodSecurity, cultureKnowledge: culture.knowledge.length }, { type, count: society.organizationCounts[type], aggregate: true }));
  }

  if (socialPopulation <= 0) {
    for (const type of organizationTypes) society.organizationCounts[type] = 0;
  } else if (stress > 0.42) {
    const candidates = organizationTypes.slice().reverse().filter((type) => society.organizationCounts[type] > targetFor(type) || society.organizationCounts[type] > 0);
    const type = candidates[0];
    if (type) {
      const probability = clamp(stress * 0.065, 0, 0.12);
      const [roll] = randomFloat(forkRandom(state.random, `aggregate-dissolution:${regionId}:${type}:${simulationStep}`));
      if (roll < probability && society.organizationCounts[type] > 0) {
        const previousCount = society.organizationCounts[type];
        society.organizationCounts[type] -= 1;
        society.lastChangeTick = state.tick;
        society.lastChangeTimelineStep = simulationStep;
        events.push(event("aggregate-organization-dissolution", "lod:aggregate-organization-dissolution", regionId, culture.id, probability, roll, { type, previousCount, count: society.organizationCounts[type], stress, foodSecurity }, { type, count: society.organizationCounts[type], aggregate: true }));
      }
    }
  }

  society.organizationCapacity = Math.min(MAX_AGGREGATE_COUNTER, organizationTypes.reduce((sum, type) => sum + society.organizationCounts[type] * Math.max(minimumMembersFor(type), Math.floor(socialPopulation / Math.max(1, society.organizationCounts[type]))), 0));
  society.lastChangeTick = Math.max(society.lastChangeTick, meaningfulCultureChange ? state.tick : previous.societySummary?.lastChangeTick ?? state.tick);
  society.lastChangeTimelineStep = latestStep(
    exactStep(society.lastChangeTimelineStep, previous.versionStep ?? String(society.lastChangeTick)),
    meaningfulCultureChange ? simulationStep : exactStep(previous.societySummary?.lastChangeTimelineStep, previous.versionStep ?? String(previous.societySummary?.lastChangeTick ?? state.tick)),
  );
  culture.lastChangeTick = meaningfulCultureChange ? state.tick : Math.max(culture.lastChangeTick, state.tick - 1);
  culture.lastChangeTimelineStep = meaningfulCultureChange
    ? simulationStep
    : latestStep(exactStep(culture.lastChangeTimelineStep, previous.versionStep ?? String(culture.lastChangeTick)), stepBefore(simulationStep));
  return { socialPopulation, culture, society, events };
};

export const organizationSummariesForAggregate = (
  previous: readonly OrganizationSummary[],
  regionId: RegionId,
  society: RegionSocietySummary,
  socialPopulation: number,
): OrganizationSummary[] => {
  const result: OrganizationSummary[] = [];
  const previousByType = new Map<OrganizationType, OrganizationSummary[]>();
  for (const organization of previous) {
    const entries = previousByType.get(organization.type) ?? [];
    entries.push(organization);
    previousByType.set(organization.type, entries);
  }
  for (const type of organizationTypes) {
    const visibleCount = Math.min(64, society.organizationCounts[type]);
    const retained = (previousByType.get(type) ?? []).slice(0, visibleCount);
    const entries = [...retained];
    for (let index = entries.length; index < visibleCount; index += 1) {
      entries.push({
        id: `aggregate:organization:${type}:${regionId}:${index}` as OrganizationSummary["id"],
        type,
        memberCount: 0,
        memberIds: [],
        childIds: [],
        resourceIds: [],
        historyIds: [],
        territoryRegionIds: [regionId],
      });
    }
    for (let index = 0; index < entries.length; index += 1) {
      const organization = entries[index]!;
      const memberCount = Math.min(Math.max(0, socialPopulation), Math.max(minimumMembersFor(type), Math.round(socialPopulation / Math.max(1, society.organizationCounts[type])) || minimumMembersFor(type)));
      const governance = defaultGovernanceFor(type);
      result.push({
        ...organization,
        memberCount,
        memberIds: organization.memberIds.filter((id) => typeof id === "string"),
        territoryRegionIds: [...new Set(organization.territoryRegionIds.length > 0 ? organization.territoryRegionIds : [regionId])],
        governance: {
          ...governance,
          stability: society.stability,
          legitimacy: society.legitimacy,
          military: society.military,
          publicGoods: society.publicGoods,
          cohesion: society.cohesion,
          treasury: clamp(society.tradeVolume / 100),
          taxRevenue: clamp(society.tradeVolume / 1_000),
        },
        diplomacy: { ...organization.diplomacy },
      });
    }
  }
  const ordered = result.sort((left, right) => organizationTypes.indexOf(left.type) - organizationTypes.indexOf(right.type) || left.id.localeCompare(right.id));
  const representative = organizationTypes
    .map((type) => ordered.find((organization) => organization.type === type))
    .filter((organization): organization is OrganizationSummary => Boolean(organization));
  const retained = [...representative, ...ordered.filter((organization) => !representative.includes(organization))]
    .slice(0, MAX_ORGANIZATIONS_PER_SUMMARY);
  const validIds = new Set(retained.map((organization) => organization.id));
  return retained
    .map((organization) => ({
      ...organization,
      childIds: organization.childIds.filter((id) => validIds.has(id) && id !== organization.id).slice(0, 64),
    }))
    .sort((left, right) => organizationTypes.indexOf(left.type) - organizationTypes.indexOf(right.type) || left.id.localeCompare(right.id));
};
