import { describe, expect, it } from "vitest";
import { createAgent } from "../../src/sim/agents/lifecycle.ts";
import { createSpeciesBlueprint, mutateSpeciesBlueprint } from "../../src/sim/ecology/blueprints.ts";
import { nextPopulationCount, suitability } from "../../src/sim/ecology/populations.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";

describe("original life blueprints", () => {
  it("creates deterministic but seed-distinct biological identities", () => {
    const first = createSpeciesBlueprint("planet:life:alpha", "consumer");
    const repeat = createSpeciesBlueprint("planet:life:alpha", "consumer");
    const other = createSpeciesBlueprint("planet:life:beta", "consumer");

    expect(repeat).toEqual(first);
    expect(other.noveltySignature).not.toBe(first.noveltySignature);
    expect(first.senses.length).toBeGreaterThan(0);
    expect(first.senses.length).toBeLessThanOrEqual(3);
    expect([
      first.metabolicEfficiency,
      first.fecundity,
      first.thermalTolerance,
      first.hydrationRetention,
      first.mutationRate,
      first.inheritanceFidelity,
    ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });

  it("branches descendants from their parent blueprint instead of rebuilding them randomly", () => {
    const parent = createSpeciesBlueprint("lineage:parent", "producer");
    const child = mutateSpeciesBlueprint(parent, "lineage:child", "producer", { temperature: 0.22, humidity: 0.78 });

    expect(child.noveltySignature).not.toBe(parent.noveltySignature);
    expect(child.metabolism).toMatch(/radiant-harvesting|mineral-chemosynthesis|thermal-gradient/);
    expect(child.inheritanceFidelity).toBeGreaterThanOrEqual(0.86);
    expect(child.inheritanceFidelity).toBeLessThanOrEqual(0.995);
    expect(child.thermalTolerance).not.toBe(parent.thermalTolerance);
    expect(child.senses.length).toBeGreaterThan(0);
  });

  it("feeds biological traits into habitat, population growth, and individual life history", () => {
    const baseSpecies = createSpecies("blueprint-feedback", "consumer");
    const population = { id: "population:blueprint-feedback" as never, speciesId: baseSpecies.id, regionId: "region:0:0" as never, count: 100, energy: 1 };
    const adaptable = {
      ...baseSpecies,
      blueprint: {
        ...baseSpecies.blueprint!,
        lifespanYears: 130,
        fecundity: 1,
        metabolicEfficiency: 1,
        thermalTolerance: 1,
        hydrationRetention: 1,
      },
    };
    const fragile = {
      ...baseSpecies,
      blueprint: {
        ...baseSpecies.blueprint!,
        lifespanYears: 20,
        fecundity: 0,
        metabolicEfficiency: 0,
        thermalTolerance: 0,
        hydrationRetention: 0,
      },
    };

    expect(suitability(adaptable, 0.2, 0.2)).toBeGreaterThan(suitability(fragile, 0.2, 0.2));
    expect(nextPopulationCount(population, adaptable, 1, 1)).toBeGreaterThan(nextPopulationCount(population, fragile, 1, 1));
    const longLived = createAgent(population, adaptable, 0, "blueprint-life-history");
    const shortLived = createAgent(population, fragile, 0, "blueprint-life-history");
    expect(longLived.lifespan).toBeGreaterThan(shortLived.lifespan);
    expect(longLived.traits.fertility ?? 0).toBeGreaterThan(shortLived.traits.fertility ?? 0);
  });
});
