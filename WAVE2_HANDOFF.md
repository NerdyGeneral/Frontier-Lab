# Wave 2: Strategic company

This release extends the existing deterministic game and its Paperclips-style screen.

## Implementation ownership

- Lab lane: training/data/research modules, `wave2-lab` contracts and authored content.
- Infrastructure lane: compute, infrastructure, pools, resource conservation, `wave2-infrastructure` contracts/content.
- Interface lane: compact panels, styling, browser persistence and save backups.
- Coordinator: shared contracts, market/products/rivals, migration, cross-domain validation, integration and publication.

## Shared integration rules

Schema 3 / content 0.3.0. Historical schema 1 and 2 saves must validate before additive upgrade. No change to historical player cash, week, ledger, lineage, queued commands, or random streams during upgrade.

All companies use the same ledger, staff grants, compute pools, commands, and market accounting. Rivals receive authored scenario starting assets once. Their planners propose normal commands during the plan phase. Private rival project messages are filtered by company ownership.

Messages should include `companyId`; use `public: true` only for an intended market announcement. Resource requests use `poolId: 'auto'` when any compatible connected pool is eligible. Pool memory is never summed across unrelated locations. Owned energy charges apply to physical work executed; cloud rent is inclusive.

## Playable scope

- Owned general, memory-rich and training racks; delivery, installation, parking, infrastructure staffing, variable GPU costs, standard six-stage facilities.
- Purchased specialist/broad/behavior data, source-aware evidence, curation, adaptation and foundation recipes, saved training profiles, evaluations and behavioral outcomes.
- Research R1, R2, R3, R4, R5, R1A and R5A, each with a real application and separate staff/compute meters.
- Four consumer segments, a developer API, token costs and token-metered API revenue, memory/context/reasoning options, product replacement, finite market competition and three seeded rival companies.

Private enterprise licensing, agent work, retrieval/compression/routing applications, sparse networking, custom chips and endings remain explicitly planned. Harbor's existing business offer is a disclosed scenario advantage; the player's private-enterprise gate is not bypassed.

## Acceptance

Opening first sale still works. Every additional GPU, model, feature, project and customer changes a real resource or invoice. Customer populations conserve within each market. No unearned rival income, free research completions, unsaved training rerolls, or cross-company journal leakage. Old snapshots remain readable and raw browser saves are backed up before migration.
