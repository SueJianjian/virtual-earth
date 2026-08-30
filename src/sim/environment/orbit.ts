import { hashString, normalizeSeed } from "../random.ts";
import type { LunarState, OrbitalState, PlanetSeason } from "../types.ts";
import { DAYS_PER_YEAR, simulationCyclePhase } from "../time.ts";

const UINT32_MAX = 0xffffffff;
const TAU = Math.PI * 2;

/** Physical rendering units use the planet radius as one scene unit. */
export const PLANET_RADIUS_UNITS = 1;
export const STAR_RADIUS_IN_PLANET_RADII = 109.1;
export const MOON_RADIUS_IN_PLANET_RADII = 0.2727;
export const EARTH_LIKE_PLANET_SEMI_MAJOR_AXIS = 23_481;
export const EARTH_LIKE_MOON_SEMI_MAJOR_AXIS = 60.3;
export const MOON_TO_PLANET_MASS_RATIO = 0.0123;
const EARTH_ORBITAL_PERIOD_DAYS = 365.256;
const EARTH_MOON_ORBITAL_PERIOD_DAYS = 27.3217;

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

const orbitalPositionForPhase = (
  phase: number,
  eccentricity: number,
  periapsisPhase: number,
): [number, number, number] => {
  const meanAnomaly = (phase + periapsisPhase) * TAU;
  const trueAnomaly = trueAnomalyFor(meanAnomaly, eccentricity);
  const distanceRatio = (1 - eccentricity ** 2)
    / (1 + eccentricity * Math.cos(trueAnomaly));
  return [
    Math.cos(trueAnomaly) * distanceRatio,
    0,
    Math.sin(trueAnomaly) * distanceRatio,
  ];
};

const starDirectionForPlanetPhase = (
  phase: number,
  eccentricity: number,
  periapsisPhase: number,
): [number, number, number] => {
  const position = orbitalPositionForPhase(phase, eccentricity, periapsisPhase);
  const length = Math.hypot(position[0], position[1], position[2]);
  return [-position[0] / length, -position[1] / length, -position[2] / length];
};

const solarFluxFor = (orbital: Pick<OrbitalState, "eccentricity" | "periapsisPhase" | "baseSolarFlux">, phase: number): number => {
  const position = orbitalPositionForPhase(phase, orbital.eccentricity, orbital.periapsisPhase);
  const distanceRatio = Math.hypot(position[0], position[1], position[2]);
  return clamp(orbital.baseSolarFlux / Math.max(0.35, distanceRatio ** 2), 0.45, 1.8);
};

type LunarParameters = Pick<LunarState, "orbitalPeriodDays" | "inclinationDegrees" | "eccentricity" | "periapsisPhase">;

const lunarParametersForSeed = (seed: number): LunarParameters => ({
  orbitalPeriodDays: 22 + Math.floor(seededUnit(seed, "lunar-period") * 20),
  inclinationDegrees: 4 + seededUnit(seed, "lunar-inclination") * 19,
  eccentricity: 0.015 + seededUnit(seed, "lunar-eccentricity") * 0.12,
  periapsisPhase: seededUnit(seed, "lunar-periapsis-phase"),
});

const lunarDirectionForPhase = (phase: number, inclinationDegrees: number): [number, number, number] => {
  const angle = phase * TAU;
  const inclination = inclinationDegrees * Math.PI / 180;
  return [
    Math.cos(angle),
    Math.sin(angle) * Math.sin(inclination),
    Math.sin(angle) * Math.cos(inclination),
  ];
};

const lunarIlluminationFor = (
  lunarPhase: number,
  inclinationDegrees: number,
  solarOrbitalPhase: number,
  solarPeriapsisPhase: number,
  solarEccentricity: number,
): number => {
  const moon = lunarDirectionForPhase(lunarPhase, inclinationDegrees);
  const sun = starDirectionForPlanetPhase(solarOrbitalPhase, solarEccentricity, solarPeriapsisPhase);
  const dot = moon[0] * sun[0] + moon[1] * sun[1] + moon[2] * sun[2];
  return clamp((1 - dot) / 2, 0, 1);
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

export const isLunarState = (value: unknown): value is LunarState => {
  if (!value || typeof value !== "object") return false;
  const lunar = value as Partial<LunarState>;
  return finiteNumber(lunar.orbitalPeriodDays)
    && Number.isInteger(lunar.orbitalPeriodDays)
    && lunar.orbitalPeriodDays >= 16
    && lunar.orbitalPeriodDays <= 96
    && finiteNumber(lunar.inclinationDegrees)
    && lunar.inclinationDegrees >= 0
    && lunar.inclinationDegrees <= 45
    && finiteNumber(lunar.eccentricity)
    && lunar.eccentricity >= 0
    && lunar.eccentricity < 0.25
    && finiteNumber(lunar.periapsisPhase)
    && lunar.periapsisPhase >= 0
    && lunar.periapsisPhase < 1
    && finiteNumber(lunar.orbitalPhase)
    && lunar.orbitalPhase >= 0
    && lunar.orbitalPhase < 1
    && finiteNumber(lunar.illumination)
    && lunar.illumination >= 0
    && lunar.illumination <= 1;
};

const parametersForSeed = (seed: number): Omit<OrbitalState, "orbitalPhase" | "seasonalPhase" | "solarFlux" | "season"> => ({
  orbitalPeriodDays: DAYS_PER_YEAR + Math.floor(seededUnit(seed, "orbital-period") * 121),
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
  const seasonalPhase = orbitalPhase;
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

export const lunarStateAtDays = (
  parameters: LunarParameters,
  totalDays: string | number,
  solarOrbitalPhase = 0,
  solarPeriapsisPhase = 0,
  solarEccentricity = 0,
): LunarState => {
  const orbitalPhase = simulationCyclePhase(totalDays, parameters.orbitalPeriodDays);
  return {
    ...parameters,
    orbitalPhase,
    illumination: lunarIlluminationFor(
      (orbitalPhase + parameters.periapsisPhase) % 1,
      parameters.inclinationDegrees,
      solarOrbitalPhase,
      solarPeriapsisPhase,
      solarEccentricity,
    ),
  };
};

export const lunarStateForWorld = (world: {
  seed: number;
  tick: number;
  years: number;
  simulationDays?: number;
  timeline?: { step: string; days: string };
  orbital?: OrbitalState;
}): LunarState => {
  const orbital = world.orbital ?? createOrbitalState(world.seed, world.timeline?.days ?? world.simulationDays ?? Math.round(world.years * DAYS_PER_YEAR));
  const totalDays = world.timeline?.days
    ?? (world.simulationDays === undefined ? String(Math.round(world.years * DAYS_PER_YEAR)) : world.simulationDays);
  return lunarStateAtDays(
    lunarParametersForSeed(world.seed),
    totalDays,
    orbital.orbitalPhase,
    orbital.periapsisPhase,
    orbital.eccentricity,
  );
};

/** Solar height at the equator, where 0 is sunrise/sunset and 1 is overhead. */
export const solarAltitudeFor = (
  orbital: Pick<OrbitalState, "seasonalPhase" | "axialTiltDegrees">,
  dayPhase: number,
  latitudeDegrees = 0,
): number => {
  const latitude = latitudeDegrees * Math.PI / 180;
  const declination = Math.sin(orbital.seasonalPhase * TAU) * Math.sin(orbital.axialTiltDegrees * Math.PI / 180);
  const hourAngle = dayPhase * TAU - Math.PI / 2;
  return clamp(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.sin(hourAngle), -1, 1);
};

/** Direction from the observed surface toward the sun in scene coordinates. */
export const solarDirectionFor = (
  orbital: Pick<OrbitalState, "seasonalPhase" | "axialTiltDegrees">,
  dayPhase: number,
  latitudeDegrees = 0,
): [number, number, number] => {
  const altitude = solarAltitudeFor(orbital, dayPhase, latitudeDegrees);
  const horizontal = Math.sqrt(Math.max(0, 1 - altitude ** 2));
  const azimuth = dayPhase * TAU - Math.PI / 2;
  return [Math.cos(azimuth) * horizontal, altitude, Math.sin(azimuth) * horizontal];
};

export const lunarDirectionAt = (lunar: LunarState, apparentPhase = lunar.orbitalPhase): [number, number, number] =>
  lunarDirectionForPhase((apparentPhase + lunar.periapsisPhase) % 1, lunar.inclinationDegrees);

export const lunarDistanceScaleAt = (lunar: LunarState, apparentPhase = lunar.orbitalPhase): number => {
  const meanAnomaly = (apparentPhase + lunar.periapsisPhase) * TAU;
  const trueAnomaly = trueAnomalyFor(meanAnomaly, lunar.eccentricity);
  return (1 - lunar.eccentricity ** 2) / (1 + lunar.eccentricity * Math.cos(trueAnomaly));
};

/** Position of the planet around the fixed central star in normalized orbital units. */
export const planetPositionAt = (
  orbital: Pick<OrbitalState, "orbitalPhase" | "eccentricity" | "periapsisPhase">,
  phase = orbital.orbitalPhase,
): [number, number, number] => orbitalPositionForPhase(phase, orbital.eccentricity, orbital.periapsisPhase);

/** Direction from the planet toward the fixed central star in the orbital frame. */
export const starDirectionFromPlanetAt = (
  orbital: Pick<OrbitalState, "orbitalPhase" | "eccentricity" | "periapsisPhase">,
  phase = orbital.orbitalPhase,
): [number, number, number] => starDirectionForPlanetPhase(phase, orbital.eccentricity, orbital.periapsisPhase);

/** Exact axial rotation phase, preserving remote-era clocks through integer microhours. */
export const planetRotationPhaseAt = (
  orbital: Pick<OrbitalState, "rotationPeriodHours">,
  totalDays: string | number,
): number => {
  const exactDays = typeof totalDays === "number"
    ? BigInt(Math.max(0, Math.trunc(totalDays)))
    : BigInt(totalDays);
  const unitsPerHour = 1_000_000n;
  const periodUnits = BigInt(Math.max(1, Math.round(orbital.rotationPeriodHours * Number(unitsPerHour))));
  const elapsedUnits = (exactDays * 24n * unitsPerHour) % periodUnits;
  return Number(elapsedUnits) / Number(periodUnits);
};

/** Position of the moon relative to its parent planet in normalized lunar units. */
export const moonPositionAt = (
  lunar: LunarState,
  apparentPhase = lunar.orbitalPhase,
): [number, number, number] => {
  const direction = lunarDirectionAt(lunar, apparentPhase);
  const distance = lunarDistanceScaleAt(lunar, apparentPhase);
  return [direction[0] * distance, direction[1] * distance, direction[2] * distance];
};

export const planetSemiMajorAxisInPlanetRadii = (
  orbital: Pick<OrbitalState, "orbitalPeriodDays">,
): number => EARTH_LIKE_PLANET_SEMI_MAJOR_AXIS
  * Math.pow(orbital.orbitalPeriodDays / EARTH_ORBITAL_PERIOD_DAYS, 2 / 3);

export const moonSemiMajorAxisInPlanetRadii = (
  lunar: Pick<LunarState, "orbitalPeriodDays">,
): number => EARTH_LIKE_MOON_SEMI_MAJOR_AXIS
  * Math.pow(lunar.orbitalPeriodDays / EARTH_MOON_ORBITAL_PERIOD_DAYS, 2 / 3);

export type PlanetMoonBarycentricPositions = {
  barycenter: [number, number, number];
  planet: [number, number, number];
  moon: [number, number, number];
};

/** Planet and moon positions around their shared center of mass. */
export const planetMoonBarycentricPositionsAt = (
  lunar: LunarState,
  apparentPhase = lunar.orbitalPhase,
): PlanetMoonBarycentricPositions => {
  const relativeMoon = moonPositionAt(lunar, apparentPhase);
  const semiMajorAxis = moonSemiMajorAxisInPlanetRadii(lunar);
  const relative: [number, number, number] = [
    relativeMoon[0] * semiMajorAxis,
    relativeMoon[1] * semiMajorAxis,
    relativeMoon[2] * semiMajorAxis,
  ];
  const planetShare = -MOON_TO_PLANET_MASS_RATIO / (1 + MOON_TO_PLANET_MASS_RATIO);
  const moonShare = 1 / (1 + MOON_TO_PLANET_MASS_RATIO);
  return {
    barycenter: [0, 0, 0],
    planet: [relative[0] * planetShare, relative[1] * planetShare, relative[2] * planetShare],
    moon: [relative[0] * moonShare, relative[1] * moonShare, relative[2] * moonShare],
  };
};

export type StellarSystemPositions = PlanetMoonBarycentricPositions & {
  star: [number, number, number];
};

/** Star-centered positions with the planet-moon barycenter following its stellar orbit. */
export const stellarSystemPositionsAt = (
  orbital: OrbitalState,
  lunar: LunarState,
  planetPhase = orbital.orbitalPhase,
  moonPhase = lunar.orbitalPhase,
): StellarSystemPositions => {
  const normalizedPlanet = planetPositionAt(orbital, planetPhase);
  const planetSemiMajorAxis = planetSemiMajorAxisInPlanetRadii(orbital);
  const barycenter: [number, number, number] = [
    normalizedPlanet[0] * planetSemiMajorAxis,
    normalizedPlanet[1] * planetSemiMajorAxis,
    normalizedPlanet[2] * planetSemiMajorAxis,
  ];
  const local = planetMoonBarycentricPositionsAt(lunar, moonPhase);
  const translate = (position: [number, number, number]): [number, number, number] => [
    barycenter[0] + position[0],
    barycenter[1] + position[1],
    barycenter[2] + position[2],
  ];
  return {
    star: [0, 0, 0],
    barycenter,
    planet: translate(local.planet),
    moon: translate(local.moon),
  };
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
