import { describe, expect, it } from "vitest";
import { renderTimeline } from "../../src/ui/timeline.ts";
import type { EventMilestone, WorldEvent } from "../../src/sim/types.ts";

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
      event("species-divergence", {}),
      event("territory-expansion", {}),
      event("interregional-trade", {}),
      event("border-conflict", {}),
    ]);

    expect(element.innerHTML).toContain("种群扩散");
    expect(element.innerHTML).toContain("物种分化");
    expect(element.innerHTML).toContain("疆域扩张");
    expect(element.innerHTML).toContain("区域贸易");
    expect(element.innerHTML).toContain("边境冲突");
    expect(element.innerHTML).toContain("世界时间 4 年 0 天");
  });

  it("distinguishes autonomous disasters from user-authored events", () => {
    const element = { innerHTML: "" } as HTMLElement;
    const volcano = event("volcano", { intensity: 0.7 });
    const earthquake = event("earthquake", { intensity: 0.5 });
    const drought = event("drought", { intensity: 0.6 });
    const flood = event("flood", { intensity: 0.8 });
    const userVolcano = event("volcano", {});
    userVolcano.id = "event:user-volcano";
    userVolcano.source = "user";
    renderTimeline(element, [volcano, earthquake, drought, flood, userVolcano]);

    expect(element.innerHTML).toContain("火山喷发");
    expect(element.innerHTML).toContain("构造地震");
    expect(element.innerHTML).toContain("区域干旱");
    expect(element.innerHTML).toContain("区域洪水");
    expect(element.innerHTML).toContain("用户火山事件");
    expect(element.innerHTML).toContain("区域洪水 · 强度 80%");
    expect(element.innerHTML).not.toContain("natural-flood");
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

  it("labels autonomous innovation and the route used for diffusion", () => {
    const element = { innerHTML: "" } as HTMLElement;
    const innovation = event("knowledge-innovation", {});
    innovation.payload = { name: "潮星定向法", domain: "navigation" };
    const diffusion = event("knowledge-diffusion", {});
    diffusion.id = "event:knowledge-diffusion";
    diffusion.payload = { name: "潮星定向法", route: "trade" };

    renderTimeline(element, [innovation, diffusion]);

    expect(element.innerHTML).toContain("自主技术诞生 · 潮星定向法");
    expect(element.innerHTML).toContain("知识跨域传播 · 潮星定向法（贸易）");
  });

  it("shows archived milestones and prefers a hot event with the same ID", () => {
    const element = { innerHTML: "" } as HTMLElement;
    const milestone: EventMilestone = {
      id: "event:archived:formation",
      tick: 1,
      years: 1,
      kind: "planet-formation-complete",
      ruleId: "formation:stable-crust",
      source: "natural",
      sourceIds: [],
      regionIds: [],
      organizationIds: [],
      probability: 1,
      roll: 0,
      details: { name: "稳定地壳形成" },
    };
    const current = event("planet-formation-complete", {});
    current.id = milestone.id;
    current.years = 2;

    renderTimeline(element, [current], [milestone]);

    expect(element.innerHTML).toContain("稳定地壳形成");
    expect(element.innerHTML).not.toContain("历史档案");
    expect(element.innerHTML).toContain("世界时间 2 年 0 天");
  });
});
