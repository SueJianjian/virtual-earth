import { describe, expect, it } from "vitest";
import { MAX_PERSISTENT_TOTAL, addPersistentTotal, boundedPersistentTotal } from "../../src/sim/numeric.ts";

describe("persistent numeric totals", () => {
  it("saturates cumulative values before they lose integer precision", () => {
    expect(addPersistentTotal(MAX_PERSISTENT_TOTAL - 2, 10)).toBe(MAX_PERSISTENT_TOTAL);
    expect(addPersistentTotal(MAX_PERSISTENT_TOTAL, 1)).toBe(MAX_PERSISTENT_TOTAL);
    expect(boundedPersistentTotal(Number.POSITIVE_INFINITY)).toBe(MAX_PERSISTENT_TOTAL);
    expect(boundedPersistentTotal(Number.NaN)).toBe(0);
    expect(addPersistentTotal(12.5, 0.25)).toBe(12.75);
  });
});
