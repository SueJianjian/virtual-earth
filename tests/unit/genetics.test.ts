import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import {
  founderGenetics,
  geneticEnvironmentFitness,
  HERITABLE_AGENT_TRAITS,
  inheritAgentGenetics,
  summarizePopulationGenetics,
  validAgentGenetics,
} from "../../src/sim/agents/genetics.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";

const fixture = () => {
  const species = createSpecies("genetics", "consumer");
  const population = { id: "population:genetics" as never, speciesId: species.id, regionId: "region:1:1" as never, count: 64, energy: 1 };
  const first = createAgent(population, species, 0, "genetics");
  const second = createAgent(population, species, 1, "genetics");
  return { species, population, first, second };
};

describe("individual inheritance and selection", () => {
  it("creates deterministic bounded founder genetics", () => {
    const { species, first } = fixture();
    const genetics = founderGenetics(species, first.traits, "founder-test");

    expect(genetics).toEqual(founderGenetics(species, first.traits, "founder-test"));
    expect(validAgentGenetics(genetics)).toBe(true);
    expect(HERITABLE_AGENT_TRAITS.every((trait) => first.traits[trait]! >= 0 && first.traits[trait]! <= 1)).toBe(true);
  });

  it("recombines both parents, advances generation, and records bounded mutations", () => {
    const { species, population, first, second } = fixture();
    first.genetics = { ...first.genetics!, generation: 2 };
    second.genetics = { ...second.genetics!, generation: 4 };
    for (const trait of HERITABLE_AGENT_TRAITS) {
      first.traits[trait] = 0.2;
      second.traits[trait] = 0.8;
    }
    species.blueprint = { ...species.blueprint!, mutationRate: 0.08, inheritanceFidelity: 0.86 };
    const child = createAgent(population, species, 2, "child", [first.id, second.id]);
    const result = inheritAgentGenetics(child, first, second, species, "inheritance-seed");
    const repeated = inheritAgentGenetics(child, first, second, species, "inheritance-seed");

    expect(result).toEqual(repeated);
    expect(result.agent.genetics).toMatchObject({ generation: 5, mutationCount: result.mutationCount });
    expect(validAgentGenetics(result.agent.genetics)).toBe(true);
    expect(result.mutationCount).toBeGreaterThan(0);
    expect(result.mutationRoll).toBeLessThan(result.mutationProbability);
    expect(result.mutationCount).toBeLessThanOrEqual(HERITABLE_AGENT_TRAITS.length);
    expect(HERITABLE_AGENT_TRAITS.every((trait) => result.agent.traits[trait]! >= 0 && result.agent.traits[trait]! <= 1)).toBe(true);
  });

  it("gives better adapted traits higher fitness under the same local climate", () => {
    const { species, first, second } = fixture();
    species.traits.temperatureOptimum = 1;
    species.traits.humidityOptimum = 1;
    first.traits.thermalTolerance = 0;
    first.traits.hydrationRetention = 0;
    second.traits.thermalTolerance = 1;
    second.traits.hydrationRetention = 1;

    const exposed = geneticEnvironmentFitness(first, species, 0.5, 0.5);
    const adapted = geneticEnvironmentFitness(second, species, 0.5, 0.5);

    expect(adapted.fitness).toBeGreaterThan(exposed.fitness);
    expect(adapted.thermalStress).toBeLessThan(exposed.thermalStress);
    expect(adapted.hydrationStress).toBeLessThan(exposed.hydrationStress);
  });

  it("summarizes the selected population sample without growing state", () => {
    const { first, second } = fixture();
    first.traits.metabolicEfficiency = 0.2;
    second.traits.metabolicEfficiency = 0.8;

    const sample = summarizePopulationGenetics([first, second]);

    expect(sample?.sampleSize).toBe(2);
    expect(sample?.means.metabolicEfficiency).toBeCloseTo(0.5, 8);
    expect(Object.keys(sample?.means ?? {})).toHaveLength(HERITABLE_AGENT_TRAITS.length);
  });
});
