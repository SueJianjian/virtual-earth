import { SAVE_SCHEMA_VERSION, isSaveEnvelope } from "./schema.ts";
import type { Grid, WorldState } from "../sim/types.ts";

const encode = (value: unknown): unknown => {
  if (value instanceof Float32Array) return { __type: "Float32Array", values: Array.from(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).reduce<Record<string, unknown>>((result, key) => {
      if (key !== "observation") result[key] = encode((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
};

const decode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.__type === "Float32Array" && Array.isArray(record.values)) return new Float32Array(record.values.map(Number));
    return Object.keys(record).reduce<Record<string, unknown>>((result, key) => {
      result[key] = decode(record[key]);
      return result;
    }, {});
  }
  return value;
};

const isGrid = (value: unknown): value is Grid => {
  if (!value || typeof value !== "object") return false;
  const grid = value as Partial<Grid>;
  const width = grid.width;
  const height = grid.height;
  return typeof width === "number" && typeof height === "number" && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && grid.values instanceof Float32Array && grid.values.length === width * height;
};

const validateWorld = (value: unknown): WorldState => {
  if (!value || typeof value !== "object") throw new Error("Save world must be an object");
  const world = value as Partial<WorldState>;
  const fields = world.fields;
  const chemistry = world.chemistry;
  if (world.version !== 1 || !Number.isFinite(world.seed) || !Number.isFinite(world.tick) || !Number.isFinite(world.years) || !world.random || !fields || !chemistry) throw new Error("Save world is missing required fields");
  const fieldValues = Object.values(fields);
  const chemistryValues = Object.values(chemistry);
  if (!fieldValues.every(isGrid) || !chemistryValues.every(isGrid)) throw new Error("Save contains invalid grids");
  const requiredArrays: Array<keyof WorldState> = ["species", "populations", "agents", "knowledge", "relationships", "cultures", "organizations", "resources", "events"];
  if (!requiredArrays.every((key) => Array.isArray(world[key]))) throw new Error("Save contains invalid entity collections");
  if (!world.worldview || !world.lod) throw new Error("Save is missing worldview or LOD state");
  return { ...world, observation: {} } as WorldState;
};

export const serializeWorld = (state: WorldState): string => JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, world: encode({ ...state, observation: {} }) });

export const deserializeWorld = (input: string): WorldState => {
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new Error("Save is not valid JSON"); }
  if (!isSaveEnvelope(parsed)) throw new Error("Unsupported or malformed save schema");
  return validateWorld(decode(parsed.world));
};
