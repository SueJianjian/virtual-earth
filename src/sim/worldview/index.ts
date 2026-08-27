import type { SimulationStage, WorldDelta } from "../types.ts";
import { stepWorldviews } from "./engine.ts";
import { meanFoodSecurity } from "../agents/food.ts";
import { lifetimeTradeVolume } from "../events/ledger.ts";

export { createWorldviewState, DEFAULT_WORLDVIEW_PACK_IDS, getWorldviewPack, listWorldviewPacks } from "./registry.ts";
export { stepWorldviews } from "./engine.ts";
export type { WorldviewPack, WorldviewRule, MotifDefinition, ResourceDefinition, EventTemplate } from "../types.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
const mean = (values: Float32Array): number => {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
};

const terrainRelief = (state: Parameters<typeof stepWorldviews>[0]): number => {
  const { elevation } = state.fields;
  if (elevation.values.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < elevation.values.length; index += 1) {
    const x = index % elevation.width;
    const east = Math.floor(index / elevation.width) * elevation.width + (x + 1) % elevation.width;
    total += Math.abs((elevation.values[index] ?? 0) - (elevation.values[east] ?? 0));
  }
  return total / elevation.values.length;
};

export const worldviewStage: SimulationStage = {
  id: "worldview",
  order: 70,
  run: (state) => {
    const result = stepWorldviews(state, {
      state,
      random: state.random,
      tick: state.tick,
      years: state.years,
      enabledPackIds: state.worldview.enabledPackIds,
      metrics: {
        meanTemperature: mean(state.fields.temperature.values), meanHumidity: mean(state.fields.humidity.values), waterCoverage: mean(state.fields.water.values), nutrientLevel: mean(state.fields.nutrients.values), biomass: mean(state.fields.biomass.values), oxygen: mean(state.chemistry.oxygen.values),
        carbon: mean(state.chemistry.carbon.values), organics: mean(state.chemistry.organics.values),
        oceanCoverage: state.fields.water.values.filter((value) => value >= 0.5).length / Math.max(1, state.fields.water.values.length),
        terrainRelief: terrainRelief(state),
        populationCount: state.populations.reduce((sum, population) => sum + population.count, 0), cognitivePotential: state.species.reduce((sum, species) => sum + (species.traits.cognitivePotential ?? 0), 0), knowledgeDiversity: state.cultures.reduce((sum, culture) => sum + culture.knowledgeIds.length, 0), beliefDiversity: state.cultures.reduce((sum, culture) => sum + culture.beliefIds.length, 0), householdCount: state.organizations.filter((organization) => organization.type === "family").length, settlementDensity: state.organizations.filter((organization) => organization.type === "settlement" || organization.type === "city").length, tradeVolume: lifetimeTradeVolume(state), foodSurplus: state.resources.filter((resource) => resource.resourceId === "food").reduce((sum, resource) => sum + resource.amount, 0), foodSecurity: meanFoodSecurity(state), organizationCapacity: state.organizations.reduce((sum, organization) => sum + organization.memberIds.length, 0), resourceBalance: state.resources.reduce((sum, resource) => sum + resource.amount, 0),
      },
    });
    return { ...emptyDelta(), ...result };
  },
};
