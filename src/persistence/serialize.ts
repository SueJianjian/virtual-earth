import { SAVE_SCHEMA_VERSION, isSaveEnvelope } from "./schema.ts";
import type { EventMilestone, Grid, PlanetFormationState, SubstanceState, WorldState } from "../sim/types.ts";
import { completedPlanetFormationState } from "../sim/environment/formation.ts";
import { ensureSpeciesIdentity } from "../sim/ecology/blueprints.ts";
import { ensureCultureIdentity } from "../sim/culture/identity.ts";
import { defaultGovernanceFor } from "../sim/society/organization.ts";
import { createEventArchive, MAX_EVENT_MILESTONES } from "../sim/events/ledger.ts";

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

const formationPhases = new Set<PlanetFormationState["phase"]>(["dust-cloud", "planetesimals", "accretion", "differentiation", "cooling", "stable-crust"]);
const isFormationState = (value: unknown): value is PlanetFormationState => {
  if (!value || typeof value !== "object") return false;
  const formation = value as Partial<PlanetFormationState>;
  const values = [formation.progress, formation.dustDensity, formation.bodyCount, formation.planetaryMass, formation.collisionEnergy, formation.coreFraction, formation.surfaceHeat, formation.atmosphere, formation.volatileFraction];
  return typeof formation.phase === "string"
    && formationPhases.has(formation.phase as PlanetFormationState["phase"])
    && values.every((item) => Number.isFinite(item));
};

const countRecord = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>((result, [key, count]) => {
    if (Number.isFinite(count) && Number(count) >= 0) result[key] = Number(count);
    return result;
  }, {});
};

const isEventMilestone = (value: unknown): value is EventMilestone => {
  if (!value || typeof value !== "object") return false;
  const milestone = value as Partial<EventMilestone>;
  const details = milestone.details;
  return typeof milestone.id === "string"
    && Number.isFinite(milestone.tick)
    && (milestone.years === undefined || Number.isFinite(milestone.years))
    && typeof milestone.kind === "string"
    && typeof milestone.ruleId === "string"
    && (milestone.source === "natural" || milestone.source === "user")
    && Array.isArray(milestone.sourceIds)
    && milestone.sourceIds.every((id) => typeof id === "string")
    && Array.isArray(milestone.regionIds)
    && milestone.regionIds.every((id) => typeof id === "string")
    && Array.isArray(milestone.organizationIds)
    && milestone.organizationIds.every((id) => typeof id === "string")
    && Number.isFinite(milestone.probability)
    && Number.isFinite(milestone.roll)
    && (milestone.position === undefined || (Array.isArray(milestone.position) && milestone.position.length === 2 && milestone.position.every(Number.isFinite)))
    && Boolean(details)
    && typeof details === "object"
    && !Array.isArray(details)
    && Object.values(details).every((detail) => typeof detail === "string" || typeof detail === "number" || typeof detail === "boolean");
};

const substanceKinds = new Set<SubstanceState["kind"]>(["mineral", "crystal", "organic-compound", "engineered-composite"]);
const substanceFormations = new Set<SubstanceState["formation"]>(["geological", "hydrothermal", "biochemical", "engineered"]);
const isSubstanceState = (value: unknown): value is SubstanceState => {
  if (!value || typeof value !== "object") return false;
  const substance = value as Partial<SubstanceState>;
  return typeof substance.id === "string"
    && typeof substance.name === "string"
    && typeof substance.kind === "string"
    && substanceKinds.has(substance.kind as SubstanceState["kind"])
    && typeof substance.formation === "string"
    && substanceFormations.has(substance.formation as SubstanceState["formation"])
    && (substance.status === "latent" || substance.status === "known")
    && typeof substance.regionId === "string"
    && Number.isFinite(substance.originTick)
    && Number.isFinite(substance.originYears)
    && Array.isArray(substance.parentIds)
    && substance.parentIds.every((id) => typeof id === "string")
    && Array.isArray(substance.discoveredByIds)
    && substance.discoveredByIds.every((id) => typeof id === "string")
    && (substance.discoveryTick === undefined || Number.isFinite(substance.discoveryTick))
    && (substance.discoveryYears === undefined || Number.isFinite(substance.discoveryYears))
    && Boolean(substance.composition)
    && Object.values(substance.composition ?? {}).every(Number.isFinite)
    && Boolean(substance.properties)
    && Object.values(substance.properties ?? {}).every(Number.isFinite);
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
      governance: { ...defaultGovernanceFor(organization.type), ...(organization.governance ?? {}) },
      diplomacy: organization.diplomacy && typeof organization.diplomacy === "object" ? organization.diplomacy : {},
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
    governance: { ...defaultGovernanceFor(organization.type), ...(organization.governance ?? {}) },
    diplomacy: organization.diplomacy && typeof organization.diplomacy === "object" ? organization.diplomacy : {},
    ...(typeof organization.archivedHistoryCount === "number" ? { archivedHistoryCount: organization.archivedHistoryCount } : {}),
  }));
  const facilities = Array.isArray(world.facilities) ? world.facilities : [];
  const substances = Array.isArray(world.substances) ? world.substances.filter(isSubstanceState) : [];
  const worldview = world.worldview as Partial<WorldState["worldview"]>;
  const formation = world.formation ?? completedPlanetFormationState(world.seed!);
  if (!isFormationState(formation)) throw new Error("Save contains invalid planet formation state");
  const defaultArchive = createEventArchive(world.events!);
  const savedArchive = world.eventArchive as Partial<WorldState["eventArchive"]> | undefined;
  const archivedEventCount = Number.isFinite(savedArchive?.archivedEventCount) ? Math.max(0, Number(savedArchive?.archivedEventCount)) : 0;
  const eventArchive: WorldState["eventArchive"] = {
    ...defaultArchive,
    ...(savedArchive?.firstEventTick === undefined ? {} : { firstEventTick: savedArchive.firstEventTick }),
    ...(savedArchive?.firstEventYears === undefined ? {} : { firstEventYears: savedArchive.firstEventYears }),
    ...(savedArchive?.latestEventTick === undefined ? {} : { latestEventTick: savedArchive.latestEventTick }),
    ...(savedArchive?.latestEventYears === undefined ? {} : { latestEventYears: savedArchive.latestEventYears }),
    ...(savedArchive?.archivedThroughTick === undefined ? {} : { archivedThroughTick: savedArchive.archivedThroughTick }),
    ...(savedArchive?.archivedThroughYears === undefined ? {} : { archivedThroughYears: savedArchive.archivedThroughYears }),
    totalEventCount: Math.max(world.events!.length + archivedEventCount, Number(savedArchive?.totalEventCount ?? 0)),
    archivedEventCount,
    archivedSpeciesCount: Number.isFinite(savedArchive?.archivedSpeciesCount) ? Math.max(0, Number(savedArchive?.archivedSpeciesCount)) : 0,
    archivedKnowledgeCount: Number.isFinite(savedArchive?.archivedKnowledgeCount) ? Math.max(0, Number(savedArchive?.archivedKnowledgeCount)) : 0,
    archivedCultureCount: Number.isFinite(savedArchive?.archivedCultureCount) ? Math.max(0, Number(savedArchive?.archivedCultureCount)) : 0,
    archivedRelationshipCount: Number.isFinite(savedArchive?.archivedRelationshipCount) ? Math.max(0, Number(savedArchive?.archivedRelationshipCount)) : 0,
    kindCounts: countRecord(savedArchive?.kindCounts),
    regionCounts: countRecord(savedArchive?.regionCounts),
    organizationCounts: countRecord(savedArchive?.organizationCounts),
    organizationFormationCounts: countRecord(savedArchive?.organizationFormationCounts),
    tradeVolumeByResource: countRecord(savedArchive?.tradeVolumeByResource),
    archivedSpeciesRoleCounts: countRecord(savedArchive?.archivedSpeciesRoleCounts),
    milestones: Array.isArray(savedArchive?.milestones)
      ? savedArchive.milestones.filter(isEventMilestone).slice(-MAX_EVENT_MILESTONES)
      : defaultArchive.milestones,
  };
  return {
    ...world,
    formation,
    species: world.species!.map((species) => ensureSpeciesIdentity(species)),
    cultures: world.cultures!.map((culture) => ensureCultureIdentity(culture)),
    organizations,
    facilities,
    substances,
    eventArchive,
    worldview: {
      ...world.worldview,
      enabledPackIds: Array.isArray(worldview.enabledPackIds) ? worldview.enabledPackIds : [],
      discoveredRuleIds: Array.isArray(worldview.discoveredRuleIds) ? worldview.discoveredRuleIds : [],
      entities: Array.isArray(worldview.entities) ? worldview.entities : [],
      phenomena: Array.isArray(worldview.phenomena) ? worldview.phenomena : [],
      practices: Array.isArray(worldview.practices) ? worldview.practices : [],
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
