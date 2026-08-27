import type { ChemistryChange, WorldState } from "../types.ts";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const calculateChemistry = (state: WorldState, elapsedYears = 1): ChemistryChange[] => {
  const { fields, chemistry } = state;
  const years = Math.max(0, elapsedYears);
  const changes: ChemistryChange[] = [];
  for (let index = 0; index < fields.elevation.values.length; index += 1) {
    const water = fields.water.values[index] ?? 0;
    const nutrients = fields.nutrients.values[index] ?? 0;
    const temperature = fields.temperature.values[index] ?? 0;
    const humidity = fields.humidity.values[index] ?? 0;
    const biomass = fields.biomass.values[index] ?? 0;
    const organics = chemistry.organics.values[index] ?? 0;
    const elevation = fields.elevation.values[index] ?? 0;
    const weathering = (1 - elevation) * 0.0007;
    const organicDecay = organics * 0.0015;
    const productivity = biomass * temperature * (0.35 + humidity * 0.65) * 0.0009;
    const respiration = biomass * (0.00012 + temperature * 0.00022);
    const prebioticOrganics = water * temperature * (0.75 + nutrients * 0.25) * 0.000035;
    changes.push(
      { field: "carbon", index, operation: "add", value: (weathering * 0.2 + respiration * 0.3 - productivity * 0.35 - organicDecay * 0.08) * years, causeRuleId: "carbon-cycle" },
      { field: "nitrogen", index, operation: "add", value: (weathering * 0.12 - nutrients * 0.0002) * years, causeRuleId: "chemistry-cycle" },
      { field: "phosphorus", index, operation: "add", value: (weathering * 0.08 - nutrients * 0.0001) * years, causeRuleId: "chemistry-cycle" },
      { field: "organics", index, operation: "add", value: (prebioticOrganics + biomass * 0.0001 - organicDecay) * years, causeRuleId: "organic-cycle" },
      { field: "oxygen", index, operation: "add", value: (productivity * 0.45 - respiration * 0.25 - (chemistry.oxygen.values[index] ?? 0) * 0.00008) * years, causeRuleId: "oxygen-cycle" },
    );
  }
  return changes;
};

export const applyChemistryChanges = (
  state: WorldState,
  changes: ChemistryChange[],
): WorldState["chemistry"] => {
  const next = structuredClone(state.chemistry);
  for (const change of changes) {
    const values = next[change.field].values;
    const current = values[change.index] ?? 0;
    const value = change.operation === "add" ? current + change.value : change.value;
    values[change.index] = clamp01(value);
  }
  return next;
};
