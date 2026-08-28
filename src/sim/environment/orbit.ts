import { hashString, normalizeSeed } from "../random.ts";
import type { OrbitalState, PlanetSeason } from "../types.ts";
import { DAYS_PER_YEAR, simulationCyclePhase } from "../time.ts";

const UINT32_MAX = 0xffffffff;
const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const seededUnit = (seed: number, label: string): number =>
  hashString(`${label}:${normalizeSeed(seed)}`) / UINT32_MAX;

const seasonForPhase = (phase: number): PlanetSeason => {
  const index = Math.min(3, Math.floor(clamp(phase, 0, 1 - Number.EPSILON) * 4));
  return (["spring", "summer", "autumn", "winter"] as const)[index]!;
};

const trueAnomalyFor = (meanAnomaly: number, eccentricity: number): number => {
  // One Newton refinement is enough for the deliberately bounded eccentricity.
  const eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly)
    * (1 + eccentricity * Math.cos(meanAnomaly));
  return 2 * Math.atan2(
    Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomaly / 2),
    Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomaly / 2),
  );
};

const solarFluxFor = (orbital: Pick<OrbitalState, "eccentricity" | "periapsisPhase" | "baseSolarFlux">, phase: number): number => {
  const meanAnomaly = (phase + orbital.periapsisPhase) * TAU;
  const trueAnomaly = trueAnomalyFor(meanAnomaly, orbital.eccentricity);
  const distanceRatio = (1 - orbital.eccentricity ** 2)
    / (1 + orbital.eccentricity * Math.cos(trueAnomaly));
  return clamp(orbital.baseSolarFlux / Math.max(0.35, distanceRatio ** 2), 0.45, 1.8);
};

export const isOrbitalState = (value: unknown): value is OrbitalState => {
  if (!value || typeof value !== "object") return false;
  const orbital = value as Partial<OrbitalState>;
  const { orbitalPeriodDays, axialTiltDegrees, eccentricity, periapsisPhase, baseSolarFlux,
    rotationPeriodHours, orbitalPhase, seasonalPhase, solarFlux, season } = orbital;
  return finiteNumber(orbitalPeriodDays)
    && Number.isInteger(orbitalPeriodDays)
    && orbitalPeriodDays >= DAYS_PER_YEAR
    && orbitalPeriodDays <= DAYS_PER_YEAR * 1_000_000
    && finiteNumber(axialTiltDegrees)
    && axialTiltDegrees >= 0
    && axialTiltDegrees <= 60
    && finiteNumber(eccentricity)
    && eccentricity >= 0
    && eccentricity < 0.25
    && finiteNumber(periapsisPhase)
    && periapsisPhase >= 0
    && periapsisPhase < 1
    && finiteNumber(baseSolarFlux)
    && baseSolarFlux > 0
    && baseSolarFlux <= 2
    && finiteNumber(rotationPeriodHours)
    && rotationPeriodHours >= 4
    && rotationPeriodHours <= 96
    && finiteNumber(orbitalPhase)
    && orbitalPhase >= 0
    && orbitalPhase < 1
    && finiteNumber(seasonalPhase)
    && seasonalPhase >= 0
    && seasonalPhase < 1
    && finiteNumber(solarFlux)
    && solarFlux >= 0.45
    && solarFlux <= 1.8
    && ["spring", "summer", "autumn", "winter"].includes(season as PlanetSeason);
};

const parametersForSeed = (seed: number): Omit<OrbitalState, "orbitalPhase" | "seasonalPhase" | "solarFlux" | "season"> => ({
  orbitalPeriodDays: DAYS_PER_YEAR * (180 + Math.floor(seededUnit(seed, "orbital-period") * 241)),
  axialTiltDegrees: 8 + seededUnit(seed, "axial-tilt") * 34,
  eccentricity: 0.003 + seededUnit(seed, "eccentricity") * 0.012,
  periapsisPhase: seededUnit(seed, "periapsis-phase"),
  baseSolarFlux: 0.995 + seededUnit(seed, "solar-luminosity") * 0.01,
  rotationPeriodHours: 12 + seededUnit(seed, "rotation-period") * 40,
});

export const orbitalStateAtDays = (
  parameters: Pick<OrbitalState, "orbitalPeriodDays" | "axialTiltDegrees" | "eccentricity" | "periapsisPhase" | "baseSolarFlux" | "rotationPeriodHours">,
  totalDays: string | number,
): OrbitalState => {
  const exactDays = typeof totalDays === "number" ? String(Math.max(0, Math.trunc(totalDays))) : totalDays;
  const orbitalPhase = simulationCyclePhase(exactDays, parameters.orbitalPeriodDays);
  const seasonalPhase = simulationCyclePhase(exactDays, DAYS_PER_YEAR);
  return {
    ...parameters,
    orbitalPhase,
    seasonalPhase,
    solarFlux: solarFluxFor(parameters, orbitalPhase),
    season: seasonForPhase(seasonalPhase),
  };
};

export const createOrbitalState = (seed: number, totalDays: string | number = "0"): OrbitalState =>
  orbitalStateAtDays(parametersForSeed(seed), totalDays);

export const orbitalStateForWorld = (world: {
  seed: number;
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: { step: string; days: string };
  orbital?: OrbitalState;
}): OrbitalState => {
  const parameters = world.orbital ?? parametersForSeed(world.seed);
  const totalDays = world.timeline?.days
    ?? (world.simulationDays === undefined ? String(Math.round(world.years * DAYS_PER_YEAR)) : world.simulationDays);
  return orbitalStateAtDays(parameters, totalDays);
};

export const seasonalTemperatureOffset = (
  orbital: Pick<OrbitalState, "seasonalPhase" | "axialTiltDegrees">,
  y: number,
  height: number,
): number => {
  const hemisphere = y / Math.max(1, height - 1) * 2 - 1;
  const tilt = Math.sin(orbital.axialTiltDegrees * Math.PI / 180);
  return -Math.sin(orbital.seasonalPhase * TAU) * hemisphere * tilt * 0.08;
};

export const diurnalTemperatureOffset = (
  orbital: Pick<OrbitalState, "rotationPeriodHours">,
  x: number,
  width: number,
): number => {
  const rotationSignal = Math.sin((x + 0.5) / Math.max(1, width) * TAU);
  const amplitude = clamp((orbital.rotationPeriodHours - 12) / 60, 0.04, 0.42);
  return rotationSignal * amplitude * 0.025;
};
