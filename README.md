# Virtual Earth

[![CI](https://github.com/SueJianjian/virtual-earth/actions/workflows/ci.yml/badge.svg)](https://github.com/SueJianjian/virtual-earth/actions/workflows/ci.yml)

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

For a hardware-accelerated desktop run on Windows, use:

```powershell
npm run desktop
```

The desktop shell runs as a tray application. Closing its window hides it and
keeps the simulation Worker running without browser background throttling. Use
the tray icon to reopen the observer or choose `Exit and save` to checkpoint
the latest world before quitting. This keeps the world evolving while the
computer is powered on; a powered-off computer cannot execute the simulation.
When the computer starts again, opening the desktop app restores the latest
checkpoint and resumes autonomous evolution.

To create a portable Windows executable, use `npm run desktop:dist`. The
desktop shell loads the same production build, keeps Node APIs out of the
renderer, and leaves WebGL hardware acceleration enabled. It improves window
stability and avoids browser-tab throttling; actual frame rate still depends
on the computer's GPU and available memory.

## Verify

```powershell
npm run test
npm run build
npm run test:e2e
npm run benchmark
npm run benchmark:dense
npm run benchmark:dense:default
npm run benchmark:soak
```

`npm run benchmark` checks the normal autonomous formation path against a
10 ms/step budget. `npm run benchmark:dense` first warms up a formed world for
1,000 steps on a compact 16x8 grid, then checks a fully active ecological and
social world against a 60 ms/step budget. `npm run benchmark:dense:default`
runs the same active state on the default 96x48 map; the benchmark copies the
warmup environment window into the larger deterministic planet before timing,
so grid cost changes without relying on a second seed to independently reach
the same history. Dense runs fail unless they actually exercise ecological
relationships, at least 64 individuals, personal relationships, culture and
knowledge, cities and states, facilities, and disease. Timed runs are split
into four segments and fail when the later segments exceed the configured
slowdown ratio, so a passing average cannot hide steadily increasing step cost.
`npm run benchmark:soak` extends the default-map dense run to 1,000 timed
steps for release and long-running stability checks. All
benchmark commands also fail when the budget is exceeded or when they find
non-finite values, unbounded hot events or detailed agents, duplicate
resource entries, unbounded per-organization archive indexes, or dangling
relationship, organization-member, diplomatic, resource-holder and
parent-material references. They also enforce the bounded original-substance
catalog, pathogen catalog, per-agent infection and immunity limits,
population-record ceiling and active knowledge catalog. The causal
milestone archive is bounded as well: it preserves early anchors and recent
key events without retaining an ever-growing event list.
Lifetime counters use saturating arithmetic at JavaScript's safe-integer limit,
so archived history, discoveries, disease totals and practice statistics cannot
overflow during continued operation.
Their JSON output includes collection sizes, peak counts,
archived and total event counts, per-stage timings, the slowest stage and the
final authoritative digest.

These are repeatable regression gates for continued operation rather than a
promise tied to one calendar year. Long-run integration tests additionally
check collection bounds and reference integrity at regular intervals while all
simulation subsystems are active.
The authoritative clock has no special stop at year 3479 and no project-defined
year horizon. It stores total simulation steps and whole simulation days as
JSON-safe decimal strings, so progression remains exact after JavaScript's
safe-integer range; the legacy numeric fields become bounded compatibility
projections only. Events carry the exact step used for identity, ordering and
duration checks, and the exact timeline is restored with a save. Invalid time
steps and malformed timeline values are rejected before mutation or load.
Remote-era regression coverage starts at year one billion and boundary coverage
crosses the safe-integer limit while verifying daily progression and save
restoration. Resource and facility ledgers are canonicalized and bounded at
each commit so long-lived accounts cannot grow without limit.
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

Steady environmental steps also reuse the climate grids they produce, normalize
new hydrology grids in place, skip no-op hazard copies and project dense
chemistry patches plus local effects through one clone. An ordinary step
therefore avoids eleven full-grid intermediate copies without reducing map
resolution or changing the deterministic world digest.

Annual individual and society stages share one food-balance index while they
read the same immutable organization and resource snapshot; replacing either
collection invalidates the cache. Environmental energy conversion walks
only regions that actually possess energy knowledge, in stable map order, and
completed ocean or prebiotic milestones no longer rescan the global grids each
year. These paths reduce mature-world work without lowering simulation or
rendering resolution.

Autonomous timing uses absolute deadlines. Simulation work therefore does not
silently extend the configured one-real-minute-per-simulated-day interval. If
a busy or backgrounded tab falls behind, the Worker catches up by at most
eight days, discards older wall-clock debt, and then resumes its normal
deadline. A long browser or computer suspension therefore cannot trigger an
unbounded catch-up loop. State digests are streamed directly over canonical state values,
preserving the previous deterministic digest while avoiding a full JSON copy
 of every grid.
The Worker also emits a bounded browser checkpoint every 120 simulation steps
and when the page is hidden. The page stores the newest checkpoint in both
`localStorage` and IndexedDB when available, restores it after a refresh, and
then resumes autonomous evolution. `localStorage` is used as a fast path;
IndexedDB is the larger persistent mirror and is used when the fast cache is
full or malformed. The persistence line below the save controls reports the
recovery source, payload size, and whether the point is restoring, saved,
unavailable, or cleared. If the fast browser cache is malformed, a valid
IndexedDB mirror is tried before the checkpoint is discarded.
A malformed manual import leaves both the active world and its previous
recovery point intact. Browser storage failures (including quota exhaustion)
do not interrupt the simulation, and the visible warning makes the missing
recovery point clear.
Manual saves also become the newest recovery point, while reset explicitly
clears it. This protects long-running worlds from ordinary page reloads without
attempting to replay unbounded wall-clock debt.

## Simulation rules

- A new world contains no species, populations, agents, families, cultures,
  organizations, mythology entities or cultivation entities.
- Environment initialization is derived from generated terrain. Water and
  nutrients then evolve through field deltas and chemistry changes.
- Every seed receives an independent, classically bounded orbital period,
  axial tilt, eccentricity, periapsis, stellar flux and rotation period. The
  central star remains fixed, the planet follows its elliptical orbit, and its
  moon follows a nested planet-relative orbit. Exact simulated days derive the
  current orbit and the matching four-season cycle, so opposite hemispheres receive
  opposite seasonal forcing and local reports can show the current climate
  driver. Greenhouse carbon, ocean thermal inertia and humidity complete the
  deterministic climate loop. Slow tectonics, erosion and deposition alter
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
- Adaptive diversity limits apply to simultaneously living species rather than
  the historical catalog. Extinct lineages remain available to reports, while
  a vacated ecological niche can produce a new traceable descendant instead of
  permanently freezing evolution after the first few species appear.
- Mobile populations can migrate toward better adjacent habitats, with agent
  locations following the population delta and a causal migration event.
- Food, ecological and governance pressure can also move a settlement, city or
  larger polity to a better adjacent region. Organization migration carries
  independent detailed members, represented population and held resources
  through the same ledger, relinquishes the old territorial center, and records
  the reason and destination for map routes and reports. Shared members remain
  with their other active organizations so hierarchical societies stay intact.
- Producer populations mint food through the resource ledger. Society rules
  allocate, trade and consume food with conservation checks and auditable
  transactions; organization conflict, fragmentation and dissolution remain in
  the event history.
- Interregional food, material and energy routes derive from shared borders or
  established diplomacy. A successful neutral shipment establishes a bilateral
  trade relation immediately, so later cargo in the same cycle receives the
  negotiated route capacity without mutating the prior world snapshot.
- Held food now feeds back into member food needs through bounded per-capita
  security. Hunger, fertility and mortality therefore respond to conserved
  organization balances instead of an unrelated global counter.
- Food security also biases family formation, can make a better-supplied
  neighboring region attractive to mobile populations, and reduces the
  effective capacity of large organizations under persistent shortage.
- Original pathogens can emerge from local chemistry, moisture, temperature
  and host density without a scripted date. Infection spreads through local
  prevalence and individual relationships; recovery leaves bounded immunity,
  while severe disease lowers vitality and contributes to auditable deaths.
- The same pathogen can establish distinct regional outbreaks when infected
  carriers migrate or when trade, population movement and wartime displacement
  connect regions. Each outbreak keeps its own status, prevalence and detection
  history; a pathogen retains at most 32 regional records, preserving its origin
  and active outbreaks before dormant history.
- Medical knowledge and staffed medical facilities reduce transmission,
  severity and mortality. Pathogen, infection and immunity records remain
  bounded, and invalid host references are removed after extinction so public
  health cannot become an unbounded long-run ledger.
- The pathogen catalog limits simultaneously active disease rather than
  permanently reserving every slot for dormant history. Once the catalog is
  full, a newly emerged active pathogen can displace the oldest dormant record,
  preserving continued epidemiological evolution under the same fixed bound.
- Canonical pathogen records are deep-copied directly into each annual health
  step instead of repeatedly rebuilding and sorting their regional histories.
  Legacy or malformed saves still take the full normalization path, and every
  authoritative commit revalidates outbreak order, status and summary totals.
- Organization rules are independent for clan, tribe, settlement, city, state,
  federation and empire. Higher-order organizations retain child organization
  IDs and recruit current local members during governance.
- Children can inherit knowledge and beliefs from both parents. Births preserve
  parent, caregiver and sibling links so long-running worlds retain
  deterministic, auditable family lineages. A partner who dies in the current
  lifecycle step cannot participate in a later birth from that same step.
- Detailed individuals also carry a fixed-size genetic lineage record. Births
  recombine nine bounded heritable traits from both parents, use the species'
  mutation rate and inheritance fidelity for deterministic mutations, and
  record generation, lineage signature and parent divergence. Metabolic
  efficiency, thermal tolerance, hydration retention and disease resistance
  affect hunger, climate survival, reproduction and infection outcomes rather
  than remaining descriptive labels. Selected local trait averages feed back
  into adaptive species divergence, connecting family-scale inheritance to
  long-term ecological evolution without an unbounded genome ledger.
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
- Persistent diplomacy and both recent and archived interregional events
  project into bounded strategic routes. Trade, alliances, migration and
  conflict retain cumulative counts, amounts and exact first/latest times
  after hot-ledger compaction, while fixed archive limits prevent route history
  from growing with world age. Individual zoom still keeps only local kinship,
  care and teaching links visible.
- The substance map layer shows regional richness. Region and organization
  reports list local materials, while each substance report exposes composition,
  properties, formation route, provenance, discoverers and parent materials.
- The epidemic map layer exposes regional prevalence. Region, individual,
  organization and pathogen reports show vitality, active infections,
  immunity, host lineage, transmission, severity, cumulative cases,
  recoveries and deaths.
