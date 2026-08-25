import type { WorldviewPack } from "../../types.ts";
import { regionIdForWorldview, ruleFromPredicates } from "../rules.ts";

export const indianMythology: WorldviewPack = {
  id: "mythology.indian-motif",
  version: 1,
  label: "轮回与宇宙周期母题",
  motifs: [
    { id: "returning-cycle", tags: ["cycle", "rebirth", "cosmos"], predicates: [{ subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }] },
    { id: "balance-of-action", tags: ["ethic", "consequence", "ritual"], predicates: [{ subject: "organization", metric: "organizationCapacity", operator: ">=", value: 4 }] },
  ],
  resources: [{ id: "karma-memory", cap: 100, sinks: ["vow", "ritual"], sources: ["action", "teaching"] }],
  rules: [
    ruleFromPredicates("indian-cycle-discovery", [{ subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }, { subject: "population", metric: "populationCount", operator: ">=", value: 10 }], 0.08, (context, evidence) => ({ kind: "discover-motif", packId: "mythology.indian-motif", motifId: "returning-cycle", regionId: regionIdForWorldview(context), evidence })),
    ruleFromPredicates("indian-action-discovery", [{ subject: "organization", metric: "organizationCapacity", operator: ">=", value: 4 }, { subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 1 }], 0.07, (context, evidence) => ({ kind: "propose-entity", packId: "mythology.indian-motif", entityKind: "deity", regionId: regionIdForWorldview(context), evidence, probability: 0.07 })),
  ],
  templates: [{ id: "cycle-vision", kind: "collective-vision", payloadKeys: ["regionId", "cycle"] }],
};
