import { describe, expect, it } from "vitest";
import { createAgentModel } from "../../src/ui/fantasy-assets.ts";

describe("fantasy scene assets", () => {
  it("exposes lightweight animation parts for close-up agents", () => {
    const model = createAgentModel(42);
    const animation = model.userData.animation as { type?: string; arms?: unknown[]; legs?: unknown[]; body?: unknown };

    expect(animation.type).toBe("agent");
    expect(animation.arms).toHaveLength(2);
    expect(animation.legs).toHaveLength(2);
    expect(animation.body).toBeDefined();
  });
});
