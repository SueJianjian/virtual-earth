export const SAVE_SCHEMA_VERSION = 1 as const;
export type SaveEnvelope = { schemaVersion: typeof SAVE_SCHEMA_VERSION; world: unknown };

export const isSaveEnvelope = (value: unknown): value is SaveEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SaveEnvelope>;
  return candidate.schemaVersion === SAVE_SCHEMA_VERSION && "world" in candidate;
};
