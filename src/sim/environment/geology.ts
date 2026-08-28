import type { FieldChange, WorldState } from "../types.ts";
import { simulationCycleAngle, simulationDaysForWorld, wholePeriodsCrossed } from "../time.ts";

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

const plateForcing = (state: WorldState, x: number, y: number): number => {
  const { width, height } = state.fields.elevation;
  const seedPhase = (state.seed % 4096) / 4096 * Math.PI * 2;
  const platePattern = Math.sin(x / width * Math.PI * 4 + seedPhase)
    * Math.cos(y / Math.max(1, height - 1) * Math.PI * 2 - seedPhase * 0.7);
  const pulse = 0.55 + Math.sin(simulationCycleAngle(simulationDaysForWorld(state), Math.round(180 * 2 * Math.PI * 365)) + seedPhase) * 0.45;
  return platePattern * pulse * 0.000004;
};

export const calculateGeology = (state: WorldState, elapsedYears = 1): FieldChange[] => {
  const intervalYears = 8;
  const completedIntervals = wholePeriodsCrossed(simulationDaysForWorld(state), Math.max(0, elapsedYears), intervalYears);
  if (completedIntervals <= 0) return [];
  const { elevation, water, humidity, nutrients } = state.fields;
  const geologicalYears = completedIntervals * intervalYears;
  const changes: FieldChange[] = [];
  for (let index = 0; index < elevation.values.length; index += 1) {
    const x = index % elevation.width;
    const y = Math.floor(index / elevation.width);
    const elevationValue = elevation.values[index] ?? 0;
    const neighbors = neighborsOf(index, elevation.width, elevation.height);
    const neighborMean = neighbors.reduce((sum, neighbor) => sum + (elevation.values[neighbor] ?? elevationValue), 0)
      / Math.max(1, neighbors.length);
    const relief = elevationValue - neighborMean;
    const wetness = (water.values[index] ?? 0) * 0.55 + (humidity.values[index] ?? 0) * 0.45;
    const erosion = Math.max(0, relief) * wetness * 0.0008;
    const deposition = Math.max(0, -relief) * (water.values[index] ?? 0) * 0.00022;
    const tectonics = plateForcing(state, x, y);
    const elevationDelta = (tectonics - erosion + deposition) * geologicalYears;
    const nutrientDelta = Math.abs(erosion) * 1.4 + Math.max(0, deposition) * 0.35
      - (nutrients.values[index] ?? 0) * 0.000025;
    changes.push(
      { field: "elevation", index, operation: "add", value: elevationDelta, causeRuleId: "geology:tectonics-erosion" },
      { field: "nutrients", index, operation: "add", value: nutrientDelta * geologicalYears, causeRuleId: "geology:mineral-cycle" },
    );
  }
  return changes;
};
