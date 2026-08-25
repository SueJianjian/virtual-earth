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
through a Web Worker. Controls submit commands or external events; they do not
mutate authoritative state directly.

## Verify

```powershell
npm run test
npm run build
npm run test:e2e
npm run benchmark
```

The benchmark reports grid size, step count, average step time, entity counts,
event count and the final authoritative digest.

## Simulation rules

- A new world contains no species, populations, agents, families, cultures,
  organizations, mythology entities or cultivation entities.
- Environment initialization is derived from generated terrain. Water and
  nutrients then evolve through field deltas and chemistry changes.
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
- LOD summaries preserve region resources, organization history, source agent
  IDs and relationship records for deterministic read-only projections.
- The region inspector exposes household lineages, generation depth, kinship
  composition and descendant knowledge or belief carriers in both live micro
  projections and conserved aggregate summaries.
- The same seed and commands reproduce the same digest and event history.
  Different seeds may remain sterile, diverge, stagnate, fragment or collapse.
- Mythology and cultivation packs provide potential rules only. They do not
  pre-create deities, sects, techniques or cultivators.
- Observation, focus and map layers are projections. They cannot change the
  authoritative world.
