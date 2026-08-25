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
});
