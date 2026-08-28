# Virtual Earth

Virtual Earth is a deterministic, rule-driven sandbox. It starts with an empty
entity state and lets terrain, climate, chemistry, ecology, individuals,
families, cultures and organizations emerge from local conditions and seeded
randomness.

## Run

Requirements: Node.js 20 or newer.

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Open the URL printed by Vite. The browser communicates with the simulation
through a Web Worker and starts autonomous evolution after the first snapshot.
Controls submit commands or external events; they do not mutate authoritative
state directly. Pause the simulation before inspecting a fixed instant, use
single-step to advance it explicitly, or reset to the original seed state.

## Verify

```powershell
npm run test
npm run build
npm run test:e2e
npm run benchmark
npm run benchmark:dense
npm run benchmark:dense:default
```

`npm run benchmark` checks the normal autonomous formation path against a
10 ms/step budget. `npm run benchmark:dense` first warms up a formed world for
1,000 steps on a compact 16x8 grid, then checks a fully active ecological and
social world against a 60 ms/step budget. `npm run benchmark:dense:default`
runs the same gate on the default 96x48 map. All benchmark commands fail when
the budget is exceeded or when they find non-finite values, unbounded hot
events or detailed agents, duplicate
resource entries, unbounded per-organization archive indexes, or dangling
relationship, organization-member, diplomatic, resource-holder and
parent-material references. They also enforce the bounded original-substance
catalog, population-record ceiling and active knowledge catalog. The causal
milestone archive is bounded as well: it preserves early anchors and recent
key events without retaining an ever-growing event list.
Their JSON output includes collection sizes, peak counts,
archived and total event counts, per-stage timings, the slowest stage and the
final authoritative digest.

These are repeatable regression gates for continued operation rather than a
promise tied to one calendar year. Long-run integration tests additionally
check collection bounds and reference integrity at regular intervals while all
simulation subsystems are active.
The runtime status panel also reports measured step cost, hot events and
archived history. A failed simulation step pauses the worker and preserves the
last valid authoritative state for inspection.

Runtime snapshots keep dense overlays in typed grids and transfer their
buffers from the Worker instead of cloning multi-megabyte arrays a second
time. The food-security layer uses the same representation, so inactive map
cells do not create tens of thousands of string-keyed records. Stable global
views reuse their existing globe geometry and update its position and color
buffers in place; hidden local props and entities are rebuilt only after the
camera enters a regional LOD.

Autonomous timing uses absolute deadlines. Simulation work therefore does not
silently extend the configured one-real-minute-per-simulated-day interval. If
a busy or backgrounded tab falls behind, the Worker catches up in bounded
batches of at most eight days, keeping pause and inspection commands
responsive. State digests are streamed directly over canonical state values,
preserving the previous deterministic digest while avoiding a full JSON copy
of every grid.

## Simulation rules

- A new world contains no species, populations, agents, families, cultures,
  organizations, mythology entities or cultivation entities.
- Environment initialization is derived from generated terrain. Water and
  nutrients then evolve through field deltas and chemistry changes.
- Orbital forcing, greenhouse carbon, ocean thermal inertia and humidity form
  a deterministic climate cycle. Slow tectonics, erosion and deposition alter
  relief while recycling minerals without bypassing the field-delta ledger.
- Local tectonic stress, terrain relief, heat, aridity and basin wetness can
  independently produce bounded volcanoes, earthquakes, droughts and floods.
  Each hazard carries regional evidence and affects terrain, chemistry,
  water redistribution, biomass and exposed facilities without a scripted
  calendar trigger.
- Biomass is no longer monotonic: primary production, grazing, decomposition
  and natural turnover feed carbon, oxygen, organics and nutrients back into
  one another. Regional ecological carrying capacity also contributes to the
  stability of settlements and larger organizations.
- Abiogenesis, trophic species, individuals, families and organizations are
  conditional probabilistic outcomes. No fixed tick or stage name creates an
  entity.
- Mobile populations can migrate toward better adjacent habitats, with agent
  locations following the population delta and a causal migration event.
- Producer populations mint food through the resource ledger. Society rules
  allocate, trade and consume food with conservation checks and auditable
  transactions; organization conflict, fragmentation and dissolution remain in
  the event history.
- Held food now feeds back into member food needs through bounded per-capita
  security. Hunger, fertility and mortality therefore respond to conserved
  organization balances instead of an unrelated global counter.
- Food security also biases family formation, can make a better-supplied
  neighboring region attractive to mobile populations, and reduces the
  effective capacity of large organizations under persistent shortage.
- Organization rules are independent for clan, tribe, settlement, city, state,
  federation and empire. Higher-order organizations retain child organization
  IDs and recruit current local members during governance.
- Children can inherit knowledge and beliefs from both parents. Births preserve
  parent, caregiver and sibling links so long-running worlds retain
  deterministic, auditable family lineages.
- Cultures can now derive original subsistence, construction, navigation,
  medicine, governance and energy techniques from local conditions and member
  abilities. Each innovation records its inventors, source region, prerequisite
  knowledge and origin time instead of advancing through a fixed technology tree.
- Stable crust regions can form deterministic original minerals, crystals and
  organic compounds from local terrain, water, nutrients and chemistry. These
  substances remain latent until local individuals discover them; sufficiently
  capable cultures can later create engineered composites with traceable parent
  materials, inventors and origin times.
- Known local substances feed back into material production, energy output,
  structural resilience and biological utility. Latent substances provide no
  civilization bonus, so discovery and access remain meaningful constraints.
- Knowledge can diffuse through trade, alliances, migration and wartime contact.
  The route, source culture and original provenance remain visible in the event
  ledger and region, individual or organization reports.
- Active knowledge and per-holder records are bounded for continued operation.
  Widely held, recent and high-credibility techniques remain live while retired
  records contribute to a cumulative archive count and surviving parent links.
- Adopted techniques now feed back into the world: subsistence raises bounded
  food yield, construction raises organizational capacity, medicine lowers
  age and hunger mortality risk, navigation improves migration access, energy
  conversion changes local carbon/oxygen/organic balances, and governance
  improves legitimacy, cohesion and public goods. These effects remain local
  to the cultures that actually hold the recorded knowledge.
- Facilities now maintain exclusive, skill-matched workforces. Staffing and
  average worker skill scale real facility output; death or migration creates
  vacancies that local organizations refill, while active workers accumulate
  profession skill and an auditable workplace memory.
- LOD summaries preserve region resources, organization history, source agent
  IDs and relationship records for deterministic read-only projections. Quiet
  aggregate regions continue to refresh population, food and migration
  statistics from authoritative records without recreating detailed agents;
  natural hotspots can still promote a region back to a detailed projection.
- The region inspector exposes household lineages, generation depth, kinship
  composition and descendant knowledge or belief carriers in both live micro
  projections and conserved aggregate summaries.
- The same seed and commands reproduce the same digest and event history.
  Different seeds may remain sterile, diverge, stagnate, fragment or collapse.
- Mythology and cultivation packs provide potential rules only. They do not
  pre-create deities, sects, techniques or cultivators.
- Observation, focus and map layers are projections. They cannot change the
  authoritative world. Carbon and oxygen overlays plus local chemistry values
  make the planetary feedback cycle directly observable.
- The substance map layer shows regional richness. Region and organization
  reports list local materials, while each substance report exposes composition,
  properties, formation route, provenance, discoverers and parent materials.
