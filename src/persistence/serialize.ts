import { SAVE_SCHEMA_VERSION, isSaveEnvelope } from "./schema.ts";
import type { Grid, WorldState } from "../sim/types.ts";

const encode = (value: unknown): unknown => {
  if (value instanceof Float32Array) return { __type: "Float32Array", values: Array.from(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).reduce<Record<string, unknown>>((result, key) => {
      result[key] = encode((value as Record<string, unknown>)[key]);
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
  const lod = world.lod as WorldState["lod"];
  const summaries = lod.summaries.map((summary) => {
    const partial = summary as Partial<WorldState["lod"]["summaries"][number]>;
    const agentIds = Array.isArray(partial.agentIds) ? partial.agentIds : [];
    const relationshipRecords = Array.isArray(partial.relationshipRecords) ? partial.relationshipRecords : [];
    const relationshipCounts = relationshipRecords.reduce<WorldState["lod"]["summaries"][number]["lineage"]["relationshipCounts"]>((counts, relationship) => {
      counts[relationship.kind] = (counts[relationship.kind] ?? 0) + 1;
      return counts;
    }, {});
    const descendantIds = new Set(relationshipRecords.filter((relationship) => relationship.kind === "parent").map((relationship) => relationship.toId));
    const defaultLineage = {
      descendantCount: descendantIds.size,
      generationDepth: agentIds.length === 0 ? 0 : descendantIds.size > 0 ? 2 : 1,
      knowledgeCarrierCount: 0,
      knowledgeInheritanceCount: 0,
      beliefCarrierCount: 0,
      relationshipCounts,
    };
    const lineage = {
      ...(partial.lineage ?? defaultLineage),
      knowledgeInheritanceCount: typeof partial.lineage?.knowledgeInheritanceCount === "number" ? partial.lineage.knowledgeInheritanceCount : 0,
    };
    const organizations = (partial.organizations ?? []).map((organization) => ({
      ...organization,
      territoryRegionIds: Array.isArray(organization.territoryRegionIds) ? organization.territoryRegionIds : [partial.regionId!],
    }));
    return {
      ...summary,
      organizations,
      agentIds,
      agentRecords: Array.isArray(partial.agentRecords) ? partial.agentRecords : [],
      relationshipRecords,
      lineage,
      familyLineages: Array.isArray(partial.familyLineages) ? partial.familyLineages : [],
      foodBalance: typeof partial.foodBalance === "number" ? partial.foodBalance : 0,
      foodPerAgent: typeof partial.foodPerAgent === "number" ? partial.foodPerAgent : 0,
      foodSecurity: typeof partial.foodSecurity === "number" ? partial.foodSecurity : 0,
    };
  });
  const focusRegionId = world.observation && typeof world.observation === "object" && typeof (world.observation as { focusRegionId?: unknown }).focusRegionId === "string"
    ? (world.observation as { focusRegionId: WorldState["observation"]["focusRegionId"] }).focusRegionId
    : undefined;
  const organizations = world.organizations!.map((organization) => ({
    ...organization,
    territoryRegionIds: Array.isArray(organization.territoryRegionIds) ? organization.territoryRegionIds : [organization.regionId],
  }));
  const worldview = world.worldview as Partial<WorldState["worldview"]>;
  return {
    ...world,
    organizations,
    worldview: {
      ...world.worldview,
      enabledPackIds: Array.isArray(worldview.enabledPackIds) ? worldview.enabledPackIds : [],
      discoveredRuleIds: Array.isArray(worldview.discoveredRuleIds) ? worldview.discoveredRuleIds : [],
      entities: Array.isArray(worldview.entities) ? worldview.entities : [],
      phenomena: Array.isArray(worldview.phenomena) ? worldview.phenomena : [],
    },
    lod: { ...lod, summaries },
    observation: focusRegionId ? { focusRegionId } : {},
  } as WorldState;
};

export const serializeWorld = (state: WorldState): string => JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, world: encode({ ...state, observation: state.observation.focusRegionId ? { focusRegionId: state.observation.focusRegionId } : {} }) });

export const deserializeWorld = (input: string): WorldState => {
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new Error("Save is not valid JSON"); }
  if (!isSaveEnvelope(parsed)) throw new Error("Unsupported or malformed save schema");
  return validateWorld(decode(parsed.world));
};
