import { describe, expect, it } from "vitest";
import { renderTimeline } from "../../src/ui/timeline.ts";
import type { WorldEvent } from "../../src/sim/types.ts";

const event = (kind: string, evidence: Record<string, number | string | boolean>): WorldEvent => ({
  id: `event:${kind}`,
  tick: 4,
  kind,
  ruleId: `rule:${kind}`,
  source: "natural",
  sourceIds: [],
  probability: 0.5,
  roll: 0.2,
  evidence,
  payload: {},
});

describe("event timeline", () => {
  it("identifies food-driven migration and shortage-driven splits", () => {
    const element = { innerHTML: "" } as HTMLElement;
    renderTimeline(element, [
      event("population-migration", { foodDriven: true }),
      event("organization-split", { foodSecurity: 0 }),
      event("agent-death", { hungerDeaths: 1 }),
    ]);

    expect(element.innerHTML).toContain("人口迁移 · 食物驱动");
    expect(element.innerHTML).toContain("组织分裂 · 缺粮压力");
    expect(element.innerHTML).toContain("个体死亡 · 饥饿主导");
  });

  it("uses readable labels for cross-region civilization events", () => {
    const element = { innerHTML: "" } as HTMLElement;
    renderTimeline(element, [
      event("population-dispersal", {}),
      event("territory-expansion", {}),
      event("interregional-trade", {}),
      event("border-conflict", {}),
    ]);

    expect(element.innerHTML).toContain("种群扩散");
    expect(element.innerHTML).toContain("疆域扩张");
    expect(element.innerHTML).toContain("区域贸易");
    expect(element.innerHTML).toContain("边境冲突");
    expect(element.innerHTML).toContain("演化步 4");
  });

  it("names causal worldview events without treating beliefs as verified facts", () => {
    const element = { innerHTML: "" } as HTMLElement;
    const observation = event("worldview-original-anomaly-observation", {});
    observation.payload = { name: "雾脉共振", epistemicStatus: "observed" };
    const myth = event("worldview-original-mythic-tradition", {});
    myth.payload = { name: "雾脉守望传说", epistemicStatus: "believed" };
    renderTimeline(element, [observation, myth]);

    expect(element.innerHTML).toContain("发现异常自然现象 · 雾脉共振");
    expect(element.innerHTML).toContain("形成神话传统 · 雾脉守望传说");
    expect(element.innerHTML).not.toContain("验证客观规律 · 雾脉守望传说");
  });

  it("distinguishes practice progress, setbacks and energy exhaustion", () => {
    const element = { innerHTML: "" } as HTMLElement;
    const progress = event("worldview-original-practice-training", {});
    progress.payload = { outcome: "advance" };
    const exhausted = event("worldview-original-practice-training", {});
    exhausted.id = "event:exhausted";
    exhausted.payload = { outcome: "exhausted" };
    renderTimeline(element, [progress, exhausted]);

    expect(element.innerHTML).toContain("规律训练 · 共鸣提升");
    expect(element.innerHTML).toContain("规律训练 · 能量耗尽");
  });
});
