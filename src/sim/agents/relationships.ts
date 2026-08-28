import { forkRandom, hashString, randomChance } from "../random.ts";
import type {
  AgentContext,
  EntityId,
  OrganizationState,
  RelationshipState,
  RuleOutcome,
  WorldDelta,
} from "../types.ts";
import { defaultGovernanceFor } from "../society/organization.ts";

const emptyDelta = (): WorldDelta => ({
  fieldChanges: [],
  chemistryChanges: [],
  entityEffects: [],
  relationshipEffects: [],
  resourceTransactions: [],
  worldviewEffects: [],
  eventDrafts: [],
});

const asEntityId = (value: string): EntityId => value as EntityId;
const asOrganizationId = (value: string): OrganizationState["id"] => value as OrganizationState["id"];

export const relationshipIdFor = (
  kind: RelationshipState["kind"],
  fromId: EntityId,
  toId: EntityId,
): string => {
  const ids = kind === "parent" || kind === "caregiver" || kind === "teacher"
    ? `${fromId}:${toId}`
    : [fromId, toId].sort().join(":");
  return `relationship:${hashString(`${kind}:${ids}`).toString(16)}`;
};

export const createRelationship = (
  kind: RelationshipState["kind"],
  fromId: EntityId,
  toId: EntityId,
  createdTick: number,
  strength: number,
  createdTimelineStep?: string,
): RelationshipState => ({
  id: relationshipIdFor(kind, fromId, toId),
  fromId,
  toId,
  kind,
  strength: Math.max(0, Math.min(1, strength)),
  createdTick,
  ...(createdTimelineStep === undefined ? {} : { createdTimelineStep }),
  sourceEventId: `relationship-cause:${hashString(`${kind}:${fromId}:${toId}:${createdTimelineStep ?? createdTick}`).toString(16)}`,
});

export const familyIdFor = (memberIds: EntityId[]): OrganizationState["id"] =>
  asOrganizationId(`family:${hashString([...memberIds].sort().join(":")).toString(16)}`);

export const createFamily = (
  memberIds: EntityId[],
  regionId: OrganizationState["regionId"],
): OrganizationState => ({
  id: familyIdFor(memberIds),
  type: "family",
  memberIds: [...new Set(memberIds)].sort(),
  childOrganizationIds: [],
  regionId,
  territoryRegionIds: [regionId],
  resources: {},
  status: "active",
  governance: defaultGovernanceFor("family"),
  diplomacy: {},
});

export const createFamilyIfEligible = (
  context: AgentContext,
): RuleOutcome<OrganizationState> => {
  const candidates = context.candidateIds
    .map((id) => context.state.agents.find((agent) => agent.id === id))
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length < 2) return { status: "skipped", delta: emptyDelta() };
  const [first, second] = candidates;
  if (!first || !second || first.regionId !== second.regionId || first.age < 16 || second.age < 16) {
    return { status: "skipped", delta: emptyDelta() };
  }
  const existingFamily = context.state.organizations.some((organization) =>
    organization.type === "family" && first && second &&
    organization.memberIds.includes(first.id) && organization.memberIds.includes(second.id));
  if (existingFamily) return { status: "skipped", delta: emptyDelta() };
  const sociality = ((first.traits.sociality ?? 0) + (second.traits.sociality ?? 0)) / 2;
  const cooperation = ((first.traits.cooperation ?? 0) + (second.traits.cooperation ?? 0)) / 2;
  const probability = Math.max(0, Math.min(0.85, sociality * 0.35 + cooperation * 0.35));
  const [roll] = randomChance(forkRandom(context.random, `family:${first.id}:${second.id}`), probability);
  if (!roll) return { status: "skipped", delta: emptyDelta() };
  const family = createFamily([first.id, second.id], first.regionId);
  const delta = emptyDelta();
  delta.entityEffects.push({ collection: "organizations", operation: "create", id: family.id, value: family });
  return { status: "applied", value: family, delta };
};
