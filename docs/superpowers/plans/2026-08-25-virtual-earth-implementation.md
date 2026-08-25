# 虚拟地球自主演化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个从无生命原始地球开始、由规则和概率自行产生生态、个体、家庭、部落、聚落、城市、国家、神话和修真路径的 2D 浏览器模拟器。

**Architecture:** 使用纯 TypeScript 模拟核心、Canvas 2D 地图和 Web Worker。环境、生态、个体、社会和世界观规则只读取上一时间步的快照并写入下一状态；UI 只消费快照并提交事件。全球区域使用统计摘要，用户关注或发生重大事件的区域展开为个体和关系网络，离开热点后再守恒汇总。

**Tech Stack:** Node.js 20+, TypeScript 5+, Vite, Canvas 2D, Web Worker, Vitest, Playwright。

## Global Constraints

- 初始世界必须没有个体、家庭、部落、城市、国家、神祇、宗门、功法和修士；生命、智慧、组织与体系只能由规则满足条件后概率产生。
- 不写固定的“第 N 秒创建城市”或“按阶段播放剧情”逻辑；阶段名称只能由当前状态指标推导，不能驱动实体生成。
- 每个自主事件必须包含规则 ID、种子随机抽样、条件证据、来源实体、时间和位置；固定种子重跑时事件顺序和关键状态必须一致。
- 个体、家庭、组织和超自然实体使用稳定 ID；形成、扩张、分裂、合并、迁徙、征服和消亡都保留事件历史。
- 多尺度展开/汇总必须保持人口、资源、成员关系和关键历史的一致性，不得用精度切换凭空创造或删除人口。
- 区域模拟模式是权威状态的一部分：`aggregate` 区域由统计状态演化，`micro` 区域由真实个体演化；用户聚焦只生成确定性的只读投影，不改变模式、不消耗模拟随机数、不写回世界。
- 只有自然热点规则才能触发 `aggregate <-> micro`，模式切换必须有可复现事件、来源、条件证据和守恒校验；同一世界是否被用户观察不得改变权威 digest。
- 神话包以公共文化母题和原创数据结构表达，不复制现代作品文本、角色设定、图片或受限制资源；无明确许可证的 GitHub 项目只作概念参考。
- 世界观包只能提交受限效果和发现候选，不能提交任意路径 patch 或直接创建成熟实体；核心 reducer 必须重新验证条件、概率、来源和资源闭环。
- 上帝模式只能提交世界事件，不允许 UI 直接修改模拟状态或直接宣布实体、文明、神迹、飞升成功。
- 规则前置条件使用结构化状态谓词，不能引用派生阶段标签、绝对 tick 或唯一时间阈值；阶段标签只存在于 UI 读模型。
- 地图和模拟核心解耦；模拟核心不依赖 DOM、Canvas、React 或浏览器全局对象。
- 15 分钟是第一个生态/文化里程碑，不是模拟终点；测试必须支持继续运行、停滞、退化和灭亡。
- 所有数值字段必须有明确边界；每个时间步执行水、能量、资源和人口守恒/边界检查。

---

## 文件地图

第一阶段建立以下边界，后续任务只在对应边界内添加代码：

- `src/sim/types.ts`：所有跨模块数据契约和 ID 类型。
- `src/sim/random.ts`：可序列化的确定性伪随机数生成器。
- `src/sim/world.ts`：世界创建、快照复制和状态版本。
- `src/sim/environment/`：地形、气候、水文和化学场。
- `src/sim/ecology/`：物种、种群、繁殖、迁移、捕食和灭绝。
- `src/sim/events/`：规则、事件、条件证据和时间线。
- `src/sim/agents/`：个体、需求、生命周期、记忆和关系。
- `src/sim/culture/`：语言、知识、信仰和文化传播。
- `src/sim/society/`：家庭、部落、聚落、城市、国家和组织生命周期。
- `src/sim/lod/`：区域热点、统计摘要、个体展开和守恒汇总。
- `src/sim/worldview/`：体系包注册、规则和五个示范体系。
- `src/sim/engine.ts`：单步调度，只组合模块，不包含 UI 逻辑。
- `src/worker/`：Worker 协议和模拟线程入口。
- `src/persistence/`：版本化 JSON 存档。
- `src/ui/`：Canvas、图层、检查器、控制器、事件时间线和上帝模式。
- `tests/unit/`：纯函数和模块不变量测试。
- `tests/integration/`：固定种子、多尺度和体系交互测试。
- `tests/e2e/`：浏览器渲染与交互测试。

## Task 1: 建立可运行的浏览器与测试骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/styles.css`
- Create: `tests/unit/smoke.test.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm run test`, `npm run test:e2e` 四个稳定命令。
- Produces: 页面中的 `#app`、`#world-map` 和 `#simulation-status` 三个稳定 DOM 入口，供后续 UI 和 E2E 使用。

- [ ] **Step 1: 创建包配置和脚本**

写入以下脚本，不引入 React 或不必要的 UI 框架：

```json
{
  "name": "virtual-earth",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "@types/node": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: 创建 TypeScript、Vite 和 Playwright 配置**

TypeScript 必须启用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`；Vitest 使用 Node 环境；Playwright 使用 Chromium、`webServer.command = 'npm run dev -- --host 127.0.0.1'` 和固定测试端口。

- [ ] **Step 3: 创建最小页面和空 Canvas**

`src/main.ts` 创建 `#app`、标题、`<canvas id="world-map">` 和 `<output id="simulation-status">Initializing`，Canvas 设置 `devicePixelRatio` 适配但不绘制模拟数据。`src/styles.css` 提供深色地图工作区、固定工具栏宽度和窄屏下的纵向布局。

- [ ] **Step 4: 编写冒烟测试并运行**

在 `tests/unit/smoke.test.ts` 验证 `1 + 1 === 2` 和 `package.json` 脚本由配置加载；运行：

```powershell
npm install
npm run test
npm run build
```

预期：测试和构建均通过，页面可由 Vite 启动。

- [ ] **Step 5: 提交脚手架**

```powershell
git add package.json tsconfig.json vite.config.ts index.html src tests playwright.config.ts
git commit -m "build: scaffold virtual earth app"
```

## Task 2: 建立确定性世界状态和随机源

**Files:**
- Create: `src/sim/types.ts`
- Create: `src/sim/random.ts`
- Create: `src/sim/world.ts`
- Create: `tests/unit/random.test.ts`
- Create: `tests/unit/world.test.ts`

**Interfaces:**
- Produces: `createWorld(seed: number, options?: WorldOptions): WorldState`。
- Produces: `nextRandom(random: RandomState): [number, RandomState]`，输出 `[0, 1)` 且不修改输入。
- Produces: `cloneWorld(state: WorldState): WorldState` 和 `worldDigest(state: WorldState): string`。

- [ ] **Step 1: 定义跨模块类型**

在 `src/sim/types.ts` 定义稳定 ID、网格、事件、实体和世界状态：

```ts
export type EntityId = string & { readonly __entityId: unique symbol };
export type OrganizationId = string & { readonly __organizationId: unique symbol };
export type RegionId = string & { readonly __regionId: unique symbol };
export type RandomState = { value: number };
export type WorldOptions = { width?: number; height?: number; enabledPackIds?: string[] };
export type Grid = { width: number; height: number; values: Float32Array };
export type SpeciesRole = "producer" | "consumer" | "decomposer";
export type OrganizationType = "family" | "clan" | "tribe" | "settlement" | "city" | "state" | "federation" | "empire";
export type HotspotReason = "user-focus" | "city" | "war" | "cultivation" | "mythic-event" | "disaster" | "rapid-change";
export type RegionMode = "aggregate" | "micro";
export type FieldName = "elevation" | "temperature" | "humidity" | "water" | "nutrients" | "biomass";
export type FieldChange = { field: FieldName; index: number; operation: "set" | "add"; value: number; causeRuleId: string };
export type RelationshipState = { id: string; fromId: EntityId; toId: EntityId; kind: "parent" | "partner" | "caregiver" | "friend" | "rival" | "teacher" | "student"; strength: number; createdTick: number; sourceEventId: string };
export type RelationshipEffect = { operation: "create" | "update" | "remove"; relationship: RelationshipState };
export type EntityEffect =
  | { collection: "species"; operation: "create" | "update" | "remove"; id: EntityId; value?: SpeciesState }
  | { collection: "populations"; operation: "create" | "update" | "remove"; id: EntityId; value?: PopulationState }
  | { collection: "agents"; operation: "create" | "update" | "remove"; id: EntityId; value?: AgentState }
  | { collection: "cultures"; operation: "create" | "update" | "remove"; id: EntityId; value?: CultureState }
  | { collection: "organizations"; operation: "create" | "update" | "remove"; id: OrganizationId; value?: OrganizationState }
  | { collection: "worldviewEntities"; operation: "create" | "update" | "remove"; id: EntityId; value?: WorldviewEntityState };
export type ResourceLedgerEntry = { id: string; resourceId: string; regionId: RegionId; holderId?: string; amount: number; cap: number; originEventId: string };
export type ResourceTransaction = { id: string; resourceId: string; regionId: RegionId; amount: number; operation: "mint" | "transfer" | "consume" | "destroy"; source: "environment" | "culture" | "worldview" | "user"; sourceId: string; fromHolderId?: string; toHolderId?: string; causeRuleId: string };
export type WorldEventDraft = { kind: string; ruleId: string; position?: [number, number]; sourceIds: string[]; probability: number; roll: number; evidence: Record<string, number | string | boolean>; payload: Record<string, unknown>; source: "natural" | "user" };
export type WorldDelta = { fieldChanges: FieldChange[]; entityEffects: EntityEffect[]; relationshipEffects: RelationshipEffect[]; resourceTransactions: ResourceTransaction[]; worldviewEffects: WorldviewEffect[]; eventDrafts: WorldEventDraft[] };
export type StateMetric = "meanTemperature" | "meanHumidity" | "waterCoverage" | "nutrientLevel" | "biomass" | "oxygen" | "populationCount" | "cognitivePotential" | "knowledgeDiversity" | "beliefDiversity" | "householdCount" | "settlementDensity" | "tradeVolume" | "foodSurplus" | "organizationCapacity" | "resourceBalance";
export type RuleContext = { state: Readonly<WorldState>; random: RandomState; metrics: Record<StateMetric, number>; regionId?: RegionId };
export type RuleApplicationContext = RuleContext & { tick: number };
export type RuleDecision = { eligible: boolean; probability: number; evidence: Record<string, number | string | boolean>; reason: string };
export type RuleOutcome<T = unknown, D extends WorldDelta = WorldDelta> = { status: "applied" | "skipped"; value?: T; delta: D };
export type EnvironmentInput = { solarFlux: number; externalEvents: WorldEvent[] };
export type EnvironmentDelta = WorldDelta;
export type EcologyDelta = WorldDelta;
export type AgentsDelta = WorldDelta;
export type CultureDelta = WorldDelta;
export type SocietyDelta = WorldDelta;
export type WorldviewDelta = Pick<WorldDelta, "worldviewEffects" | "resourceTransactions" | "eventDrafts">;
export type StepInput = { elapsedYears: number; externalEvents: WorldEvent[] };
export type StepResult = { state: WorldState; events: WorldEvent[]; digest: string };
export type AgentContext = RuleContext & { candidateIds: EntityId[] };
export type SocietyContext = RuleContext & { regionId: RegionId; candidateMemberIds: EntityId[] };
export type WorldviewContext = RuleContext & { enabledPackIds: string[] };
export type WorldEventInput = { id: string; kind: string; regionId: RegionId; intensity: number; duration: number; source: "user"; payload: Record<string, string | number | boolean> };
export type Distribution = { bins: Record<string, number> };
export type OrganizationSummary = { id: OrganizationId; type: OrganizationType; memberCount: number; childIds: OrganizationId[]; resourceIds: string[]; historyIds: string[] };
export type RegionSummary = { regionId: RegionId; version: number; mode: RegionMode; population: number; populationByAge: Distribution; skillHistogram: Distribution; cultureHistogram: Distribution; householdCount: number; organizations: OrganizationSummary[]; relationshipDigest: string; resources: ResourceLedgerEntry[]; migrationRate: number; historyIds: string[]; random: RandomState; canonicalDigest: string };
export type RegionProjection = { regionId: RegionId; sourceRevision: number; readOnly: true; generatedFromDigest: string; agents: AgentState[]; relationships: RelationshipState[]; organizations: OrganizationState[] };
export type LodState = { summaries: RegionSummary[]; canonicalMicroRegionIds: RegionId[] };
export type ObservationState = { focusRegionId?: RegionId; projection?: RegionProjection };
export type SpeciesState = { id: EntityId; role: SpeciesRole; traits: Record<string, number>; parentId?: EntityId };
export type PopulationState = { id: EntityId; speciesId: EntityId; regionId: RegionId; count: number; energy: number };
export type AgentState = { id: EntityId; populationId: EntityId; regionId: RegionId; age: number; traits: Record<string, number>; relationshipIds: string[] };
export type CultureState = { id: EntityId; regionId: RegionId; knowledgeIds: string[]; beliefIds: string[]; transmissionRate: number };
export type OrganizationState = { id: OrganizationId; type: OrganizationType; memberIds: EntityId[]; childOrganizationIds: OrganizationId[]; regionId: RegionId; resources: Record<string, number>; status: "active" | "migrating" | "fragmenting" | "collapsed" };
export type WorldviewEntityState = { id: EntityId; packId: string; kind: string; regionId: RegionId; influence: number; resourceBalances: Record<string, number> };
export type WorldviewEffect =
  | { kind: "discover-motif"; packId: string; motifId: string; regionId: RegionId; evidence: Record<string, number | string | boolean> }
  | { kind: "propagate-belief"; packId: string; beliefId: string; regionId: RegionId; sourceIds: EntityId[]; strength: number }
  | { kind: "propose-entity"; packId: string; entityKind: "deity" | "sect" | "cultivation-path"; regionId: RegionId; evidence: Record<string, number | string | boolean>; probability: number }
  | { kind: "resource-transaction"; transaction: ResourceTransaction };
export type WorldviewState = { enabledPackIds: string[]; discoveredRuleIds: string[]; entities: WorldviewEntityState[] };
export type SimulationStage = { id: string; order: number; run(state: Readonly<WorldState>, input: StepInput, priorDeltas: ReadonlyMap<string, WorldDelta>): WorldDelta };
export type WorldEvent = {
  id: string; tick: number; kind: string; ruleId: string; position?: [number, number]; source: "natural" | "user";
  sourceIds: string[]; probability: number; roll: number;
  evidence: Record<string, number | string | boolean>; payload: Record<string, unknown>;
};
export type WorldState = {
  version: 1; seed: number; tick: number; years: number; random: RandomState;
  fields: { elevation: Grid; temperature: Grid; humidity: Grid; water: Grid; nutrients: Grid; biomass: Grid };
  chemistry: { carbon: Grid; nitrogen: Grid; phosphorus: Grid; organics: Grid; oxygen: Grid };
  species: SpeciesState[]; populations: PopulationState[];
  agents: AgentState[]; relationships: RelationshipState[]; cultures: CultureState[];
  organizations: OrganizationState[]; resources: ResourceLedgerEntry[]; worldview: WorldviewState;
  events: WorldEvent[]; lod: LodState; observation: ObservationState;
};
```

All module-specific deltas use `WorldDelta` and are applied by typed reducers in `src/sim/engine.ts`; modules may add narrow helper types but may not invent incompatible replacements for these shared contracts. `WorldEventInput` is the only input accepted from UI tools, and its `id` is the single deduplication key. The engine is the only component that turns `eventDrafts` into final `WorldEvent` records.

- [ ] **Step 2: Implement serializable deterministic randomness**

Use a small integer PRNG with explicit state, for example `xorshift32`, and implement `randomFloat`, `randomInt`, `randomChance`, and `forkRandom(label)`. `forkRandom` must derive a new stream from the parent state and stable label, not from wall-clock time or object iteration order.

- [ ] **Step 3: Implement blank-world construction**

`createWorld` creates deterministic terrain-sized grids, empty `species`, `populations`, `agents`, `relationships`, `cultures`, `organizations` and `worldview.entities`, plus bounded inorganic chemistry. The single top-level `resources` ledger starts empty; `ResourceDefinition` describes only possible sources/sinks and never grants initial supernatural resources. It must not call a helper that creates a deity, cultivation sect, human, family or city.

- [ ] **Step 4: Test deterministic and blank invariants**

Test that two worlds with the same seed have identical `worldDigest`, different seeds produce different terrain digests, `createWorld(1)` has zero species, populations, agents, relationships, cultures, organizations, worldview entities and top-level resource ledger entries, and all field values are finite and bounded. Export `assertBlankWorld(state)` and reuse it after enabling all five worldview packs and after the first several steps in a deliberately ineligible world.

- [ ] **Step 5: Commit the core state contract**

```powershell
npm run test -- tests/unit/random.test.ts tests/unit/world.test.ts
git add src/sim/types.ts src/sim/random.ts src/sim/world.ts tests/unit
git commit -m "feat: add deterministic world state"
```

## Task 3: 实现地质、气候、水文和化学场

**Files:**
- Create: `src/sim/environment/terrain.ts`
- Create: `src/sim/environment/climate.ts`
- Create: `src/sim/environment/hydrology.ts`
- Create: `src/sim/environment/chemistry.ts`
- Create: `src/sim/environment/index.ts`
- Create: `tests/unit/environment.test.ts`

**Interfaces:**
- Produces: `initializeEnvironment(state: WorldState): WorldState`。
- Produces: `stepEnvironment(state: WorldState, input: EnvironmentInput): EnvironmentDelta`。
- Produces: `applyEnvironmentDelta(state: WorldState, delta: EnvironmentDelta): WorldState`。

- [ ] **Step 1: 用确定性噪声初始化地形**

实现 `generateElevation(seed, width, height)`，使用纬度约束和多频率平滑噪声产生海洋、盆地和高地；同一种子必须逐格一致。初始种群仍为空。

- [ ] **Step 2: 实现可解释气候场**

按纬度、海拔、海洋邻近度、大气状态和云量计算温度、湿度、风向和降水；把输入和输出写成纯函数。`stepClimate` 不创建生物、文明或神话实体。

- [ ] **Step 3: 实现守恒水文**

实现蒸发、降雨、径流和海洋交换。每个格子的水量通过 `clamp` 限制，并返回 `waterBefore`、`waterAfter`、`atmosphericTransfer` 供测试检查总量变化只来自显式转移。

- [ ] **Step 4: 实现无机化学与有机物积累**

实现矿物风化、碳氮磷迁移、有机物衰减和氧气变化，但在生命起源条件未满足时不生成生产者。生命起源候选条件必须作为数值输出交给事件规则层。

环境模块导出并注册 `order = 10` 的 `environment` 阶段；该阶段只产生环境 delta，不创建生命或社会实体。

- [ ] **Step 5: 测试环境方向和不变量**

覆盖赤道/极地温度方向、海拔升高的温度方向、降水随水汽增加的方向、单步水量守恒、所有字段边界和固定种子一致性。

- [ ] **Step 6: 提交环境垂直切片**

```powershell
npm run test -- tests/unit/environment.test.ts
npm run build
git add src/sim/environment tests/unit/environment.test.ts
git commit -m "feat: simulate terrain climate and chemistry"
```

## Task 4: 实现种群生态和生命起源规则

**Files:**
- Create: `src/sim/ecology/species.ts`
- Create: `src/sim/ecology/populations.ts`
- Create: `src/sim/ecology/step.ts`
- Create: `tests/unit/ecology.test.ts`

**Interfaces:**
- Produces: `attemptAbiogenesis(context: RuleContext): RuleOutcome<SpeciesState>`。
- Produces: `stepEcology(state: WorldState, environment: EnvironmentDelta): EcologyDelta`。
- Produces: `applyEcologyDelta(state: WorldState, delta: EcologyDelta): WorldState`。

- [ ] **Step 1: 定义可变异物种和种群数据**

物种包含角色、能量需求、温湿度适应区间、移动能力、繁殖率、寿命、变异率和认知潜势；种群包含位置、数量、能量、年龄分布和食物关系。禁止把“第一个物种”写成固定实体。

- [ ] **Step 2: 实现生命起源概率规则**

`attemptAbiogenesis` 读取温度、水、矿物、能量和有机物，在条件满足时使用当前规则流抽样。成功后生成带随机基因组的新生产者，并记录条件证据；条件不满足时只返回 `skipped`，不推进模拟阶段。

- [ ] **Step 3: 实现生产者、消费者和分解者闭环**

生产者消耗光、水和营养；消费者消耗食物；分解者处理死亡有机物并返还营养。资源不足降低繁殖和存活，不允许负数量或瞬间无限增长。

- [ ] **Step 4: 实现迁移、变异、竞争和灭绝**

使用邻域适应度和移动能力计算迁移；新物种从父物种基因参数变异而来；捕食和竞争通过种群关系消耗能量；灭绝保留源 ID 和原因事件。不要用固定事件顺序创建消费者或分解者。

生态模块导出并注册 `order = 20` 的 `ecology` 阶段，读取环境阶段的前一状态快照和 delta，不直接调用未来的 agents 或 society 模块。

- [ ] **Step 5: 测试不同种子和人工条件**

对合成环境测试生产者能够增长、资源耗尽时种群下降、消费者只有在食物可用时才出现、变异产生新稳定 ID、灭绝可追踪。运行两个种子，验证生态事件序列允许不同。

- [ ] **Step 6: 提交生态切片**

```powershell
npm run test -- tests/unit/ecology.test.ts
git add src/sim/ecology tests/unit/ecology.test.ts
git commit -m "feat: add emergent ecology rules"
```

## Task 5: 建立规则引擎、事件账本和长期调度

**Files:**
- Create: `src/sim/events/rules.ts`
- Create: `src/sim/events/ledger.ts`
- Create: `src/sim/events/phase.ts`
- Create: `src/sim/engine.ts`
- Create: `tests/unit/events.test.ts`
- Create: `tests/integration/autonomy.test.ts`

**Interfaces:**
- Produces: `type StatePredicate = { subject: "field" | "chemistry" | "population" | "culture" | "organization" | "resource"; metric: StateMetric; operator: ">=" | "<=" | "=="; value: number }` and `type EmergenceRule = { id: string; predicates: StatePredicate[]; evaluate(context: RuleContext): RuleDecision; apply(context: RuleApplicationContext): RuleOutcome }`。
- Produces: `stepWorld(state: WorldState, input: StepInput): StepResult`。
- Produces: `derivePhase(state: WorldState): DisplayPhase`，只用于显示。
- Produces: `registerSimulationStage(stage: SimulationStage): void`，后续模块通过它接入调度顺序。

- [ ] **Step 1: 实现条件证据和规则决策类型**

在 `src/sim/events/phase.ts` 定义 `DisplayPhase = "primordial" | "oceanic" | "chemical" | "ecological" | "sapient" | "social" | "mythic" | "cultivation"`，并且只从当前状态计算。`RuleDecision` 必须包含 `eligible`、`probability`、`evidence` 和 `reason`；`RuleOutcome` 只包含 typed delta，不携带第二份事件数组。`StatePredicate` 只能引用白名单状态指标，不允许 `phase`、`tick`、`years` 或仅时间阈值。规则评估上下文不暴露时间；引擎在应用结果时才把当前 tick 写入事件草稿。

在 `src/sim/types.ts` 增加 `SimulationStage = { id: string; order: number; run(state: Readonly<WorldState>, input: StepInput, priorDeltas: ReadonlyMap<string, WorldDelta>): WorldDelta }`。阶段注册表按 `order` 排序并拒绝重复 ID；Task 5 只注册 environment 和 ecology，Task 6 到 Task 9 在各自完成后注册 agents/culture、society、lod 和 worldview。阶段只能读取 previous snapshot 和只读的前序 delta，不能修改其他阶段的输入。`registerSimulationStage` 校验规则/阶段 ID 不能包含 `phase` 或时间门槛标记。

- [ ] **Step 2: 实现事件账本**

`appendEvent` 只接受一个已带 ID 的 `WorldEvent`；自然事件 ID 由 `ruleId + tick + sourceIds + roll` 的稳定哈希产生，用户事件直接使用 `WorldEventInput.id`。事件按 `(tick, id)` 排序，重复事件 ID 不得重复应用。账本提供 `eventsSince(tick)` 和 `digest()`；`WorldDelta` 的 `eventDrafts` 由引擎一次性物化并追加，任何规则不得另外写事件数组。

- [ ] **Step 3: 实现可扩展的单步调度器**

`stepWorld` 按注册表中的 `order` 调用当前阶段，并让每个阶段基于同一 previous snapshot 和只读前序 delta 产生自己的 delta；Task 5 的最小构建只运行 environment 和 ecology，后续任务通过 `registerSimulationStage` 接入 agents/culture、society、lod 和 worldview。最后由 typed reducers 校验 field/entity/relationship/resource/worldview effects，统一物化 event drafts、执行资源交易和边界检查，再更新 tick。不要在 `stepWorld` 中写 `if (tick === 500) createCity()` 这类按固定时间创建实体的逻辑。

- [ ] **Step 4: 让阶段标签成为派生指标**

`derivePhase` 根据温度、海洋、氧气、生物量、智慧种群、组织和超自然发现等当前指标返回标签；删除任何让阶段标签驱动生成实体的路径。

- [ ] **Step 5: 编写自主性集成测试**

测试同一种子运行 N 步产生相同 digest；不同种子产生不同事件摘要；初始事件账本没有神祇、宗门或城市；删除资源后组织可能退化；修改派生阶段标签或 tick 但保持权威状态相同不能改变形成资格或结果；随机种子不会因为墙钟时间变化；所有资源变化都能在资源交易账本中找到来源和去向。

- [ ] **Step 6: 提交调度核心**

```powershell
npm run test -- tests/unit/events.test.ts tests/integration/autonomy.test.ts
git add src/sim/events src/sim/engine.ts tests/unit/events.test.ts tests/integration/autonomy.test.ts
git commit -m "feat: add rule driven simulation engine"
```

## Task 6: 实现个体、家庭、文化和关系网络

**Files:**
- Create: `src/sim/agents/lifecycle.ts`
- Create: `src/sim/agents/relationships.ts`
- Create: `src/sim/culture/knowledge.ts`
- Create: `src/sim/culture/step.ts`
- Create: `tests/unit/agents.test.ts`
- Create: `tests/unit/culture.test.ts`

**Interfaces:**
- Produces: `stepAgents(state: WorldState, ecology: EcologyDelta): AgentsDelta`。
- Produces: `stepCulture(state: WorldState, agents: AgentsDelta): CultureDelta`。
- Produces: `createFamilyIfEligible(context: AgentContext): RuleOutcome<OrganizationState>`，返回 `OrganizationState.type = "family"`，不再维护第二套 `families` 数组。

- [ ] **Step 1: 定义个体生命周期**

实现出生、成长、需求、工作、学习、繁殖、疾病、衰老和死亡；个体必须拥有稳定 ID、父母 ID、寿命分布、性状、技能、记忆摘要和信仰/知识引用。智慧种群不是开局实体，而是生态层产生认知潜势并通过规则转化后才有 agent。

- [ ] **Step 2: 实现关系边和家庭形成**

关系边统一存放在 `WorldState.relationships`，包含类型、强度、创建 tick 和来源事件；个体上的 `relationshipIds` 只是索引缓存。只有亲缘、照护、资源共享或互助条件达到阈值时，家庭组织形成规则才有资格抽样；家庭成员死亡、迁移或资源崩溃会触发重组或解体，不创建第二套家庭实体。

- [ ] **Step 3: 实现知识和文化传播**

知识条目包含来源、可信度、传播成本和遗忘率；个体通过观察、模仿、教学和家庭传承获得知识。语言/信仰作为可变文化特征，不从神话包直接注入。`src/sim/agents` 和 `src/sim/culture` 各导出一个 `SimulationStage`，分别使用 `order = 30` 和 `order = 40` 注册到引擎。

- [ ] **Step 4: 测试自主出现与死亡**

使用合成智能种群测试个体能出生和死亡、家庭组织只在条件满足后形成、资源不足会降低出生和提高迁移/死亡、知识可以通过关系传播；使用空初始世界测试不会凭空出现个体、关系或家庭组织。测试同一关系只能在 `relationships` 集合中拥有一个权威记录。

- [ ] **Step 5: 提交个体文化切片**

```powershell
npm run test -- tests/unit/agents.test.ts tests/unit/culture.test.ts
git add src/sim/agents src/sim/culture tests/unit/agents.test.ts tests/unit/culture.test.ts
git commit -m "feat: add emergent agents and culture"
```

## Task 7: 实现家庭、部落、聚落、城市、国家和更高组织

**Files:**
- Create: `src/sim/society/organization.ts`
- Create: `src/sim/society/formation.ts`
- Create: `src/sim/society/governance.ts`
- Create: `src/sim/society/step.ts`
- Create: `tests/unit/society.test.ts`
- Create: `tests/integration/social-evolution.test.ts`

**Interfaces:**
- Produces: `attemptOrganizationFormation(context: SocietyContext, type: OrganizationType): RuleOutcome<OrganizationState>`。
- Produces: `stepSociety(state: WorldState, culture: CultureDelta, agents: AgentsDelta): SocietyDelta`。
- Produces: `organizationCapacity(org: OrganizationState, context: SocietyContext): number`。

- [ ] **Step 1: 定义组织统一模型**

组织包含稳定 ID、类型、成员/子组织 ID、领地、资源、规范、决策方式、影响范围、历史和生命周期状态。类型只描述当前组织形态，不携带“下一阶段”指针。

- [ ] **Step 2: 实现形成资格与概率**

部落使用亲缘、语言、信仰、防御和迁徙网络；聚落使用定居和食物剩余；城市使用人口密度、贸易、专业化和公共工程；国家使用领土治理、税收、法律、军事和跨聚落协调。每种组织都返回条件证据并用独立规则流抽样，不允许 `tribe -> city -> state` 的强制升级函数。

- [ ] **Step 3: 实现治理、资源和冲突**

实现资源分配、首领/委员会/神权/宗门等决策方式、贸易、征税、公共工程、外交和冲突；战败、灾害或资源枯竭可以让组织分裂、迁徙、被吞并或退化。`src/sim/society` 导出并注册 `order = 50` 的 `society` 阶段。

- [ ] **Step 4: 测试组织生命周期**

测试合成条件下各类型组织可以形成，低资源时组织容量下降，成员损失可触发分裂/解体，邻近组织可合并或冲突；测试没有达到条件时不会生成城市或国家，阶段标签改变也不会绕过条件。

- [ ] **Step 5: 提交社会切片**

```powershell
npm run test -- tests/unit/society.test.ts tests/integration/social-evolution.test.ts
git add src/sim/society tests/unit/society.test.ts tests/integration/social-evolution.test.ts
git commit -m "feat: add emergent social organizations"
```

## Task 8: 实现全球摘要与局部个体展开

**Files:**
- Create: `src/sim/lod/types.ts`
- Create: `src/sim/lod/focus.ts`
- Create: `src/sim/lod/expand.ts`
- Create: `src/sim/lod/summarize.ts`
- Create: `tests/unit/lod.test.ts`
- Create: `tests/integration/lod-conservation.test.ts`

**Interfaces:**
- Produces: `focusRegion(state: WorldState, region: RegionId): ObservationState`，只生成只读投影，不修改或返回新的权威 `WorldState`。
- Produces: `projectRegion(summary: RegionSummary, version: number): RegionProjection`，只使用摘要中的 canonical digest 和稳定区域随机状态，不消耗模拟随机流。
- Produces: `promoteRegion(state: WorldState, region: RegionId, reason: HotspotReason): WorldDelta`，仅供自然热点规则调用，负责可审计的 `aggregate -> micro` 模式切换。
- Produces: `summarizeRegion(state: WorldState, region: RegionId): WorldDelta`，仅供自然退热点规则调用，负责可审计的 `micro -> aggregate` 模式切换。

- [ ] **Step 1: 定义区域摘要与展开状态**

摘要是 `aggregate` 模式的权威状态，保存人口按年龄/技能/文化分布、家庭组织签名、组织成员摘要、关系 digest、资源账本条目、迁徙率、稳定历史 ID、canonical digest 和区域随机流。`micro` 模式的权威状态保存 `AgentState`、`RelationshipState`、family-type `OrganizationState`、其他组织和对应资源交易。`RegionProjection` 只是只读视图，不进入世界状态。

- [ ] **Step 2: 实现热点选择**

城市、战争、宗门、神迹、灾害和快速人口/资源变化由世界规则提升热点分数并可能触发模式切换；用户关注只更新 `ObservationState`，不改变模拟精度、不改变随机流、不改变生成概率。

- [ ] **Step 3: 实现确定性展开**

自然热点触发 `promoteRegion` 时，使用摘要、canonical digest、区域随机状态和版本重建稳定个体 ID、家庭关系和组织成员；同一权威状态只能得到同一 micro 状态。`focusRegion` 调用 `projectRegion` 时不得写回任何实体，也不能消费 `WorldState.random`。`src/sim/lod` 导出并注册 `order = 60` 的 `lod` 阶段。

- [ ] **Step 4: 实现守恒汇总**

自然退热点时，`summarizeRegion` 聚合权威个体人口、资源交易、家庭组织、组织成员和关系边，不丢失关键历史；汇总前后校验人口总数、资源总量、组织成员数、关系边 ID、随机状态和 canonical digest。用户取消聚焦不得调用它。

- [ ] **Step 5: 测试切换不变量**

只读 projection 的创建前后，权威 `worldDigest`、随机状态、人口、资源和事件账本完全一致；自然 `aggregate -> micro -> aggregate` 切换在相同规则流下恢复摘要的容差范围；模式切换期间人口、资源、组织成员、关系边和关键历史守恒；不同用户聚焦原因不应改变规则结果，只改变观察投影。

- [ ] **Step 6: 提交多尺度切片**

```powershell
npm run test -- tests/unit/lod.test.ts tests/integration/lod-conservation.test.ts
git add src/sim/lod tests/unit/lod.test.ts tests/integration/lod-conservation.test.ts
git commit -m "feat: add conserved multi scale simulation"
```

## Task 9: 接入世界观体系包和修真规则

**Files:**
- Create: `src/sim/worldview/types.ts`
- Create: `src/sim/worldview/registry.ts`
- Create: `src/sim/worldview/engine.ts`
- Create: `src/sim/worldview/packs/chinese-mythology.ts`
- Create: `src/sim/worldview/packs/greek-mythology.ts`
- Create: `src/sim/worldview/packs/norse-mythology.ts`
- Create: `src/sim/worldview/packs/indian-mythology.ts`
- Create: `src/sim/worldview/packs/cultivation.ts`
- Create: `tests/unit/worldview.test.ts`
- Create: `tests/integration/worldview-autonomy.test.ts`

**Interfaces:**
- Produces: `WorldviewPack` with `id`, `motifs`, `resources`, `rules`, `templates` and `version`。
- Produces: `createWorldviewState(enabledPackIds: string[]): WorldviewState`。
- Produces: `stepWorldviews(state: WorldState, context: WorldviewContext): WorldviewDelta`。

- [ ] **Step 1: 定义体系包契约**

体系包只能读取上下文并返回 `WorldviewEffect[]`，不得直接写入其他模块数组，也不得返回 `WorldPatch`/任意字符串路径。规则必须声明结构化状态谓词、资源闭环、传播机制、冲突/融合规则和失败条件。`propose-entity` 只能提交发现候选，核心 reducer 负责再次验证后才允许实体形成。

```ts
export type MotifDefinition = { id: string; tags: string[]; predicates: StatePredicate[] };
export type ResourceDefinition = { id: string; cap: number; sinks: string[]; sources: string[] };
export type WorldviewRule = {
  id: string; predicates: StatePredicate[]; evaluate(context: WorldviewContext): RuleDecision;
  apply(context: RuleApplicationContext): RuleOutcome<WorldviewEffect, WorldviewDelta>;
};
export type EventTemplate = { id: string; kind: string; payloadKeys: string[] };
export type WorldviewPack = {
  id: string; version: 1; label: string; motifs: MotifDefinition[];
  resources: ResourceDefinition[]; rules: WorldviewRule[]; templates: EventTemplate[];
};
```

- [ ] **Step 2: 实现注册表和空初始状态**

注册五个示范包，但 `createWorldviewState` 只保存启用包 ID、已发现规则、空实体列表和空资源账本；`ResourceDefinition` 不提供初始余额，开局资源必须为零或来自环境/文化规则。开局不得调用创建神祇、宗门、功法或修士的构造器。`src/sim/worldview` 导出并注册 `order = 70` 的 `worldview` 阶段。

- [ ] **Step 3: 添加四个神话母题包**

用原创、数据驱动的公共母题表达自然神灵、祖先/英雄崇拜、命运/预言、宇宙周期、祭祀、神谕和组织传播；不复制现代作品文本。规则只提供潜在出现条件和传播/冲突关系。

- [ ] **Step 4: 添加修真体系包**

定义灵气、资质、功法传承、境界、寿命、宗门、法宝、渡劫和因果资源/关系。修真发现依赖灵气、观察、知识传承、个体资质和社会组织条件；成功突破、渡劫或建立宗门都使用概率和失败分支。

- [ ] **Step 5: 测试体系自主性与互操作**

启用全部包创建世界并运行首个时间步时，物种、种群、个体、关系、组织、体系实体和体系资源账本仍遵守空初始约束；在合成条件下可生成一次可追踪发现候选，但只有核心 reducer 验证通过才形成实体；相同种子可复现、不同种子可不出现；体系资源耗尽时可衰退/消亡；神话包和修真包只能通过受限效果和资源交易互相影响，不能直接改对方内部状态。测试资源总量、来源和去向守恒。

- [ ] **Step 6: 提交体系切片**

```powershell
npm run test -- tests/unit/worldview.test.ts tests/integration/worldview-autonomy.test.ts
git add src/sim/worldview tests/unit/worldview.test.ts tests/integration/worldview-autonomy.test.ts
git commit -m "feat: add emergent mythology and cultivation packs"
```

## Task 10: 接入 Worker、存档和版本化快照

**Files:**
- Create: `src/worker/protocol.ts`
- Create: `src/worker/simulation.worker.ts`
- Create: `src/worker/client.ts`
- Create: `src/persistence/schema.ts`
- Create: `src/persistence/serialize.ts`
- Create: `src/persistence/storage.ts`
- Create: `tests/unit/persistence.test.ts`
- Create: `tests/integration/worker.test.ts`

**Interfaces:**
- Produces: `WorkerCommand = { type: "start" } | { type: "pause" } | { type: "step"; count: number } | { type: "setSpeed"; multiplier: 1 | 4 | 16 | 64 } | { type: "applyEvent"; event: WorldEventInput } | { type: "focusRegion"; regionId: RegionId } | { type: "save" } | { type: "load"; payload: string }`。
- Produces: `WorkerMessage = { type: "snapshot"; snapshot: WorldSnapshot } | { type: "events"; events: WorldEvent[] } | { type: "error"; code: string; message: string } | { type: "saved"; payload: string; digest: string }`。
- Produces: `serializeWorld(state: WorldState): string` 和 `deserializeWorld(input: string): WorldState`。

- [ ] **Step 1: 定义严格消息协议**

在 `src/worker/protocol.ts` 同时定义 `WorldSnapshot = { tick: number; years: number; digest: string; fields: WorldState["fields"]; metrics: Record<string, number>; selectedRegion?: RegionSummary; projection?: RegionProjection }` 和 `WorkerClient = { send(command: WorkerCommand): void; subscribe(listener: (message: WorkerMessage) => void): () => void }`。所有控制命令使用可判别联合类型，`WorldEventInput.id` 是唯一事件 ID 来源；Worker 不接收 DOM 对象或回调。重复 event ID 返回 `duplicate` 而不是再次应用。`focusRegion` 只返回只读 projection，不能调用 promotion/summarization 或改变权威 digest。

- [ ] **Step 2: 实现 Worker 模拟循环**

Worker 维护唯一 `WorldState` 和 speed/paused 状态，按固定逻辑时间步运行；UI 请求 snapshot 时发送可转移的网格副本和轻量实体摘要。计算异常暂停 Worker 并发送结构化错误。

- [ ] **Step 3: 实现 JSON 编解码**

将 TypedArray 编码为普通数组或 base64 字段，保留 version、seed、random、稳定 ID、LOD 权威模式、区域摘要/微观状态、资源账本、事件证据和体系状态；观察 projection 只保存来源 digest 或直接丢弃并按摘要重建，不能作为权威状态保存；加载时拒绝未知版本并保留当前世界。

- [ ] **Step 4: 测试暂停、恢复、保存和加载**

测试 Worker 单步后暂停不会继续改变 digest；保存/加载后下一步结果与未保存运行一致；坏 JSON、缺字段、未知版本都返回可显示错误；事件命令不会重复生效。

- [ ] **Step 5: 提交运行时基础设施**

```powershell
npm run test -- tests/unit/persistence.test.ts tests/integration/worker.test.ts
git add src/worker src/persistence tests/unit/persistence.test.ts tests/integration/worker.test.ts
git commit -m "feat: run simulation in worker and persist worlds"
```

## Task 11: 实现地图、图层、统计面板和检查器

**Files:**
- Create: `src/ui/map-canvas.ts`
- Create: `src/ui/layers.ts`
- Create: `src/ui/status-panel.ts`
- Create: `src/ui/inspector.ts`
- Create: `src/ui/timeline.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Create: `tests/e2e/world-render.spec.ts`

**Interfaces:**
- Consumes: `WorkerMessage` from Task 10 and `WorldState`/snapshot summaries from `src/sim/types.ts`。
- Produces: non-empty Canvas map, natural/temperature/rainfall/nutrients/biomass/species layers, cell inspector and social inspector。

- [ ] **Step 1: 绘制自然地图和稳定图例**

Canvas 根据 elevation/water/biomass 绘制自然地图，使用固定颜色表和图例；尺寸由容器和 `devicePixelRatio` 计算，不能由文本或 hover 内容改变。

- [ ] **Step 2: 实现分析图层**

图层按钮只改变渲染函数，不改变模拟状态；温度、降水、营养、生物量和物种分布必须使用同一网格索引和统一 legend。

- [ ] **Step 3: 实现状态面板与时间线**

显示地球年、派生阶段、环境指标、物种、人口、家庭、聚落和组织层级；时间线展示规则 ID、条件证据的摘要、位置和来源，不能把固定剧情当作发生事实。

- [ ] **Step 4: 实现地图选区和多层检查器**

点击单元格显示环境/生态指标；热点区域显示个体、家庭、关系、聚落、组织和世界观实体的稳定 ID、成员、资源和历史。非热点区域显示摘要，并提供“聚焦区域”命令。

- [ ] **Step 5: 运行浏览器渲染检查**

```powershell
npm run dev -- --host 127.0.0.1
npx playwright test tests/e2e/world-render.spec.ts
```

测试桌面和窄屏 viewport，断言 Canvas 非空、状态时间变化、图层切换、选区面板出现且文字不重叠。

- [ ] **Step 6: 提交观察界面**

```powershell
git add src/ui src/main.ts src/styles.css tests/e2e/world-render.spec.ts
git commit -m "feat: add world map and observation panels"
```

## Task 12: 实现暂停、速度、存档和上帝模式事件工具

**Files:**
- Create: `src/ui/controls.ts`
- Create: `src/ui/god-mode.ts`
- Modify: `src/ui/timeline.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Create: `tests/integration/god-mode.test.ts`
- Modify: `tests/e2e/world-render.spec.ts`

**Interfaces:**
- Produces: `GodTool = "raise-terrain" | "lower-terrain" | "add-water" | "add-rain" | "heat" | "cool" | "volcano" | "earthquake" | "meteor" | "add-minerals" | "add-organics" | "seed-life" | "drought" | "flood" | "cold-snap" | "volcanic-winter"` and `createGodEvent(id: string, tool: GodTool, region: RegionId, intensity: number, duration: number): WorldEventInput`。
- Consumes: `WorkerClient.send(command: WorkerCommand): void`。

- [ ] **Step 1: 实现时间控制**

暂停、单步、`1x / 4x / 16x / 64x` 和重置只发送 Worker 命令；速度只改变逻辑时间消费速率，不改变随机规则或事件概率公式。

- [ ] **Step 2: 实现保存/加载 UI**

保存请求 Worker 产生 JSON 并写入下载或浏览器存储；加载先在 Worker 校验版本和 digest，再替换世界；失败时保留当前世界并显示错误。

- [ ] **Step 3: 实现上帝模式事件工具**

地形、水文、气候、地质、资源、生命和灾害工具只创建带稳定 `id` 的 `WorldEventInput`；事件带位置、强度、持续时间、来源 `user`，由环境/生态/社会规则产生后续影响。UI 不得直接调用 `state.fields.water.values[index] = 1`。

- [ ] **Step 4: 测试干预的连锁影响**

在固定种子上分别加热、增加降雨、增加营养和投放种群，验证事件日志出现、后续环境/生态指标变化、重复事件只应用一次；验证没有干预的对照运行保持原 digest。

- [ ] **Step 5: 完成端到端控制测试**

在 E2E 中点击暂停和加速，确认模拟年变化速度不同；创建一次火山或资源事件，确认时间线显示用户事件且地图/统计后续变化；保存后加载，确认 digest 和选区状态恢复。

- [ ] **Step 6: 提交交互工具**

```powershell
npm run test -- tests/integration/god-mode.test.ts
npx playwright test tests/e2e/world-render.spec.ts
git add src/ui tests/integration/god-mode.test.ts tests/e2e/world-render.spec.ts
git commit -m "feat: add simulation controls and god events"
```

## Task 13: 完成全链路自主性验证和性能基线

**Files:**
- Create: `tests/integration/full-run.test.ts`
- Create: `tests/integration/seed-variation.test.ts`
- Create: `tests/e2e/autonomous-run.spec.ts`
- Create: `scripts/benchmark.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm run benchmark`，输出固定步数、网格尺寸、热点数量、个体数量和平均 step 时间。
- Produces: README 中的启动、控制、存档、体系包和自主性规则说明。

- [ ] **Step 1: 编写多种子长跑测试**

运行一组固定 seeds 到生态/文化里程碑和更长社会时间，断言相同 seed 的 `worldDigest`、关键事件顺序和资源守恒一致；不同 seed 至少在地形、生态或社会事件摘要中存在差异。

- [ ] **Step 2: 编写非固定模式断言**

统计多个 seed 的组织结果，允许“没有城市/国家”的结果；测试不得断言每个 seed 必须出现特定神祇、宗门、城市或国家，只断言满足条件后事件可发生且失败路径合法。

- [ ] **Step 3: 编写完整浏览器流程**

打开空世界，观察时间增长，聚焦热点，切换图层，查看个体/家庭/组织检查器，暂停、单步、加速，施加一次事件，保存并加载；每一步检查 UI 与 Worker 状态一致。

- [ ] **Step 4: 建立性能基线**

`scripts/benchmark.ts` 使用 Node 直接调用纯模拟核心，固定网格和步数，记录平均 step、峰值个体数、热点展开数量和 digest；超过预算时输出最慢模块而不是改变规则精度以隐藏问题。

- [ ] **Step 5: 更新 README 并执行全套验证**

```powershell
npm run test
npm run build
npm run test:e2e
npm run benchmark
git diff --check
git status --short --branch
```

README 必须明确：模拟是概率和规则驱动的开放系统；15 分钟只是首个里程碑；不同种子可能停滞或灭亡；神话/修真不会开局预置；上帝模式通过事件工作。

- [ ] **Step 6: 提交验收基线**

```powershell
git add tests scripts README.md
git commit -m "test: verify autonomous world evolution"
```

## 实施顺序与验收门槛

按 Task 1 到 Task 13 顺序执行。每个任务完成后必须通过自己的测试并提交，后续任务不得绕过前一任务的接口。

在进入 UI 前，Task 2 到 Task 9 必须能在 Node/Vitest 中独立运行；在声称“自行发展”完成前，必须同时满足以下条件：

- 初始状态的个体、家庭、组织、神祇和修真实体数量为零；
- 任何社会/世界观形成事件都能指出规则 ID、条件证据、概率、随机抽样和来源；
- 同一种子复现，异种子允许差异；
- 没有任何按 tick、阶段名或固定剧情直接创建实体的代码路径；
- 资源、人口、关系和历史在摘要/展开之间守恒；
- 组织能够形成，也能够停滞、分裂、退化、被征服或灭亡；
- 五个体系包可以同时启用，但开局不产生神祇、宗门、功法或修士；
- 浏览器中用户看到的是实际快照和事件因果，而不是预录动画。
