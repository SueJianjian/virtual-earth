import { createRandom, hashString, nextRandom } from "../random.ts";
import {
  nextSimulationStep,
  nextSimulationTick,
  projectedYearsAfterStep,
  simulationDaysForWorld,
  wholePeriodsCrossed,
} from "../time.ts";
import type {
  FieldChange,
  Grid,
  TectonicPlateKind,
  TectonicPlateState,
  TectonicState,
  WorldEventDraft,
  WorldState,
} from "../types.ts";

export const MIN_TECTONIC_PLATES = 7;
export const MAX_TECTONIC_PLATES = 10;
export const TECTONIC_INTERVAL_YEARS = 8;
export const MAX_TECTONIC_EVENTS_PER_STEP = 3;
export const TECTONIC_EVENT_INTERVAL_UPDATES = 10;

const MAX_CRUST_AGE_YEARS = Number.MAX_SAFE_INTEGER;

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

const makeGrid = (width: number, height: number): Grid => ({
  width,
  height,
  values: new Float32Array(width * height),
});

const wrappedDelta = (from: number, to: number, width: number): number => {
  const direct = to - from;
  if (Math.abs(direct) <= width / 2) return direct;
  return direct > 0 ? direct - width : direct + width;
};

const wrap = (value: number, limit: number): number => {
  if (limit <= 0) return 0;
  return ((value % limit) + limit) % limit;
};

const reflect = (position: number, velocity: number, elapsedYears: number, limit: number): [number, number] => {
  if (limit <= 0) return [0, 0];
  const period = limit * 2;
  const projected = wrap(position + velocity * elapsedYears, period);
  return projected <= limit
    ? [projected, velocity]
    : [period - projected, -velocity];
};

const randomValue = (cursor: { value: number }): number => {
  const [value, next] = nextRandom(cursor);
  cursor.value = next.value;
  return value;
};

const plateKindFor = (value: number): TectonicPlateKind =>
  value < 0.34 ? "continental" : value < 0.68 ? "oceanic" : "mixed";

const plateNames = ["Aruva", "Kelun", "Meyra", "Torvek", "Iskara", "Nydel", "Oruma", "Phaelis", "Ruvan", "Selka"];

const createPlates = (seed: number, width: number, height: number): TectonicPlateState[] => {
  const cursor = createRandom(hashString(`tectonics:${seed}`));
  const plateCount = MIN_TECTONIC_PLATES
    + Math.floor(randomValue(cursor) * (MAX_TECTONIC_PLATES - MIN_TECTONIC_PLATES + 1));
  const nameOffset = hashString(`plate-names:${seed}`) % plateNames.length;
  const plates: TectonicPlateState[] = [];
  for (let index = 0; index < plateCount; index += 1) {
    const angle = randomValue(cursor) * Math.PI * 2;
    const speed = 0.004 + randomValue(cursor) * 0.012;
    const kind = plateKindFor(randomValue(cursor));
    const densityBase = kind === "oceanic" ? 0.68 : kind === "continental" ? 0.42 : 0.55;
    const thicknessBase = kind === "oceanic" ? 0.34 : kind === "continental" ? 0.72 : 0.53;
    plates.push({
      id: `plate:${index + 1}`,
      name: `${plateNames[(nameOffset + index) % plateNames.length]} Plate`,
      kind,
      centerX: ((index + randomValue(cursor) * 0.78) / plateCount) * width,
      centerY: (0.08 + randomValue(cursor) * 0.84) * Math.max(1, height - 1),
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
      density: clamp(densityBase + (randomValue(cursor) - 0.5) * 0.12),
      thickness: clamp(thicknessBase + (randomValue(cursor) - 0.5) * 0.16),
      crustAgeYears: 0,
    });
  }
  return plates;
};

const movePlates = (
  plates: readonly TectonicPlateState[],
  width: number,
  height: number,
  geologicalYears: number,
): TectonicPlateState[] => {
  if (geologicalYears <= 0) return plates.map((plate) => ({ ...plate }));
  return plates.map((plate) => {
    const [centerY, velocityY] = reflect(plate.centerY, plate.velocityY, geologicalYears, Math.max(1, height - 1));
    return {
      ...plate,
      centerX: wrap(plate.centerX + plate.velocityX * geologicalYears, width),
      centerY,
      velocityY,
      crustAgeYears: Math.min(MAX_CRUST_AGE_YEARS, plate.crustAgeYears + geologicalYears),
    };
  });
};

const nearestPlateIndex = (
  plates: readonly TectonicPlateState[],
  x: number,
  y: number,
  width: number,
  height: number,
): number => {
  let nearest = 0;
  let shortestDistance = Number.POSITIVE_INFINITY;
  const verticalScale = width / Math.max(1, height * 2);
  for (let plateIndex = 0; plateIndex < plates.length; plateIndex += 1) {
    const plate = plates[plateIndex]!;
    const dx = wrappedDelta(x, plate.centerX, width);
    const dy = (plate.centerY - y) * verticalScale;
    const distance = dx * dx + dy * dy;
    if (distance < shortestDistance) {
      nearest = plateIndex;
      shortestDistance = distance;
    }
  }
  return nearest;
};

const assignPlateCells = (plates: readonly TectonicPlateState[], width: number, height: number): Grid => {
  const plateIndex = makeGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      plateIndex.values[y * width + x] = nearestPlateIndex(plates, x, y, width, height);
    }
  }
  return plateIndex;
};

const neighborsOf = (index: number, width: number, height: number): number[] => {
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbors = [
    y > 0 ? index - width : undefined,
    y + 1 < height ? index + width : undefined,
    y * width + (x + width - 1) % width,
    y * width + (x + 1) % width,
  ];
  return neighbors.filter((neighbor): neighbor is number => neighbor !== undefined);
};

const boundaryFields = (
  plates: readonly TectonicPlateState[],
  plateIndex: Grid,
): { boundaryStress: Grid; boundaryActivity: Grid } => {
  const { width, height } = plateIndex;
  const boundaryStress = makeGrid(width, height);
  const boundaryActivity = makeGrid(width, height);
  for (let index = 0; index < plateIndex.values.length; index += 1) {
    const localPlateIndex = Math.trunc(plateIndex.values[index] ?? 0);
    const localPlate = plates[localPlateIndex]!;
    let strongestStress = 0;
    let strongestActivity = 0;
    for (const neighborIndex of neighborsOf(index, width, height)) {
      const peerPlateIndex = Math.trunc(plateIndex.values[neighborIndex] ?? 0);
      if (peerPlateIndex === localPlateIndex) continue;
      const peerPlate = plates[peerPlateIndex]!;
      const dx = wrappedDelta(localPlate.centerX, peerPlate.centerX, width);
      const dy = peerPlate.centerY - localPlate.centerY;
      const distance = Math.max(0.000001, Math.hypot(dx, dy));
      const normalX = dx / distance;
      const normalY = dy / distance;
      const relativeX = peerPlate.velocityX - localPlate.velocityX;
      const relativeY = peerPlate.velocityY - localPlate.velocityY;
      const separation = relativeX * normalX + relativeY * normalY;
      const shear = Math.abs(relativeX * -normalY + relativeY * normalX);
      const densityContrast = Math.abs(peerPlate.density - localPlate.density);
      const stress = clamp(Math.abs(separation) * 28 + shear * 17 + densityContrast * 0.24);
      if (stress <= strongestStress) continue;
      strongestStress = stress;
      strongestActivity = clamp(-separation * 45, -1, 1);
    }
    boundaryStress.values[index] = strongestStress;
    boundaryActivity.values[index] = strongestActivity;
  }
  return { boundaryStress, boundaryActivity };
};

const rebuildTectonicGrids = (
  plates: readonly TectonicPlateState[],
  width: number,
  height: number,
): Pick<TectonicState, "plateIndex" | "boundaryStress" | "boundaryActivity"> => {
  const plateIndex = assignPlateCells(plates, width, height);
  return { plateIndex, ...boundaryFields(plates, plateIndex) };
};

export const createTectonicState = (
  seed: number,
  width: number,
  height: number,
  history: { elapsedYears?: number; lastUpdatedTick?: number; timelineStep?: string } = {},
): TectonicState => {
  const elapsedYears = Number.isFinite(history.elapsedYears) ? Math.max(0, history.elapsedYears ?? 0) : 0;
  const completedIntervals = Math.floor(elapsedYears / TECTONIC_INTERVAL_YEARS);
  const geologicalYears = completedIntervals * TECTONIC_INTERVAL_YEARS;
  const plates = movePlates(createPlates(seed, width, height), width, height, geologicalYears);
  return {
    plates,
    ...rebuildTectonicGrids(plates, width, height),
    updateCount: Math.min(Number.MAX_SAFE_INTEGER, completedIntervals),
    lastUpdatedTick: history.lastUpdatedTick ?? 0,
    lastUpdatedTimelineStep: history.timelineStep ?? "0",
    lastUpdatedYears: geologicalYears,
  };
};

const validGrid = (
  value: unknown,
  width: number,
  height: number,
  predicate: (entry: number) => boolean,
): value is Grid => {
  if (!value || typeof value !== "object") return false;
  const grid = value as Partial<Grid>;
  return grid.width === width
    && grid.height === height
    && grid.values instanceof Float32Array
    && grid.values.length === width * height
    && grid.values.every(predicate);
};

export const isTectonicState = (value: unknown, width: number, height: number): value is TectonicState => {
  if (!value || typeof value !== "object") return false;
  const tectonics = value as Partial<TectonicState>;
  if (!Array.isArray(tectonics.plates)
    || tectonics.plates.length < MIN_TECTONIC_PLATES
    || tectonics.plates.length > MAX_TECTONIC_PLATES) return false;
  const plateIds = new Set<string>();
  const validPlates = tectonics.plates.every((plate) => {
    if (!plate || typeof plate !== "object" || typeof plate.id !== "string" || plateIds.has(plate.id)) return false;
    plateIds.add(plate.id);
    return plate.id.length > 0
      && typeof plate.name === "string"
      && plate.name.length > 0
      && ["continental", "oceanic", "mixed"].includes(plate.kind)
      && [plate.centerX, plate.centerY, plate.velocityX, plate.velocityY, plate.density, plate.thickness, plate.crustAgeYears].every(Number.isFinite)
      && plate.centerX >= 0 && plate.centerX < width
      && plate.centerY >= 0 && plate.centerY <= Math.max(1, height - 1)
      && Math.hypot(plate.velocityX, plate.velocityY) <= 1
      && plate.density >= 0 && plate.density <= 1
      && plate.thickness >= 0 && plate.thickness <= 1
      && plate.crustAgeYears >= 0 && plate.crustAgeYears <= MAX_CRUST_AGE_YEARS;
  });
  return validPlates
    && validGrid(tectonics.plateIndex, width, height, (entry) => Number.isInteger(entry) && entry >= 0 && entry < tectonics.plates!.length)
    && validGrid(tectonics.boundaryStress, width, height, (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && validGrid(tectonics.boundaryActivity, width, height, (entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && Number.isSafeInteger(tectonics.updateCount) && Number(tectonics.updateCount) >= 0
    && Number.isSafeInteger(tectonics.lastUpdatedTick) && Number(tectonics.lastUpdatedTick) >= 0
    && (tectonics.lastUpdatedTimelineStep === undefined || /^(0|[1-9]\d*)$/.test(tectonics.lastUpdatedTimelineStep))
    && Number.isFinite(tectonics.lastUpdatedYears)
    && Number(tectonics.lastUpdatedYears) >= 0
    && Number(tectonics.lastUpdatedYears) <= MAX_CRUST_AGE_YEARS;
};

const boundaryType = (activity: number): "convergent" | "divergent" | "transform" =>
  activity >= 0.12 ? "convergent" : activity <= -0.12 ? "divergent" : "transform";

type BoundaryCandidate = {
  index: number;
  plateIndex: number;
  peerPlateIndex: number;
  stress: number;
  activity: number;
};

const strongestBoundaries = (tectonics: TectonicState): BoundaryCandidate[] => {
  const candidates = new Map<string, BoundaryCandidate>();
  const { plateIndex, boundaryStress, boundaryActivity } = tectonics;
  for (let index = 0; index < plateIndex.values.length; index += 1) {
    const stress = boundaryStress.values[index] ?? 0;
    if (stress < 0.18) continue;
    const localPlateIndex = Math.trunc(plateIndex.values[index] ?? 0);
    for (const neighbor of neighborsOf(index, plateIndex.width, plateIndex.height)) {
      const peerPlateIndex = Math.trunc(plateIndex.values[neighbor] ?? 0);
      if (peerPlateIndex === localPlateIndex) continue;
      const left = Math.min(localPlateIndex, peerPlateIndex);
      const right = Math.max(localPlateIndex, peerPlateIndex);
      const key = `${left}:${right}`;
      const candidate = {
        index,
        plateIndex: left,
        peerPlateIndex: right,
        stress,
        activity: boundaryActivity.values[index] ?? 0,
      };
      const previous = candidates.get(key);
      if (!previous || candidate.stress > previous.stress || (candidate.stress === previous.stress && candidate.index < previous.index)) {
        candidates.set(key, candidate);
      }
    }
  }
  return [...candidates.values()]
    .sort((left, right) => right.stress - left.stress || left.index - right.index)
    .slice(0, MAX_TECTONIC_EVENTS_PER_STEP);
};

const tectonicEvents = (
  state: WorldState,
  tectonics: TectonicState,
  elapsedYears: number,
): WorldEventDraft[] => strongestBoundaries(tectonics).map((boundary) => {
  const plate = tectonics.plates[boundary.plateIndex]!;
  const peer = tectonics.plates[boundary.peerPlateIndex]!;
  const x = boundary.index % tectonics.plateIndex.width;
  const y = Math.floor(boundary.index / tectonics.plateIndex.width);
  const type = boundaryType(boundary.activity);
  return {
    kind: "tectonic-boundary-shift",
    ruleId: `geology:boundary-${type}`,
    years: projectedYearsAfterStep(state, elapsedYears),
    position: [x, y],
    sourceIds: [plate.id, peer.id],
    probability: 1,
    roll: 0,
    evidence: {
      regionId: `region:${x}:${y}`,
      plateId: plate.id,
      peerPlateId: peer.id,
      boundaryType: type,
      stress: boundary.stress,
      activity: boundary.activity,
    },
    payload: {
      name: `${plate.name} / ${peer.name}`,
      plateId: plate.id,
      peerPlateId: peer.id,
      boundaryType: type,
    },
    source: "natural",
  };
});

const geologicalFieldChanges = (
  state: WorldState,
  tectonics: TectonicState,
  geologicalYears: number,
): FieldChange[] => {
  const { elevation, water, humidity, nutrients } = state.fields;
  const changes: FieldChange[] = [];
  for (let index = 0; index < elevation.values.length; index += 1) {
    const elevationValue = elevation.values[index] ?? 0;
    const neighbors = neighborsOf(index, elevation.width, elevation.height);
    const neighborMean = neighbors.reduce((sum, neighbor) => sum + (elevation.values[neighbor] ?? elevationValue), 0)
      / Math.max(1, neighbors.length);
    const relief = elevationValue - neighborMean;
    const wetness = (water.values[index] ?? 0) * 0.55 + (humidity.values[index] ?? 0) * 0.45;
    const erosion = Math.max(0, relief) * wetness * 0.0008;
    const deposition = Math.max(0, -relief) * (water.values[index] ?? 0) * 0.00022;
    const stress = tectonics.boundaryStress.values[index] ?? 0;
    const activity = tectonics.boundaryActivity.values[index] ?? 0;
    const uplift = Math.max(0, activity) * stress * 0.000012;
    const rifting = Math.max(0, -activity) * stress * 0.000007;
    const transformRoughness = Math.abs(activity) < 0.12 ? stress * 0.0000015 : 0;
    const elevationDelta = (uplift - rifting + transformRoughness - erosion + deposition) * geologicalYears;
    const nutrientDelta = (Math.abs(erosion) * 1.4
      + Math.max(0, deposition) * 0.35
      + stress * 0.000006
      - (nutrients.values[index] ?? 0) * 0.000025) * geologicalYears;
    changes.push(
      { field: "elevation", index, operation: "add", value: elevationDelta, causeRuleId: "geology:tectonics-erosion" },
      { field: "nutrients", index, operation: "add", value: nutrientDelta, causeRuleId: "geology:mineral-cycle" },
    );
  }
  return changes;
};

export const stepTectonics = (
  state: WorldState,
  elapsedYears = 1,
  timelineStep = nextSimulationStep(state),
): { tectonics?: TectonicState; fieldChanges: FieldChange[]; eventDrafts: WorldEventDraft[] } => {
  const completedIntervals = wholePeriodsCrossed(
    simulationDaysForWorld(state),
    Math.max(0, elapsedYears),
    TECTONIC_INTERVAL_YEARS,
  );
  if (completedIntervals <= 0) return { fieldChanges: [], eventDrafts: [] };
  const geologicalYears = completedIntervals * TECTONIC_INTERVAL_YEARS;
  const width = state.fields.elevation.width;
  const height = state.fields.elevation.height;
  const plates = movePlates(state.tectonics.plates, width, height, geologicalYears);
  const tectonics: TectonicState = {
    plates,
    ...rebuildTectonicGrids(plates, width, height),
    updateCount: Math.min(Number.MAX_SAFE_INTEGER, state.tectonics.updateCount + completedIntervals),
    lastUpdatedTick: nextSimulationTick(state),
    lastUpdatedTimelineStep: timelineStep,
    lastUpdatedYears: projectedYearsAfterStep(state, Math.max(0, elapsedYears)),
  };
  const crossedEventInterval = state.tectonics.updateCount === 0
    || Math.floor(state.tectonics.updateCount / TECTONIC_EVENT_INTERVAL_UPDATES)
      < Math.floor(tectonics.updateCount / TECTONIC_EVENT_INTERVAL_UPDATES);
  return {
    tectonics,
    fieldChanges: geologicalFieldChanges(state, tectonics, geologicalYears),
    eventDrafts: crossedEventInterval ? tectonicEvents(state, tectonics, Math.max(0, elapsedYears)) : [],
  };
};

export const calculateGeology = (state: WorldState, elapsedYears = 1): FieldChange[] =>
  stepTectonics(state, elapsedYears).fieldChanges;
