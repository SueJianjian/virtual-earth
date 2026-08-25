import type { CellSelection } from "./map-canvas.ts";
import { summarizeLineage } from "../sim/lod/lineage.ts";
import type { RegionLineageSummary } from "../sim/types.ts";
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
      source: "aggregate",
    };
  }
  const agents = projection?.agents ?? [];
  const relationships = projection?.relationships ?? [];
  const lineage = summarizeLineage(agents, relationships);
  return {
    ...lineage,
    householdCount: projection?.organizations.filter((organization) => organization.type === "family").length ?? 0,
    population: agents.length,
    relationshipCount: relationships.length,
    families: projection?.organizations.filter((organization) => organization.type === "family").map((family) => ({ id: family.id, memberCount: family.memberIds.length })) ?? [],
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
  const familyRows = lineage.families.slice(0, 3).map((family, index) => `
    <li><span>家庭 ${String(index + 1).padStart(2, "0")}</span><strong>${format(family.memberCount)} 名成员</strong></li>
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
      <div class="inheritance-note"><span>信念承继</span><strong>${format(lineage.beliefCarrierCount)} 名后代</strong></div>
      <ol class="family-list" aria-label="区域家庭">${familyRows || "<li class=\"family-empty\">尚未形成稳定家庭</li>"}</ol>
    </section>
  `;
};
