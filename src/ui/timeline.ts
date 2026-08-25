import type { WorldEvent } from "../sim/types.ts";

const labelFor = (event: WorldEvent): string => ({
  "abiogenesis": "生命起源",
  "species-emergence": "物种出现",
  "culture-emergence": "文化形成",
  "organization-formation": "组织形成",
  "agent-birth": "个体出生",
  "agent-death": "个体死亡",
}[event.kind] ?? event.kind);

export const renderTimeline = (element: HTMLElement, events: WorldEvent[]): void => {
  const recent = [...events].sort((left, right) => right.tick - left.tick || right.id.localeCompare(left.id)).slice(0, 8);
  element.innerHTML = recent.length === 0
    ? `<div class="empty-state"><strong>尚无事件</strong><span>世界正在积累形成条件</span></div>`
    : recent.map((event) => `
      <article class="timeline-item">
        <time>第 ${event.tick} 步</time>
        <strong>${labelFor(event)}</strong>
        <span>${event.ruleId} · 概率 ${(event.probability * 100).toFixed(1)}%</span>
      </article>
    `).join("");
};
