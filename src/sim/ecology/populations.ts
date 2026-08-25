import type { PopulationState, SpeciesState } from "../types.ts";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const populationCellIndex = (population: PopulationState, width: number, height: number): number => {
  const match = /^region:(\d+):(\d+)$/.exec(population.regionId);
  if (!match) return 0;
  const x = Number(match[1] ?? 0);
  const y = Number(match[2] ?? 0);
  return clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
};

export const suitability = (
  species: SpeciesState,
  temperature: number,
  humidity: number,
): number => {
  const tempDistance = Math.abs(temperature - (species.traits.temperatureOptimum ?? 0.5));
  const humidityDistance = Math.abs(humidity - (species.traits.humidityOptimum ?? 0.5));
  return clamp(1 - tempDistance * 1.7 - humidityDistance * 1.2, 0, 1);
};

export const nextPopulationCount = (
  population: PopulationState,
  species: SpeciesState,
  suitabilityScore: number,
  food: number,
): number => {
  const reproduction = species.traits.reproduction ?? 0.2;
  const energyUse = species.traits.energyUse ?? 0.3;
  const growth = population.count * reproduction * suitabilityScore * food * 0.08;
  const loss = population.count * energyUse * (1 - suitabilityScore) * 0.035;
  return Math.max(0, Math.min(1_000_000, population.count + growth - loss));
};
