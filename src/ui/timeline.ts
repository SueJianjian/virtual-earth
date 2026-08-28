import type { EventMilestone, WorldEvent } from "../sim/types.ts";
import { compareSimulationSteps } from "../sim/time.ts";
import { formatSimulationAge, formatSimulationAgeFromDays } from "./formatters.ts";

export type TimelineEvent = WorldEvent | EventMilestone;

const isArchivedEvent = (event: TimelineEvent): event is EventMilestone => "details" in event;

const scalarFor = (event: TimelineEvent, key: string): string | number | boolean | undefined => {
  if (isArchivedEvent(event)) {
    const value = event.details[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
  }
  const value = event.evidence[key] ?? event.payload[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
};

const escapeHtml = (value: string): string => value.replace(/[&<>\"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '\"': "&quot;",
  "'": "&#39;",
}[character] ?? character));

const labelFor = (event: TimelineEvent): string => {
  if (event.kind === "volcano") return event.source === "user" ? "用户火山事件" : "火山喷发";
  if (event.kind === "earthquake") return event.source === "user" ? "用户地震事件" : "构造地震";
  if (event.kind === "drought") return event.source === "user" ? "用户干旱事件" : "区域干旱";
  if (event.kind === "flood") return event.source === "user" ? "用户洪水事件" : "区域洪水";
  return ({
  "abiogenesis": "生命起源",
  "species-emergence": "物种出现",
  "species-divergence": "物种分化",
  "culture-emergence": "文化形成",
  "culture-evolution": "文化演化",
  "knowledge-innovation": "自主技术诞生",
  "knowledge-diffusion": "知识跨域传播",
  "organization-formation": "组织形成",
  "organization-split": "组织分裂",
  "population-migration": "人口迁移",
  "population-dispersal": "种群扩散",
  "territory-expansion": "疆域扩张",
  "interregional-trade": "区域贸易",
  "border-conflict": "边境冲突",
  "diplomatic-alliance": "达成跨区域联盟",
  "organization-war": "跨区域战争",
  "territory-transfer": "战争领土转移",
  "war-displacement": "战争引发迁徙",
  "organization-trade": "组织贸易",
  "worldview-original-anomaly-observation": "发现异常自然现象",
  "worldview-original-cultural-theory": "形成文明解释",
  "worldview-original-mythic-tradition": "形成神话传统",
  "worldview-original-principle-verification": "验证客观规律",
  "worldview-original-practice-begin": "开启规律训练",
  "worldview-original-practice-training": "规律训练",
  "worldview-original-practice-institution": "形成研修流派",
  "worldview-entity-dormant": "传承体系沉寂",
  "worldview-entity-revived": "传承体系复兴",
  "agent-birth": "个体出生",
  "genetic-mutation": "遗传变异出现",
  "agent-death": "个体死亡",
  "protoplanetary-dust": "原行星尘埃盘形成",
  "planetesimal-formation": "微行星群形成",
  "planetary-accretion": "行星主体开始吸积",
  "core-differentiation": "金属核心与地幔分异",
  "planetary-cooling": "熔融地表开始冷却",
  "planet-formation-complete": "稳定地壳形成",
  "ocean-formation": "海洋形成",
  "prebiotic-chemistry": "前生物化学",
  "substance-formation": "原创物质形成",
  "substance-discovery": "发现原创物质",
  "substance-engineering": "创造复合材料",
  "substance-extraction": "开采原创物质",
  "substance-depletion": "原创物质枯竭",
  "pathogen-emergence": "原创病原体出现",
  "disease-outbreak": "区域疫情暴发",
  "disease-contained": "区域疫情受控",
  "disease-regional-spread": "疫情跨区域传播",
  "add-water": "用户增加水量",
  heat: "用户升温",
  "add-organics": "用户增加有机物",
}[event.kind] ?? event.kind);
};

const qualifierFor = (event: TimelineEvent): string => {
  if (["volcano", "earthquake", "drought", "flood"].includes(event.kind) && event.source === "natural") {
    return ` · 强度 ${(Number(scalarFor(event, "intensity") ?? 0) * 100).toFixed(0)}%`;
  }
  if (event.kind === "population-migration" && scalarFor(event, "foodDriven") === true) return " · 食物驱动";
  if (event.kind === "organization-split" && Number(scalarFor(event, "foodSecurity") ?? 1) < 0.1) return " · 缺粮压力";
  if (event.kind === "agent-death" && Number(scalarFor(event, "hungerDeaths") ?? 0) > 0) return " · 饥饿主导";
  if (event.kind === "agent-death" && Number(scalarFor(event, "diseaseDeaths") ?? 0) > 0) return " · 疾病主导";
  if (event.kind === "agent-death" && Number(scalarFor(event, "environmentalDeaths") ?? 0) > 0) return " · 环境压力主导";
  if (event.kind === "substance-extraction" || event.kind === "substance-depletion") {
    const purpose = scalarFor(event, "purpose") === "energy" ? "能源" : "建造材料";
    const amount = Number(scalarFor(event, "amount") ?? 0);
    const reserveRatio = Number(scalarFor(event, "reserveRatio") ?? 0);
    return event.kind === "substance-depletion"
      ? ` · ${purpose}开采后耗尽`
      : ` · ${purpose} ${amount.toFixed(2)} 单位，剩余 ${(reserveRatio * 100).toFixed(1)}%`;
  }
  const resourceId = scalarFor(event, "resourceId");
  if (event.kind === "interregional-trade" && typeof resourceId === "string") {
    const resource = ({ food: "食物", materials: "建造材料", energy: "能源" } as Record<string, string>)[resourceId] ?? resourceId;
    return ` · ${escapeHtml(resource)} ${Number(scalarFor(event, "amount") ?? 0).toFixed(2)} 单位`;
  }
  const result = scalarFor(event, "result");
  if (event.kind === "organization-war" && typeof result === "string") {
    return ` · ${escapeHtml({ absorbed: "吞并", conquest: "征服", repelled: "击退" }[result] ?? result)}`;
  }
  const name = scalarFor(event, "name");
  if (event.kind === "knowledge-diffusion" && typeof name === "string") {
    const routeValue = scalarFor(event, "route");
    const route = typeof routeValue === "string"
      ? ({ trade: "贸易", alliance: "联盟", migration: "迁徙", war: "战争接触" }[routeValue] ?? routeValue)
      : "交流";
    return ` · ${escapeHtml(name)}（${escapeHtml(route)}）`;
  }
  if (typeof name === "string") return ` · ${escapeHtml(name)}`;
  const practiceOutcome = scalarFor(event, "outcome");
  if (event.kind === "worldview-original-practice-training" && typeof practiceOutcome === "string") {
    return ` · ${escapeHtml({ advance: "共鸣提升", setback: "训练受挫", exhausted: "能量耗尽" }[practiceOutcome] ?? practiceOutcome)}`;
  }
  return "";
};

export const renderTimeline = (element: HTMLElement, events: WorldEvent[], milestones: EventMilestone[] = []): void => {
  const byId = new Map<string, TimelineEvent>();
  for (const milestone of milestones) byId.set(milestone.id, milestone);
  for (const event of events) byId.set(event.id, event);
  const recent = [...byId.values()].sort((left, right) => compareSimulationSteps(right.timelineStep ?? String(right.tick), left.timelineStep ?? String(left.tick)) || (right.years ?? right.tick) - (left.years ?? left.tick) || right.id.localeCompare(left.id)).slice(0, 8);
  element.innerHTML = recent.length === 0
    ? `<div class="empty-state"><strong>尚无事件</strong><span>世界正在积累形成条件</span></div>`
    : recent.map((event) => `
      <article class="timeline-item" data-archived="${isArchivedEvent(event) ? "true" : "false"}">
        <time>世界时间 ${event.timelineDays === undefined ? formatSimulationAge(event.years ?? event.tick) : formatSimulationAgeFromDays(event.timelineDays)}</time>
        <strong>${escapeHtml(labelFor(event))}${qualifierFor(event)}</strong>
        <span>${isArchivedEvent(event) ? "历史档案" : event.source === "user" ? "用户事件" : "自然演化"} · ${escapeHtml(event.ruleId)} · 概率 ${(event.probability * 100).toFixed(1)}%</span>
      </article>
    `).join("");
};
