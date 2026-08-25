import { hashString } from "../random.ts";
import type { AgentState, EntityId, KnowledgeState } from "../types.ts";

export const knowledgeIdFor = (regionId: string, kind: string): string =>
  `knowledge:${hashString(`${regionId}:${kind}`).toString(16)}`;

export const createKnowledge = (
  regionId: string,
  kind: string,
  sources: AgentState[],
): KnowledgeState => ({
  id: knowledgeIdFor(regionId, kind),
  kind,
  sourceIds: sources.map((agent) => agent.id).sort(),
  credibility: Math.max(0, Math.min(1, sources.reduce((sum, agent) => sum + (agent.skills.observation ?? 0), 0) / Math.max(1, sources.length))),
  transmissionCost: Math.max(0.05, 0.5 - sources.reduce((sum, agent) => sum + (agent.skills.communication ?? 0), 0) / Math.max(1, sources.length) * 0.3),
  forgettingRate: Math.max(0.001, 0.04 - sources.reduce((sum, agent) => sum + (agent.traits.curiosity ?? 0), 0) / Math.max(1, sources.length) * 0.02),
});

export const knowledgeKindsFor = (agent: AgentState): string[] => Object.entries(agent.skills)
  .filter(([, value]) => value >= 0.18)
  .map(([kind]) => `practice:${kind}`)
  .sort();

export const asEntityId = (value: string): EntityId => value as EntityId;
