import type { SimulationStage, WorldDelta } from "../types.ts";
import { stepWorldviews } from "./engine.ts";
import { meanFoodSecurity } from "../agents/food.ts";

export { createWorldviewState, getWorldviewPack, listWorldviewPacks } from "./registry.ts";
export { stepWorldviews } from "./engine.ts";
export type { WorldviewPack, WorldviewRule, MotifDefinition, ResourceDefinition, EventTemplate } from "../types.ts";

const emptyDelta = (): WorldDelta => ({ fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [], resourceTransactions: [], worldviewEffects: [], eventDrafts: [] });
const mean = (values: Float32Array): number => values.length === 0 ? 0 : Array.from(values).reduce((sum, value) => sum + value, 0) / values.length;

export const worldviewStage: SimulationStage = {
  id: "worldview",
  order: 70,
  run: (state) => {
    const result = stepWorldviews(state, {
      state,
      random: state.random,
      enabledPackIds: state.worldview.enabledPackIds,
      metrics: {
        meanTemperature: mean(state.fields.temperature.values), meanHumidity: mean(state.fields.humidity.values), waterCoverage: mean(state.fields.water.values), nutrientLevel: mean(state.fields.nutrients.values), biomass: mean(state.fields.biomass.values), oxygen: mean(state.chemistry.oxygen.values),
        populationCount: state.populations.reduce((sum, population) => sum + population.count, 0), cognitivePotential: state.species.reduce((sum, species) => sum + (species.traits.cognitivePotential ?? 0), 0), knowledgeDiversity: state.cultures.reduce((sum, culture) => sum + culture.knowledgeIds.length, 0), beliefDiversity: state.cultures.reduce((sum, culture) => sum + culture.beliefIds.length, 0), householdCount: state.organizations.filter((organization) => organization.type === "family").length, settlementDensity: state.organizations.filter((organization) => organization.type === "settlement" || organization.type === "city").length, tradeVolume: state.events.filter((event) => event.kind === "organization-trade").reduce((sum, event) => sum + Number(event.payload.amount ?? 0), 0), foodSurplus: state.resources.filter((resource) => resource.resourceId === "food").reduce((sum, resource) => sum + resource.amount, 0), foodSecurity: meanFoodSecurity(state), organizationCapacity: state.organizations.reduce((sum, organization) => sum + organization.memberIds.length, 0), resourceBalance: state.resources.reduce((sum, resource) => sum + resource.amount, 0),
      },
    });
    return { ...emptyDelta(), ...result };
  },
};
