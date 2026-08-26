import type { OrganizationType, RegionId, RegionProjection, RegionSummary, RelationshipState, StepResult, WorldEvent, WorldEventInput, WorldState } from "../sim/types.ts";

export type WorkerCommand =
  | { type: "start" }
  | { type: "pause" }
  | { type: "step"; count: number }
  | { type: "setSpeed"; multiplier: 1 | 4 | 16 | 64 }
  | { type: "applyEvent"; event: WorldEventInput }
  | { type: "focusRegion"; regionId: RegionId }
  | { type: "save" }
  | { type: "load"; payload: string };

export type WorldSnapshot = {
  tick: number;
  years: number;
  digest: string;
  focusRegionId?: RegionId;
  fields: WorldState["fields"];
  chemistry: WorldState["chemistry"];
  metrics: Record<string, number>;
  foodSecurityByRegion?: Record<string, number>;
  sceneEntities?: SceneEntity[];
  sceneLinks?: SceneLink[];
  selectedRegion?: RegionSummary;
  projection?: RegionProjection;
};

export type SceneEntity = {
  id: string;
  kind: "agent" | "population" | OrganizationType;
  regionId: RegionId;
  count: number;
  rank: number;
};

export type SceneLink = Pick<RelationshipState, "fromId" | "toId" | "kind" | "strength">;

export type WorkerMessage =
  | { type: "snapshot"; snapshot: WorldSnapshot; paused: boolean; speed: 1 | 4 | 16 | 64 }
  | { type: "events"; events: WorldEvent[] }
  | { type: "error"; code: string; message: string }
  | { type: "saved"; payload: string; digest: string };

export type WorkerClient = { send(command: WorkerCommand): void; subscribe(listener: (message: WorkerMessage) => void): () => void };

export type StepOutcome = StepResult & { paused: boolean; speed: 1 | 4 | 16 | 64 };
