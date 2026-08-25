import type { WorldviewPack } from "../../types.ts";
import { ruleFromPredicates } from "../rules.ts";

export const cultivation: WorldviewPack = {
  id: "cultivation.path",
  version: 1,
  label: "灵气与修行路径",
  motifs: [
    { id: "breath-and-energy", tags: ["qi", "discipline", "observation"], predicates: [{ subject: "chemistry", metric: "oxygen", operator: ">=", value: 0.03 }, { subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }] },
    { id: "lineage-transmission", tags: ["inheritance", "teacher", "method"], predicates: [{ subject: "organization", metric: "organizationCapacity", operator: ">=", value: 6 }, { subject: "population", metric: "cognitivePotential", operator: ">=", value: 1 }] },
  ],
  resources: [
    { id: "spiritual-energy", cap: 100, sinks: ["cultivation", "breakthrough", "artifact"], sources: ["environment", "discipline"] },
    { id: "causal-debt", cap: 100, sinks: ["oath", "breakthrough", "conflict"], sources: ["intervention", "betrayal"] },
  ],
  rules: [
    ruleFromPredicates("cultivation-discovery", [{ subject: "chemistry", metric: "oxygen", operator: ">=", value: 0.03 }, { subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }, { subject: "population", metric: "cognitivePotential", operator: ">=", value: 1 }], 0.05, (_context, evidence) => ({ kind: "propose-entity", packId: "cultivation.path", entityKind: "cultivation-path", regionId: "region:origin" as never, evidence, probability: 0.05 })),
    ruleFromPredicates("cultivation-lineage", [{ subject: "organization", metric: "organizationCapacity", operator: ">=", value: 6 }, { subject: "culture", metric: "knowledgeDiversity", operator: ">=", value: 2 }], 0.04, (_context, evidence) => ({ kind: "discover-motif", packId: "cultivation.path", motifId: "lineage-transmission", regionId: "region:origin" as never, evidence })),
  ],
  templates: [{ id: "breakthrough-sign", kind: "cultivation-sign", payloadKeys: ["agentId", "risk"] }],
};
