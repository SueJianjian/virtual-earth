import { describe, expect, it } from "vitest";
import { stepEnvironment } from "../../src/sim/environment/index.ts";
import { stepEcology } from "../../src/sim/ecology/index.ts";
import { createSpecies } from "../../src/sim/ecology/species.ts";
import { createAgent, stepAgents } from "../../src/sim/agents/index.ts";
import { technologyProfileForRegion } from "../../src/sim/culture/index.ts";
import { createOrganization, organizationCapacity } from "../../src/sim/society/organization.ts";
import { createWorld } from "../../src/sim/world.ts";
import type { KnowledgeDomain, KnowledgeState, RuleContext, WorldState } from "../../src/sim/types.ts";

const emptyMetrics = {
  meanTemperature: 0.5,
  meanHumidity: 0.5,
  waterCoverage: 0.8,
  nutrientLevel: 0.8,
  biomass: 0,
  oxygen: 0.01,
  carbon: 0.2,
  organics: 0,
  oceanCoverage: 0.5,
  terrainRelief: 0.1,
  populationCount: 0,
  cognitivePotential: 0,
  knowledgeDiversity: 0,
  beliefDiversity: 0,
  householdCount: 0,
  settlementDensity: 0,
  tradeVolume: 0,
  foodSurplus: 0,
  foodSecurity: 0,
  organizationCapacity: 0,
  resourceBalance: 0,
} as const;

const knowledge = (id: string, domain: KnowledgeDomain): KnowledgeState => ({
  id,
  kind: `innovation:${domain}:1`,
  domain,
  sourceIds: [],
  credibility: 0.8,
  transmissionCost: 0.1,
  forgettingRate: 0.01,
});

const withKnowledge = (state: WorldState, domains: KnowledgeDomain[]): WorldState => {
  const regionId = "region:0:0" as WorldState["cultures"][number]["regionId"];
  const records = domains.map((domain, index) => knowledge(`knowledge:${domain}:${index}`, domain));
  state.knowledge = records;
  state.cultures = [{ id: "culture:technology" as never, regionId, knowledgeIds: records.map((record) => record.id), beliefIds: [], transmissionRate: 0.9 }];
  return state;
};

const ecologyContext = (state: WorldState): RuleContext => ({
  state,
  random: state.random,
  metrics: emptyMetrics,
});

describe("technology feedback", () => {
  it("turns regional knowledge into bounded technology levels", () => {
    const state = withKnowledge(createWorld(401, { width: 8, height: 8, formation: "formed" }), ["subsistence", "subsistence", "construction"]);
    expect(technologyProfileForRegion(state, "region:0:0" as never)).toMatchObject({ subsistence: 1 / 3, construction: 1 / 6, navigation: 0 });
  });

  it("raises producer food output through subsistence techniques", () => {
    const base = createWorld(402, { width: 8, height: 8, formation: "formed" });
    const species = { ...createSpecies("food-tech", "producer"), traits: { ...createSpecies("food-tech", "producer").traits, temperatureOptimum: 0.5, humidityOptimum: 0.5 } };
    base.fields.temperature.values.fill(0.5);
    base.fields.humidity.values.fill(0.5);
    base.fields.nutrients.values.fill(1);
    base.species = [species];
    base.populations = [{ id: "population:food-tech" as never, speciesId: species.id, regionId: "region:0:0" as never, count: 1_000, energy: 1 }];
    const improved = withKnowledge(structuredClone(base), ["subsistence", "subsistence", "subsistence"]);
    const baseFood = stepEcology(base, ecologyContext(base)).resourceTransactions.find((transaction) => transaction.resourceId === "food")?.amount ?? 0;
    const improvedFood = stepEcology(improved, ecologyContext(improved)).resourceTransactions.find((transaction) => transaction.resourceId === "food")?.amount ?? 0;
    expect(improvedFood).toBeGreaterThan(baseFood);
  });

  it("increases organizational capacity through construction techniques", () => {
    const base = createWorld(403, { width: 8, height: 8, formation: "formed" });
    const organization = createOrganization("city", "region:0:0" as never, []);
    const context = { state: base, random: base.random, metrics: {} as never, regionId: organization.regionId, candidateMemberIds: [] };
    const improved = withKnowledge(structuredClone(base), ["construction", "construction", "construction", "construction", "construction", "construction"]);
    const improvedContext = { ...context, state: improved };
    expect(organizationCapacity({ ...organization, resources: { stone: 10 } }, improvedContext)).toBeGreaterThan(organizationCapacity({ ...organization, resources: { stone: 10 } }, context));
  });

  it("reduces old-age mortality risk through medicine techniques", () => {
    let baselineSurvivors = 0;
    let improvedSurvivors = 0;
    for (let seed = 410; seed < 442; seed += 1) {
      const base = createWorld(seed, { width: 8, height: 8, formation: "formed" });
      const species = createSpecies(`medicine:${seed}`, "consumer");
      species.traits.cognitivePotential = 0;
      const population = { id: `population:medicine:${seed}` as never, speciesId: species.id, regionId: "region:0:0" as never, count: 1, energy: 1 };
      const agent = createAgent(population, species, 0, `medicine:${seed}`);
      agent.age = agent.lifespan;
      base.species = [species];
      base.populations = [population];
      base.agents = [agent];
      const improved = withKnowledge(structuredClone(base), ["medicine", "medicine", "medicine", "medicine", "medicine", "medicine"]);
      baselineSurvivors += stepAgents(base, { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] }).entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "update") ? 1 : 0;
      improvedSurvivors += stepAgents(improved, { fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] }).entityEffects.some((effect) => effect.collection === "agents" && effect.operation === "update") ? 1 : 0;
    }
    expect(baselineSurvivors).toBe(0);
    expect(improvedSurvivors).toBeGreaterThan(0);
  });

  it("converts available organics through an energy technique and records the cause", () => {
    const state = withKnowledge(createWorld(404, { width: 8, height: 8, formation: "formed" }), ["energy", "energy", "energy"]);
    state.chemistry.organics.values.fill(0.8);
    const delta = stepEnvironment(state, { solarFlux: 1, externalEvents: [], elapsedYears: 1 });
    expect(delta.chemistryChanges).toContainEqual(expect.objectContaining({ field: "organics", operation: "add", causeRuleId: "culture:energy-conversion" }));
    expect(delta.chemistryChanges).toContainEqual(expect.objectContaining({ field: "oxygen", operation: "add", causeRuleId: "culture:energy-conversion" }));
  });

  it("applies energy conversion only to known regions in stable spatial order", () => {
    const state = createWorld(405, { width: 8, height: 8, formation: "formed" });
    const records = [knowledge("knowledge:energy:late", "energy"), knowledge("knowledge:energy:early", "energy")];
    state.knowledge = records;
    state.cultures = [
      { id: "culture:late" as never, regionId: "region:7:7" as never, knowledgeIds: [records[0]!.id], beliefIds: [], transmissionRate: 0.9 },
      { id: "culture:early" as never, regionId: "region:0:0" as never, knowledgeIds: [records[1]!.id], beliefIds: [], transmissionRate: 0.9 },
    ];
    state.chemistry.organics.values.fill(0.8);

    const changes = stepEnvironment(state, { solarFlux: 1, externalEvents: [], elapsedYears: 1 }).chemistryChanges
      .filter((change) => change.causeRuleId === "culture:energy-conversion");

    expect(changes.map((change) => change.index)).toEqual([0, 0, 0, 63, 63, 63]);
  });
});
