import type { ChemistryChange, ChemistryPatch, WorldState } from "../types.ts";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const chemistryFields: readonly ChemistryPatch["field"][] = ["carbon", "nitrogen", "phosphorus", "organics", "oxygen"];

const emptyChemistryArrays = (size: number): Record<ChemistryPatch["field"], Float64Array> => ({
  carbon: new Float64Array(size),
  nitrogen: new Float64Array(size),
  phosphorus: new Float64Array(size),
  organics: new Float64Array(size),
  oxygen: new Float64Array(size),
});

export const calculateChemistryPatches = (state: WorldState, elapsedYears = 1): ChemistryPatch[] => {
  const { fields, chemistry } = state;
  const years = Math.max(0, elapsedYears);
  const values = emptyChemistryArrays(fields.elevation.values.length);
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
    values.carbon[index] = (weathering * 0.2 + respiration * 0.3 - productivity * 0.35 - organicDecay * 0.08) * years;
    values.nitrogen[index] = (weathering * 0.12 - nutrients * 0.0002) * years;
    values.phosphorus[index] = (weathering * 0.08 - nutrients * 0.0001) * years;
    values.organics[index] = (prebioticOrganics + biomass * 0.0001 - organicDecay) * years;
    values.oxygen[index] = (productivity * 0.45 - respiration * 0.25 - (chemistry.oxygen.values[index] ?? 0) * 0.00008) * years;
  }
  return chemistryFields.map((field) => ({
    field,
    operation: "add",
    values: values[field],
    causeRuleId: field === "carbon" ? "carbon-cycle" : field === "organics" ? "organic-cycle" : field === "oxygen" ? "oxygen-cycle" : "chemistry-cycle",
  }));
};

export const calculateChemistry = (state: WorldState, elapsedYears = 1): ChemistryChange[] => {
  const patches = calculateChemistryPatches(state, elapsedYears);
  const changes: ChemistryChange[] = [];
  for (let index = 0; index < state.fields.elevation.values.length; index += 1) {
    changes.push(
      ...patches.map((patch) => ({
        field: patch.field,
        index,
        operation: "add" as const,
        value: patch.values[index] ?? 0,
        causeRuleId: patch.causeRuleId,
      })),
    );
  }
  return changes;
};

export const applyChemistryPatches = (
  state: WorldState,
  patches: readonly ChemistryPatch[],
): WorldState["chemistry"] => {
  const next = structuredClone(state.chemistry);
  for (const patch of patches) {
    const values = next[patch.field].values;
    if (patch.operation === "set") {
      values.set(patch.values);
      continue;
    }
    for (let index = 0; index < values.length; index += 1) {
      values[index] = clamp01((values[index] ?? 0) + (patch.values[index] ?? 0));
    }
  }
  return next;
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
