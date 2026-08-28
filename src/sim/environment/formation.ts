import { hashString, normalizeSeed } from "../random.ts";
import type { EnvironmentDelta, EnvironmentInput, PlanetFormationPhase, PlanetFormationState, WorldState } from "../types.ts";
import { DAYS_PER_YEAR, projectedYearsAfterStep } from "../time.ts";

export const FORMATION_DURATION_DAYS = DAYS_PER_YEAR;

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const smoothstep = (from: number, to: number, value: number): number => {
  const amount = clamp((value - from) / Math.max(Number.EPSILON, to - from));
  return amount * amount * (3 - 2 * amount);
};

const hashCell = (seed: number, x: number, y: number, salt = 0): number => {
  const mixed = normalizeSeed(seed) ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3) ^ salt;
  return hashString(String(mixed)) / 0xffffffff;
};

const hashLattice3 = (seed: number, x: number, y: number, z: number, salt: number): number => {
  let mixed = normalizeSeed(seed) ^ salt;
  mixed ^= Math.imul(x, 0x1b873593);
  mixed ^= Math.imul(y, 0x85ebca6b);
  mixed ^= Math.imul(z, 0xc2b2ae35);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 0xffffffff;
};

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

const valueNoise3 = (seed: number, x: number, y: number, z: number, salt: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);
  const tz = smoothstep(0, 1, z - z0);
  const at = (offsetX: number, offsetY: number, offsetZ: number): number =>
    hashLattice3(seed, x0 + offsetX, y0 + offsetY, z0 + offsetZ, salt);
  const bottom = lerp(
    lerp(at(0, 0, 0), at(1, 0, 0), tx),
    lerp(at(0, 1, 0), at(1, 1, 0), tx),
    ty,
  );
  const top = lerp(
    lerp(at(0, 0, 1), at(1, 0, 1), tx),
    lerp(at(0, 1, 1), at(1, 1, 1), tx),
    ty,
  );
  return lerp(bottom, top, tz);
};

export const primordialDustElevation = (seed: number, x: number, y: number): number =>
  0.018 + hashCell(seed, x, y, 0x6d2b79f5) * 0.035;

export const formedElevation = (seed: number, x: number, y: number, width: number, height: number): number => {
  const longitude = x / Math.max(1, width) * Math.PI * 2;
  const latitude = (0.5 - y / Math.max(1, height - 1)) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  const sphereX = cosLatitude * Math.cos(longitude);
  const sphereY = Math.sin(latitude);
  const sphereZ = cosLatitude * Math.sin(longitude);
  const continental = valueNoise3(seed, sphereX * 1.35, sphereY * 1.35, sphereZ * 1.35, 0x9e3779b9);
  const regional = valueNoise3(seed, sphereX * 3.8, sphereY * 3.8, sphereZ * 3.8, 0x85ebca6b);
  const detail = valueNoise3(seed, sphereX * 9.2, sphereY * 9.2, sphereZ * 9.2, 0xc2b2ae35);
  const continentalShelf = smoothstep(0.36, 0.66, continental);
  const ridge = 1 - Math.abs(regional * 2 - 1);
  return clamp(
    0.325
      + continentalShelf * 0.285
      + (regional - 0.5) * 0.13
      + (detail - 0.5) * 0.045
      + ridge * continentalShelf * 0.045,
  );
};

export const formationPhaseForProgress = (progress: number): PlanetFormationPhase => {
  if (progress < 0.12) return "dust-cloud";
  if (progress < 0.3) return "planetesimals";
  if (progress < 0.56) return "accretion";
  if (progress < 0.74) return "differentiation";
  if (progress < 1) return "cooling";
  return "stable-crust";
};

const formationStateFor = (seed: number, progress: number): PlanetFormationState => {
  const normalized = clamp(progress);
  const phase = formationPhaseForProgress(normalized);
  const accreted = smoothstep(0.08, 0.68, normalized);
  const differentiated = smoothstep(0.5, 0.82, normalized);
  const cooled = smoothstep(0.72, 1, normalized);
  const volatileSeed = 0.35 + (hashString(`volatiles:${normalizeSeed(seed)}`) % 4000) / 10_000;
  return {
    phase,
    progress: normalized,
    dustDensity: clamp(1 - smoothstep(0.04, 0.62, normalized)),
    bodyCount: phase === "stable-crust" ? 1 : Math.max(2, Math.round(120_000 * Math.pow(1 - normalized, 2.7))),
    planetaryMass: accreted,
    collisionEnergy: clamp(Math.sin(smoothstep(0.12, 0.72, normalized) * Math.PI) * (1 - cooled * 0.65)),
    coreFraction: 0.04 + differentiated * 0.28,
    surfaceHeat: clamp(0.12 + accreted * 0.92 - cooled * 0.63),
    atmosphere: smoothstep(0.58, 1, normalized) * (0.45 + volatileSeed * 0.42),
    volatileFraction: volatileSeed * smoothstep(0.42, 0.96, normalized),
  };
};

export const createPlanetFormationState = (seed: number): PlanetFormationState => formationStateFor(seed, 0);
export const completedPlanetFormationState = (seed: number): PlanetFormationState => formationStateFor(seed, 1);

const emptyDelta = (): EnvironmentDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});

const milestoneFor = (phase: PlanetFormationPhase): { kind: string; ruleId: string; name: string } => ({
  "dust-cloud": { kind: "protoplanetary-dust", ruleId: "formation:dust-condensation", name: "原行星尘埃盘形成" },
  planetesimals: { kind: "planetesimal-formation", ruleId: "formation:planetesimal-coalescence", name: "微行星群形成" },
  accretion: { kind: "planetary-accretion", ruleId: "formation:planetary-accretion", name: "行星主体开始吸积" },
  differentiation: { kind: "core-differentiation", ruleId: "formation:core-differentiation", name: "金属核心与地幔分异" },
  cooling: { kind: "planetary-cooling", ruleId: "formation:surface-cooling", name: "熔融地表开始冷却" },
  "stable-crust": { kind: "planet-formation-complete", ruleId: "formation:stable-crust", name: "稳定地壳形成" },
}[phase]);

const formationMilestones: Array<{ progress: number; phase: PlanetFormationPhase }> = [
  { progress: 0, phase: "dust-cloud" },
  { progress: 0.12, phase: "planetesimals" },
  { progress: 0.3, phase: "accretion" },
  { progress: 0.56, phase: "differentiation" },
  { progress: 0.74, phase: "cooling" },
  { progress: 1, phase: "stable-crust" },
];

export const stepPlanetFormation = (state: WorldState, input: EnvironmentInput): EnvironmentDelta => {
  const delta = emptyDelta();
  const elapsedDays = Math.max(0, input.elapsedYears ?? 1) * DAYS_PER_YEAR;
  const accumulatedProgress = state.formation.progress + elapsedDays / FORMATION_DURATION_DAYS;
  const nextProgress = clamp(accumulatedProgress >= 1 - 1e-9 ? 1 : accumulatedProgress);
  const nextFormation = formationStateFor(state.seed, nextProgress);
  const { width, height } = state.fields.elevation;
  const shapeProgress = smoothstep(0.1, 0.78, nextProgress);
  const coolingProgress = smoothstep(0.72, 1, nextProgress);

  for (let index = 0; index < state.fields.elevation.values.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const dust = primordialDustElevation(state.seed, x, y);
    const target = formedElevation(state.seed, x, y, width, height);
    const impactRoughness = (hashCell(state.seed, x, y, 0x85ebca6b) - 0.5)
      * Math.sin(smoothstep(0.18, 0.72, nextProgress) * Math.PI) * 0.16;
    const elevation = clamp(dust * (1 - shapeProgress) + target * shapeProgress + impactRoughness);
    const latitude = Math.abs(y / Math.max(1, height - 1) - 0.5) * 2;
    const heatVariation = (hashCell(state.seed, x, y, 0xc2b2ae35) - 0.5) * 0.08;
    const temperature = clamp(nextFormation.surfaceHeat - latitude * 0.08 + heatVariation);
    const mineralization = smoothstep(0.46, 0.9, nextProgress);
    delta.fieldChanges.push(
      { field: "elevation", index, operation: "set", value: elevation, causeRuleId: "formation:mass-accretion" },
      { field: "temperature", index, operation: "set", value: temperature, causeRuleId: "formation:impact-heating" },
      { field: "humidity", index, operation: "set", value: nextFormation.atmosphere * coolingProgress * 0.25, causeRuleId: "formation:outgassing" },
      { field: "water", index, operation: "set", value: 0, causeRuleId: "formation:no-stable-oceans" },
      { field: "nutrients", index, operation: "set", value: mineralization * (0.12 + hashCell(state.seed, x, y, 0x27d4eb2f) * 0.2), causeRuleId: "formation:mineral-differentiation" },
      { field: "biomass", index, operation: "set", value: 0, causeRuleId: "formation:sterile-surface" },
    );
    delta.chemistryChanges.push(
      { field: "carbon", index, operation: "set", value: 0.08 + nextFormation.volatileFraction * 0.16, causeRuleId: "formation:carbon-retention" },
      { field: "nitrogen", index, operation: "set", value: 0.03 + nextFormation.atmosphere * 0.12, causeRuleId: "formation:atmospheric-retention" },
      { field: "phosphorus", index, operation: "set", value: 0.04 + mineralization * 0.07, causeRuleId: "formation:mantle-differentiation" },
      { field: "organics", index, operation: "set", value: 0, causeRuleId: "formation:prebiotic-reset" },
      { field: "oxygen", index, operation: "set", value: 0, causeRuleId: "formation:anoxic-atmosphere" },
    );
  }

  for (const event of input.externalEvents) {
    const region = String(event.evidence.regionId ?? event.payload.regionId ?? "region:0:0");
    const match = /^region:(\d+):(\d+)$/.exec(region);
    const x = Math.max(0, Math.min(width - 1, Number(match?.[1] ?? 0)));
    const y = Math.max(0, Math.min(height - 1, Number(match?.[2] ?? 0)));
    const index = y * width + x;
    const intensity = clamp(Number(event.payload.amount ?? event.probability));
    const addField = (field: "elevation" | "temperature" | "humidity" | "water" | "nutrients" | "biomass", value: number) =>
      delta.fieldChanges.push({ field, index, operation: "add", value, causeRuleId: `user-${event.kind}` });
    const addChemistry = (field: "carbon" | "nitrogen" | "phosphorus" | "organics" | "oxygen", value: number) =>
      delta.chemistryChanges.push({ field, index, operation: "add", value, causeRuleId: `user-${event.kind}` });
    if (event.kind === "raise-terrain") addField("elevation", intensity * 0.15);
    else if (event.kind === "lower-terrain") addField("elevation", -intensity * 0.15);
    else if (event.kind === "heat" || event.kind === "volcano" || event.kind === "meteor") addField("temperature", intensity * 0.18);
    else if (event.kind === "cool" || event.kind === "cold-snap" || event.kind === "volcanic-winter") addField("temperature", -intensity * 0.18);
    else if (event.kind === "add-rain") addField("humidity", intensity * 0.2);
    else if (event.kind === "add-minerals" || event.kind === "earthquake") addField("nutrients", intensity * 0.2);
    else if (event.kind === "add-organics" || event.kind === "seed-life") addChemistry("organics", intensity * 0.2);
  }

  delta.formationEffect = nextFormation;
  const crossedMilestones = formationMilestones.filter(({ progress }) =>
    (progress === 0 && state.tick === 0) || (progress > state.formation.progress && progress <= nextProgress));
  for (const crossed of crossedMilestones) {
    const milestone = milestoneFor(crossed.phase);
    const milestoneState = formationStateFor(state.seed, crossed.progress);
    delta.eventDrafts.push({
      kind: milestone.kind,
      ruleId: milestone.ruleId,
      years: projectedYearsAfterStep(state, Math.max(0, crossed.progress - state.formation.progress) * FORMATION_DURATION_DAYS / DAYS_PER_YEAR),
      sourceIds: [],
      probability: 1,
      roll: 0,
      evidence: {
        progress: milestoneState.progress,
        planetaryMass: milestoneState.planetaryMass,
        bodyCount: milestoneState.bodyCount,
        collisionEnergy: milestoneState.collisionEnergy,
        coreFraction: milestoneState.coreFraction,
        surfaceHeat: milestoneState.surfaceHeat,
        atmosphere: milestoneState.atmosphere,
      },
      payload: { name: milestone.name, phase: crossed.phase },
      source: "natural",
    });
  }
  return delta;
};
