import type { AgentState, RegionLineageSummary, RelationshipState } from "../types.ts";

export const summarizeLineage = (
  agents: AgentState[],
  relationships: RelationshipState[],
): RegionLineageSummary => {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const depths = new Map<string, number>();
  const depthFor = (agent: AgentState, visiting = new Set<string>()): number => {
    const known = depths.get(agent.id);
    if (known !== undefined) return known;
    if (visiting.has(agent.id)) return 1;
    if (agent.parentIds.length === 0) {
      depths.set(agent.id, 1);
      return 1;
    }
    const nextVisiting = new Set(visiting).add(agent.id);
    const parentDepth = Math.max(1, ...agent.parentIds.map((parentId) => {
      const parent = byId.get(parentId);
      return parent ? depthFor(parent, nextVisiting) : 1;
    }));
    const depth = parentDepth + 1;
    depths.set(agent.id, depth);
    return depth;
  };
  const descendants = agents.filter((agent) => agent.parentIds.length > 0);
  const relationshipCounts = relationships.reduce<RegionLineageSummary["relationshipCounts"]>((counts, relationship) => {
    counts[relationship.kind] = (counts[relationship.kind] ?? 0) + 1;
    return counts;
  }, {});
  return {
    descendantCount: descendants.length,
    generationDepth: agents.length === 0 ? 0 : Math.max(...agents.map((agent) => depthFor(agent))),
    knowledgeCarrierCount: descendants.filter((agent) => agent.knowledgeIds.length > 0).length,
    beliefCarrierCount: descendants.filter((agent) => agent.beliefIds.length > 0).length,
    relationshipCounts,
  };
};
