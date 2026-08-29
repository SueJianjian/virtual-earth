export type EntityId = string & { readonly __entityId: unique symbol };
export type OrganizationId = string & { readonly __organizationId: unique symbol };
export type RegionId = string & { readonly __regionId: unique symbol };

export type RandomState = { value: number };
/** Exact, JSON-safe world clock. Number fields remain as compatibility projections. */
export type SimulationTimeline = {
  step: string;
  days: string;
};
export type PlanetSeason = "spring" | "summer" | "autumn" | "winter";
export type OrbitalState = {
  orbitalPeriodDays: number;
  axialTiltDegrees: number;
  eccentricity: number;
  periapsisPhase: number;
  baseSolarFlux: number;
  rotationPeriodHours: number;
  orbitalPhase: number;
  seasonalPhase: number;
  solarFlux: number;
  season: PlanetSeason;
};
export type ClimateYearSummary = {
  timelineStep: string;
  timelineDays: string;
  sampleDays: number;
  meanTemperature: number;
  meanHumidity: number;
  meanWater: number;
  meanSolarFlux: number;
  minimumTemperature: number;
  maximumTemperature: number;
  seasonalRange: number;
};
/** Bounded climate ledger for the current simulated year. */
export type ClimateCycleState = {
  timelineDays: string;
  currentYearDays: number;
  temperatureTotal: number;
  humidityTotal: number;
  waterTotal: number;
  solarFluxTotal: number;
  minimumTemperature: number;
  maximumTemperature: number;
  lastCompleted?: ClimateYearSummary;
};
export type TectonicPlateKind = "continental" | "oceanic" | "mixed";
export type TectonicPlateState = {
  id: string;
  name: string;
  kind: TectonicPlateKind;
  centerX: number;
  centerY: number;
  velocityX: number;
  velocityY: number;
  density: number;
  thickness: number;
  crustAgeYears: number;
};
export type TectonicState = {
  plates: TectonicPlateState[];
  plateIndex: Grid;
  boundaryStress: Grid;
  boundaryActivity: Grid;
  updateCount: number;
  lastUpdatedTick: number;
  lastUpdatedTimelineStep?: string;
  lastUpdatedYears: number;
};
export type AtmosphereState = {
  pressure: Grid;
  windX: Grid;
  windY: Grid;
  precipitation: Grid;
  updateCount: number;
  lastUpdatedTick: number;
  lastUpdatedTimelineStep?: string;
  lastUpdatedYears: number;
};
export type OceanState = {
  seaTemperature: Grid;
  salinity: Grid;
  currentX: Grid;
  currentY: Grid;
  seaIce: Grid;
  dissolvedNutrients: Grid;
  dissolvedOxygen: Grid;
  organicCarbon: Grid;
  primaryProductivity: Grid;
  planktonBiomass: Grid;
  updateCount: number;
  lastUpdatedTick: number;
  lastUpdatedTimelineStep?: string;
  lastUpdatedYears: number;
};
export type WorldOptions = { width?: number; height?: number; enabledPackIds?: string[]; formation?: "dust" | "formed" };
export type Grid = { width: number; height: number; values: Float32Array };
export type SpeciesRole = "producer" | "consumer" | "decomposer";
export type KnowledgeDomain = "subsistence" | "construction" | "navigation" | "medicine" | "governance" | "energy";
export type FacilityStatus = "planned" | "active" | "damaged" | "abandoned";
export type OrganizationType =
  | "family"
  | "clan"
  | "tribe"
  | "settlement"
  | "city"
  | "state"
  | "federation"
  | "empire";
export type DiplomaticStance = "neutral" | "trade" | "allied" | "rival";
export type HotspotReason =
  | "user-focus"
  | "city"
  | "war"
  | "cultivation"
  | "mythic-event"
  | "disaster"
  | "rapid-change";
export type RegionMode = "aggregate" | "micro";
export type FieldName =
  | "elevation"
  | "temperature"
  | "humidity"
  | "water"
  | "nutrients"
  | "biomass";

export type PlanetFormationPhase =
  | "dust-cloud"
  | "planetesimals"
  | "accretion"
  | "differentiation"
  | "cooling"
  | "stable-crust";

export type PlanetFormationState = {
  phase: PlanetFormationPhase;
  progress: number;
  dustDensity: number;
  bodyCount: number;
  planetaryMass: number;
  collisionEnergy: number;
  coreFraction: number;
  surfaceHeat: number;
  atmosphere: number;
  volatileFraction: number;
};

export type FieldChange = {
  field: FieldName;
  index: number;
  operation: "set" | "add";
  value: number;
  causeRuleId: string;
};

export type ChemistryFieldName =
  | "carbon"
  | "nitrogen"
  | "phosphorus"
  | "organics"
  | "oxygen";

export type ChemistryChange = {
  field: ChemistryFieldName;
  index: number;
  operation: "set" | "add";
  value: number;
  causeRuleId: string;
};

export type FieldPatch = {
  field: FieldName;
  operation: "set" | "add";
  values: Float32Array;
  causeRuleId: string;
};

export type ChemistryPatch = {
  field: ChemistryFieldName;
  operation: "set" | "add";
  values: Float64Array;
  causeRuleId: string;
};

export type SubstanceKind = "mineral" | "crystal" | "organic-compound" | "engineered-composite";
export type SubstanceFormation = "geological" | "hydrothermal" | "biochemical" | "engineered";
export type SubstanceStatus = "latent" | "known";
export type SubstanceProperties = {
  hardness: number;
  density: number;
  reactivity: number;
  conductivity: number;
  energyPotential: number;
  biologicalAffinity: number;
  stability: number;
};
export type SubstanceState = {
  id: string;
  name: string;
  kind: SubstanceKind;
  formation: SubstanceFormation;
  status: SubstanceStatus;
  regionId: RegionId;
  originTick: number;
  originTimelineStep?: string;
  originYears: number;
  parentIds: string[];
  composition: Record<ChemistryFieldName, number>;
  properties: SubstanceProperties;
  /** Finite extractable stock for naturally occurring matter. */
  reserveCapacity: number;
  remainingReserve: number;
  extractedTotal: number;
  discoveredByIds: EntityId[];
  discoveryTick?: number;
  discoveryTimelineStep?: string;
  discoveryYears?: number;
  depletedTick?: number;
  depletedTimelineStep?: string;
};

export type PathogenKind = "virus-like" | "bacterial-colony" | "fungal-spore" | "parasitic-cell";
export type PathogenStatus = "outbreak" | "endemic" | "dormant";
export type PathogenRegionalOutbreakState = {
  regionId: RegionId;
  status: PathogenStatus;
  prevalence: number;
  firstDetectedTick: number;
  firstDetectedTimelineStep?: string;
  lastActiveTick: number;
  lastActiveTimelineStep?: string;
};
export type PathogenState = {
  id: string;
  name: string;
  kind: PathogenKind;
  status: PathogenStatus;
  regionId: RegionId;
  hostSpeciesId: EntityId;
  originTick: number;
  originTimelineStep?: string;
  originYears: number;
  transmission: number;
  severity: number;
  persistence: number;
  prevalence: number;
  regionalOutbreaks: PathogenRegionalOutbreakState[];
  cumulativeCases: number;
  cumulativeRecoveries: number;
  cumulativeDeaths: number;
  lastActiveTick: number;
  lastActiveTimelineStep?: string;
  noveltySignature: string;
  parentId?: string;
};

export type AgentInfectionState = {
  pathogenId: string;
  infectedTick: number;
  infectedTimelineStep?: string;
  severity: number;
};

export type AgentHealthState = {
  vitality: number;
  infections: AgentInfectionState[];
  immunityIds: string[];
};

export type AgentGeneticState = {
  generation: number;
  lineageSignature: string;
  mutationCount: number;
  inheritanceFidelity: number;
  parentDivergence: number;
};

export type RelationshipState = {
  id: string;
  fromId: EntityId;
  toId: EntityId;
  kind:
    | "parent"
    | "partner"
    | "caregiver"
    | "sibling"
    | "friend"
    | "rival"
    | "teacher"
    | "student";
  strength: number;
  createdTick: number;
  createdTimelineStep?: string;
  sourceEventId: string;
};

export type RelationshipEffect = {
  operation: "create" | "update" | "remove";
  relationship: RelationshipState;
};

export type EcologicalRelationshipKind = "predation" | "competition" | "mutualism" | "parasitism";
export type EcologicalRelationshipState = {
  id: string;
  kind: EcologicalRelationshipKind;
  fromSpeciesId: EntityId;
  toSpeciesId: EntityId;
  regionId: RegionId;
  strength: number;
  firstTick: number;
  firstTimelineStep?: string;
  lastTick: number;
  lastTimelineStep?: string;
  interactionCount: number;
  cumulativeImpact: number;
  lastImpact: number;
  status: "active" | "dormant";
  details: Record<string, number | string | boolean>;
};

export type EcologicalRelationshipEffect = {
  operation: "create" | "update" | "remove";
  relationship: EcologicalRelationshipState;
};

export type EntityEffect =
  | {
      collection: "species";
      operation: "create" | "update" | "remove";
      id: EntityId;
      value?: SpeciesState;
    }
  | {
      collection: "populations";
      operation: "create" | "update" | "remove";
      id: EntityId;
      value?: PopulationState;
    }
  | {
      collection: "agents";
      operation: "create" | "update" | "remove";
      id: EntityId;
      value?: AgentState;
    }
  | {
      collection: "cultures";
      operation: "create" | "update" | "remove";
      id: EntityId;
      value?: CultureState;
    }
  | {
      collection: "knowledge";
      operation: "create" | "update" | "remove";
      id: string;
      value?: KnowledgeState;
    }
  | {
      collection: "organizations";
      operation: "create" | "update" | "remove";
      id: OrganizationId;
      value?: OrganizationState;
    }
  | {
      collection: "facilities";
      operation: "create" | "update" | "remove";
      id: string;
      value?: FacilityState;
    }
  | {
      collection: "substances";
      operation: "create" | "update" | "remove";
      id: string;
      value?: SubstanceState;
    }
  | {
      collection: "pathogens";
      operation: "create" | "update" | "remove";
      id: string;
      value?: PathogenState;
    }
  | {
      collection: "worldviewEntities";
      operation: "create" | "update" | "remove";
      id: EntityId;
      value?: WorldviewEntityState;
    };

export type ResourceLedgerEntry = {
  id: string;
  resourceId: string;
  regionId: RegionId;
  holderId?: string;
  amount: number;
  cap: number;
  originEventId: string;
};

export type ResourceTransaction = {
  id: string;
  resourceId: string;
  regionId: RegionId;
  destinationRegionId?: RegionId;
  amount: number;
  operation: "mint" | "transfer" | "consume" | "destroy";
  source: "environment" | "culture" | "worldview" | "user";
  sourceId: string;
  fromHolderId?: string;
  toHolderId?: string;
  causeRuleId: string;
};

export type WorldEventDraft = {
  kind: string;
  ruleId: string;
  years?: number;
  position?: [number, number];
  sourceIds: string[];
  probability: number;
  roll: number;
  evidence: Record<string, number | string | boolean>;
  payload: Record<string, unknown>;
  source: "natural" | "user";
};

export type WorldDelta = {
  fieldChanges: FieldChange[];
  chemistryChanges: ChemistryChange[];
  fieldPatches?: FieldPatch[];
  chemistryPatches?: ChemistryPatch[];
  entityEffects: EntityEffect[];
  relationshipEffects: RelationshipEffect[];
  ecologicalRelationshipEffects?: EcologicalRelationshipEffect[];
  resourceTransactions: ResourceTransaction[];
  worldviewEffects: WorldviewEffect[];
  eventDrafts: WorldEventDraft[];
  lodEffects?: LodEffect[];
  formationEffect?: PlanetFormationState;
  climateCycleEffect?: ClimateCycleState;
  tectonicEffect?: TectonicState;
  atmosphereEffect?: AtmosphereState;
  oceanEffect?: OceanState;
};

export type StateMetric =
  | "meanTemperature"
  | "meanHumidity"
  | "waterCoverage"
  | "nutrientLevel"
  | "biomass"
  | "oxygen"
  | "carbon"
  | "organics"
  | "oceanCoverage"
  | "terrainRelief"
  | "populationCount"
  | "cognitivePotential"
  | "knowledgeDiversity"
  | "beliefDiversity"
  | "householdCount"
  | "settlementDensity"
  | "tradeVolume"
  | "foodSurplus"
  | "foodSecurity"
  | "organizationCapacity"
  | "resourceBalance";

export type RuleContext = {
  state: Readonly<Omit<WorldState, "tick" | "years" | "observation">>;
  random: RandomState;
  metrics: Record<StateMetric, number>;
  tick?: number;
  years?: number;
  regionId?: RegionId;
};

export type StatePredicate = {
  subject: "field" | "chemistry" | "population" | "culture" | "organization" | "resource";
  metric: StateMetric;
  operator: ">=" | "<=" | "==";
  value: number;
};

export type EmergenceRule = {
  id: string;
  predicates: StatePredicate[];
  evaluate(context: RuleContext): RuleDecision;
  apply(context: RuleApplicationContext): RuleOutcome;
};

export type RuleApplicationContext = RuleContext;

export type RuleDecision = {
  eligible: boolean;
  probability: number;
  evidence: Record<string, number | string | boolean>;
  reason: string;
};

export type RuleOutcome<T = unknown, D extends Partial<WorldDelta> = WorldDelta> = {
  status: "applied" | "skipped";
  value?: T;
  delta: D;
};

export type EnvironmentInput = {
  solarFlux: number;
  externalEvents: WorldEvent[];
  elapsedYears?: number;
  /** The environment is projected for the clock value committed by this step. */
  timelineDays?: string;
  timelineStep?: string;
};
export type EnvironmentDelta = WorldDelta;
export type EcologyDelta = WorldDelta;
export type AgentsDelta = WorldDelta;
export type CultureDelta = WorldDelta;
export type SocietyDelta = WorldDelta;
export type WorldviewDelta = Pick<
  WorldDelta,
  "worldviewEffects" | "resourceTransactions" | "eventDrafts"
>;
export type StepInput = {
  elapsedYears: number;
  externalEvents: WorldEvent[];
  /** Exact clock day targeted by the step, used by time-dependent stages. */
  timelineDays?: string;
  /** Exact step targeted by the world commit. */
  timelineStep?: string;
};
export type StepResult = {
  state: WorldState;
  events: WorldEvent[];
  digest: string;
};
export type AgentContext = RuleContext & { candidateIds: EntityId[] };
export type SocietyContext = RuleContext & {
  regionId: RegionId;
  candidateMemberIds: EntityId[];
  foodIndex?: FoodBalanceIndex;
  eligibilityIndex?: SocietyEligibilityIndex;
};
export type FoodBalanceIndex = {
  byEntry: ReadonlyMap<string, number>;
  byRegion: ReadonlyMap<string, number>;
  byAgent: ReadonlyMap<string, number>;
};
export type SocietyEligibilityIndex = {
  agentsById: ReadonlyMap<string, AgentState>;
  relationshipIdsByAgent: ReadonlyMap<string, ReadonlySet<string>>;
  activeOrganizations: ReadonlyArray<OrganizationState>;
  activeOrganizationsByRegion: ReadonlyMap<string, ReadonlyArray<OrganizationState>>;
  culturesByRegion: ReadonlyMap<string, CultureState>;
};
export type WorldviewContext = RuleContext & { enabledPackIds: string[] };
export type MotifDefinition = { id: string; tags: string[]; predicates: StatePredicate[] };
export type ResourceDefinition = { id: string; cap: number; sinks: string[]; sources: string[] };
export type EventTemplate = { id: string; kind: string; payloadKeys: string[] };
export type WorldviewRule = {
  id: string;
  predicates: StatePredicate[];
  evaluate(context: WorldviewContext): RuleDecision;
  apply(context: RuleApplicationContext): RuleOutcome<WorldviewEffect, WorldviewDelta>;
};
export type WorldviewPack = {
  id: string;
  version: 1;
  label: string;
  motifs: MotifDefinition[];
  resources: ResourceDefinition[];
  rules: WorldviewRule[];
  templates: EventTemplate[];
};
export type WorldEventInput = {
  id: string;
  kind: string;
  regionId: RegionId;
  intensity: number;
  duration: number;
  source: "user";
  payload: Record<string, string | number | boolean>;
};

export type Distribution = { bins: Record<string, number> };
export type RegionAgentRecord = {
  id: EntityId;
  age: number;
  parentIds: EntityId[];
  traits?: Record<string, number>;
  skills: Record<string, number>;
  knowledgeIds: string[];
  beliefIds: string[];
  genetics?: AgentGeneticState;
  health?: AgentHealthState;
};
export type OrganizationSummary = {
  id: OrganizationId;
  type: OrganizationType;
  memberCount: number;
  memberIds: EntityId[];
  childIds: OrganizationId[];
  resourceIds: string[];
  historyIds: string[];
  archivedHistoryCount?: number;
  territoryRegionIds: RegionId[];
  governance?: GovernanceState;
  diplomacy?: Record<string, DiplomaticStance>;
};
export type OrganizationArchiveReason = "lifecycle" | "capacity";
export type ArchivedOrganizationSummary = {
  id: OrganizationId;
  type: OrganizationType;
  regionId: RegionId;
  memberCount: number;
  memberIds: EntityId[];
  childIds: OrganizationId[];
  resourceIds: string[];
  resources: Record<string, number>;
  territoryRegionIds: RegionId[];
  status: "active" | "migrating" | "fragmenting" | "collapsed";
  historyCount: number;
  archiveReason: OrganizationArchiveReason;
  archivedTick: number;
  archivedTimelineStep?: string;
  archivedTimelineDays?: string;
  archivedYears: number;
  governance?: GovernanceState;
  diplomacy?: Record<string, DiplomaticStance>;
};
export type OrganizationDevelopmentSummary = {
  id: OrganizationId;
  type: OrganizationType;
  eventCount: number;
  memberCount: number;
  peakMemberCount: number;
  territoryCount: number;
  peakTerritoryCount: number;
  formationCount: number;
  splitCount: number;
  dissolutionCount: number;
  conflictCount: number;
  warCount: number;
  migrationCount: number;
  expansionCount: number;
  territoryTransferCount: number;
  allianceCount: number;
  tradeCount: number;
  tradeVolume: number;
  tradeVolumeByResource: Record<string, number>;
  facilityPlannedCount: number;
  facilityConstructedCount: number;
  facilityUpgradedCount: number;
  facilityDamagedCount: number;
  facilityMaintainedCount: number;
  facilityAbandonedCount: number;
  facilityRetiredCount: number;
  milestoneIds: string[];
  firstActivityTick: number;
  firstActivityTimelineStep?: string;
  firstActivityTimelineDays?: string;
  firstActivityYears?: number;
  latestActivityTick: number;
  latestActivityTimelineStep?: string;
  latestActivityTimelineDays?: string;
  latestActivityYears?: number;
};
export type RegionLineageSummary = {
  descendantCount: number;
  generationDepth: number;
  knowledgeCarrierCount: number;
  knowledgeInheritanceCount: number;
  beliefCarrierCount: number;
  relationshipCounts: Partial<Record<RelationshipState["kind"], number>>;
};
export type FamilyLineageSummary = RegionLineageSummary & {
  id: OrganizationId;
  memberCount: number;
  relationshipCount: number;
};
export type AggregateKnowledgeSummary = {
  id: string;
  kind: string;
  name?: string;
  domain?: KnowledgeDomain;
  credibility: number;
  transmissionCost: number;
  forgettingRate: number;
  originRegionId: RegionId;
  originTick: number;
  originTimelineStep?: string;
  originYears: number;
  parentIds: string[];
};
export type RegionCultureSummary = {
  id: EntityId;
  identity: CultureIdentity;
  knowledge: AggregateKnowledgeSummary[];
  beliefCount: number;
  transmissionRate: number;
  memoryStrength: number;
  innovationCount: number;
  /** Exact timeline position of the last recorded cultural change. */
  lastChangeTick: number;
  lastChangeTimelineStep?: string;
};
export type RegionSocietySummary = {
  organizationCounts: Record<OrganizationType, number>;
  organizationCapacity: number;
  cohesion: number;
  stability: number;
  legitimacy: number;
  military: number;
  publicGoods: number;
  tradeVolume: number;
  conflictPressure: number;
  infrastructureLevel: number;
  /** Exact timeline position of the last recorded social change. */
  lastChangeTick: number;
  lastChangeTimelineStep?: string;
};
export type RegionHealthSummary = {
  activePathogenIds: string[];
  infectedCount: number;
  immuneCount: number;
  prevalence: number;
  meanVitality: number;
};
export type RegionSummary = {
  regionId: RegionId;
  version: number;
  versionStep?: string;
  mode: RegionMode;
  population: number;
  socialPopulation?: number;
  populationByAge: Distribution;
  skillHistogram: Distribution;
  cultureHistogram: Distribution;
  householdCount: number;
  organizations: OrganizationSummary[];
  agentIds: EntityId[];
  agentRecords: RegionAgentRecord[];
  relationshipCount: number;
  relationshipDigest: string;
  relationshipRecords: RelationshipState[];
  ecologicalRelationshipCount?: number;
  ecologicalRelationships?: EcologicalRelationshipState[];
  lineage: RegionLineageSummary;
  familyLineages: FamilyLineageSummary[];
  cultureSummary?: RegionCultureSummary;
  societySummary?: RegionSocietySummary;
  healthSummary?: RegionHealthSummary;
  foodBalance: number;
  foodPerAgent: number;
  foodSecurity: number;
  resources: ResourceLedgerEntry[];
  migrationRate: number;
  historyIds: string[];
  archivedHistoryCount?: number;
  random: RandomState;
  canonicalDigest: string;
};
export type RegionProjection = {
  regionId: RegionId;
  sourceRevision: number;
  sourceRevisionStep?: string;
  readOnly: true;
  generatedFromDigest: string;
  agents: AgentState[];
  relationships: RelationshipState[];
  ecologicalRelationships?: EcologicalRelationshipState[];
  organizations: OrganizationState[];
};
export type LodState = {
  summaries: RegionSummary[];
  canonicalMicroRegionIds: RegionId[];
};
export type LodEffect =
  | { operation: "upsert-summary"; summary: RegionSummary }
  | { operation: "remove-summary"; regionId: RegionId };
export type ObservationState = {
  focusRegionId?: RegionId;
  projection?: RegionProjection;
};

export type LifeBiochemistry = "carbon-nitrogen" | "phosphorus-lattice" | "silicate-organic" | "metal-organic" | "crystal-colloid";
export type GeneticCarrier = "double-ribbon" | "triple-ribbon" | "branched-polymer" | "vesicle-lattice" | "mineral-template";
export type CellArchitecture = "membrane-cell" | "porous-cell" | "syncytial-web" | "crystal-cell" | "modular-colony";
export type MetabolismMode = "radiant-harvesting" | "mineral-chemosynthesis" | "thermal-gradient" | "ingestive-predation" | "osmotic-parasitism" | "symbiotic-exchange" | "detrital-catalysis" | "mineral-recycling" | "anaerobic-fermentation";
export type BodySymmetry = "bilateral" | "radial" | "spiral" | "fractal" | "asymmetric";
export type BodyStructure = "membrane" | "segmented" | "shell" | "filament" | "network";
export type LocomotionMode = "rooted" | "gliding" | "contractile" | "ciliary" | "jet" | "drifting";
export type SensoryMode = "chemical-gradient" | "thermal-field" | "polarized-light" | "vibration" | "electric-field" | "pressure-wave";
export type ReproductionMode = "fission" | "budding" | "spore-cycle" | "paired-fusion" | "brood-pod" | "colony-fragmentation";
export type SpeciesBlueprint = {
  biochemistry: LifeBiochemistry;
  geneticCarrier: GeneticCarrier;
  cellArchitecture: CellArchitecture;
  metabolism: MetabolismMode;
  bodyPlan: {
    symmetry: BodySymmetry;
    structure: BodyStructure;
    locomotion: LocomotionMode;
    appendagePairs: number;
    colonial: boolean;
  };
  senses: SensoryMode[];
  reproduction: ReproductionMode;
  lifespanYears: number;
  adultScale: number;
  metabolicEfficiency: number;
  fecundity: number;
  thermalTolerance: number;
  hydrationRetention: number;
  mutationRate: number;
  inheritanceFidelity: number;
  noveltySignature: string;
};
export type SpeciesState = {
  id: EntityId;
  name?: string;
  role: SpeciesRole;
  traits: Record<string, number>;
  parentId?: EntityId;
  originRegionId?: RegionId;
  originTick?: number;
  originTimelineStep?: string;
  originYears?: number;
  blueprint?: SpeciesBlueprint;
};
export type ArchivedSpeciesSummary = {
  id: EntityId;
  name?: string;
  role: SpeciesRole;
  traits: Record<string, number>;
  parentId?: EntityId;
  originRegionId?: RegionId;
  originTick?: number;
  originTimelineStep?: string;
  originYears?: number;
  blueprint: SpeciesBlueprint;
  lastKnownPopulation: number;
  lastKnownRegionIds: RegionId[];
  archivedTick: number;
  archivedTimelineStep?: string;
  archivedTimelineDays?: string;
  archivedYears: number;
};
export type PopulationState = {
  id: EntityId;
  speciesId: EntityId;
  regionId: RegionId;
  count: number;
  energy: number;
};
export type AgentState = {
  id: EntityId;
  sourceId?: EntityId;
  populationId: EntityId;
  regionId: RegionId;
  age: number;
  lifespan: number;
  parentIds: EntityId[];
  traits: Record<string, number>;
  skills: Record<string, number>;
  needs: Record<string, number>;
  memoryIds: string[];
  knowledgeIds: string[];
  beliefIds: string[];
  relationshipIds: string[];
  genetics?: AgentGeneticState;
  health?: AgentHealthState;
};
export type KnowledgeState = {
  id: string;
  kind: string;
  sourceIds: EntityId[];
  credibility: number;
  transmissionCost: number;
  forgettingRate: number;
  name?: string;
  domain?: KnowledgeDomain;
  originRegionId?: RegionId;
  originTick?: number;
  originTimelineStep?: string;
  originYears?: number;
  parentIds?: string[];
};
export type CultureLanguageFamily = "pulse-tonal" | "scent-glyph" | "gesture-lattice" | "resonant-vowel" | "light-pattern";
export type CultureCommunicationStyle = "consensus" | "council" | "lineage" | "merit" | "ritual";
export type CultureValues = {
  cooperation: number;
  reciprocity: number;
  hierarchy: number;
  curiosity: number;
  tradition: number;
  stewardship: number;
};
export type CultureIdentity = {
  name: string;
  languageFamily: CultureLanguageFamily;
  communicationStyle: CultureCommunicationStyle;
  values: CultureValues;
  traditions: string[];
  symbol: string;
  originRegionId: RegionId;
  originTick: number;
  originTimelineStep?: string;
  originYears: number;
  generation: number;
  noveltySignature: string;
  parentCultureIds?: EntityId[];
};
export type CultureState = {
  id: EntityId;
  regionId: RegionId;
  knowledgeIds: string[];
  beliefIds: string[];
  transmissionRate: number;
  identity?: CultureIdentity;
};
export type OrganizationState = {
  id: OrganizationId;
  type: OrganizationType;
  memberIds: EntityId[];
  childOrganizationIds: OrganizationId[];
  regionId: RegionId;
  territoryRegionIds: RegionId[];
  resources: Record<string, number>;
  status: "active" | "migrating" | "fragmenting" | "collapsed";
  archivedHistoryCount?: number;
  governance?: GovernanceState;
  diplomacy?: Record<string, DiplomaticStance>;
};
export type FacilityState = {
  id: string;
  type: KnowledgeDomain;
  regionId: RegionId;
  ownerOrganizationId: OrganizationId;
  level: 1 | 2 | 3;
  condition: number;
  status: FacilityStatus;
  workforceIds: EntityId[];
  workforceRequired?: number;
  workforceEfficiency?: number;
  materialInvested: number;
  plannedTick: number;
  plannedTimelineStep?: string;
  builtTick: number;
  builtTimelineStep?: string;
  lastMaintainedTick: number;
  lastMaintainedTimelineStep?: string;
  lastIncidentTick: number;
  lastIncidentTimelineStep?: string;
  lastInspectedEventTick?: number;
  lastInspectedEventTimelineStep?: string;
  abandonedTick?: number;
  abandonedTimelineStep?: string;
};
export type GovernanceState = {
  stability: number;
  legitimacy: number;
  military: number;
  treasury: number;
  publicGoods: number;
  warWeariness: number;
  taxRate: number;
  taxRevenue: number;
  cohesion: number;
  lastConflictTick: number;
  lastConflictTimelineStep?: string;
};
export type WorldviewEntityKind = "deity" | "sect" | "cultivation-path";
export type WorldviewEntityStatus = "active" | "dormant";
export type WorldviewEntityState = {
  id: EntityId;
  packId: string;
  kind: WorldviewEntityKind;
  name?: string;
  regionId: RegionId;
  influence: number;
  resourceBalances: Record<string, number>;
  originTick?: number;
  originTimelineStep?: string;
  sourcePhenomenonId?: string;
  founderId?: EntityId;
  memberIds?: EntityId[];
  sponsorOrganizationId?: OrganizationId;
  status: WorldviewEntityStatus;
  supporterCount?: number;
  activePractitionerCount?: number;
  sponsorCount?: number;
  viability?: number;
  lastStatusChangeTick?: number;
  lastStatusChangeTimelineStep?: string;
  lastActiveTick?: number;
  lastActiveTimelineStep?: string;
  dormantSinceTick?: number;
  dormantSinceTimelineStep?: string;
  revivalCount?: number;
  derivedFromEntityIds?: EntityId[];
  derivedFromPackIds?: string[];
  propagationCount?: number;
  conflictCount?: number;
  fusionCount?: number;
  lastInteractionTick?: number;
  lastInteractionTimelineStep?: string;
};
export type WorldviewInteractionKind = "propagation" | "conflict" | "fusion";
export type WorldviewInteractionStatus = "active" | "dormant" | "resolved";
export type WorldviewGovernanceEffect = "stabilizing" | "destabilizing" | "integrating";
export type WorldviewInteractionState = {
  id: string;
  kind: WorldviewInteractionKind;
  sourceEntityId: EntityId;
  targetEntityId: EntityId;
  sourcePackId: string;
  targetPackId: string;
  regionId: RegionId;
  /** Destination region for a verified interregional contact. */
  targetRegionId?: RegionId;
  originTick: number;
  originTimelineStep?: string;
  lastInteractionTick: number;
  lastInteractionTimelineStep?: string;
  attempts: number;
  successes: number;
  failures: number;
  compatibility: number;
  intensity: number;
  status: WorldviewInteractionStatus;
  fusionEntityId?: EntityId;
  transmittedBeliefId?: string;
  transmittedPracticeId?: string;
  governanceEffect?: WorldviewGovernanceEffect;
};
export type WorldviewPhenomenonKind =
  | "natural-anomaly"
  | "cultural-theory"
  | "mythic-tradition"
  | "verified-principle";
export type EpistemicStatus = "observed" | "hypothesized" | "believed" | "verified";
export type WorldviewPhenomenonState = {
  id: string;
  packId: string;
  kind: WorldviewPhenomenonKind;
  epistemicStatus: EpistemicStatus;
  name: string;
  regionId: RegionId;
  originTick: number;
  originTimelineStep?: string;
  parentIds: string[];
  causeRuleId: string;
  evidence: Record<string, number | string | boolean>;
};
export type WorldviewPracticeStatus = "active" | "dormant" | "failed";
export type WorldviewPracticeState = {
  id: string;
  packId: string;
  name: string;
  phenomenonId: string;
  regionId: RegionId;
  practitionerId: EntityId;
  teacherId?: EntityId;
  originTick: number;
  originTimelineStep?: string;
  lastTrainedTick: number;
  lastTrainedTimelineStep?: string;
  attunement: number;
  energy: number;
  attempts: number;
  failures: number;
  status: WorldviewPracticeStatus;
  organizationId?: OrganizationId;
};
export type WorldviewEffect =
  | {
      kind: "discover-motif";
      packId: string;
      motifId: string;
      regionId: RegionId;
      evidence: Record<string, number | string | boolean>;
    }
  | {
      kind: "propagate-belief";
      packId: string;
      beliefId: string;
      regionId: RegionId;
      sourceIds: EntityId[];
      strength: number;
    }
  | {
      kind: "propose-entity";
      packId: string;
      entityKind: WorldviewEntityKind;
      name?: string;
      regionId: RegionId;
      evidence: Record<string, number | string | boolean>;
      probability: number;
      influence?: number;
      sourcePhenomenonId?: string;
      founderId?: EntityId;
      memberIds?: EntityId[];
      sponsorOrganizationId?: OrganizationId;
    }
  | {
      kind: "record-phenomenon";
      packId: string;
      phenomenonKind: WorldviewPhenomenonKind;
      epistemicStatus: EpistemicStatus;
      name: string;
      regionId: RegionId;
      parentIds: string[];
      causeRuleId: string;
      evidence: Record<string, number | string | boolean>;
    }
  | {
      kind: "begin-practice";
      packId: string;
      name: string;
      phenomenonId: string;
      regionId: RegionId;
      practitionerId: EntityId;
      teacherId?: EntityId;
      organizationId?: OrganizationId;
      resourceHolderId?: string;
      evidence: Record<string, number | string | boolean>;
    }
  | {
      kind: "train-practice";
      packId: string;
      practiceId: string;
      outcome: "advance" | "setback" | "exhausted";
      energyGain: number;
      energySpent: number;
      attunementDelta: number;
      resourceId?: string;
      resourceHolderId?: string;
      resourceMinted?: number;
      resourceConsumed?: number;
      organizationId?: OrganizationId;
      evidence: Record<string, number | string | boolean>;
    }
  | {
      kind: "interact-entities";
      packId: string;
      interaction: WorldviewInteractionKind;
      sourceEntityId: EntityId;
      targetEntityId: EntityId;
      regionId: RegionId;
      targetRegionId?: RegionId;
      probability: number;
      compatibility: number;
      intensity: number;
      evidence: Record<string, number | string | boolean>;
    }
  | { kind: "resource-transaction"; transaction: ResourceTransaction };
export type WorldviewState = {
  enabledPackIds: string[];
  discoveredRuleIds: string[];
  entities: WorldviewEntityState[];
  phenomena: WorldviewPhenomenonState[];
  practices: WorldviewPracticeState[];
  interactions: WorldviewInteractionState[];
};
export type SimulationStage = {
  id: string;
  order: number;
  run(
    state: Readonly<WorldState>,
    input: StepInput,
    priorDeltas: ReadonlyMap<string, WorldDelta>,
  ): WorldDelta;
};
export type WorldEvent = {
  id: string;
  tick: number;
  timelineStep?: string;
  timelineDays?: string;
  years?: number;
  kind: string;
  ruleId: string;
  position?: [number, number];
  source: "natural" | "user";
  sourceIds: string[];
  probability: number;
  roll: number;
  evidence: Record<string, number | string | boolean>;
  payload: Record<string, unknown>;
};

export type EventMilestone = {
  id: string;
  tick: number;
  timelineStep?: string;
  timelineDays?: string;
  years?: number;
  kind: string;
  ruleId: string;
  source: "natural" | "user";
  sourceIds: string[];
  regionIds: RegionId[];
  organizationIds: string[];
  probability: number;
  roll: number;
  position?: [number, number];
  details: Record<string, number | string | boolean>;
};

export type StrategicRouteKind = "trade" | "alliance" | "migration" | "border-conflict";
export type StrategicRouteSummary = {
  kind: StrategicRouteKind;
  fromId: string;
  toId: string;
  fromRegion: RegionId;
  toRegion: RegionId;
  resourceId?: "food" | "materials" | "energy";
  cumulativeAmount: number;
  occurrenceCount: number;
  firstTick: number;
  firstTimelineStep?: string;
  firstTimelineDays?: string;
  firstYears?: number;
  lastTick: number;
  lastTimelineStep?: string;
  lastTimelineDays?: string;
  lastYears?: number;
};

export type EventArchive = {
  totalEventCount: number;
  archivedEventCount: number;
  archivedSpeciesCount: number;
  archivedKnowledgeCount: number;
  archivedCultureCount: number;
  archivedRelationshipCount: number;
  firstEventTick?: number;
  firstEventTimelineStep?: string;
  firstEventYears?: number;
  latestEventTick?: number;
  latestEventTimelineStep?: string;
  latestEventYears?: number;
  archivedThroughTick?: number;
  archivedThroughTimelineStep?: string;
  archivedThroughYears?: number;
  kindCounts: Record<string, number>;
  regionCounts: Record<string, number>;
  organizationCounts: Record<string, number>;
  organizationFormationCounts: Record<string, number>;
  tradeVolumeByResource: Record<string, number>;
  archivedSpeciesRoleCounts: Partial<Record<SpeciesRole, number>>;
  archivedSpeciesSummaries: ArchivedSpeciesSummary[];
  archivedOrganizationCount: number;
  archivedOrganizationSummaries: ArchivedOrganizationSummary[];
  organizationDevelopment: Record<string, OrganizationDevelopmentSummary>;
  milestones: EventMilestone[];
  strategicRoutes: StrategicRouteSummary[];
  historySamples: WorldHistorySample[];
};

/** Compact annual observation used to inspect continuous world evolution. */
export type WorldHistorySample = {
  tick: number;
  years: number;
  timelineStep: string;
  timelineDays: string;
  meanTemperature: number;
  oceanCoverage: number;
  biomass: number;
  oxygen: number;
  organics: number;
  populationCount: number;
  speciesCount: number;
  organizationCount: number;
  facilityCount: number;
  knowledgeCount: number;
  foodSecurity: number;
  diseasePrevalence: number;
  annualMeanTemperature?: number;
  annualMeanHumidity?: number;
  annualMeanWater?: number;
  annualMeanSolarFlux?: number;
  annualMinimumTemperature?: number;
  annualMaximumTemperature?: number;
  annualSeasonalRange?: number;
};

export type WorldState = {
  version: 1;
  seed: number;
  tick: number;
  years: number;
  /** Exact whole simulated days; omitted only for legacy saves. */
  simulationDays?: number;
  /** Exact clock used after the compatibility number fields reach their precision limit. */
  timeline?: SimulationTimeline;
  orbital: OrbitalState;
  climateCycle: ClimateCycleState;
  random: RandomState;
  formation: PlanetFormationState;
  tectonics: TectonicState;
  atmosphere: AtmosphereState;
  ocean: OceanState;
  fields: {
    elevation: Grid;
    temperature: Grid;
    humidity: Grid;
    water: Grid;
    nutrients: Grid;
    biomass: Grid;
  };
  chemistry: {
    carbon: Grid;
    nitrogen: Grid;
    phosphorus: Grid;
    organics: Grid;
    oxygen: Grid;
  };
  substances: SubstanceState[];
  pathogens: PathogenState[];
  species: SpeciesState[];
  populations: PopulationState[];
  agents: AgentState[];
  knowledge: KnowledgeState[];
  relationships: RelationshipState[];
  ecologicalRelationships?: EcologicalRelationshipState[];
  cultures: CultureState[];
  organizations: OrganizationState[];
  facilities: FacilityState[];
  resources: ResourceLedgerEntry[];
  worldview: WorldviewState;
  events: WorldEvent[];
  eventArchive: EventArchive;
  lod: LodState;
  observation: ObservationState;
};
