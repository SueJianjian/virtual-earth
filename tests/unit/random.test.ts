import { describe, expect, it } from "vitest";
import {
  createRandom,
  forkRandom,
  nextRandom,
  randomChance,
  randomInt,
} from "../../src/sim/random.ts";

describe("deterministic random source", () => {
  it("replays the same sequence from the same seed", () => {
    let first = createRandom(42);
    let second = createRandom(42);
    const firstValues: number[] = [];
    const secondValues: number[] = [];

    for (let index = 0; index < 20; index += 1) {
      let firstValue: number;
      let secondValue: number;
      [firstValue, first] = nextRandom(first);
      [secondValue, second] = nextRandom(second);
      firstValues.push(firstValue);
      secondValues.push(secondValue);
    }

    expect(firstValues).toEqual(secondValues);
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("keeps derived streams stable and independent of wall clock time", () => {
    const parent = createRandom(7);
    const first = forkRandom(parent, "ecology");
    const second = forkRandom(parent, "ecology");
    const different = forkRandom(parent, "society");

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it("bounds integer and chance helpers", () => {
    let random = createRandom(123);
    for (let index = 0; index < 100; index += 1) {
      let value: number;
      [value, random] = randomInt(random, 7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }

    const [always, afterAlways] = randomChance(random, 1);
    const [never] = randomChance(afterAlways, 0);
    expect(always).toBe(true);
    expect(never).toBe(false);
  });
});
