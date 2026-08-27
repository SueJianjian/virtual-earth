import { describe, expect, it } from "vitest";
import { deriveNaturalSubstance, MAX_SUBSTANCES, stepSubstances, substanceEffectProfileForRegion } from "../../src/sim/environment/substances.ts";
import type { AgentState, EntityId, KnowledgeDomain, RegionId, SubstanceState, WorldState } from "../../src/sim/types.ts";
import { createWorld } from "../../src/sim/world.ts";

const favorableWorld = (): WorldState => {
  const state = createWorld(701, { width: 8, height: 8, formation: "formed" });
  state.fields.elevation.values.fill(0.74);
  state.fields.temperature.values.fill(0.58);
  state.fields.water.values.fill(0.32);
  state.fields.nutrients.values.fill(0.82);
  state.chemistry.carbon.values.fill(0.38);
  state.chemistry.nitrogen.values.fill(0.2);
  state.chemistry.phosphorus.values.fill(0.22);
  state.chemistry.organics.values.fill(0.001);
  state.chemistry.oxygen.values.fill(0.16);
  return state;
};

const firstNaturalSubstance = (state: WorldState): SubstanceState => {
  for (let index = 0; index < state.fields.elevation.values.length; index += 1) {
    const substance = deriveNaturalSubstance(state, index);
    if (substance) return substance;
  }
  throw new Error("Expected at least one deterministic substance candidate");
};

const agentFor = (id: string, regionId: RegionId): AgentState => ({
  id: id as EntityId,
  populationId: "population:substance-observers" as EntityId,
  regionId,
  age: 28,
  lifespan: 80,
  parentIds: [],
  traits: { curiosity: 1, cooperation: 0.8, sociality: 0.8 },
  skills: { observation: 1, toolUse: 1, communication: 0.8 },
  needs: { food: 1, safety: 1 },
  memoryIds: [],
  knowledgeIds: [],
  beliefIds: [],
  relationshipIds: [],
});

const addTechnology = (state: WorldState, domains: KnowledgeDomain[]): void => {
  state.knowledge = domains.map((domain, index) => ({
    id: `knowledge:substance:${domain}:${index}`,
    kind: `innovation:${domain}:${index}`,
    domain,
    sourceIds: state.agents.slice(0, 2).map((agent) => agent.id),
    credibility: 0.9,
    transmissionCost: 0.1,
    forgettingRate: 0.01,
  }));
  state.cultures = [{
    id: "culture:substance-engineers" as EntityId,
    regionId: state.substances[0]!.regionId,
    knowledgeIds: state.knowledge.map((knowledge) => knowledge.id),
    beliefIds: [],
    transmissionRate: 0.9,
  }];
};

describe("emergent substances", () => {
  it("derives deterministic original matter from local physical and chemical conditions", () => {
    const firstState = favorableWorld();
    const first = firstNaturalSubstance(firstState);
    const index = Number(first.regionId.split(":")[2]) * firstState.fields.elevation.width + Number(first.regionId.split(":")[1]);
    const second = deriveNaturalSubstance(favorableWorld(), index);

    expect(second).toEqual(first);
    expect(first.name.length).toBeGreaterThanOrEqual(3);
    expect(first.status).toBe("latent");
    expect(["geological", "hydrothermal", "biochemical"]).toContain(first.formation);
    expect(Object.values(first.composition).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(Object.values(first.properties).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });

  it("lets local observers discover latent matter with auditable provenance", () => {
    const state = favorableWorld();
    const latent = firstNaturalSubstance(state);
    state.substances = [latent];
    state.agents = Array.from({ length: 4 }, (_, index) => agentFor(`agent:observer:${index}`, latent.regionId));

    let discovered: SubstanceState | undefined;
    for (let tick = 0; tick < 128 && !discovered; tick += 1) {
      state.tick = tick;
      const delta = stepSubstances(state, 1 / 365);
      discovered = delta.entityEffects.find((effect) => effect.collection === "substances" && effect.operation === "update" && effect.id === latent.id)?.value as SubstanceState | undefined;
    }

    expect(discovered).toMatchObject({ status: "known", regionId: latent.regionId });
    expect(discovered?.discoveredByIds.length).toBeGreaterThan(0);
    expect(discovered?.discoveryYears).toBeLessThan(1);
  });

  it("allows capable cultures to engineer a traceable composite from known local matter", () => {
    const state = favorableWorld();
    const source = { ...firstNaturalSubstance(state), status: "known" as const };
    state.substances = [source];
    state.agents = Array.from({ length: 6 }, (_, index) => agentFor(`agent:engineer:${index}`, source.regionId));
    addTechnology(state, ["construction", "construction", "energy"]);

    let engineered: SubstanceState | undefined;
    for (let tick = 0; tick < 256 && !engineered; tick += 1) {
      state.tick = tick;
      const delta = stepSubstances(state);
      engineered = delta.entityEffects.find((effect) => effect.collection === "substances" && effect.operation === "create" && effect.value?.kind === "engineered-composite")?.value as SubstanceState | undefined;
    }

    expect(engineered).toMatchObject({ kind: "engineered-composite", formation: "engineered", status: "known", parentIds: [source.id] });
    expect(engineered?.discoveredByIds.length).toBeGreaterThan(0);
  });

  it("keeps the authoritative substance collection bounded", () => {
    const state = favorableWorld();
    const template = firstNaturalSubstance(state);
    state.substances = Array.from({ length: MAX_SUBSTANCES }, (_, index) => ({ ...template, id: `substance:bounded:${index}`, regionId: `region:${index % 8}:${Math.floor(index / 8) % 8}` as RegionId }));

    const delta = stepSubstances(state);

    expect(delta.entityEffects.some((effect) => effect.collection === "substances" && effect.operation === "create")).toBe(false);
  });

  it("derives bounded production effects only from discovered matter", () => {
    const state = favorableWorld();
    const substance = firstNaturalSubstance(state);
    state.substances = [substance];
    expect(substanceEffectProfileForRegion(state, substance.regionId).materialYield).toBe(0);

    state.substances = [{ ...substance, status: "known" }];
    const profile = substanceEffectProfileForRegion(state, substance.regionId);
    expect(profile.materialYield).toBeGreaterThan(0);
    expect(Object.values(profile).every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
