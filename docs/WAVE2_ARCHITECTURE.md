# Frontier Lab — Wave 2: strategic company

Wave 2 extends the first-sale game into a company strategy simulation: research methods, distinct training evidence, model families, training profiles, behavioral evaluation, segmented customers, metered API service, operating rivals, purchased GPUs, and staged data-center construction.

The delivered build and content version are **0.3.0**; save schema is **3**. The Wave 0 and Wave 1 documents remain historical records of their releases. Build, test, browser, and publication evidence is recorded separately in `WAVE2_ACCEPTANCE.md`.

All economics, AI capability scores, hardware quantities, token rates, and customer populations are authored game parameters. No external model runs, real GPU orders, payments, or business messages occur. The simulation executes in the browser, and saves remain local to that browser unless the player exports them.

## Delivered scope

| Playable in Wave 2 | Explicitly later work |
| --- | --- |
| Research projects R1, R2, R3, R4, R5, R1A, and R5A | The other research catalog entries and late-game endings |
| Specialist packs, distinct broad corpora, preparation, and curated revisions | Data marketplaces, negotiated private licenses, and feedback collection programs |
| Conversation, document, coding/tools, foundation, reliability, and calibration recipes | Sparse architecture, custom chips, distillation families, and autonomous research assistants |
| Compact, medium, and large dense model families | Architecture search and custom accelerator design |
| Basic, expanded capability, and behavioral held-out suites | Broad adversarial evaluation, security incidents, and general goal-directed misalignment |
| Basic Chat across four consumer segments and a developer API | Player business/private deployments, weight licensing, agents, and workflow products |
| Three authored rivals with operating budgets and normal command admission | Multiplayer, complete strategic planning, and a balanced long campaign |
| General, memory-rich, and training GPU racks; colocation and standard data centers | Efficient sites, resilience upgrades, fast fabric, and custom hardware |

Later catalog entries are labeled planned and are not executable player projects. Harbor's inherited business product and certification are scenario assets; their presence does not unlock the player's later business research.

## Module boundaries

| Source | Responsibility |
| --- | --- |
| `src/contracts/types.ts`, `wave1.ts`, `wave2-lab.ts`, `wave2-infrastructure.ts`, `wave2-market.ts` | Shared typed commands, durable records, resource requests, and views |
| `src/core/engine.ts`, `foundation-modules.ts` | Atomic weekly transactions, module ordering, command admission, revalidation, and journals |
| `src/content/catalog.ts`, `wave2-lab.ts`, `wave2-infrastructure.ts`, `wave2-market.ts` | Authored research, recipes, profiles, datasets, hardware, construction, and customer assumptions |
| `src/modules/company.ts`, `workforce.ts` | The company slice, shared staff grants, salaries, and the sole cash/ledger writer |
| `src/modules/compute.ts`, `compute-pools.ts`, `infrastructure.ts` | The compute slice, placement, physical/effective work, racks, sites, infrastructure operations, and cost facts |
| `src/modules/lab.ts`, `lab-data.ts`, `lab-planner.ts`, `lab-math.ts`, `lab-evaluation.ts` | The data/model slices, corpus provenance, immutable training plans, checkpoints, and evaluation evidence |
| `src/modules/research.ts` | The research slice, prerequisite gates, saved project meters, and company-specific knowledge |
| `src/modules/products.ts` | The products slice, deployment, feature options, request/token meters, usage, credits, and invoice facts |
| `src/modules/markets.ts`, `rivals.ts` | The markets slice, finite populations, segmented trials/cohorts, trust, competition, and proposed rival commands |
| `src/modules/campaign.ts` | Milestones derived from completed work and posted receipts |
| `src/core/selectors.ts` and module view helpers | Read-only forecasts and UI views; they do not mutate the simulation |
| `src/core/validation.ts`, `wave1-validation.ts`, `wave2-lab-validation.ts`, `wave2-infrastructure-validation.ts`, `wave2-market-validation.ts` | Whole-state, cross-slice, lineage, job, finance, market, and resource invariants |
| `src/core/snapshot.ts`, `migration.ts`, historical validators, `wave2-state.ts` | Snapshot verification, authentic historical upgrades, additive defaults, and one-time rival seeding |
| `src/ui/FrontierLab.tsx`, `panels.tsx`, `lab-panels.tsx`, `product-panels.tsx`, `infrastructure-panel.tsx`, `components.tsx` | The unfolding page, local form drafts, typed commands, shared previews, and explanations |
| `src/persistence/wave0-browser.ts` | Browser save ownership, migration archives, recovery export, and guarded replacement |

Seven registered modules own their declared slices. Infrastructure and pool helpers support the compute owner; rival policy supports the markets owner. These helpers do not create additional writers for durable slices. The React components display shared selectors and catalog values and dispatch commands; they do not run a parallel economy.

## Weekly simulation and accounting

The seven phases remain `commit → reserve → execute → resolve → settle → market → plan`. A completed week is validated as a candidate transaction before replacing the prior state. Invalid commands receive rejections; invalid module writes, impossible grants, arithmetic errors, or failed state invariants discard the candidate transaction.

Commands are queued and revalidated at their due boundary. Upfront quotes reserve available cash without immediately debiting it. Modules emit deduplicated expense or receipt facts, and the company posts them once. Rival policy proposes ordinary commands for subsequent application through the same validation and accounting path.

The ledger retains its recent 200 entries and invoice history has its own bounded window. Recurring fact receipts are retained while referenced by either history or the current week; older recognized weekly receipts expire. One-off purchase, construction, training, and research proof receipts remain. Dated periodic facts must match the actual settlement week, so pruning does not allow an expired bill to be replayed as a new charge. Cumulative company totals remain authoritative beyond the visible history window.

Research uses separate work and staff completion meters. Its method becomes available at the following boundary after both finish. A new training run captures its evidence, recipe, family, targets, methods, profile, and work requirements; a later research completion does not rewrite an existing run. Completed product deployment and infrastructure installation also respect their availability boundaries.

Money is integer cents. CU, CUw, MU, FTE, and staff-weeks use 1,000,000,000 stored units per displayed unit. Scores and rates use basis points. Data-unit counts are ordinary integers, while relevant evidence in training calculations uses fixed-point units. Saved fractional carries prevent small weekly quantities from disappearing through repeated rounding.

Physical GPU work and effective useful work are distinct. Hardware efficiency changes how much effective work a physical grant can perform; invoices and physical operating costs must use the appropriate meter. A quoted cost, allocated category, or resource request does not itself count as completed work.

## Research and its applications

`getResearchView` returns company-specific available, locked, active, paused, pending, complete, or planned entries. Completing research unlocks an application; it does not directly grant capability, prepared data, free hardware, or a deployed product.

| ID | Method | Prerequisites | Entry fee | Staff effort | Research work | Concrete application |
| --- | --- | --- | ---: | --- | ---: | --- |
| R1 | Evaluation suite | None | $1,000 | 2 research weeks | 2 CUw | Expanded 100-case capability suite |
| R2 | Data curation | R1 | $2,000 | 3 data weeks | 4 CUw | Separate quality-revision jobs |
| R3 | Checkpoint automation | None | $1,500 | 2 ML weeks | 2 CUw | Optional 10% checkpoints in future runs |
| R4 | Efficient adaptation | R2 | $4,000 | 4 ML weeks | 6 CUw | 25% less update work for eligible new adaptation recipes |
| R5 | Preference tuning | R1, R2 | $4,000 | 3 research weeks | 8 CUw | Reliability/behavior recipe |
| R1A | Behavior cases | R1 | $1,500 | 2 research weeks | 4 CUw | Separate 100-case behavior suite |
| R5A | Calibration curriculum | R5, R1A | $3,000 | 4 research weeks | 8 CUw | Calibration recipe for a new candidate |

The source catalog is authoritative for names and coefficients. Payroll and rented compute continue while research proceeds, and entry fees exclude both. Role requirements compete with the same company's other staff work. Pausing preserves research effort and releases subsequent requests.

The UI reveals Research after prepared data exists, shows no more than five available methods, and folds completed research and future branches into native details sections. Running projects show both staff and work meters with their current bottleneck.

## Data evidence and rights

The original prepared starter sample remains the opening evidence. Four specialist packs cover conversation, documents, coding, or tools. Each costs $6,000, contains 120 raw units at quality 90, and needs two data staff-weeks to prepare. Its principal domain has full coverage and the other domains have 20% coverage; each pack also supplies 100 behavior units.

Three distinct broad-corpus editions each cost $10,000, contain 500 raw units at quality 80, provide 60% domain coverage, and require four data staff-weeks to prepare. Their distinct source identities make them useful for foundation evidence requirements. Buying or preparing a copied display record does not create a new underlying source.

Curation requires R2 and a separate three-data-staff-week job. It produces a new immutable revision with quality increased by 10 points, capped at 95. Underlying source count, coverage, and rights remain unchanged. A corpus that includes several revisions of the same source counts that source once, using the best selected revision's quality. Preparation and curation are real projects, and unfinished evidence does not become usable early.

Training captures the selected corpus and intersects its rights. Hosted release must retain hosted-use rights. Weight distribution and feedback-reuse permissions are tracked even though player weight licensing and feedback programs are later products. Preparing or training does not invent rights.

## Model design and training

The recipe selects a task and, for foundations, a new model family. Adaptation retains the base family. The player selects a saved base model, primary packet, optional additional prepared evidence, a profile, and optional checkpoint automation. `getTrainingPreview` displays workspace, work, design effort, evidence, projected ranges, and admission reasons from the same planner used by the simulation.

| Recipe | Base update work | Entry fee | Additional design effort | Evidence / design constraint |
| --- | ---: | ---: | ---: | --- |
| Conversation adaptation | 12 CUw | $0 | None | 100 relevant units; task-specific finite targets |
| Document adaptation | 24 CUw | $0 | None | 100 relevant units; other domains may regress |
| Coding and tools adaptation | 48 CUw | $0 | None | 120 relevant units; one coding packet has limited tool coverage |
| Medium foundation | 240 CUw | $20,000 | 6 research staff-weeks | Two evaluated released versions, 500 broad units, 250 relevant units/domain, 100 behavior units |
| Large foundation | 900 CUw | $70,000 | 20 research staff-weeks | Two evaluated released versions, 1,500 broad units, 750 relevant units/domain, 100 behavior units |
| Preference and reliability tuning | 16 CUw | $0 | None | R5 and 100 behavior units; reliability target 94 |
| Calibration curriculum | 16 CUw | $0 | None | R5A and behavior evidence; halve the saved lineage's confident-error target |

Profile and research modifiers can change new-run work. Foundation admission requires at least one assigned researcher FTE, and design effort must finish before training compute begins. Staff supervision, complete connected workspace, and development allocation remain independent constraints.

| Family | Resident weights | Foundation workspace | Serving work multiplier | Capability ceiling: conversation / documents / coding / tools |
| --- | ---: | ---: | ---: | --- |
| Compact | 2 MU | Opening adaptation uses 4 MU | 1× | 70 / 65 / 65 / 60 |
| Medium | 8 MU | 24 MU | 2× | 85 / 85 / 85 / 80 |
| Large | 24 MU | 72 MU | 4× | 95 / 95 / 95 / 95 |

Only dense architecture is executable. Family ceilings are limits, not free trained scores. Work, evidence relevance, quality, targets, and lineage determine the completed result.

The original Seed 0 + starter packet + conversation recipe defaults to an explicit **Reference opening** option. It omits profile variance and preserves the authored conversation-48 / reliability-86 result after full work with prepared data. Players can choose a variable profile instead. If the recipe, base, or corpus changes while Reference opening is selected, the UI uses Balanced; the reference option is only offered for the exact opening combination.

Stable training uses 10% more update work and a saved outcome adjustment within ±1 point. Balanced uses normal work and ±3 points. Ambitious uses 40% more work, one higher target tier capped by family ceilings, and ±5 points. The saved training identity fixes outcomes so rerunning identical work is not a free reroll. Behavior and calibration recipes use their fixed method instead of capability-profile variation.

R3 makes eight additional checkpoints available at 10% intervals. Each costs 0.25 development CUw; the basic midpoint and final versions already exist. Checkpoint overhead is distinct from useful training-update work. R4 applies its 25% reduction only to eligible future adaptation work; it does not reduce serving costs, existing jobs, or foundation compute.

Capabilities use finite lineage anchors and recipe targets. Reusing identical evidence does not stack the same improvement repeatedly. New foundation training starts a new foundation identity with its own anchor rather than adding another unrestricted gain to the current model.

## Evaluation, calibration, and behavior

Basic conversation evaluation uses 20 cases, two development CUw, and half a research staff-week. R1's expanded suite uses 100 cases across four capability domains, four development CUw, and one research staff-week. R1A's behavior suite also uses 100 cases, four CUw, and one research staff-week.

Each completed suite creates retained held-out evidence for the model. Existing reports are not rerolled, and running an evaluation does not change model weights. The behavior suite distinguishes useful answers, confident errors, false refusals, clarifications, and correct policy refusals. Adding behavioral evidence does not erase a capability report used for release. The model inspector reports aggregate release eligibility across its retained capability reports, even while a behavior suite is selected.

Model behavior stores separate confident-error and false-refusal tendencies. Preference tuning targets reliability; calibration reduces confident errors by redirecting those responses toward clarification. It does not create free correct answers or raise saved useful-answer capability. Product usage exposes these behavioral rates separately from its technical execution-error rate, and behavior feeds retention/trust consequences.

These systems provide a concrete early model-behavior loop. Autonomous goals, deceptive planning, security incidents, evaluation gaming, and general misalignment are not claimed as implemented.

## Products, request meters, and billing

The player may operate one Basic Chat offer and one Developer API offer. Each has a distinct product, deployment, contract, model reference, usage meter, and invoice history. Product model replacement requires one ML staff-week and interrupts service during deployment; subscriptions receive credits for the unavailable service. Inspecting a model in the UI does not change a deployment.

Basic Chat requires held-out release evidence, conversation at least 45, reliability at least 65, and hosted-use rights. The API requires evaluated coding at least 50 and reliability at least 80. Business/private deployment remains behind the player's later R12 gate.

A standard request has 500 input tokens and 100 output tokens. Baseline work is 0.0002 CUw for a compact model. Input work costs 0.0002 CUw per 1,000 tokens; output and internal reasoning work cost 0.001 CUw per 1,000 tokens. The family multiplier applies once, and actual physical work then depends on the hardware grant.

| Product option | Serving cost change | Delivered customer effect |
| --- | --- | --- |
| Conversation memory | Adds 100 input tokens before any context multiplier | Regular, heavy, and professional consumer conversion improves 5%; their baseline churn falls 25% |
| Extended context | Doubles input tokens; session memory rises from 0.02 to 0.08 MU per active account | Adds 5 effective task-score points for professional, developer, and business workloads |
| Deep reasoning | Adds 200 internal tokens | Adds 10 effective task-score points, subject to the task-score cap |

These options change serving behavior without changing the model's saved weights. Extra tokens can increase both API revenue and cost, and a higher bill can reduce price fit. A larger session-memory requirement can become the binding constraint before compute is exhausted.

Chat is a weekly subscription with a 25–500 exchange allowance. Each segment requests up to its typical usage or the allowance, whichever is lower. Gross billing is accounts multiplied by weekly price; missing paid service receives proportional credits. Failed answers still consume work and affect retention separately from capacity credits.

The API uses a 25–5,000 request limit and a reference bill for 600 standard requests. With the default $60 reference bill, rates are **$100 per million input tokens** and **$500 per million output/internal tokens**. Only executed paid tokens are invoiced; free trials and unserved requests are not billed. Internal reasoning uses the output rate. These deliberately fictional rates belong to this game's economy.

Usage records show baseline demand, effective work served, actual physical work, paid input/output/internal tokens, owned GPU variable cost, service fulfillment, behavior, gross billing, credits, and collected revenue. Infrastructure and company accounting charge actual owned GPU work once; product cost views do not create another charge.

## Segmented finite markets

| Segment | Population | Typical requests / week | Reference weekly bill | Principal requirements |
| --- | ---: | ---: | ---: | --- |
| Casual consumers | 1,800 | 50 | $8 | Conversation 45, reliability 65, error tolerance 20% |
| Regular consumers | 1,400 | 100 | $12 | Conversation 48, reliability 65, error tolerance 18% |
| Heavy consumers | 600 | 300 | $18 | Conversation 50, reliability 65, error tolerance 15% |
| Professional consumers | 200 | 200 | $30 | Conversation 60, documents 55, reliability 90, error tolerance 8% |
| Developer accounts | 400 | 600 | $60 | Coding 50 and reliability 80; metered API |
| Business organizations | 80 | 3,000 | $300 | Later player product; inherited Harbor product remains in the scenario |

Consumer individuals, developer accounts, and business organizations remain separate markets. All providers' active cohorts and trials consume the same finite segment populations. Departed accounts and failed trials return to the available outside pool at the next weekly boundary. A competitor's acquisition therefore changes the outside population available to the player.

Consumers shop at 3% of outside population per week, developers at 2%, and businesses at 1%. Base reach is 20 consumer trials or three developer trials; granted commercial work adds reach. The company's commercial capacity is shared across products. Admission also checks the next-week serving and memory forecast.

Conversion starts from 45% and is modified by task fit, price, service, allowance, trust, and applicable product options, then bounded to 5–80%. Trials consume real work, and newly converted accounts start paid service at the following boundary. Churn, retention, and trust respond to operating outcomes. Aggregate error rates are simulation expectations; the game does not call a real LLM to generate individual consumer conversations.

## Rivals and authored starting assets

`seedRivals` creates three established companies once. Starting models, prepared data, evaluated reports, trained staff, cash, research, products, and customer cohorts are explicit scenario assets. They are not periodic free grants and do not represent a simulated prehistory.

| Company | Starting focus | Starting cash | Cloud CU | Starting customers | Policy interval |
| --- | --- | ---: | ---: | ---: | ---: |
| Atlas Systems | Medium-model consumer platform | $180,000 | 16 | Up to 250 consumers across four segments | 8 weeks |
| Swiftworks | Compact coding API | $90,000 | 8 | Up to 40 developer accounts | 4 weeks |
| Harbor AI | Inherited private-document business | $120,000 | 8 | Up to 8 organizations | 6 weeks |

When importing a mature run, scenario cohort admission respects space left in each finite population. Rivals subsequently pay the same rent, payroll, research, training, deployment, and usage expenses as ordinary companies. Policy protects reserves and service, continues already-funded work, proposes research and behavior training, evaluates candidates, deploys suitable replacements, and adjusts published terms. It is a bounded heuristic, not an omniscient optimizer.

Rival policy emits regular commands, and the engine quotes, validates, and applies them. It does not directly mint a better model or debit another slice. The public view exposes released product information and public activity. Private candidate details, cash, staff commands, and unpublished training results do not belong in the player's UI. A public model reference retains the last release through an upgrade.

## Owned compute and facilities

Every ordered rack contains eight nominal CU, takes six weeks to arrive, and needs one infrastructure staff-week to install. Delivery alone creates inventory, not usable capacity. Installed racks require operating staff. Parking can reduce active power and cooling demand while installed upkeep continues.

| GPU rack | Purchase | Nominal memory | Training / serving efficiency | Variable cost / physical CUw | Power per nominal CU |
| --- | ---: | ---: | ---: | ---: | ---: |
| General | $18,000 | 16 MU | 1× / 1× | $50 | 1 |
| Memory-rich | $27,200 | 32 MU | 1.1× / 1× | $55 | 1.1 |
| Training | $32,000 | 16 MU | 1.8× / 1.1× | $75 | 1.6 |

Colocation costs $160 per installed rack-week and requires 0.25 infrastructure FTE per rack. A standard owned site costs $240 per operational week plus $5 per installed CU-week, and requires 0.25 base infrastructure FTE plus 0.25 FTE per 16 installed CU. Actual owned physical GPU work adds the variable charge in the table. General cloud rent remains $200 per reserved CU-week, including energy and idle time.

A standard data center provides 64 nominal CU of installed rack slots and power/cooling envelopes of 64 units. These are separate constraints: enough slots does not guarantee enough power for training hardware. Staff coverage, power, and cooling reduce usable owned capacity and memory. Each job must fit a single connected pool; cloud, distinct sites, and different hardware classes do not combine their memory. Training spanning multiple owned racks uses a 70% fabric multiplier until later networking work exists.

| Construction stage | Payment | Minimum calendar | Infrastructure effort |
| --- | ---: | ---: | ---: |
| Site reservation | $4,000 | 2 weeks | 0.25 staff-weeks |
| Site preparation | $4,000 | 2 weeks | 0.5 staff-weeks |
| Shell | $12,000 | 6 weeks | 0.75 staff-weeks |
| Power and cooling | $14,000 | 6 weeks | 1.5 staff-weeks |
| Network and storage | $4,000 | 2 weeks | 0.5 staff-weeks |
| Acceptance | $2,000 | 2 weeks | 0.5 staff-weeks |
| **Total** | **$40,000** | **20 weeks minimum** | **4 staff-weeks** |

Each stage must be funded separately and complete both its calendar and staff meter. Pausing or a staff shortage can extend the timeline. Commissioning does not purchase GPUs. Sites and racks retain individual identities, destination, costs, status, and progress so save/load and later expansion can preserve actual commitments.

## UI, saves, and release limits

The page retains three compact desktop columns, ordinary buttons, thin rules, short tables, and native details elements. It becomes a single-column page on narrow screens. No new dashboard framework or asset package was added. Research unfolds after data preparation, public competition after the first candidate, and API/infrastructure after the first sale; existing products and infrastructure also keep their sections visible.

Shared action previews show why an action is unavailable, upfront costs, recurring changes, and available cash after commitments. Local form drafts survive simulation ticks. Labels distinguish capacity, effective work, physical work, memory, and staff; blocked projects display their actual limiting resource. Later research and products remain explicitly planned.

Schema 3 retains the existing primary key, `frontier-lab.wave0.snapshot`, and writer lock, `frontier-lab.wave0.writer`, so an upgrade finds the prior browser run. Checksum verification and historical validation precede migration. Valid schema-1 and schema-2 saves upgrade without advancing the week; original commands, historical records, and saved work are carried through supported migration paths while Wave 2 state is initialized.

Before the first upgraded primary write, the adapter archives exact schema-1 bytes under `frontier-lab.wave0.original` or schema-2 bytes under `frontier-lab.wave1.original`. Existing originals are retained. If the archive write fails, the primary is not replaced. Explicit import/new-lab replacement also saves the previous raw run before writing a replacement. Corrupt, empty, or unknown-version stored input blocks automatic overwrite and remains available for exact-byte export.

Only the browser tab holding the writer lock advances or saves the run. Missing storage or coordination falls back to explicit memory-only play and export. Imports are reviewed while the clock is paused, the page pauses when hidden, and there is no offline catch-up. Saves are not synchronized to an account or other device.

Import and serialization share a 2 MB UTF-8 byte limit. An oversized current state is rejected before any browser write, so a save that cannot be read back does not replace the prior usable primary. The UI reports the specific size limit instead of promising a successful export.

This release establishes connected systems and regression-tested invariants. It does not claim long-campaign balance, complete competitor intelligence, production financial realism, real LLM behavior, or the later agent/chip/licensing game. Those remain separate design and implementation work.
