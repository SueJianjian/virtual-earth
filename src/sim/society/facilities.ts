import { technologyProfilesForState } from "../culture/technology.ts";
import {
  extractSubstanceReserve,
  substanceEffectProfilesForState,
  substanceReserveRatio,
} from "../environment/substances.ts";
import { forkRandom, hashString, randomFloat } from "../random.ts";
import { compareSimulationSteps, nextSimulationStep, nextSimulationTick, simulationStepDistance, simulationStepForWorld } from "../time.ts";
import { eventsForRegionAndOrganizations } from "../events/index.ts";
import type {
  FacilityState,
  KnowledgeDomain,
  EntityId,
  OrganizationId,
  OrganizationType,
  RegionId,
  SocietyDelta,
  SubstanceState,
  WorldDelta,
  WorldEvent,
  WorldState,
} from "../types.ts";

const domains: KnowledgeDomain[] = ["subsistence", "construction", "navigation", "medicine", "governance", "energy"];
export const MAX_FACILITIES_PER_REGION = domains.length;
export const MAX_FACILITY_RECORDS = 16_384;
export const MATERIAL_RESERVE_SCALE = 2_000;
export const ENERGY_FEEDSTOCK_SCALE = 10_000;
const civicTypes = new Set<OrganizationType>(["settlement", "city", "state", "federation", "empire"]);
const organizationRank: Record<OrganizationType, number> = {
  family: 0,
  clan: 1,
  tribe: 2,
  settlement: 3,
  city: 4,
  state: 5,
  federation: 6,
  empire: 7,
};
const workforceRequired: Record<KnowledgeDomain, number> = {
  subsistence: 2,
  construction: 3,
  navigation: 3,
  medicine: 2,
  governance: 4,
  energy: 4,
};
export const facilityWorkforceRequiredFor = (type: KnowledgeDomain): number => workforceRequired[type];
const constructionCost: Record<KnowledgeDomain, number> = {
  subsistence: 2.4,
  construction: 3,
  navigation: 3.4,
  medicine: 3.2,
  governance: 4,
  energy: 4.5,
};

type FacilityOwner = {
  id: OrganizationId;
  type: OrganizationType;
  regionId: RegionId;
  memberIds: WorldState["agents"][number]["id"][];
};

type WorkerRecord = {
  id: WorldState["agents"][number]["id"];
  regionId?: RegionId;
  age?: number;
  skills: Record<string, number>;
  traits: Record<string, number>;
};

type WorkforceAssignment = {
  ids: FacilityState["workforceIds"];
  efficiency: number;
  required: number;
};

type WorkforceCandidate = {
  id: EntityId;
  score: number;
  retained: boolean;
};

type NaturalReserveCandidates = {
  materials: SubstanceState[];
  energy: SubstanceState[];
};

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [], chemistryChanges: [], entityEffects: [], relationshipEffects: [],
  resourceTransactions: [], worldviewEffects: [], eventDrafts: [],
});
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const ABANDONED_FACILITY_RETENTION_TICKS = 100;
const facilityStatusRank: Record<FacilityState["status"], number> = {
  abandoned: 0,
  planned: 1,
  damaged: 2,
  active: 3,
};

const facilityKey = (facility: Pick<FacilityState, "regionId" | "type">): string => `${facility.regionId}|${facility.type}`;

const facilityPriority = (facility: FacilityState): number =>
  facilityStatusRank[facility.status] * 1_000_000_000_000
  + facility.level * 1_000_000_000
  + clamp(facility.condition) * 1_000_000
  + Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, facility.materialInvested));

const safeTick = (value: number, fallback: number): number => {
  const candidate = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Number.isSafeInteger(candidate) ? candidate : fallback;
};

const safeTimelineStep = (value: string | undefined): string | undefined =>
  value !== undefined && /^\d+$/.test(value) ? value : undefined;

const normalizedFacility = (state: WorldState, facility: FacilityState): FacilityState | undefined => {
  if (typeof facility.id !== "string"
    || typeof facility.ownerOrganizationId !== "string"
    || typeof facility.regionId !== "string"
    || !Array.isArray(facility.workforceIds)
    || !Object.prototype.hasOwnProperty.call(facilityStatusRank, facility.status)) return undefined;
  const regionMatch = /^region:(\d+):(\d+)$/.exec(facility.regionId);
  if (!domains.includes(facility.type) || !regionMatch) return undefined;
  const x = Number(regionMatch[1]);
  const y = Number(regionMatch[2]);
  if (x >= state.fields.elevation.width || y >= state.fields.elevation.height) return undefined;
  const required = workforceRequired[facility.type];
  const workforceIds = [...new Set(facility.workforceIds.filter((id): id is FacilityState["workforceIds"][number] => typeof id === "string"))].sort().slice(0, required);
  const rawLevel = Number.isFinite(facility.level) ? facility.level : 1;
  const level = Math.max(1, Math.min(3, Math.trunc(rawLevel))) as FacilityState["level"];
  const condition = clamp(Number.isFinite(facility.condition) ? facility.condition : 0);
  const materialInvested = Number.isFinite(facility.materialInvested) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, facility.materialInvested)) : 0;
  const boundedEfficiency = facility.workforceEfficiency === undefined
    ? undefined
    : clamp(Number.isFinite(facility.workforceEfficiency) ? facility.workforceEfficiency : 0);
  const plannedTick = safeTick(facility.plannedTick, 0);
  const builtTick = safeTick(facility.builtTick, -1);
  const lastMaintainedTick = safeTick(facility.lastMaintainedTick, 0);
  const lastIncidentTick = safeTick(facility.lastIncidentTick, 0);
  const lastInspectedEventTick = facility.lastInspectedEventTick === undefined ? undefined : safeTick(facility.lastInspectedEventTick, 0);
  const abandonedTick = facility.abandonedTick === undefined ? undefined : safeTick(facility.abandonedTick, 0);
  const plannedTimelineStep = safeTimelineStep(facility.plannedTimelineStep);
  const builtTimelineStep = safeTimelineStep(facility.builtTimelineStep);
  const lastMaintainedTimelineStep = safeTimelineStep(facility.lastMaintainedTimelineStep);
  const lastIncidentTimelineStep = safeTimelineStep(facility.lastIncidentTimelineStep);
  const lastInspectedEventTimelineStep = safeTimelineStep(facility.lastInspectedEventTimelineStep);
  const abandonedTimelineStep = safeTimelineStep(facility.abandonedTimelineStep);
  if (level === facility.level
    && condition === facility.condition
    && materialInvested === facility.materialInvested
    && plannedTick === facility.plannedTick
    && builtTick === facility.builtTick
    && lastMaintainedTick === facility.lastMaintainedTick
    && lastIncidentTick === facility.lastIncidentTick
    && lastInspectedEventTick === facility.lastInspectedEventTick
    && abandonedTick === facility.abandonedTick
    && plannedTimelineStep === facility.plannedTimelineStep
    && builtTimelineStep === facility.builtTimelineStep
    && lastMaintainedTimelineStep === facility.lastMaintainedTimelineStep
    && lastIncidentTimelineStep === facility.lastIncidentTimelineStep
    && lastInspectedEventTimelineStep === facility.lastInspectedEventTimelineStep
    && abandonedTimelineStep === facility.abandonedTimelineStep
    && workforceIds.length === facility.workforceIds.length
    && workforceIds.every((id, index) => id === facility.workforceIds[index])
    && boundedEfficiency === facility.workforceEfficiency
    && (facility.workforceRequired === undefined || facility.workforceRequired === required)) return facility;
  return {
    ...facility,
    level,
    condition,
    materialInvested,
    plannedTick,
    builtTick,
    lastMaintainedTick,
    lastIncidentTick,
    ...(plannedTimelineStep === undefined ? {} : { plannedTimelineStep }),
    ...(builtTimelineStep === undefined ? {} : { builtTimelineStep }),
    ...(lastMaintainedTimelineStep === undefined ? {} : { lastMaintainedTimelineStep }),
    ...(lastIncidentTimelineStep === undefined ? {} : { lastIncidentTimelineStep }),
    workforceIds,
    ...(boundedEfficiency === undefined ? {} : { workforceEfficiency: boundedEfficiency }),
    ...(lastInspectedEventTick === undefined ? {} : { lastInspectedEventTick }),
    ...(lastInspectedEventTimelineStep === undefined ? {} : { lastInspectedEventTimelineStep }),
    ...(abandonedTick === undefined ? {} : { abandonedTick }),
    ...(abandonedTimelineStep === undefined ? {} : { abandonedTimelineStep }),
    ...(facility.workforceRequired === undefined ? {} : { workforceRequired: required }),
  };
};

/**
 * Enforces one authoritative asset per region and technology domain. This
 * keeps malformed saves and long-lived creation races from growing facilities
 * without bound while retaining the strongest operational record.
 */
export const compactFacilityRecords = (state: WorldState): number => {
  const previousCount = state.facilities.length;
  const byRegionType = new Map<string, FacilityState>();
  for (const raw of state.facilities) {
    const facility = normalizedFacility(state, raw);
    if (!facility) continue;
    const key = facilityKey(facility);
    const existing = byRegionType.get(key);
    if (!existing || facilityPriority(facility) > facilityPriority(existing)
      || (facilityPriority(facility) === facilityPriority(existing) && facility.id.localeCompare(existing.id) < 0)) {
      byRegionType.set(key, facility);
    }
  }
  state.facilities = [...byRegionType.values()]
    .sort((left, right) => facilityPriority(right) - facilityPriority(left) || facilityKey(left).localeCompare(facilityKey(right)) || left.id.localeCompare(right.id))
    .slice(0, MAX_FACILITY_RECORDS)
    .sort((left, right) => facilityKey(left).localeCompare(facilityKey(right)) || left.id.localeCompare(right.id));
  return previousCount - state.facilities.length;
};

export type FacilityEffectProfile = Record<KnowledgeDomain, number>;
const emptyEffectProfile = (): FacilityEffectProfile => ({
  subsistence: 0,
  construction: 0,
  navigation: 0,
  medicine: 0,
  governance: 0,
  energy: 0,
});
type FacilitySource = Pick<WorldState, "facilities">;
const effectCache = new WeakMap<WorldState["facilities"], ReadonlyMap<RegionId, FacilityEffectProfile>>();

export const facilityOperationalEffect = (facility: FacilityState): number => {
  if (facility.status !== "active" && facility.status !== "damaged") return 0;
  const statusFactor = facility.status === "damaged" ? 0.65 : 1;
  const required = facility.workforceRequired ?? facilityWorkforceRequiredFor(facility.type);
  const staffing = clamp(facility.workforceIds.length / Math.max(1, required));
  const skillFactor = 0.55 + clamp(facility.workforceEfficiency ?? 1) * 0.45;
  return clamp((facility.level / 3) * clamp(facility.condition) * statusFactor * staffing * skillFactor);
};

export const facilityEffectProfilesForState = (state: FacilitySource): ReadonlyMap<RegionId, FacilityEffectProfile> => {
  const cached = effectCache.get(state.facilities);
  if (cached) return cached;
  const profiles = new Map<RegionId, FacilityEffectProfile>();
  for (const facility of state.facilities) {
    const effect = facilityOperationalEffect(facility);
    if (effect <= 0) continue;
    const profile = profiles.get(facility.regionId) ?? emptyEffectProfile();
    profile[facility.type] = clamp(profile[facility.type] + effect);
    profiles.set(facility.regionId, profile);
  }
  effectCache.set(state.facilities, profiles);
  return profiles;
};

export const facilityEffectProfileForRegion = (state: FacilitySource, regionId: RegionId): FacilityEffectProfile =>
  facilityEffectProfilesForState(state).get(regionId) ?? emptyEffectProfile();

export const facilityIdFor = (regionId: RegionId, type: KnowledgeDomain, ownerId: OrganizationId): string =>
  `facility:${type}:${hashString(`${regionId}:${ownerId}`).toString(16)}`;

const ownerRecords = (state: WorldState): FacilityOwner[] => {
  const collapsedIds = new Set(state.organizations.filter((organization) => organization.status === "collapsed").map((organization) => organization.id));
  const byId = new Map<OrganizationId, FacilityOwner>();
  for (const organization of state.organizations) {
    if (organization.status === "collapsed" || !civicTypes.has(organization.type)) continue;
    byId.set(organization.id, {
      id: organization.id,
      type: organization.type,
      regionId: organization.regionId,
      memberIds: [...organization.memberIds],
    });
  }
  for (const summary of state.lod.summaries) {
    for (const organization of summary.organizations) {
      if (byId.has(organization.id) || collapsedIds.has(organization.id) || !civicTypes.has(organization.type)) continue;
      byId.set(organization.id, {
        id: organization.id,
        type: organization.type,
        regionId: summary.regionId,
        memberIds: [...organization.memberIds],
      });
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const primaryOwnersByRegion = (owners: FacilityOwner[]): Map<RegionId, FacilityOwner> => {
  const result = new Map<RegionId, FacilityOwner>();
  for (const owner of owners) {
    const current = result.get(owner.regionId);
    if (!current
      || organizationRank[owner.type] > organizationRank[current.type]
      || (organizationRank[owner.type] === organizationRank[current.type] && owner.memberIds.length > current.memberIds.length)
      || (organizationRank[owner.type] === organizationRank[current.type] && owner.memberIds.length === current.memberIds.length && owner.id.localeCompare(current.id) < 0)) {
      result.set(owner.regionId, owner);
    }
  }
  return result;
};

const resourceKey = (resourceId: string, regionId: RegionId, holderId?: string): string =>
  `${resourceId}|${regionId}|${holderId ?? "world"}`;

const naturalReserveScore = (substance: SubstanceState, purpose: "materials" | "energy"): number =>
  purpose === "materials"
    ? substance.properties.hardness * 0.55 + substance.properties.stability * 0.45
    : substance.properties.energyPotential * 0.55 + substance.properties.conductivity * 0.45;

const professionSkillKey = (type: KnowledgeDomain): string => `profession:${type}`;

const workerRecordsFor = (state: WorldState): ReadonlyMap<string, WorkerRecord> => {
  const records = new Map<string, WorkerRecord>();
  for (const agent of state.agents) records.set(agent.id, { id: agent.id, regionId: agent.regionId, age: agent.age, skills: agent.skills, traits: agent.traits });
  for (const summary of state.lod.summaries) {
    for (const record of summary.agentRecords) {
      if (!records.has(record.id)) records.set(record.id, { id: record.id, regionId: summary.regionId, age: record.age, skills: record.skills, traits: {} });
    }
  }
  return records;
};

const workerScore = (worker: WorkerRecord | undefined, type: KnowledgeDomain): number => {
  if (!worker) return 0.5;
  const skill = (name: string): number => clamp(worker.skills[name] ?? 0);
  const trait = (name: string): number => clamp(worker.traits[name] ?? 0);
  const profession = skill(professionSkillKey(type));
  let general: number;
  if (type === "subsistence") general = skill("toolUse") * 0.38 + skill("observation") * 0.24 + trait("cooperation") * 0.2 + trait("curiosity") * 0.18;
  else if (type === "construction") general = skill("toolUse") * 0.58 + skill("observation") * 0.12 + trait("cooperation") * 0.2 + trait("curiosity") * 0.1;
  else if (type === "navigation") general = skill("observation") * 0.42 + skill("communication") * 0.18 + skill("toolUse") * 0.12 + trait("curiosity") * 0.28;
  else if (type === "medicine") general = skill("observation") * 0.48 + skill("communication") * 0.2 + trait("cooperation") * 0.2 + trait("curiosity") * 0.12;
  else if (type === "governance") general = skill("communication") * 0.46 + skill("observation") * 0.08 + trait("cooperation") * 0.28 + trait("sociality") * 0.18;
  else general = skill("toolUse") * 0.5 + skill("observation") * 0.26 + trait("curiosity") * 0.16 + trait("cooperation") * 0.08;
  return clamp(general * 0.65 + profession * 0.35);
};

const workforceAssignmentsFor = (
  state: WorldState,
  owners: FacilityOwner[],
  primaryOwners: ReadonlyMap<RegionId, FacilityOwner>,
  technology: ReturnType<typeof technologyProfilesForState>,
): ReadonlyMap<string, WorkforceAssignment> => {
  const workers = workerRecordsFor(state);
  const facilitiesByOwner = new Map<OrganizationId, Array<{ id: string; type: KnowledgeDomain; existingIds: Set<string>; priority: number }>>();
  for (const facility of state.facilities.filter((candidate) => candidate.status !== "abandoned")) {
    const entries = facilitiesByOwner.get(facility.ownerOrganizationId) ?? [];
    entries.push({ id: facility.id, type: facility.type, existingIds: new Set(facility.workforceIds), priority: facility.status === "active" ? 0 : facility.status === "damaged" ? 1 : 2 });
    facilitiesByOwner.set(facility.ownerOrganizationId, entries);
  }
  for (const owner of primaryOwners.values()) {
    const profile = technology.get(owner.regionId);
    if (!profile || profile.construction <= 0) continue;
    const entries = facilitiesByOwner.get(owner.id) ?? [];
    const existingTypes = new Set(entries.map((entry) => entry.type));
    for (const type of domains) {
      if (profile[type] <= 0 || existingTypes.has(type)) continue;
      entries.push({ id: facilityIdFor(owner.regionId, type, owner.id), type, existingIds: new Set(), priority: 3 });
    }
    facilitiesByOwner.set(owner.id, entries);
  }
  const assignments = new Map<string, WorkforceAssignment>();
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
  const globallyAssigned = new Set<string>();
  const workerScores = new Map<string, Partial<Record<KnowledgeDomain, number>>>();
  const scoreFor = (id: string, type: KnowledgeDomain): number => {
    const scores = workerScores.get(id);
    const cached = scores?.[type];
    if (cached !== undefined) return cached;
    const score = workerScore(workers.get(id), type);
    if (scores) scores[type] = score;
    else workerScores.set(id, { [type]: score });
    return score;
  };
  const eligibleWorkerIds = new Map<OrganizationId, EntityId[]>();
  const eligibleWorkerIdsFor = (owner: FacilityOwner): readonly EntityId[] => {
    const key = owner.id;
    const cached = eligibleWorkerIds.get(key);
    if (cached) return cached;
    const eligible = [...new Set(owner.memberIds)]
      .filter((id) => {
        const worker = workers.get(id);
        return (worker?.regionId === undefined || worker.regionId === owner.regionId) && (worker?.age === undefined || worker.age >= 14);
      });
    eligibleWorkerIds.set(key, eligible);
    return eligible;
  };
  const compareCandidates = (left: WorkforceCandidate, right: WorkforceCandidate): number => {
    const difference = (right.score + Number(right.retained) * 0.03) - (left.score + Number(left.retained) * 0.03);
    return difference || left.id.localeCompare(right.id);
  };
  const topCandidatesFor = (
    owner: FacilityOwner,
    entry: { type: KnowledgeDomain; existingIds: Set<string> },
    available: ReadonlySet<string>,
    required: number,
  ): WorkforceCandidate[] => {
    const candidates: WorkforceCandidate[] = [];
    for (const id of eligibleWorkerIdsFor(owner)) {
      if (!available.has(id) || globallyAssigned.has(id)) continue;
      const candidate: WorkforceCandidate = { id, score: scoreFor(id, entry.type), retained: entry.existingIds.has(id) };
      let position = 0;
      while (position < candidates.length && compareCandidates(candidates[position]!, candidate) <= 0) position += 1;
      if (position >= required && candidates.length >= required) continue;
      candidates.splice(position, 0, candidate);
      if (candidates.length > required) candidates.pop();
    }
    return candidates;
  };
  const orderedOwners = [...facilitiesByOwner.entries()].sort(([left], [right]) => {
    const leftOwner = ownersById.get(left);
    const rightOwner = ownersById.get(right);
    return (rightOwner ? organizationRank[rightOwner.type] : -1) - (leftOwner ? organizationRank[leftOwner.type] : -1) || left.localeCompare(right);
  });
  for (const [ownerId, entries] of orderedOwners) {
    const owner = ownersById.get(ownerId);
    if (!owner) continue;
    const available = new Set(owner.memberIds);
    for (const entry of entries.sort((left, right) => left.priority - right.priority || domains.indexOf(left.type) - domains.indexOf(right.type) || left.id.localeCompare(right.id))) {
      const required = workforceRequired[entry.type];
      const candidates = topCandidatesFor(owner, entry, available, required);
      for (const candidate of candidates) {
        available.delete(candidate.id);
        globallyAssigned.add(candidate.id);
      }
      assignments.set(entry.id, {
        ids: candidates.map((candidate) => candidate.id),
        efficiency: candidates.length > 0 ? candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length : 0,
        required,
      });
    }
  }
  return assignments;
};

const eventRegions = (event: WorldEvent): string[] => [
  event.payload.regionId,
  event.payload.fromRegion,
  event.payload.toRegion,
  event.evidence.regionId,
].filter((value): value is string => typeof value === "string");

const incidentSeverity = (facility: FacilityState, events: readonly WorldEvent[]): { severity: number; lastTick: number; lastStep: string; kinds: string[] } => {
  const naturalSeverity: Record<string, number> = { volcano: 0.32, earthquake: 0.28, meteor: 0.42, drought: 0.12, flood: 0.22 };
  const conflictKinds = new Set(["organization-conflict", "border-conflict", "organization-war"]);
  let severity = 0;
  let lastTick = facility.lastIncidentTick;
  let lastStep = facility.lastIncidentTimelineStep ?? String(facility.lastIncidentTick);
  const inspectedThrough = facility.lastInspectedEventTimelineStep ?? String(facility.lastInspectedEventTick ?? facility.lastIncidentTick);
  const plannedThrough = facility.plannedTimelineStep ?? String(facility.plannedTick);
  const kinds = new Set<string>();
  // Events are kept in chronological order. A facility records the latest
  // inspected tick, so old history can be skipped without rebuilding an
  // index for the entire retained event ledger on every simulated year.
  const relevantEvents = eventsForRegionAndOrganizations(events, facility.regionId, [facility.ownerOrganizationId]);
  for (let index = relevantEvents.length - 1; index >= 0; index -= 1) {
    const event = relevantEvents[index];
    if (!event) continue;
    const eventStep = event.timelineStep ?? String(event.tick);
    if (compareSimulationSteps(eventStep, inspectedThrough) <= 0 || compareSimulationSteps(eventStep, plannedThrough) < 0) break;
    const local = eventRegions(event).includes(facility.regionId)
      || event.sourceIds.includes(facility.ownerOrganizationId)
      || event.sourceIds.includes(facility.id);
    if (!local) continue;
    const base = naturalSeverity[event.kind] ?? (conflictKinds.has(event.kind) ? 0.2 : 0);
    if (base <= 0) continue;
    const intensity = clamp(Number(event.evidence.intensity ?? event.payload.intensity ?? event.probability ?? 0.5));
    severity += base * (0.55 + intensity * 0.9);
    lastTick = Math.max(lastTick, event.tick);
    if (compareSimulationSteps(eventStep, lastStep) > 0) lastStep = eventStep;
    kinds.add(event.kind);
  }
  return { severity: Math.min(0.85, severity), lastTick, lastStep, kinds: [...kinds].sort() };
};

const lifecycleEvent = (
  delta: WorldDelta,
  facility: FacilityState,
  kind: string,
  ruleId: string,
  evidence: Record<string, number | string | boolean>,
): void => {
  delta.eventDrafts.push({
    kind,
    ruleId,
    sourceIds: [facility.id, facility.ownerOrganizationId],
    probability: 1,
    roll: 0,
    evidence: { regionId: facility.regionId, facilityType: facility.type, ...evidence },
    payload: {
      regionId: facility.regionId,
      facilityId: facility.id,
      ownerOrganizationId: facility.ownerOrganizationId,
      facilityType: facility.type,
      level: facility.level,
      status: facility.status,
    },
    source: "natural",
  });
};

const consumeMaterials = (
  delta: WorldDelta,
  state: WorldState,
  facility: FacilityState,
  amount: number,
  purpose: string,
): void => {
  delta.resourceTransactions.push({
    id: `resource:materials:${purpose}:${simulationStepForWorld(state)}:${facility.id}`,
    resourceId: "materials",
    regionId: facility.regionId,
    amount: rounded(amount),
    operation: "consume",
    source: "culture",
    sourceId: facility.id,
    fromHolderId: facility.ownerOrganizationId,
    causeRuleId: `society:facility-${purpose}`,
  });
};

export const stepFacilities = (state: WorldState, incidentEvents: readonly WorldEvent[] = state.events): SocietyDelta => {
  const delta = emptyDelta();
  const currentStep = simulationStepForWorld(state);
  const currentTick = state.tick;
  const balances = new Map<string, number>();
  for (const resource of state.resources) {
    const key = resourceKey(resource.resourceId, resource.regionId, resource.holderId);
    balances.set(key, (balances.get(key) ?? 0) + resource.amount);
  }
  const materialBalanceFor = (regionId: RegionId, holderId: OrganizationId): number =>
    balances.get(resourceKey("materials", regionId, holderId)) ?? 0;
  const owners = ownerRecords(state);
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
  const primaryOwners = primaryOwnersByRegion(owners);
  const orderedPrimaryOwners = [...primaryOwners.values()].sort((left, right) => left.id.localeCompare(right.id));
  const technology = technologyProfilesForState(state);
  const facilityEffects = facilityEffectProfilesForState(state);
  const substanceEffects = substanceEffectProfilesForState(state);
  const workforceAssignments = workforceAssignmentsFor(state, owners, primaryOwners, technology);
  const plannedBalances = new Map<OrganizationId, number>();
  const reserveUpdates = new Map<string, SubstanceState>();
  const reserveCandidatesByRegion = new Map<RegionId, NaturalReserveCandidates>();
  for (const substance of state.substances) {
    if (substance.status !== "known" || substance.formation === "engineered" || substance.remainingReserve <= 0) continue;
    const candidates = reserveCandidatesByRegion.get(substance.regionId) ?? { materials: [], energy: [] };
    candidates.materials.push(substance);
    candidates.energy.push(substance);
    reserveCandidatesByRegion.set(substance.regionId, candidates);
  }
  for (const candidates of reserveCandidatesByRegion.values()) {
    candidates.materials.sort((left, right) => naturalReserveScore(right, "materials") - naturalReserveScore(left, "materials") || left.id.localeCompare(right.id));
    candidates.energy.sort((left, right) => naturalReserveScore(right, "energy") - naturalReserveScore(left, "energy") || left.id.localeCompare(right.id));
  }
  const extractNaturalReserve = (
    regionId: RegionId,
    purpose: "materials" | "energy",
    requestedAmount: number,
    sourceId: OrganizationId,
  ): number => {
    let requested = Math.max(0, requestedAmount);
    let extractedTotal = 0;
    const candidates = reserveCandidatesByRegion.get(regionId)?.[purpose] ?? [];
    for (const original of candidates) {
      if (requested <= 0.000000001) break;
      const current = reserveUpdates.get(original.id) ?? original;
      if (current.remainingReserve <= 0) continue;
      const extraction = extractSubstanceReserve(
        current,
        requested,
        nextSimulationTick(state),
        nextSimulationStep(state),
      );
      if (extraction.amount <= 0) continue;
      reserveUpdates.set(original.id, extraction.substance);
      requested = rounded(requested - extraction.amount);
      extractedTotal = rounded(extractedTotal + extraction.amount);
      const reserveRatio = substanceReserveRatio(extraction.substance);
      delta.eventDrafts.push({
        kind: "substance-extraction",
        ruleId: "society:substance-extraction",
        sourceIds: [original.id, sourceId],
        probability: 1,
        roll: 0,
        evidence: { regionId, substanceId: original.id, purpose, amount: extraction.amount, remainingReserve: extraction.substance.remainingReserve, reserveRatio },
        payload: { regionId, substanceId: original.id, organizationId: sourceId, purpose, amount: extraction.amount, remainingReserve: extraction.substance.remainingReserve, reserveRatio },
        source: "natural",
      });
      if (extraction.becameDepleted) {
        delta.eventDrafts.push({
          kind: "substance-depletion",
          ruleId: "society:substance-depletion",
          sourceIds: [original.id, sourceId],
          probability: 1,
          roll: 0,
          evidence: { regionId, substanceId: original.id, purpose, extractedTotal: extraction.substance.extractedTotal },
          payload: { regionId, substanceId: original.id, organizationId: sourceId, purpose, remainingReserve: 0, reserveRatio: 0 },
          source: "natural",
        });
      }
    }
    return extractedTotal;
  };

  for (const owner of orderedPrimaryOwners) {
    const profile = technology.get(owner.regionId);
    if (!profile || profile.construction <= 0 || owner.memberIds.length < workforceRequired.construction) continue;
    const [xText, yText] = owner.regionId.replace("region:", "").split(":");
    const x = Number(xText);
    const y = Number(yText);
    const index = Number.isInteger(x) && Number.isInteger(y) ? y * state.fields.elevation.width + x : -1;
    const elevation = index >= 0 ? state.fields.elevation.values[index] ?? 0 : 0;
    const nutrients = index >= 0 ? state.fields.nutrients.values[index] ?? 0 : 0;
    const geologyFactor = 0.78 + clamp(elevation) * 0.25 + clamp(nutrients) * 0.18;
    const localFacilities = facilityEffects.get(owner.regionId) ?? emptyEffectProfile();
    const localSubstances = substanceEffects.get(owner.regionId);
    const productionFactor = 1 + localFacilities.construction * 0.45 + localFacilities.energy * 0.25 + (localSubstances?.materialYield ?? 0) * 0.35;
    const requestedFieldProduction = rounded((0.45 + profile.construction * 2 + Math.log2(owner.memberIds.length + 1) * 0.1) * geologyFactor * productionFactor);
    const fieldProduction = Math.min(requestedFieldProduction, clamp(nutrients) * MATERIAL_RESERVE_SCALE);
    if (fieldProduction > 0 && index >= 0) {
      delta.fieldChanges.push({
        field: "nutrients",
        index,
        operation: "add",
        value: -fieldProduction / MATERIAL_RESERVE_SCALE,
        causeRuleId: "society:mineral-extraction",
      });
    }
    const naturalProduction = extractNaturalReserve(
      owner.regionId,
      "materials",
      requestedFieldProduction * (localSubstances?.naturalMaterialYield ?? 0) * 0.2,
      owner.id,
    );
    const amount = rounded(fieldProduction + naturalProduction);
    if (amount > 0) {
      delta.resourceTransactions.push({
        id: `resource:materials:production:${currentStep}:${owner.id}`,
        resourceId: "materials",
        regionId: owner.regionId,
        amount,
        operation: "mint",
        source: "culture",
        sourceId: owner.id,
        toHolderId: owner.id,
        causeRuleId: "society:material-production",
      });
    }
    plannedBalances.set(owner.id, materialBalanceFor(owner.regionId, owner.id));
  }

  for (const owner of orderedPrimaryOwners) {
    const profile = technology.get(owner.regionId);
    const localFacilities = facilityEffects.get(owner.regionId) ?? emptyEffectProfile();
    const localSubstances = substanceEffects.get(owner.regionId);
    const requestedEnergy = rounded(localFacilities.energy * (0.3 + (profile?.energy ?? 0) * 1.4 + Math.log2(owner.memberIds.length + 1) * 0.08) * (1 + (localSubstances?.energyEfficiency ?? 0) * 0.3));
    const [xText, yText] = owner.regionId.replace("region:", "").split(":");
    const x = Number(xText);
    const y = Number(yText);
    const index = Number.isInteger(x) && Number.isInteger(y) ? y * state.fields.elevation.width + x : -1;
    const organics = index >= 0 ? state.chemistry.organics.values[index] ?? 0 : 0;
    const renewableOutput = requestedEnergy * 0.25;
    const feedstockOutput = Math.min(requestedEnergy * 0.75, Math.max(0, organics) * ENERGY_FEEDSTOCK_SCALE);
    if (feedstockOutput > 0 && index >= 0) {
      const feedstockChange = feedstockOutput / ENERGY_FEEDSTOCK_SCALE;
      delta.chemistryChanges.push(
        { field: "organics", index, operation: "add", value: -feedstockChange, causeRuleId: "society:energy-feedstock-conversion" },
        { field: "oxygen", index, operation: "add", value: -feedstockChange * 0.25, causeRuleId: "society:energy-feedstock-conversion" },
        { field: "carbon", index, operation: "add", value: feedstockChange * 0.65, causeRuleId: "society:energy-feedstock-conversion" },
      );
    }
    const naturalOutput = extractNaturalReserve(
      owner.regionId,
      "energy",
      requestedEnergy * (localSubstances?.naturalEnergyYield ?? 0) * 0.2,
      owner.id,
    );
    const energyOutput = rounded(renewableOutput + feedstockOutput + naturalOutput);
    if (energyOutput <= 0) continue;
    delta.resourceTransactions.push({
      id: `resource:energy:production:${currentStep}:${owner.id}`,
      resourceId: "energy",
      regionId: owner.regionId,
      amount: energyOutput,
      operation: "mint",
      source: "culture",
      sourceId: owner.id,
      toHolderId: owner.id,
      causeRuleId: "society:facility-energy-production",
    });
  }

  for (const substance of [...reserveUpdates.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    delta.entityEffects.push({ collection: "substances", operation: "update", id: substance.id, value: substance });
  }

  const existingTypesByRegion = new Set(
    state.facilities
      .filter((facility) => facility.status !== "abandoned")
      .map((facility) => `${facility.regionId}:${facility.type}`),
  );
  for (const owner of orderedPrimaryOwners) {
    const profile = technology.get(owner.regionId);
    if (!profile || profile.construction <= 0) continue;
    for (const type of domains) {
      if (profile[type] <= 0 || owner.memberIds.length < workforceRequired[type]) continue;
      const regionType = `${owner.regionId}:${type}`;
      if (existingTypesByRegion.has(regionType)) continue;
      const assignment = workforceAssignments.get(facilityIdFor(owner.regionId, type, owner.id));
      if (!assignment || assignment.ids.length < assignment.required) continue;
      const facility: FacilityState = {
        id: facilityIdFor(owner.regionId, type, owner.id),
        type,
        regionId: owner.regionId,
        ownerOrganizationId: owner.id,
        level: 1,
        condition: 0,
        status: "planned",
        workforceIds: assignment.ids,
        workforceRequired: assignment.required,
        workforceEfficiency: assignment.efficiency,
        materialInvested: 0,
        plannedTick: currentTick,
        plannedTimelineStep: currentStep,
        builtTick: -1,
        lastMaintainedTick: currentTick,
        lastMaintainedTimelineStep: currentStep,
        lastIncidentTick: currentTick,
        lastIncidentTimelineStep: currentStep,
        lastInspectedEventTick: currentTick,
        lastInspectedEventTimelineStep: currentStep,
      };
      delta.entityEffects.push({ collection: "facilities", operation: "create", id: facility.id, value: facility });
      lifecycleEvent(delta, facility, "facility-planned", "society:facility-planning", { technologyLevel: profile[type], workforce: facility.workforceIds.length });
      existingTypesByRegion.add(regionType);
    }
  }

  for (const current of [...state.facilities].sort((left, right) => left.id.localeCompare(right.id))) {
    if (current.status === "abandoned") {
      const abandonedTick = current.abandonedTick ?? current.lastIncidentTick;
      if (simulationStepDistance(currentStep, current.abandonedTimelineStep ?? String(abandonedTick)) >= ABANDONED_FACILITY_RETENTION_TICKS) {
        delta.entityEffects.push({ collection: "facilities", operation: "remove", id: current.id });
        lifecycleEvent(delta, current, "facility-retired", "society:facility-history-archive", { abandonedTick });
      }
      continue;
    }
    const owner = ownersById.get(current.ownerOrganizationId);
    let facility = current;
    let copied = false;
    const editableFacility = (): FacilityState => {
      if (!copied) {
        facility = { ...current, workforceIds: [...current.workforceIds] };
        copied = true;
      }
      return facility;
    };
    if (!owner) {
      editableFacility();
      facility.status = "abandoned";
      facility.abandonedTick = currentTick;
      facility.abandonedTimelineStep = currentStep;
      facility.workforceIds = [];
      lifecycleEvent(delta, facility, "facility-abandoned", "society:facility-abandonment", { reason: "owner-unavailable", condition: facility.condition });
      delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
      continue;
    }
    const previousWorkforce = new Set(current.workforceIds);
    const assignment = workforceAssignments.get(facility.id) ?? { ids: [], efficiency: 0, required: workforceRequired[facility.type] };
    const workforceChanged = current.workforceIds.length !== assignment.ids.length || assignment.ids.some((id) => !previousWorkforce.has(id));
    const workforceDataChanged = workforceChanged
      || current.workforceRequired !== assignment.required
      || current.workforceEfficiency !== assignment.efficiency;
    if (workforceDataChanged) {
      editableFacility();
      facility.workforceIds = assignment.ids;
      facility.workforceRequired = assignment.required;
      facility.workforceEfficiency = assignment.efficiency;
    }
    const availableWorkforce = assignment.ids.length;
    const requiredWorkforce = assignment.required;
    if (workforceChanged) {
      lifecycleEvent(delta, facility, "facility-workforce-changed", "society:facility-workforce", {
        previousWorkforce: previousWorkforce.size,
        workforce: availableWorkforce,
        workforceRequired: requiredWorkforce,
        workforceEfficiency: rounded(assignment.efficiency),
      });
    }
    let available = plannedBalances.get(owner.id) ?? materialBalanceFor(owner.regionId, owner.id);
    plannedBalances.set(owner.id, available);

    if (facility.status === "planned") {
      const cost = constructionCost[facility.type];
      if (availableWorkforce >= requiredWorkforce && available >= cost) {
        consumeMaterials(delta, state, facility, cost, "construction");
        available -= cost;
        plannedBalances.set(owner.id, available);
        editableFacility();
        facility.condition = 1;
        facility.status = "active";
        facility.materialInvested = rounded(cost);
        facility.builtTick = currentTick;
        facility.builtTimelineStep = currentStep;
        facility.lastMaintainedTick = currentTick;
        facility.lastMaintainedTimelineStep = currentStep;
        lifecycleEvent(delta, facility, "facility-constructed", "society:facility-construction", { materialCost: cost, workforce: availableWorkforce });
      }
      if (copied) delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
      continue;
    }

    editableFacility();
    facility.condition = clamp(facility.condition - (availableWorkforce < requiredWorkforce ? 0.018 : 0.006));
    const incident = incidentSeverity(facility, incidentEvents);
    facility.lastInspectedEventTick = Math.max(currentTick, incident.lastTick);
    facility.lastInspectedEventTimelineStep = compareSimulationSteps(currentStep, incident.lastStep) >= 0 ? currentStep : incident.lastStep;
    let damagedThisStep = false;
    if (compareSimulationSteps(incident.lastStep, facility.lastIncidentTimelineStep ?? String(facility.lastIncidentTick)) > 0) {
      facility.lastIncidentTick = incident.lastTick;
      facility.lastIncidentTimelineStep = incident.lastStep;
      const probability = clamp(0.28 + incident.severity * 0.8);
      const [roll] = randomFloat(forkRandom(state.random, `facility-incident:${facility.id}:${incident.lastTick}`));
      if (roll < probability) {
        const resistance = 0.08 * (facility.level - 1)
          + (technology.get(facility.regionId)?.construction ?? 0) * 0.12
          + (substanceEffects.get(facility.regionId)?.structuralStrength ?? 0) * 0.12;
        const damage = Math.max(0.04, incident.severity * (1 - resistance));
        facility.condition = clamp(facility.condition - damage);
        facility.status = "damaged";
        damagedThisStep = true;
        lifecycleEvent(delta, facility, "facility-damaged", "society:facility-incident", {
          incidentKinds: incident.kinds.join(","), probability, roll, damage: rounded(damage), condition: rounded(facility.condition),
        });
      }
    }

    if (facility.condition <= 0.08) {
      facility.status = "abandoned";
      facility.abandonedTick = currentTick;
      facility.abandonedTimelineStep = currentStep;
      facility.workforceIds = [];
      lifecycleEvent(delta, facility, "facility-abandoned", "society:facility-abandonment", { reason: "structural-failure", condition: rounded(facility.condition) });
      delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
      continue;
    }

    if (!damagedThisStep && facility.condition < 0.86 && availableWorkforce >= requiredWorkforce) {
      const maintenanceCost = rounded(0.18 + facility.level * 0.12);
      if (available >= maintenanceCost) {
        consumeMaterials(delta, state, facility, maintenanceCost, "maintenance");
        available -= maintenanceCost;
        plannedBalances.set(owner.id, available);
        const previousCondition = facility.condition;
        facility.condition = clamp(facility.condition + 0.22 + (technology.get(facility.regionId)?.construction ?? 0) * 0.08);
        facility.status = facility.condition >= 0.62 ? "active" : "damaged";
        facility.lastMaintainedTick = currentTick;
        facility.lastMaintainedTimelineStep = currentStep;
        facility.materialInvested = rounded(facility.materialInvested + maintenanceCost);
        lifecycleEvent(delta, facility, "facility-maintained", "society:facility-maintenance", { materialCost: maintenanceCost, restored: rounded(facility.condition - previousCondition), condition: rounded(facility.condition) });
      } else {
        facility.status = "damaged";
      }
    } else if (facility.condition < 0.62 || availableWorkforce < requiredWorkforce) {
      facility.status = "damaged";
    } else {
      facility.status = "active";
    }

    const profile = technology.get(facility.regionId);
    const nextLevel = facility.level < 3 ? facility.level + 1 as 2 | 3 : undefined;
    const requiredTechnology = nextLevel === 2 ? 0.5 : nextLevel === 3 ? 5 / 6 : 1;
    const upgradeCost = nextLevel ? rounded(constructionCost[facility.type] * nextLevel * 0.8) : 0;
    if (nextLevel && profile && profile[facility.type] >= requiredTechnology && facility.condition >= 0.78 && available >= upgradeCost) {
      consumeMaterials(delta, state, facility, upgradeCost, "upgrade");
      available -= upgradeCost;
      plannedBalances.set(owner.id, available);
      facility.level = nextLevel;
      facility.condition = clamp(facility.condition + 0.08);
      facility.materialInvested = rounded(facility.materialInvested + upgradeCost);
      facility.lastMaintainedTick = currentTick;
      facility.lastMaintainedTimelineStep = currentStep;
      lifecycleEvent(delta, facility, "facility-upgraded", "society:facility-upgrade", { materialCost: upgradeCost, technologyLevel: profile[facility.type], condition: rounded(facility.condition) });
    }
    delta.entityEffects.push({ collection: "facilities", operation: "update", id: facility.id, value: facility });
  }
  return delta;
};
