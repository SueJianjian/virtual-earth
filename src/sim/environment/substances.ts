import { technologyProfileForRegion } from "../culture/technology.ts";
import { forkRandom, hashString, randomFloat } from "../random.ts";
import type {
  ChemistryFieldName,
  RegionId,
  SubstanceKind,
  SubstanceProperties,
  SubstanceState,
  WorldDelta,
  WorldState,
} from "../types.ts";

export const MAX_SUBSTANCES = 256;
const CELLS_PER_STEP = 16;
const chemistryFields: ChemistryFieldName[] = ["carbon", "nitrogen", "phosphorus", "organics", "oxygen"];

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const rounded = (value: number): number => Math.round(clamp(value) * 1_000_000) / 1_000_000;

const regionForIndex = (state: WorldState, index: number): RegionId =>
  `region:${index % state.fields.elevation.width}:${Math.floor(index / state.fields.elevation.width)}` as RegionId;

const compositionAt = (state: WorldState, index: number): SubstanceState["composition"] => {
  const raw = Object.fromEntries(chemistryFields.map((field) => [field, Math.max(0, state.chemistry[field].values[index] ?? 0)])) as Record<ChemistryFieldName, number>;
  const total = Math.max(0.000001, Object.values(raw).reduce((sum, value) => sum + value, 0));
  return Object.fromEntries(chemistryFields.map((field) => [field, rounded(raw[field] / total)])) as SubstanceState["composition"];
};

const propertiesFor = (
  kind: SubstanceKind,
  composition: SubstanceState["composition"],
  environment: { elevation: number; temperature: number; water: number; nutrients: number },
): SubstanceProperties => {
  const { carbon, nitrogen, phosphorus, organics, oxygen } = composition;
  const { elevation, temperature, water, nutrients } = environment;
  if (kind === "organic-compound") {
    return {
      hardness: rounded(0.08 + carbon * 0.22 + phosphorus * 0.12),
      density: rounded(0.18 + carbon * 0.24 + water * 0.12),
      reactivity: rounded(0.28 + organics * 0.38 + oxygen * 0.2),
      conductivity: rounded(0.06 + carbon * 0.2 + nitrogen * 0.12),
      energyPotential: rounded(0.22 + carbon * 0.34 + organics * 0.3),
      biologicalAffinity: rounded(0.45 + organics * 0.35 + nitrogen * 0.12 + phosphorus * 0.08),
      stability: rounded(0.32 + (1 - temperature) * 0.18 + water * 0.16 + carbon * 0.16),
    };
  }
  const crystalline = kind === "crystal";
  return {
    hardness: rounded(0.34 + elevation * 0.3 + phosphorus * 0.2 + (crystalline ? 0.14 : 0)),
    density: rounded(0.28 + elevation * 0.24 + carbon * 0.18 + nitrogen * 0.1),
    reactivity: rounded(0.12 + oxygen * 0.3 + temperature * 0.18 + nutrients * 0.08),
    conductivity: rounded(0.08 + carbon * 0.32 + phosphorus * 0.16 + (crystalline ? 0.12 : 0)),
    energyPotential: rounded(0.08 + carbon * 0.18 + temperature * 0.18 + (crystalline ? 0.22 : 0)),
    biologicalAffinity: rounded(0.08 + nutrients * 0.24 + phosphorus * 0.2 + water * 0.08),
    stability: rounded(0.42 + elevation * 0.2 + (1 - temperature) * 0.12 + (crystalline ? 0.18 : 0)),
  };
};

const nameFor = (seed: number, signature: string, kind: SubstanceKind): string => {
  const prefixes = ["曜", "澜", "砾", "霁", "烬", "辉", "岚", "泠", "苍", "熔", "璇", "湛"];
  const stems = ["脉", "核", "纤", "络", "壤", "辉", "棱", "凝", "潮", "穹", "息", "纹"];
  const suffixes: Record<SubstanceKind, string[]> = {
    mineral: ["矿", "岩", "砂", "石"],
    crystal: ["晶", "晶簇", "晶体", "晶核"],
    "organic-compound": ["胶", "素", "质", "凝体"],
    "engineered-composite": ["合材", "复晶", "聚质", "构体"],
  };
  const hash = hashString(`${seed}:${signature}`);
  const prefix = prefixes[hash % prefixes.length] ?? "曜";
  const stem = stems[Math.floor(hash / prefixes.length) % stems.length] ?? "脉";
  const suffixList = suffixes[kind];
  const suffix = suffixList[Math.floor(hash / Math.max(1, prefixes.length * stems.length)) % suffixList.length] ?? "质";
  return `${prefix}${stem}${suffix}`;
};

const signatureFor = (state: WorldState, index: number, kind: SubstanceKind): string => {
  const quantized = [
    state.fields.elevation.values[index],
    state.fields.temperature.values[index],
    state.fields.water.values[index],
    state.fields.nutrients.values[index],
    ...chemistryFields.map((field) => state.chemistry[field].values[index]),
  ].map((value) => Math.round(clamp(value ?? 0) * 32));
  return `${kind}:${regionForIndex(state, index)}:${quantized.join(":")}`;
};

const naturalCandidateKind = (state: WorldState, index: number): { kind: Exclude<SubstanceKind, "engineered-composite">; score: number } => {
  const elevation = clamp(state.fields.elevation.values[index] ?? 0);
  const temperature = clamp(state.fields.temperature.values[index] ?? 0);
  const water = clamp(state.fields.water.values[index] ?? 0);
  const nutrients = clamp(state.fields.nutrients.values[index] ?? 0);
  const organics = clamp((state.chemistry.organics.values[index] ?? 0) * 900);
  const phosphorus = clamp(state.chemistry.phosphorus.values[index] ?? 0);
  if (organics >= 0.25 && water >= 0.24) {
    return { kind: "organic-compound", score: clamp(organics * 0.42 + water * 0.24 + nutrients * 0.16 + (1 - Math.abs(temperature - 0.55)) * 0.18) };
  }
  if (elevation >= 0.56) {
    return { kind: "crystal", score: clamp(elevation * 0.42 + phosphorus * 0.2 + temperature * 0.16 + nutrients * 0.22) };
  }
  return { kind: "mineral", score: clamp(elevation * 0.32 + nutrients * 0.34 + phosphorus * 0.2 + (1 - water) * 0.14) };
};

export const deriveNaturalSubstance = (state: WorldState, index: number, elapsedYears = 1): SubstanceState | undefined => {
  if (state.formation.phase !== "stable-crust" || index < 0 || index >= state.fields.elevation.values.length) return undefined;
  const regionId = regionForIndex(state, index);
  if (state.substances.some((substance) => substance.regionId === regionId && substance.formation !== "engineered")) return undefined;
  const candidate = naturalCandidateKind(state, index);
  if (candidate.score < 0.3) return undefined;
  const signature = signatureFor(state, index, candidate.kind);
  const rarityRoll = (hashString(`${state.seed}:${signature}:rarity`) % 10_000) / 10_000;
  const probability = clamp(0.08 + (candidate.score - 0.3) * 0.72, 0.08, 0.55);
  if (rarityRoll >= probability) return undefined;
  const composition = compositionAt(state, index);
  const environment = {
    elevation: clamp(state.fields.elevation.values[index] ?? 0),
    temperature: clamp(state.fields.temperature.values[index] ?? 0),
    water: clamp(state.fields.water.values[index] ?? 0),
    nutrients: clamp(state.fields.nutrients.values[index] ?? 0),
  };
  const hydrothermal = candidate.kind === "crystal" && environment.water >= 0.16 && environment.temperature >= 0.45;
  const formation = candidate.kind === "organic-compound" ? "biochemical" : hydrothermal ? "hydrothermal" : "geological";
  return {
    id: `substance:${candidate.kind}:${hashString(`${state.seed}:${signature}`).toString(16)}`,
    name: nameFor(state.seed, signature, candidate.kind),
    kind: candidate.kind,
    formation,
    status: "latent",
    regionId,
    originTick: state.tick + 1,
    originYears: state.years + Math.max(0, elapsedYears),
    parentIds: [],
    composition,
    properties: propertiesFor(candidate.kind, composition, environment),
    discoveredByIds: [],
  };
};

const discoverSubstance = (state: WorldState, elapsedYears: number): { substance: SubstanceState; probability: number; roll: number } | undefined => {
  const agentsByRegion = new Map<RegionId, WorldState["agents"]>();
  for (const agent of state.agents) {
    const agents = agentsByRegion.get(agent.regionId) ?? [];
    agents.push(agent);
    agentsByRegion.set(agent.regionId, agents);
  }
  for (const substance of state.substances.filter((candidate) => candidate.status === "latent").sort((left, right) => left.id.localeCompare(right.id))) {
    const agents = agentsByRegion.get(substance.regionId) ?? [];
    if (agents.length === 0) continue;
    const observation = agents.reduce((sum, agent) => sum + (agent.skills.observation ?? 0), 0) / agents.length;
    const toolUse = agents.reduce((sum, agent) => sum + (agent.skills.toolUse ?? 0), 0) / agents.length;
    const technology = technologyProfileForRegion(state, substance.regionId);
    const probability = clamp(0.035 + observation * 0.22 + toolUse * 0.14 + technology.construction * 0.18, 0.035, 0.6);
    const [roll] = randomFloat(forkRandom(state.random, `substance-discovery:${substance.id}:${state.tick}`));
    if (roll >= probability) continue;
    const discoverers = [...agents]
      .sort((left, right) => ((right.skills.observation ?? 0) + (right.skills.toolUse ?? 0)) - ((left.skills.observation ?? 0) + (left.skills.toolUse ?? 0)) || left.id.localeCompare(right.id))
      .slice(0, 4)
      .map((agent) => agent.id);
    return {
      substance: {
        ...substance,
        status: "known",
        discoveredByIds: discoverers,
        discoveryTick: state.tick + 1,
        discoveryYears: state.years + Math.max(0, elapsedYears),
      },
      probability,
      roll,
    };
  }
  return undefined;
};

const engineerComposite = (state: WorldState, elapsedYears: number): { substance: SubstanceState; probability: number; roll: number } | undefined => {
  const knownByRegion = new Map<RegionId, SubstanceState[]>();
  for (const substance of state.substances) {
    if (substance.status !== "known") continue;
    const list = knownByRegion.get(substance.regionId) ?? [];
    list.push(substance);
    knownByRegion.set(substance.regionId, list);
  }
  for (const culture of [...state.cultures].sort((left, right) => left.id.localeCompare(right.id))) {
    if (state.substances.some((substance) => substance.regionId === culture.regionId && substance.kind === "engineered-composite")) continue;
    const parents = (knownByRegion.get(culture.regionId) ?? []).filter((substance) => substance.kind !== "engineered-composite");
    const agents = state.agents.filter((agent) => agent.regionId === culture.regionId);
    const technology = technologyProfileForRegion(state, culture.regionId);
    if (parents.length === 0 || agents.length < 4 || technology.construction < 1 / 3 || technology.energy < 1 / 6) continue;
    const source = [...parents].sort((left, right) => right.properties.stability + right.properties.conductivity - left.properties.stability - left.properties.conductivity || left.id.localeCompare(right.id))[0];
    if (!source) continue;
    const inventiveness = agents.reduce((sum, agent) => sum + (agent.traits.curiosity ?? 0) + (agent.skills.toolUse ?? 0), 0) / (agents.length * 2);
    const probability = clamp(0.015 + inventiveness * 0.05 + technology.construction * 0.06 + technology.energy * 0.05, 0.015, 0.16);
    const [roll] = randomFloat(forkRandom(state.random, `substance-engineering:${culture.id}:${source.id}:${state.tick}`));
    if (roll >= probability) continue;
    const inventors = [...agents]
      .sort((left, right) => ((right.traits.curiosity ?? 0) + (right.skills.toolUse ?? 0)) - ((left.traits.curiosity ?? 0) + (left.skills.toolUse ?? 0)) || left.id.localeCompare(right.id))
      .slice(0, 4)
      .map((agent) => agent.id);
    const signature = `engineered:${culture.regionId}:${source.id}:${Math.round(technology.construction * 6)}:${Math.round(technology.energy * 6)}`;
    const properties: SubstanceProperties = {
      hardness: rounded(source.properties.hardness * 0.72 + technology.construction * 0.28),
      density: rounded(source.properties.density * 0.82 + 0.08),
      reactivity: rounded(source.properties.reactivity * (0.82 - technology.construction * 0.12)),
      conductivity: rounded(source.properties.conductivity * 0.58 + technology.energy * 0.42),
      energyPotential: rounded(source.properties.energyPotential * 0.55 + technology.energy * 0.45),
      biologicalAffinity: rounded(source.properties.biologicalAffinity * 0.68 + technology.construction * 0.08),
      stability: rounded(source.properties.stability * 0.62 + technology.construction * 0.3 + technology.energy * 0.08),
    };
    return {
      substance: {
        id: `substance:engineered-composite:${hashString(`${state.seed}:${signature}`).toString(16)}`,
        name: nameFor(state.seed, signature, "engineered-composite"),
        kind: "engineered-composite",
        formation: "engineered",
        status: "known",
        regionId: culture.regionId,
        originTick: state.tick + 1,
        originYears: state.years + Math.max(0, elapsedYears),
        parentIds: [source.id],
        composition: { ...source.composition },
        properties,
        discoveredByIds: inventors,
        discoveryTick: state.tick + 1,
        discoveryYears: state.years + Math.max(0, elapsedYears),
      },
      probability,
      roll,
    };
  }
  return undefined;
};

export const stepSubstances = (state: WorldState, elapsedYears = 1): WorldDelta => {
  const delta = emptyDelta();
  if (state.formation.phase !== "stable-crust") return delta;
  const remaining = Math.max(0, MAX_SUBSTANCES - state.substances.length);
  const existingIds = new Set(state.substances.map((substance) => substance.id));
  const plannedRegions = new Set(state.substances.filter((substance) => substance.formation !== "engineered").map((substance) => substance.regionId));
  const cellCount = state.fields.elevation.values.length;
  let created = 0;
  for (let offset = 0; offset < Math.min(CELLS_PER_STEP, cellCount) && created < remaining; offset += 1) {
    const index = (state.tick * CELLS_PER_STEP + offset) % cellCount;
    const regionId = regionForIndex(state, index);
    if (plannedRegions.has(regionId)) continue;
    const substance = deriveNaturalSubstance(state, index, elapsedYears);
    if (!substance || existingIds.has(substance.id)) continue;
    existingIds.add(substance.id);
    plannedRegions.add(regionId);
    created += 1;
    delta.entityEffects.push({ collection: "substances", operation: "create", id: substance.id, value: substance });
    delta.eventDrafts.push({
      kind: "substance-formation",
      ruleId: `environment:substance-${substance.formation}`,
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: { regionId: substance.regionId, substanceKind: substance.kind, stability: substance.properties.stability, energyPotential: substance.properties.energyPotential },
      payload: { substanceId: substance.id, name: substance.name, kind: substance.kind, formation: substance.formation, regionId: substance.regionId },
      source: "natural",
    });
  }

  const discovery = discoverSubstance(state, elapsedYears);
  if (discovery) {
    delta.entityEffects.push({ collection: "substances", operation: "update", id: discovery.substance.id, value: discovery.substance });
    delta.eventDrafts.push({
      kind: "substance-discovery",
      ruleId: "culture:substance-discovery",
      sourceIds: discovery.substance.discoveredByIds,
      probability: discovery.probability,
      roll: discovery.roll,
      evidence: { regionId: discovery.substance.regionId, substanceKind: discovery.substance.kind, discoverers: discovery.substance.discoveredByIds.length },
      payload: { substanceId: discovery.substance.id, name: discovery.substance.name, kind: discovery.substance.kind, regionId: discovery.substance.regionId },
      source: "natural",
    });
  }

  if (state.substances.length + created < MAX_SUBSTANCES) {
    const engineered = engineerComposite(state, elapsedYears);
    if (engineered && !existingIds.has(engineered.substance.id)) {
      delta.entityEffects.push({ collection: "substances", operation: "create", id: engineered.substance.id, value: engineered.substance });
      delta.eventDrafts.push({
        kind: "substance-engineering",
        ruleId: "culture:original-material-engineering",
        sourceIds: engineered.substance.discoveredByIds,
        probability: engineered.probability,
        roll: engineered.roll,
        evidence: { regionId: engineered.substance.regionId, parentCount: engineered.substance.parentIds.length, stability: engineered.substance.properties.stability, conductivity: engineered.substance.properties.conductivity },
        payload: { substanceId: engineered.substance.id, name: engineered.substance.name, kind: engineered.substance.kind, parentIds: engineered.substance.parentIds, regionId: engineered.substance.regionId },
        source: "natural",
      });
    }
  }
  return delta;
};

export type SubstanceEffectProfile = {
  materialYield: number;
  structuralStrength: number;
  energyEfficiency: number;
  biologicalUtility: number;
};

export const substanceEffectProfilesForState = (state: Pick<WorldState, "substances">): ReadonlyMap<RegionId, SubstanceEffectProfile> => {
  const profiles = new Map<RegionId, SubstanceEffectProfile>();
  for (const substance of state.substances) {
    if (substance.status !== "known") continue;
    const current = profiles.get(substance.regionId) ?? { materialYield: 0, structuralStrength: 0, energyEfficiency: 0, biologicalUtility: 0 };
    const engineeredFactor = substance.kind === "engineered-composite" ? 1 : 0.82;
    current.materialYield = Math.max(current.materialYield, rounded((substance.properties.hardness * 0.45 + substance.properties.stability * 0.55) * engineeredFactor));
    current.structuralStrength = Math.max(current.structuralStrength, rounded((substance.properties.hardness * 0.55 + substance.properties.stability * 0.45) * engineeredFactor));
    current.energyEfficiency = Math.max(current.energyEfficiency, rounded((substance.properties.conductivity * 0.55 + substance.properties.energyPotential * 0.45) * engineeredFactor));
    current.biologicalUtility = Math.max(current.biologicalUtility, rounded((substance.properties.biologicalAffinity * 0.7 + (1 - substance.properties.reactivity) * 0.3) * engineeredFactor));
    profiles.set(substance.regionId, current);
  }
  return profiles;
};

export const substanceEffectProfileForRegion = (state: Pick<WorldState, "substances">, regionId: RegionId): SubstanceEffectProfile =>
  substanceEffectProfilesForState(state).get(regionId) ?? { materialYield: 0, structuralStrength: 0, energyEfficiency: 0, biologicalUtility: 0 };
