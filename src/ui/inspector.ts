import type { CellSelection } from "./map-canvas.ts";
import { summarizeLineage } from "../sim/lod/lineage.ts";
import type { FamilyLineageSummary, RegionLineageSummary } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";

const percent = (value: number | undefined): string => `${((value ?? 0) * 100).toFixed(1)}%`;
const format = (value: number): string => new Intl.NumberFormat("zh-CN").format(value);
const relationshipLabels: Array<[keyof RegionLineageSummary["relationshipCounts"], string]> = [
  ["partner", "伴侣"],
  ["parent", "亲子"],
  ["caregiver", "照护"],
  ["sibling", "同胞"],
];

export type InspectorLineage = RegionLineageSummary & {
  householdCount: number;
  population: number;
  relationshipCount: number;
  families: Array<{ id: string; memberCount: number }>;
  familyLineages: FamilyLineageSummary[];
  foodBalance: number;
  foodPerAgent: number;
  foodSecurity: number;
  source: "aggregate" | "micro";
};

export const lineageForSnapshot = (snapshot: WorldSnapshot): InspectorLineage => {
  const summary = snapshot.selectedRegion;
  const projection = snapshot.projection;
  if (summary?.mode === "aggregate") {
    return {
      ...summary.lineage,
      householdCount: summary.householdCount,
      population: summary.population,
      relationshipCount: summary.relationshipCount,
      families: summary.organizations.filter((organization) => organization.type === "family").map((family) => ({ id: family.id, memberCount: family.memberCount })),
      familyLineages: summary.familyLineages ?? [],
      foodBalance: summary.foodBalance,
      foodPerAgent: summary.foodPerAgent,
      foodSecurity: summary.foodSecurity,
      source: "aggregate",
    };
  }
  const agents = projection?.agents ?? [];
  const relationships = projection?.relationships ?? [];
  const lineage = summarizeLineage(agents, relationships);
  const familyLineages = (projection?.organizations ?? [])
    .filter((organization) => organization.type === "family")
    .map((family) => {
      const memberIds = new Set(family.memberIds);
      const familyAgents = agents.filter((agent) => memberIds.has(agent.id));
      const familyRelationships = relationships.filter((relationship) => memberIds.has(relationship.fromId) && memberIds.has(relationship.toId));
      return {
        id: family.id,
        memberCount: family.memberIds.length,
        relationshipCount: familyRelationships.length,
        ...summarizeLineage(familyAgents, familyRelationships),
      };
    });
  return {
    ...lineage,
    householdCount: projection?.organizations.filter((organization) => organization.type === "family").length ?? 0,
    population: agents.length,
    relationshipCount: relationships.length,
    families: projection?.organizations.filter((organization) => organization.type === "family").map((family) => ({ id: family.id, memberCount: family.memberIds.length })) ?? [],
    familyLineages,
    foodBalance: summary?.foodBalance ?? 0,
    foodPerAgent: summary?.foodPerAgent ?? 0,
    foodSecurity: summary?.foodSecurity ?? 0,
    source: "micro",
  };
};

export const renderInspector = (element: HTMLElement, snapshot: WorldSnapshot, selection?: CellSelection): void => {
  if (!selection) {
    element.innerHTML = `<div class="empty-state"><strong>未选择区域</strong><span>环境与社会状态</span></div>`;
    return;
  }
  const fields = snapshot.fields;
  const lineage = lineageForSnapshot(snapshot);
  const familyRows = (lineage.familyLineages.length > 0 ? lineage.familyLineages : lineage.families.map((family) => ({
    id: family.id,
    memberCount: family.memberCount,
    relationshipCount: 0,
    descendantCount: 0,
    generationDepth: 0,
    knowledgeCarrierCount: 0,
    knowledgeInheritanceCount: 0,
    beliefCarrierCount: 0,
    relationshipCounts: {},
  }))).slice(0, 3).map((family, index) => `
    <li><span>家庭 ${String(index + 1).padStart(2, "0")} · ${format(family.relationshipCount)} 关系</span><strong>${format(family.memberCount)} 名成员 · ${format(family.descendantCount)} 后代 · ${format(family.knowledgeInheritanceCount)} 条知识</strong></li>
  `).join("");
  element.innerHTML = `
    <div class="inspector-head"><strong>${selection.regionId}</strong><span>${lineage.source === "aggregate" ? "聚合摘要" : "实时微观投影"}</span></div>
    <dl class="inspector-grid">
      <div><dt>海拔</dt><dd>${percent(fields.elevation.values[selection.index])}</dd></div>
      <div><dt>水量</dt><dd>${percent(fields.water.values[selection.index])}</dd></div>
      <div><dt>温度</dt><dd>${percent(fields.temperature.values[selection.index])}</dd></div>
      <div><dt>湿度</dt><dd>${percent(fields.humidity.values[selection.index])}</dd></div>
      <div><dt>养分</dt><dd>${percent(fields.nutrients.values[selection.index])}</dd></div>
      <div><dt>生物量</dt><dd>${percent(fields.biomass.values[selection.index])}</dd></div>
    </dl>
    <section class="lineage-section" aria-label="家庭谱系">
      <div class="lineage-heading"><strong>家庭谱系</strong><span>${format(lineage.population)} 个体 · ${format(lineage.relationshipCount)} 关系</span></div>
      <dl class="lineage-metrics">
        <div><dt>家庭</dt><dd>${format(lineage.householdCount)}</dd></div>
        <div><dt>后代</dt><dd>${format(lineage.descendantCount)}</dd></div>
        <div><dt>代际深度</dt><dd>${format(lineage.generationDepth)}</dd></div>
        <div><dt>知识承继</dt><dd>${format(lineage.knowledgeCarrierCount)}</dd></div>
      </dl>
      <div class="relationship-breakdown" aria-label="亲属关系">
        ${relationshipLabels.map(([kind, label]) => `<span><i data-kind="${kind}"></i>${label}<strong>${format(lineage.relationshipCounts[kind] ?? 0)}</strong></span>`).join("")}
      </div>
      <div class="inheritance-note"><span>代际知识传承</span><strong>${format(lineage.knowledgeInheritanceCount)} 条知识</strong></div>
      <div class="food-security"><span>食物保障</span><strong>${format(lineage.foodBalance)} 单位 · 人均 ${format(lineage.foodPerAgent)} · ${(lineage.foodSecurity * 100).toFixed(0)}%</strong></div>
      <ol class="family-list" aria-label="区域家庭">${familyRows || "<li class=\"family-empty\">尚未形成稳定家庭</li>"}</ol>
    </section>
  `;
};
