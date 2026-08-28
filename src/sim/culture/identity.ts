import { hashString } from "../random.ts";
import type {
  AgentState,
  CultureCommunicationStyle,
  CultureIdentity,
  CultureLanguageFamily,
  CultureState,
  CultureValues,
  EntityId,
  KnowledgeDomain,
  RegionId,
} from "../types.ts";
import { simulationStepModulo } from "../time.ts";

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const rounded = (value: number): number => Math.round(clamp(value) * 1_000_000) / 1_000_000;
const fraction = (seed: string): number => hashString(seed) / 0xffffffff;
const choice = <T>(values: readonly T[], seed: string): T => values[hashString(seed) % values.length]!;

const languages: CultureLanguageFamily[] = ["pulse-tonal", "scent-glyph", "gesture-lattice", "resonant-vowel", "light-pattern"];
const communicationStyles: CultureCommunicationStyle[] = ["consensus", "council", "lineage", "merit", "ritual"];
const namePrefixes = ["潮", "岚", "曜", "霁", "棱", "泠", "烬", "穹", "澜", "脉", "晶", "风"];
const nameStems = ["回声", "环脉", "浮痕", "鸣谷", "星壤", "织潮", "烁枝", "雾庭", "根契", "岩歌", "光纹", "深环"];
const traditionsByDomain: Record<KnowledgeDomain, string[]> = {
  subsistence: ["共养潮壤", "守护风籽", "分穗礼"],
  construction: ["叠岩誓", "固基歌", "拱门纪"],
  navigation: ["寻潮夜", "星纹记", "渡雾礼"],
  medicine: ["净创仪", "光苔守则", "复元诵"],
  governance: ["环议日", "群炬盟", "公印礼"],
  energy: ["岩鸣祭", "晶息轮", "潮热守望"],
};
const environmentFor = (regionId: RegionId, environment?: Partial<{ elevation: number; water: number; humidity: number; nutrients: number; biomass: number }>) => ({
  elevation: environment?.elevation ?? 0.5,
  water: environment?.water ?? 0.5,
  humidity: environment?.humidity ?? 0.5,
  nutrients: environment?.nutrients ?? 0.5,
  biomass: environment?.biomass ?? 0.5,
  regionId,
});

const mean = (members: readonly AgentState[], selector: (agent: AgentState) => number): number =>
  members.reduce((sum, member) => sum + selector(member), 0) / Math.max(1, members.length);

const cultureNameFor = (seed: string): string => `${choice(namePrefixes, `${seed}:prefix`)}${choice(nameStems, `${seed}:stem`)}`;

const valuesFor = (
  seed: string,
  members: readonly AgentState[],
  environment: ReturnType<typeof environmentFor>,
): CultureValues => ({
  cooperation: rounded(mean(members, (agent) => agent.traits.cooperation ?? 0.5) * 0.7 + mean(members, (agent) => agent.traits.sociality ?? 0.5) * 0.15 + environment.biomass * 0.15),
  reciprocity: rounded(mean(members, (agent) => agent.traits.cooperation ?? 0.5) * 0.52 + environment.nutrients * 0.25 + environment.water * 0.13 + fraction(`${seed}:reciprocity`) * 0.1),
  hierarchy: rounded(0.12 + fraction(`${seed}:hierarchy`) * 0.42 + (1 - mean(members, (agent) => agent.traits.cooperation ?? 0.5)) * 0.2),
  curiosity: rounded(mean(members, (agent) => agent.traits.curiosity ?? 0.5) * 0.74 + (1 - environment.biomass) * 0.08 + fraction(`${seed}:curiosity`) * 0.18),
  tradition: rounded(0.24 + fraction(`${seed}:tradition`) * 0.42),
  stewardship: rounded(environment.water * 0.28 + environment.nutrients * 0.22 + environment.biomass * 0.2 + mean(members, (agent) => agent.traits.cooperation ?? 0.5) * 0.3),
});

export const createCultureIdentity = (
  seed: string,
  regionId: RegionId,
  tick: number,
  years: number,
  members: readonly AgentState[] = [],
  environment: Partial<{ elevation: number; water: number; humidity: number; nutrients: number; biomass: number }> = {},
  parentCultureIds?: EntityId[],
  timelineStep = String(tick),
): CultureIdentity => {
  const local = environmentFor(regionId, environment);
  const languageFamily = choice(languages, `${seed}:language`);
  const communicationStyle = choice(communicationStyles, `${seed}:communication`);
  const domains: KnowledgeDomain[] = [
    local.water > 0.55 ? "navigation" : "subsistence",
    local.biomass > 0.45 ? "medicine" : "construction",
    local.nutrients > 0.58 ? "subsistence" : "energy",
  ];
  const traditions = [...new Set(domains.map((domain) => choice(traditionsByDomain[domain], `${seed}:tradition:${domain}`)))].slice(0, 6);
  return {
    name: cultureNameFor(seed),
    languageFamily,
    communicationStyle,
    values: valuesFor(seed, members, local),
    traditions,
    symbol: `${(hashString(`${seed}:symbol`) % 16).toString(16)}${(hashString(`${seed}:symbol:2`) % 16).toString(16)}`,
    originRegionId: regionId,
    originTick: tick,
    originTimelineStep: timelineStep,
    originYears: years,
    generation: 0,
    noveltySignature: hashString(`culture:${seed}:${languageFamily}:${communicationStyle}`).toString(16).padStart(8, "0"),
    ...(parentCultureIds && parentCultureIds.length > 0 ? { parentCultureIds: [...new Set(parentCultureIds)].sort() as EntityId[] } : {}),
  };
};

const identityChanged = (before: CultureIdentity, after: CultureIdentity): boolean =>
  before.languageFamily !== after.languageFamily
  || before.communicationStyle !== after.communicationStyle
  || before.traditions.join("|") !== after.traditions.join("|")
  || Object.keys(before.values).some((key) => Math.abs(before.values[key as keyof CultureValues] - after.values[key as keyof CultureValues]) > 0.025);

export const evolveCultureIdentity = (
  identity: CultureIdentity,
  seed: string,
  tick: number,
  members: readonly AgentState[],
  environment: Partial<{ elevation: number; water: number; humidity: number; nutrients: number; biomass: number }> = {},
  knowledgeDomains: readonly KnowledgeDomain[] = [],
  timelineStep = String(tick),
): CultureIdentity => {
  if (simulationStepModulo(timelineStep, 12) !== 0 && knowledgeDomains.length === 0) return identity;
  const local = environmentFor(identity.originRegionId, environment);
  const target = valuesFor(`${seed}:${identity.noveltySignature}`, members, local);
  const values = Object.fromEntries(Object.keys(identity.values).map((key) => {
    const field = key as keyof CultureValues;
    return [field, rounded(identity.values[field] * 0.94 + target[field] * 0.06)];
  })) as CultureValues;
  const traditions = [...identity.traditions];
  for (const domain of knowledgeDomains) {
    const tradition = choice(traditionsByDomain[domain], `${seed}:new-tradition:${domain}`);
    if (!traditions.includes(tradition)) traditions.push(tradition);
  }
  while (traditions.length > 6) traditions.shift();
  const languageFamily = fraction(`${seed}:language-drift:${timelineStep}`) < 0.014
    ? choice(languages.filter((candidate) => candidate !== identity.languageFamily), `${seed}:language-choice:${timelineStep}`)
    : identity.languageFamily;
  const communicationStyle = fraction(`${seed}:style-drift:${timelineStep}`) < 0.018
    ? choice(communicationStyles.filter((candidate) => candidate !== identity.communicationStyle), `${seed}:style-choice:${timelineStep}`)
    : identity.communicationStyle;
  return {
    ...identity,
    values,
    traditions,
    languageFamily,
    communicationStyle,
    generation: identity.generation + 1,
    noveltySignature: hashString(`culture-branch:${identity.noveltySignature}:${seed}:${timelineStep}:${languageFamily}:${communicationStyle}`).toString(16).padStart(8, "0"),
  };
};

export const ensureCultureIdentity = (culture: CultureState): CultureState => culture.identity
  ? culture
  : {
    ...culture,
    identity: createCultureIdentity(`legacy:${culture.id}`, culture.regionId, 0, 0),
  };

export const cultureIdentityFor = (culture: Pick<CultureState, "id" | "regionId" | "identity">): CultureIdentity =>
  culture.identity ?? createCultureIdentity(`legacy:${culture.id}`, culture.regionId, 0, 0);

export const culturalCompatibility = (source: CultureIdentity, destination: CultureIdentity): number => {
  const language = source.languageFamily === destination.languageFamily ? 1 : 0.66;
  const communication = source.communicationStyle === destination.communicationStyle ? 1 : 0.82;
  const valueDistance = Object.keys(source.values).reduce((sum, key) => {
    const field = key as keyof CultureValues;
    return sum + Math.abs(source.values[field] - destination.values[field]);
  }, 0) / Object.keys(source.values).length;
  return clamp(language * communication * (1 - valueDistance * 0.26), 0.45, 1);
};

export const cultureIdentityChanged = identityChanged;
