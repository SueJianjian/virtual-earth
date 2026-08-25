import type { WorldviewPack } from "../types.ts";
import { chineseMythology } from "./packs/chinese-mythology.ts";
import { greekMythology } from "./packs/greek-mythology.ts";
import { norseMythology } from "./packs/norse-mythology.ts";
import { indianMythology } from "./packs/indian-mythology.ts";
import { cultivation } from "./packs/cultivation.ts";

const packs = new Map<string, WorldviewPack>([
  [chineseMythology.id, chineseMythology],
  [greekMythology.id, greekMythology],
  [norseMythology.id, norseMythology],
  [indianMythology.id, indianMythology],
  [cultivation.id, cultivation],
]);

export const listWorldviewPacks = (): WorldviewPack[] => [...packs.values()].sort((left, right) => left.id.localeCompare(right.id));
export const getWorldviewPack = (id: string): WorldviewPack | undefined => packs.get(id);
export const createWorldviewState = (enabledPackIds: string[]) => ({
  enabledPackIds: [...new Set(enabledPackIds)].filter((id) => packs.has(id)).sort(),
  discoveredRuleIds: [],
  entities: [],
});
