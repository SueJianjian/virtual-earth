import type { WorldviewPack } from "../../types.ts";
import { regionIdForWorldview, ruleFromPredicates } from "../rules.ts";

export const greekMythology: WorldviewPack = {
  id: "mythology.greek-motif",
  version: 1,
  label: "城邦与命运母题",
  motifs: [
    { id: "civic-pantheon", tags: ["city", "ritual", "plurality"], predicates: [{ subject: "organization", metric: "settlementDensity", operator: ">=", value: 1 }] },
    { id: "fate-question", tags: ["omen", "choice", "destiny"], predicates: [{ subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }] },
  ],
  resources: [{ id: "oracle-trust", cap: 100, sinks: ["divination"], sources: ["observation"] }],
  rules: [
    ruleFromPredicates("greek-civic-discovery", [{ subject: "organization", metric: "settlementDensity", operator: ">=", value: 1 }, { subject: "population", metric: "populationCount", operator: ">=", value: 12 }], 0.1, (context, evidence) => ({ kind: "propose-entity", packId: "mythology.greek-motif", entityKind: "deity", regionId: regionIdForWorldview(context), evidence, probability: 0.1 })),
    ruleFromPredicates("greek-fate-discovery", [{ subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }, { subject: "population", metric: "populationCount", operator: ">=", value: 8 }], 0.07, (context, evidence) => ({ kind: "discover-motif", packId: "mythology.greek-motif", motifId: "fate-question", regionId: regionIdForWorldview(context), evidence })),
  ],
  templates: [{ id: "civic-omen", kind: "social-omen", payloadKeys: ["organizationId", "sign"] }],
};
