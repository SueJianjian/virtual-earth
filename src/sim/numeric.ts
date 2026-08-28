export const MAX_PERSISTENT_TOTAL = Number.MAX_SAFE_INTEGER;

export const boundedPersistentTotal = (value: number): number => {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (!Number.isFinite(value) || value >= MAX_PERSISTENT_TOTAL) return MAX_PERSISTENT_TOTAL;
  return value;
};

export const addPersistentTotal = (current: number, amount: number): number => {
  const base = boundedPersistentTotal(current);
  const increment = boundedPersistentTotal(amount);
  return increment >= MAX_PERSISTENT_TOTAL - base
    ? MAX_PERSISTENT_TOTAL
    : base + increment;
};
