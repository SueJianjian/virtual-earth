import type { WorldviewPack } from "../../types.ts";
import { regionIdForWorldview, ruleFromPredicates } from "../rules.ts";

export const norseMythology: WorldviewPack = {
  id: "mythology.norse-motif",
  version: 1,
  label: "风暴与循环母题",
  motifs: [
    { id: "storm-oath", tags: ["storm", "oath", "warrior"], predicates: [{ subject: "field", metric: "meanHumidity", operator: ">=", value: 0.4 }] },
    { id: "cycle-return", tags: ["cycle", "winter", "renewal"], predicates: [{ subject: "field", metric: "meanTemperature", operator: "<=", value: 0.4 }] },
  ],
  resources: [{ id: "oath-memory", cap: 100, sinks: ["oath"], sources: ["shared-memory"] }],
  rules: [
    ruleFromPredicates("norse-storm-discovery", [{ subject: "field", metric: "meanHumidity", operator: ">=", value: 0.4 }, { subject: "population", metric: "populationCount", operator: ">=", value: 6 }], 0.09, (context, evidence) => ({ kind: "discover-motif", packId: "mythology.norse-motif", motifId: "storm-oath", regionId: regionIdForWorldview(context), evidence })),
    ruleFromPredicates("norse-cycle-discovery", [{ subject: "field", metric: "meanTemperature", operator: "<=", value: 0.4 }, { subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 1 }], 0.06, (context, evidence) => ({ kind: "propose-entity", packId: "mythology.norse-motif", entityKind: "deity", regionId: regionIdForWorldview(context), evidence, probability: 0.06 })),
  ],
  templates: [{ id: "storm-sign", kind: "weather-omen", payloadKeys: ["regionId", "severity"] }],
};
