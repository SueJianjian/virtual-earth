import type { CellSelection } from "./map-canvas.ts";
import { summarizeLineage } from "../sim/lod/lineage.ts";
import type { FamilyLineageSummary, OrganizationState, OrganizationType, RegionLineageSummary } from "../sim/types.ts";
import type { WorldSnapshot } from "../worker/protocol.ts";

const percent = (value: number | undefined): string => `${((value ?? 0) * 100).toFixed(1)}%`;
const format = (value: number): string => new Intl.NumberFormat("zh-CN").format(value);
const relationshipLabels: Array<[keyof RegionLineageSummary["relationshipCounts"], string]> = [
  ["partner", "伴侣"],
  ["parent", "亲子"],
  ["caregiver", "照护"],
  ["sibling", "同胞"],
];
const organizationLabels: Record<OrganizationType, string> = {
  family: "家庭",
  clan: "氏族",
  tribe: "部落",
  settlement: "聚落",
  city: "城市",
  state: "国家",
  federation: "联盟",
  empire: "帝国",
};
const detailLevels: Array<"region" | "agent" | OrganizationType> = ["region", "agent", "family", "clan", "tribe", "settlement", "city", "state", "federation", "empire"];
export type InspectorDetail = { level: "region" | "agent" | OrganizationType; id?: string };

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
const organizationName = (organization: OrganizationState): string => `${organizationLabels[organization.type]} · ${organization.id.slice(-8)}`;

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

const detailTargets = (snapshot: WorldSnapshot, level: InspectorDetail["level"]): Array<{ id: string; label: string }> => {
  if (level === "region") return [];
  if (level === "agent") return (snapshot.projection?.agents ?? []).map((agent) => ({ id: agent.id, label: `${agent.id.slice(-8)} · ${Math.floor(agent.age)}岁` }));
  return (snapshot.projection?.organizations ?? [])
    .filter((organization) => organization.type === level)
    .map((organization) => ({ id: organization.id, label: organizationName(organization) }));
};

const detailReport = (snapshot: WorldSnapshot, detail: InspectorDetail, lineage: InspectorLineage): string => {
  const projection = snapshot.projection;
  if (detail.level === "region") {
    const available = detailLevels.slice(1).map((level) => {
      const count = level === "agent"
        ? projection?.agents.length ?? 0
        : projection?.organizations.filter((organization) => organization.type === level).length ?? 0;
      const label = level === "agent" ? "个人" : organizationLabels[level as OrganizationType];
      return `<span><strong>${format(count)}</strong>${label}</span>`;
    }).join("");
    return `<div class="detail-summary"><strong>区域总览</strong><span>${lineage.source === "aggregate" ? "来自聚合摘要，选择下方层级可查看可重建对象" : "来自实时微观投影"}</span><div class="detail-counts">${available}</div></div>`;
  }
  if (!detail.id) return `<div class="empty-state"><strong>请选择${detail.level === "agent" ? "个人" : organizationLabels[detail.level]}</strong><span>对象选择器会列出当前区域可查看的实体</span></div>`;
  if (detail.level === "agent") {
    const agent = projection?.agents.find((candidate) => candidate.id === detail.id);
    if (!agent) return `<div class="empty-state"><strong>对象暂不可用</strong><span>该实体可能已在下一次快照中离开当前区域</span></div>`;
    const relationships = projection?.relationships.filter((relationship) => relationship.fromId === agent.id || relationship.toId === agent.id) ?? [];
    const descendants = projection?.agents.filter((candidate) => candidate.parentIds.includes(agent.id)).length ?? 0;
    const family = projection?.organizations.find((organization) => organization.type === "family" && organization.memberIds.includes(agent.id));
    return `<div class="detail-report"><div class="detail-title"><strong>个人报告</strong><span>${escapeHtml(agent.id)}</span></div><dl class="detail-grid"><div><dt>年龄 / 寿命</dt><dd>${format(agent.age)} / ${format(agent.lifespan)} 年</dd></div><div><dt>家庭</dt><dd>${family ? escapeHtml(organizationName(family)) : "未归属"}</dd></div><div><dt>父母</dt><dd>${format(agent.parentIds.length)} 人</dd></div><div><dt>后代</dt><dd>${format(descendants)} 人</dd></div><div><dt>关系</dt><dd>${format(relationships.length)} 条</dd></div><div><dt>知识 / 信念</dt><dd>${format(agent.knowledgeIds.length)} / ${format(agent.beliefIds.length)}</dd></div></dl><div class="detail-tags">${Object.entries(agent.skills).map(([skill, value]) => `<span>${escapeHtml(skill)} ${percent(value)}</span>`).join("")}</div></div>`;
  }
  const organization = projection?.organizations.find((candidate) => candidate.id === detail.id);
  if (!organization) return `<div class="empty-state"><strong>组织暂不可用</strong><span>该组织可能已在下一次快照中发生演化</span></div>`;
  const summaryOrganization = snapshot.selectedRegion?.organizations.find((candidate) => candidate.id === organization.id);
  const familyLineage = snapshot.selectedRegion?.familyLineages.find((candidate) => candidate.id === organization.id);
  const memberCount = summaryOrganization?.memberCount ?? organization.memberIds.length;
  const localRelationships = projection?.relationships.filter((relationship) => organization.memberIds.includes(relationship.fromId) && organization.memberIds.includes(relationship.toId)) ?? [];
  const food = snapshot.selectedRegion?.resources.filter((resource) => resource.holderId === organization.id).reduce((sum, resource) => sum + resource.amount, 0) ?? 0;
  return `<div class="detail-report"><div class="detail-title"><strong>${organizationLabels[organization.type]}报告</strong><span>${escapeHtml(organization.id)}</span></div><dl class="detail-grid"><div><dt>成员</dt><dd>${format(memberCount)} 人</dd></div><div><dt>状态</dt><dd>${organization.status === "active" ? "活跃" : organization.status}</dd></div><div><dt>下属组织</dt><dd>${format(organization.childOrganizationIds.length)} 个</dd></div><div><dt>内部关系</dt><dd>${format(localRelationships.length)} 条</dd></div><div><dt>食物资源</dt><dd>${format(food)}</dd></div><div><dt>谱系 / 知识</dt><dd>${familyLineage ? `${format(familyLineage.generationDepth)} 代 / ${format(familyLineage.knowledgeInheritanceCount)} 条` : "聚合统计"}</dd></div></dl><div class="detail-tags">${organization.childOrganizationIds.slice(0, 8).map((id) => `<span>${escapeHtml(id)}</span>`).join("") || "<span>暂无下属组织记录</span>"}</div></div>`;
};

export const renderInspector = (element: HTMLElement, snapshot: WorldSnapshot, selection?: CellSelection, detail: InspectorDetail = { level: "region" }): void => {
  if (!selection) {
    element.innerHTML = `<div class="empty-state"><strong>未选择区域</strong><span>环境与社会状态</span></div>`;
    return;
  }
  const fields = snapshot.fields;
  const lineage = lineageForSnapshot(snapshot);
  const targets = detailTargets(snapshot, detail.level);
  const targetOptions = detail.level === "region"
    ? "<option>区域总览</option>"
    : targets.length > 0
      ? `<option value="">选择${detail.level === "agent" ? "个人" : organizationLabels[detail.level]}</option>${targets.map((target) => `<option value="${escapeHtml(target.id)}"${target.id === detail.id ? " selected" : ""}>${escapeHtml(target.label)}</option>`).join("")}`
      : `<option value="">当前区域暂无${detail.level === "agent" ? "个人" : organizationLabels[detail.level]}</option>`;
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
    <section class="detail-section" aria-label="层级详情">
      <div class="detail-heading"><strong>层级详情报告</strong><span>可查看当前区域的社会实体</span></div>
      <nav class="detail-tabs" aria-label="详情层级">${detailLevels.map((level) => `<button type="button" data-detail-level="${level}" class="detail-tab${detail.level === level ? " active" : ""}">${level === "region" ? "区域" : level === "agent" ? "个人" : organizationLabels[level]}</button>`).join("")}</nav>
      <select class="detail-target" data-detail-target aria-label="选择详情对象">${targetOptions}</select>
      <div class="detail-report-container">${detailReport(snapshot, detail, lineage)}</div>
    </section>
  `;
};
