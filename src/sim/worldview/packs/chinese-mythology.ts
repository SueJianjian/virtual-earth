import type { WorldviewPack } from "../../types.ts";
import { ruleFromPredicates } from "../rules.ts";

export const chineseMythology: WorldviewPack = {
  id: "mythology.chinese-motif",
  version: 1,
  label: "自然与祖先母题",
  motifs: [
    { id: "river-guardian", tags: ["nature", "water", "ritual"], predicates: [{ subject: "field", metric: "waterCoverage", operator: ">=", value: 0.2 }] },
    { id: "ancestor-memory", tags: ["ancestor", "lineage"], predicates: [{ subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 1 }] },
  ],
  resources: [{ id: "ritual-attention", cap: 100, sinks: ["ritual"], sources: ["collective-memory"] }],
  rules: [
    ruleFromPredicates("chinese-river-discovery", [{ subject: "field", metric: "waterCoverage", operator: ">=", value: 0.2 }, { subject: "field", metric: "biomass", operator: ">=", value: 0.05 }], 0.12, (_context, evidence) => ({ kind: "propose-entity", packId: "mythology.chinese-motif", entityKind: "deity", regionId: "region:origin" as never, evidence, probability: 0.12 })),
    ruleFromPredicates("chinese-ancestor-memory", [{ subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 1 }, { subject: "population", metric: "populationCount", operator: ">=", value: 4 }], 0.08, (_context, evidence) => ({ kind: "discover-motif", packId: "mythology.chinese-motif", motifId: "ancestor-memory", regionId: "region:origin" as never, evidence })),
  ],
  templates: [{ id: "river-sign", kind: "natural-sign", payloadKeys: ["regionId", "intensity"] }],
};
