import type { CultureIdentity, EcologicalRelationshipKind, FacilityStatus, Grid, OrganizationState, OrganizationType, RegionId, RegionProjection, RegionSummary, RelationshipState, SimulationTimeline, SpeciesBlueprint, StepResult, WorldEvent, WorldEventInput, WorldHistorySample, WorldState, WorldviewEntityKind, WorldviewEntityState, WorldviewEntityStatus, WorldviewInteractionState, WorldviewPhenomenonState, WorldviewPracticeState } from "../sim/types.ts";

export type WorkerCommand =
  | { type: "start" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "step"; count: number }
  | { type: "setSpeed"; multiplier: 1 | 4 | 16 | 64 }
  | { type: "applyEvent"; event: WorldEventInput }
  | { type: "focusRegion"; regionId: RegionId }
  | { type: "checkpoint" }
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
  timeline?: SimulationTimeline;
  orbital?: WorldState["orbital"];
  climateCycle?: WorldState["climateCycle"];
  formation: WorldState["formation"];
  tectonics?: WorldState["tectonics"];
  eventArchive?: WorldState["eventArchive"];
  historySamples?: WorldHistorySample[];
  runtime?: RuntimeDiagnostics;
  digest: string;
  focusRegionId?: RegionId;
  fields: WorldState["fields"];
  chemistry: WorldState["chemistry"];
  metrics: Record<string, number>;
  foodSecurity?: Grid;
  diseasePrevalence?: Grid;
  /** Legacy fixture compatibility. Runtime snapshots use the typed grid. */
  foodSecurityByRegion?: Record<string, number>;
  species?: WorldState["species"];
  populations?: WorldState["populations"];
  knowledge?: WorldState["knowledge"];
  ecologicalRelationships?: WorldState["ecologicalRelationships"];
  cultures?: WorldState["cultures"];
  cultureIdentityByRegion?: Record<string, CultureIdentity>;
  facilities?: WorldState["facilities"];
  substances?: WorldState["substances"];
  pathogens?: WorldState["pathogens"];
  resources?: WorldState["resources"];
  substanceRichnessByRegion?: Record<string, number>;
  organizationDirectory?: OrganizationDirectoryEntry[];
  supplyRoutes?: SupplyRoute[];
  sceneEntities?: SceneEntity[];
  sceneLinks?: SceneLink[];
  worldviewPhenomena?: WorldviewPhenomenonState[];
  worldviewPractices?: WorldviewPracticeState[];
  worldviewEntities?: WorldviewEntityState[];
  worldviewInteractions?: WorldviewInteractionState[];
  selectedRegion?: RegionSummary;
  recentRegionEvents?: RecentRegionEvent[];
  projection?: RegionProjection;
};

export type RecentRegionEvent = {
  id: string;
  tick: number;
  timelineStep?: string;
  timelineDays?: string;
  years?: number;
  kind: string;
  ruleId: string;
  source: WorldEvent["source"];
  sourceIds: string[];
  /** Bounded object IDs extracted from the event payload for detail-history matching. */
  relatedIds?: string[];
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
  archivedShipmentCount?: number;
  firstTick?: number;
  firstTimelineStep?: string;
  firstTimelineDays?: string;
  firstYears?: number;
  lastTick: number;
  lastTimelineStep?: string;
  lastTimelineDays?: string;
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

export type StrategicSceneLinkKind = "trade" | "alliance" | "migration" | "border-conflict";
export type SceneLink = {
  fromId: string;
  toId: string;
  fromRegion: RegionId;
  toRegion: RegionId;
  strength: number;
  scope: "personal" | "strategic";
  kind: RelationshipState["kind"] | EcologicalRelationshipKind | StrategicSceneLinkKind;
};

export type WorkerMessage =
  | { type: "snapshot"; snapshot: WorldSnapshot; paused: boolean; speed: 1 | 4 | 16 | 64 }
  | { type: "events"; events: WorldEvent[] }
  | { type: "autosaved"; payload: string; digest: string; timelineDays: string }
  | { type: "error"; code: string; message: string }
  | { type: "saved"; payload: string; digest: string };

export type WorkerClient = { send(command: WorkerCommand): void; subscribe(listener: (message: WorkerMessage) => void): () => void };

export type StepOutcome = StepResult & { paused: boolean; speed: 1 | 4 | 16 | 64 };
