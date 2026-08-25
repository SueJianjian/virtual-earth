import type { RandomState } from "./types.ts";

const UINT32_MAX = 0xffffffff;
const NON_ZERO_SEED = 0x6d2b79f5;

const toUint32 = (value: number): number => value >>> 0;

export const normalizeSeed = (seed: number): number => {
  const normalized = toUint32(Math.trunc(seed));
  return normalized === 0 ? NON_ZERO_SEED : normalized;
};

export const createRandom = (seed: number): RandomState => ({
  value: normalizeSeed(seed),
});

export const nextRandom = (random: RandomState): [number, RandomState] => {
  let value = random.value >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const nextValue = value >>> 0;
  return [nextValue / (UINT32_MAX + 1), { value: nextValue || NON_ZERO_SEED }];
};

export const randomFloat = (random: RandomState): [number, RandomState] =>
  nextRandom(random);

export const randomInt = (
  random: RandomState,
  maxExclusive: number,
): [number, RandomState] => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive must be a positive integer");
  }
  const [value, next] = nextRandom(random);
  return [Math.floor(value * maxExclusive), next];
};

export const randomChance = (
  random: RandomState,
  probability: number,
): [boolean, RandomState] => {
  const [value, next] = nextRandom(random);
  return [value < Math.max(0, Math.min(1, probability)), next];
};

export const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return normalizeSeed(hash);
};

export const forkRandom = (
  random: RandomState,
  label: string,
): RandomState => ({
  value: normalizeSeed(Math.imul(random.value, 2246822519) ^ hashString(label)),
});
