import type { WorldEvent } from "../sim/types.ts";

const labelFor = (event: WorldEvent): string => ({
  "abiogenesis": "生命起源",
  "species-emergence": "物种出现",
  "culture-emergence": "文化形成",
  "organization-formation": "组织形成",
  "organization-split": "组织分裂",
  "population-migration": "人口迁移",
  "population-dispersal": "种群扩散",
  "territory-expansion": "疆域扩张",
  "interregional-trade": "区域贸易",
  "border-conflict": "边境冲突",
  "organization-trade": "组织贸易",
  "worldview-original-anomaly-observation": "发现异常自然现象",
  "worldview-original-cultural-theory": "形成文明解释",
  "worldview-original-mythic-tradition": "形成神话传统",
  "worldview-original-principle-verification": "验证客观规律",
  "agent-birth": "个体出生",
  "agent-death": "个体死亡",
  "add-water": "用户增加水量",
  heat: "用户升温",
  volcano: "用户火山事件",
  "add-organics": "用户增加有机物",
}[event.kind] ?? event.kind);

const qualifierFor = (event: WorldEvent): string => {
  if (event.kind === "population-migration" && event.evidence.foodDriven === true) return " · 食物驱动";
  if (event.kind === "organization-split" && Number(event.evidence.foodSecurity ?? 1) < 0.1) return " · 缺粮压力";
  if (event.kind === "agent-death" && Number(event.evidence.hungerDeaths ?? 0) > 0) return " · 饥饿主导";
  if (typeof event.payload.name === "string") return ` · ${event.payload.name}`;
  return "";
};

export const renderTimeline = (element: HTMLElement, events: WorldEvent[]): void => {
  const recent = [...events].sort((left, right) => right.tick - left.tick || right.id.localeCompare(left.id)).slice(0, 8);
  element.innerHTML = recent.length === 0
    ? `<div class="empty-state"><strong>尚无事件</strong><span>世界正在积累形成条件</span></div>`
    : recent.map((event) => `
      <article class="timeline-item">
        <time>演化步 ${event.tick}</time>
        <strong>${labelFor(event)}${qualifierFor(event)}</strong>
        <span>${event.source === "user" ? "用户事件" : event.ruleId} · 概率 ${(event.probability * 100).toFixed(1)}%</span>
      </article>
    `).join("");
};
