import type { WorldState } from "../types.ts";
import { PREBIOTIC_ORGANICS_THRESHOLD } from "../environment/thresholds.ts";

export type DisplayPhase =
  | "dust-cloud"
  | "planetesimals"
  | "accretion"
  | "differentiation"
  | "cooling"
  | "primordial"
  | "oceanic"
  | "chemical"
  | "ecological"
  | "sapient"
  | "social"
  | "mythic"
  | "cultivation";

const average = (values: Float32Array): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
};

export const derivePhase = (state: WorldState): DisplayPhase => {
  if (state.formation.phase !== "stable-crust") return state.formation.phase;
  if (state.worldview.entities.some((entity) => entity.kind === "cultivation-path")) return "cultivation";
  if (state.worldview.entities.length > 0) return "mythic";
  if (state.organizations.length > 0) return "social";
  if (state.agents.length > 0) return "sapient";
  if (average(state.fields.biomass.values) > 0.01) return "ecological";
  if (average(state.chemistry.organics.values) >= PREBIOTIC_ORGANICS_THRESHOLD) return "chemical";
  if (average(state.fields.water.values) > 0.1) return "oceanic";
  return "primordial";
};
