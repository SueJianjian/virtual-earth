import type { CultureIdentity, FacilityStatus, Grid, OrganizationState, OrganizationType, RegionId, RegionProjection, RegionSummary, RelationshipState, SpeciesBlueprint, StepResult, WorldEvent, WorldEventInput, WorldState, WorldviewEntityKind, WorldviewEntityState, WorldviewEntityStatus, WorldviewPhenomenonState, WorldviewPracticeState } from "../sim/types.ts";

export type WorkerCommand =
  | { type: "start" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "step"; count: number }
  | { type: "setSpeed"; multiplier: 1 | 4 | 16 | 64 }
  | { type: "applyEvent"; event: WorldEventInput }
  | { type: "focusRegion"; regionId: RegionId }
  | { type: "save" }
  | { type: "load"; payload: string };

export type RuntimeDiagnostics = {
  measuredSteps: number;
  lastStepMs: number;
  averageStepMs: number;
  peakStepMs: number;
  hotEventCount: number;
  archivedEventCount: number;
  milestoneCount: number;
};

export type WorldSnapshot = {
  seed: number;
  tick: number;
  years: number;
  formation: WorldState["formation"];
  eventArchive?: WorldState["eventArchive"];
  runtime?: RuntimeDiagnostics;
  digest: string;
  focusRegionId?: RegionId;
  fields: WorldState["fields"];
  chemistry: WorldState["chemistry"];
  metrics: Record<string, number>;
  foodSecurity?: Grid;
  /** Legacy fixture compatibility. Runtime snapshots use the typed grid. */
  foodSecurityByRegion?: Record<string, number>;
  species?: WorldState["species"];
  populations?: WorldState["populations"];
  knowledge?: WorldState["knowledge"];
  cultures?: WorldState["cultures"];
  cultureIdentityByRegion?: Record<string, CultureIdentity>;
  facilities?: WorldState["facilities"];
  substances?: WorldState["substances"];
  resources?: WorldState["resources"];
  substanceRichnessByRegion?: Record<string, number>;
  organizationDirectory?: OrganizationDirectoryEntry[];
  supplyRoutes?: SupplyRoute[];
  sceneEntities?: SceneEntity[];
  sceneLinks?: SceneLink[];
  worldviewPhenomena?: WorldviewPhenomenonState[];
  worldviewPractices?: WorldviewPracticeState[];
  worldviewEntities?: WorldviewEntityState[];
  selectedRegion?: RegionSummary;
  recentRegionEvents?: RecentRegionEvent[];
  projection?: RegionProjection;
};

export type RecentRegionEvent = {
  id: string;
  tick: number;
  years?: number;
  kind: string;
  ruleId: string;
  source: WorldEvent["source"];
  sourceIds: string[];
  regionIds: RegionId[];
  organizationIds: string[];
  probability: number;
  intensity?: number;
  name?: string;
  result?: string;
  resourceId?: string;
  amount?: number;
  route?: string;
  destinationRegionId?: RegionId;
  position?: [number, number];
  archived?: boolean;
  details?: Record<string, number | string | boolean>;
};

export type SupplyRoute = {
  fromOrganizationId: string;
  toOrganizationId: string;
  fromRegion: RegionId;
  toRegion: RegionId;
  resourceId: "food" | "materials" | "energy";
  totalAmount: number;
  shipmentCount: number;
  lastTick: number;
  lastYears?: number;
};

export type OrganizationDirectoryEntry = {
  id: string;
  type: OrganizationType;
  regionId: RegionId;
  memberCount: number;
  memberIds?: string[];
  childIds: string[];
  resourceIds: string[];
  historyCount: number;
  archivedHistoryCount: number;
  relationshipCount: number;
  territoryRegionIds: RegionId[];
  governance?: OrganizationState["governance"];
  diplomacy?: OrganizationState["diplomacy"];
};

export type SceneEntity = {
  id: string;
  kind: "agent" | "population" | "facility" | OrganizationType | WorldviewEntityKind;
  regionId: RegionId;
  count: number;
  rank: number;
  facilityType?: "subsistence" | "construction" | "navigation" | "medicine" | "governance" | "energy";
  facilityLevel?: 1 | 2 | 3;
  facilityCondition?: number;
  facilityStatus?: FacilityStatus;
  worldviewInfluence?: number;
  worldviewStatus?: WorldviewEntityStatus;
  territoryRegionIds?: RegionId[];
  speciesId?: string;
  speciesName?: string;
  lifeBlueprint?: SpeciesBlueprint;
  cultureId?: string;
  cultureName?: string;
  cultureSignature?: string;
};

export type SceneLink = {
  fromId: string;
  toId: string;
  strength: number;
  kind: RelationshipState["kind"] | "trade" | "border-conflict";
};

export type WorkerMessage =
  | { type: "snapshot"; snapshot: WorldSnapshot; paused: boolean; speed: 1 | 4 | 16 | 64 }
  | { type: "events"; events: WorldEvent[] }
  | { type: "error"; code: string; message: string }
  | { type: "saved"; payload: string; digest: string };

export type WorkerClient = { send(command: WorkerCommand): void; subscribe(listener: (message: WorkerMessage) => void): () => void };

export type StepOutcome = StepResult & { paused: boolean; speed: 1 | 4 | 16 | 64 };
