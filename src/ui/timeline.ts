import type { WorldEvent } from "../sim/types.ts";

const labelFor = (event: WorldEvent): string => ({
  "abiogenesis": "生命起源",
  "species-emergence": "物种出现",
  "culture-emergence": "文化形成",
  "organization-formation": "组织形成",
  "organization-split": "组织分裂",
  "population-migration": "人口迁移",
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
  return "";
};

export const renderTimeline = (element: HTMLElement, events: WorldEvent[]): void => {
  const recent = [...events].sort((left, right) => right.tick - left.tick || right.id.localeCompare(left.id)).slice(0, 8);
  element.innerHTML = recent.length === 0
    ? `<div class="empty-state"><strong>尚无事件</strong><span>世界正在积累形成条件</span></div>`
    : recent.map((event) => `
      <article class="timeline-item">
        <time>第 ${event.tick} 步</time>
        <strong>${labelFor(event)}${qualifierFor(event)}</strong>
        <span>${event.source === "user" ? "用户事件" : event.ruleId} · 概率 ${(event.probability * 100).toFixed(1)}%</span>
      </article>
    `).join("");
};
