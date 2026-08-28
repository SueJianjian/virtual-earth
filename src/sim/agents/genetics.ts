import { hashString } from "../random.ts";
import type { AgentGeneticState, AgentState, SpeciesState } from "../types.ts";
import { speciesBlueprintFor } from "../ecology/blueprints.ts";

export const HERITABLE_AGENT_TRAITS = [
  "cognitivePotential",
  "sociality",
  "cooperation",
  "curiosity",
  "fertility",
  "metabolicEfficiency",
  "thermalTolerance",
  "hydrationRetention",
  "diseaseResistance",
] as const;

export type HeritableAgentTrait = typeof HERITABLE_AGENT_TRAITS[number];
export type PopulationGeneticSample = {
  sampleSize: number;
  means: Record<HeritableAgentTrait, number>;
};

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const fraction = (seed: string): number => (hashString(seed) % 10_000) / 10_000;
const safeGeneration = (value: number): number => Number.isSafeInteger(value) && value >= 0 ? value : 0;

const signatureFor = (seed: string, traits: Readonly<Record<string, number>>): string => hashString(`${seed}:${HERITABLE_AGENT_TRAITS
  .map((trait) => `${trait}:${clamp(traits[trait] ?? 0).toFixed(6)}`)
  .join("|")}`).toString(16).padStart(8, "0");

export const founderHeritableTraits = (species: SpeciesState, seed: string): Record<HeritableAgentTrait, number> => {
  const blueprint = speciesBlueprintFor(species);
  const variation = (trait: HeritableAgentTrait): number => fraction(`${seed}:founder:${trait}`);
  return {
    cognitivePotential: clamp((species.traits.cognitivePotential ?? 0) * 0.9 + variation("cognitivePotential") * 0.1),
    sociality: variation("sociality"),
    cooperation: variation("cooperation"),
    curiosity: variation("curiosity"),
    fertility: clamp(blueprint.fecundity * 0.72 + variation("fertility") * 0.28),
    metabolicEfficiency: clamp(blueprint.metabolicEfficiency * 0.84 + variation("metabolicEfficiency") * 0.16),
    thermalTolerance: clamp(blueprint.thermalTolerance * 0.84 + variation("thermalTolerance") * 0.16),
    hydrationRetention: clamp(blueprint.hydrationRetention * 0.84 + variation("hydrationRetention") * 0.16),
    diseaseResistance: clamp(
      blueprint.metabolicEfficiency * 0.28
      + blueprint.hydrationRetention * 0.22
      + variation("diseaseResistance") * 0.5,
    ),
  };
};

export const founderGenetics = (
  species: SpeciesState,
  traits: Readonly<Record<string, number>>,
  seed: string,
): AgentGeneticState => ({
  generation: 0,
  lineageSignature: signatureFor(`${species.id}:${seed}:founder`, traits),
  mutationCount: 0,
  inheritanceFidelity: clamp(speciesBlueprintFor(species).inheritanceFidelity),
  parentDivergence: 0,
});

export const validAgentGenetics = (genetics: AgentGeneticState | undefined): genetics is AgentGeneticState => Boolean(genetics)
  && Number.isSafeInteger(genetics!.generation)
  && genetics!.generation >= 0
  && typeof genetics!.lineageSignature === "string"
  && /^[0-9a-f]{8}$/.test(genetics!.lineageSignature)
  && Number.isSafeInteger(genetics!.mutationCount)
  && genetics!.mutationCount >= 0
  && genetics!.mutationCount <= HERITABLE_AGENT_TRAITS.length
  && Number.isFinite(genetics!.inheritanceFidelity)
  && genetics!.inheritanceFidelity >= 0
  && genetics!.inheritanceFidelity <= 1
  && Number.isFinite(genetics!.parentDivergence)
  && genetics!.parentDivergence >= 0
  && genetics!.parentDivergence <= 1;

export const normalizeGeneticRecord = (
  record: { id: string; parentIds?: readonly string[]; traits?: Readonly<Record<string, number>>; genetics?: AgentGeneticState },
  inheritanceFidelity = 0.98,
  lineageSeed = "legacy",
): AgentGeneticState => {
  if (validAgentGenetics(record.genetics)) return { ...record.genetics };
  return {
    generation: (record.parentIds?.length ?? 0) > 0 ? 1 : 0,
    lineageSignature: signatureFor(`${lineageSeed}:${record.id}:legacy`, record.traits ?? {}),
    mutationCount: 0,
    inheritanceFidelity: clamp(inheritanceFidelity),
    parentDivergence: 0,
  };
};

export const normalizeAgentGenetics = (agent: AgentState, species?: SpeciesState): AgentGeneticState => {
  const fidelity = species ? speciesBlueprintFor(species).inheritanceFidelity : 0.98;
  return normalizeGeneticRecord(agent, fidelity, String(species?.id ?? agent.populationId));
};

export type GeneticInheritanceResult = {
  agent: AgentState;
  mutationCount: number;
  mutationProbability: number;
  mutationRoll: number;
  parentDivergence: number;
};

export const inheritAgentGenetics = (
  child: AgentState,
  first: AgentState,
  second: AgentState,
  species: SpeciesState,
  seed: string,
): GeneticInheritanceResult => {
  const blueprint = speciesBlueprintFor(species);
  const firstGenetics = normalizeAgentGenetics(first, species);
  const secondGenetics = normalizeAgentGenetics(second, species);
  const traitMutationProbability = clamp(blueprint.mutationRate * (2 - blueprint.inheritanceFidelity) * 2.5, 0.001, 0.25);
  const inheritedTraits = { ...child.traits };
  let mutationCount = 0;
  let minimumMutationRoll = 1;
  let divergence = 0;

  for (const trait of HERITABLE_AGENT_TRAITS) {
    const firstValue = clamp(first.traits[trait] ?? child.traits[trait] ?? 0.5);
    const secondValue = clamp(second.traits[trait] ?? child.traits[trait] ?? 0.5);
    const blend = 0.35 + fraction(`${seed}:${child.id}:${trait}:recombination`) * 0.3;
    const parentMean = (firstValue + secondValue) / 2;
    let value = firstValue * blend + secondValue * (1 - blend);
    const mutationRoll = fraction(`${seed}:${child.id}:${trait}:mutation-roll`);
    minimumMutationRoll = Math.min(minimumMutationRoll, mutationRoll);
    if (mutationRoll < traitMutationProbability) {
      const direction = fraction(`${seed}:${child.id}:${trait}:mutation-direction`) * 2 - 1;
      value += direction * (0.025 + blueprint.mutationRate * 0.6);
      mutationCount += 1;
    }
    value = clamp(value);
    inheritedTraits[trait] = value;
    divergence += Math.abs(value - parentMean);
  }

  const parentDivergence = clamp(divergence / HERITABLE_AGENT_TRAITS.length);
  const mutationProbability = 1 - Math.pow(1 - traitMutationProbability, HERITABLE_AGENT_TRAITS.length);
  const mutationRoll = 1 - Math.pow(1 - minimumMutationRoll, HERITABLE_AGENT_TRAITS.length);
  const generation = Math.min(Number.MAX_SAFE_INTEGER, Math.max(
    safeGeneration(firstGenetics.generation),
    safeGeneration(secondGenetics.generation),
  ) + 1);
  const genetics: AgentGeneticState = {
    generation,
    lineageSignature: signatureFor(`${firstGenetics.lineageSignature}:${secondGenetics.lineageSignature}:${seed}:${mutationCount}`, inheritedTraits),
    mutationCount,
    inheritanceFidelity: clamp(blueprint.inheritanceFidelity),
    parentDivergence,
  };
  return { agent: { ...child, traits: inheritedTraits, genetics }, mutationCount, mutationProbability, mutationRoll, parentDivergence };
};

export const summarizePopulationGenetics = (agents: readonly AgentState[]): PopulationGeneticSample | undefined => {
  if (agents.length === 0) return undefined;
  const means = Object.fromEntries(HERITABLE_AGENT_TRAITS.map((trait) => [
    trait,
    agents.reduce((sum, agent) => sum + clamp(agent.traits[trait] ?? 0.5), 0) / agents.length,
  ])) as Record<HeritableAgentTrait, number>;
  return { sampleSize: agents.length, means };
};

export type GeneticEnvironmentFitness = {
  fitness: number;
  thermalStress: number;
  hydrationStress: number;
};

export const geneticEnvironmentFitness = (
  agent: Pick<AgentState, "traits">,
  species: SpeciesState,
  temperature: number,
  humidity: number,
): GeneticEnvironmentFitness => {
  const blueprint = speciesBlueprintFor(species);
  const thermalTolerance = clamp(agent.traits.thermalTolerance ?? blueprint.thermalTolerance);
  const hydrationRetention = clamp(agent.traits.hydrationRetention ?? blueprint.hydrationRetention);
  const temperatureMismatch = Math.abs(clamp(temperature) - clamp(species.traits.temperatureOptimum ?? temperature));
  const humidityMismatch = Math.abs(clamp(humidity) - clamp(species.traits.humidityOptimum ?? humidity));
  const thermalStress = clamp((temperatureMismatch - thermalTolerance * 0.42) * 1.8);
  const hydrationStress = clamp(humidityMismatch * (1 - hydrationRetention * 0.68) * 1.55);
  return {
    fitness: clamp(1 - thermalStress * 0.58 - hydrationStress * 0.42),
    thermalStress,
    hydrationStress,
  };
};
