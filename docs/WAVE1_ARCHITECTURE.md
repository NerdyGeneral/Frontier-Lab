# Frontier Lab — Wave 1: first sale

Wave 1 implements the first complete customer loop: prepare data, hire and assign people, adapt a model, evaluate it, deploy Basic Chat, serve trials and subscribers, and collect a correctly credited subscription invoice. The page retains the sparse Universal Paperclips style. All AI behavior is simulated locally; there are no model API calls or paid external services.

This document records the delivered rules and the boundaries that future waves must preserve. Schema is **2**, content is **0.2.0**, and build is **0.2.0**. The historical Wave 0 architecture and acceptance documents remain unchanged. Build, test, browser, and publication evidence belongs in the Wave 1 acceptance document.

## Source and state ownership

| Source | Ownership and responsibility |
| --- | --- |
| `src/contracts/types.ts`, `wave1.ts` | Commands, resource requests and grants, domain records, reports, quotes, and read-only game views |
| `src/core/engine.ts` | Command admission and revalidation, seven weekly phases, atomic transactions, frozen handler inputs, receipts, and journals |
| `src/core/foundation-modules.ts` | Registry of the six active modules; it now wires complete domain modules rather than the historical foundation adapters |
| `src/modules/company.ts`, `workforce.ts` | The `company` slice: hires, onboarding, founder and employee assignments, staff grants, and the only financial ledger writer |
| `src/modules/compute.ts` | The `compute` slice: general cloud rentals, category budgets, workspace placement, physical grants, rent, and inventory deliveries |
| `src/modules/lab.ts` | The `data` and `models` slices: preparation, finite adaptation, checkpoints, evaluation runs and reports, and model release boundaries |
| `src/modules/products.ts` | The `products` slice: offers, deployments, contracts, service requests, usage, service credits, and invoice facts |
| `src/modules/markets.ts` | The `markets` slice: the finite consumer market, trials, conversion, renewal cohorts, churn, and acquisition limits |
| `src/modules/campaign.ts` | The `campaign` slice: milestones earned from completed work and actual posted revenue |
| `src/core/resources.ts`, `math.ts`, `random.ts` | Independent resource checks, safe fixed-point arithmetic, and saved named random streams |
| `src/core/selectors.ts` | Read-only costs, runway, progress, bottlenecks, training forecasts, and the next milestone |
| `src/core/validation.ts`, `wave1-validation.ts` | Complete-state and cross-slice invariants before and after transactions and snapshot operations |
| `src/core/snapshot.ts`, `migration.ts`, `legacy-validation.ts` | Checksummed envelopes, authentic Wave 0 validation and upgrade, and validation of the upgraded state |
| `src/ui/FrontierLab.tsx`, `panels.tsx`, `components.tsx` | The three-column game page, previews and action controls; economic rules stay in the core and modules |
| `src/persistence/wave0-browser.ts` | The existing local save key, single writer lock, original-save backup, import/recovery, and browser storage failures |

The `research` and `agents` slices remain placeholders without active execution modules. `CONTENT` in `src/content/catalog.ts` is the authority for game coefficients. A visible catalog entry does not imply that its project or hardware class is implemented.

Model, training run, evaluation report, product, deployment, contract, invoice, and customer cohort identities remain separate. A module may replace only the slices it declares in `owns`. Other modules communicate through commands, facts, resource requests, scheduled boundary items, and saved domain records.

## Weekly transaction and availability

Every displayed week is a complete candidate transaction. Handlers receive frozen snapshots. Invalid facts, foreign slice writes, impossible grants, exceptions, or an invalid completed state discard the candidate week and its random draws. The caller retains the original state.

| Phase | Delivered behavior |
| --- | --- |
| `commit` | Process due equipment/model releases, onboarding boundaries, and product activation. Then revalidate and apply due queued commands in order. |
| `reserve` | Collect every module's requests. The company grants staff first; compute grants physical work and memory second. |
| `execute` | Consume the complete resource frame, advance project meters, produce usage, and emit overhead, payroll, and rent facts. |
| `resolve` | Materialize completed prepared data, checkpoints, model candidates, and evaluation reports. Completed deployment schedules activation for the following boundary. |
| `settle` | Products emit invoice receipt facts. The company runs last, posts each fact once, and settles receipts before expenses. |
| `market` | Resolve completed/expired trials and churn, create next-week subscribers, and admit next-week trials within the opening market rules. No financial facts are added here. |
| `plan` | Record milestones from the resulting state, including the first positive subscription receipt. |

Preparation, training, and evaluation outputs can appear in `resolve` because their dependent stage cannot reserve or execute earlier in that same week. Deployment has an explicit `readyWeek = completionWeek + 1`; the product and its model become live together at that following `commit`.

Commands are admitted against the current state, queued, and revalidated when due. Previews do not alter state or RNG. Upfront quotes reserve uncommitted cash without debiting it at queue time. Same-boundary expense facts also reduce the funds available to later commands. A rejected command emits no fee. New command IDs are capped at 80 characters so derived IDs fit the shared limit; authentic older stored command IDs up to 160 characters remain valid during migration.

## Units, grants, and bottlenecks

Money is stored as integer cents. CU, CUw, MU, FTE, and staff-weeks use **1,000,000,000 stored units per displayed unit**. Scores, quality, coverage, and rates use basis points; displayed capability 48 is stored as 4800. Safe integer operations and high-precision multiplication intermediates prevent rounding drift or overflow. BigInt is never serialized into game state. Fractional conversion, churn, shopping, and commercial reach carry forward between weeks.

Each workload declares its company, task, pool, category, work, memory, priority, and role demands. Requests are sorted by priority and then request ID. The priorities are:

| Priority | Request | Resource behavior |
| --- | --- | --- |
| 0 | Live product serving | Model weights plus peak session memory; 10% compute headroom |
| 10 | Deployment | ML staff only; no fabricated GPU work |
| 20 | Evaluation | Development compute and research staff; independent completion meters |
| 30 | Data preparation | Data staff only |
| 40 | Adaptation | Development compute, complete training workspace, and ML supervision |
| 70 | Extra acquisition reach | Commercial staff only |

The founder has one shared FTE, initially assigned to data. Assignments use quarter-FTE increments. Ready employees contribute their assigned time in their hired role. A person's capacity is shared across all requests, and onboarding staff contribute none. `lastStaff` records granted capacity rather than inventing work when a task cannot use it.

The current executable pool is `general-cloud`, with a 1:1 relationship between physical and effective work. Adaptation supervision permits **4 CUw per ML staff-week**. The compute owner caps physical work to the actual ML grant before execution; the lab does not multiply by supervision again. A workspace must fit in full. An unplaced workspace receives zero work and zero memory allocation. Serving has first claim on memory; lab work uses separate workspace.

The collector independently checks aggregate role budgets, complete memory placement, supervision, physical category ceilings, total memory, and headroom-inclusive reservations. A request, allocation, or promising forecast is not itself useful completed work.

## Workforce, cloud, and company economics

The opening company has $48,000, four rented general CU, eight MU, two CU allocated to development, one founder, no employees, and no earned revenue. Cloud capacity can be changed to a whole number from 0 to 128 CU. Each general CU provides two MU and costs **$200 per week**, including energy and idle reservation. The existing $200 weekly founder draw and overhead also continues.

Five employee roles can be hired. Hardware specialists remain gated.

| Role | Weekly salary | Recruitment fee |
| --- | ---: | ---: |
| Researcher | $450 | $2,250 |
| ML engineer | $300 | $1,500 |
| Data engineer | $250 | $1,250 |
| Infrastructure engineer | $350 | $1,750 |
| Product / commercial | $250 | $1,250 |

Recruitment costs five weekly salaries. A Week 1 hire is paid in Weeks 1 and 2 and becomes productive at Week 3. Salary is charged once regardless of assignment or idle time. Dismissal costs two weekly salaries and removes the employee before that boundary's payroll. Infrastructure staff can be hired, but the facility and operations jobs that will use them are planned; idle hiring provides no hidden production bonus.

Cloud allocations share the same physical reservation. Downsizing requires reducing allocations first and retaining enough memory for active model weights. Session fit is still checked during service placement. Equipment deliveries preserved from older saves enter inventory only. They do not create installed capacity. Owned-hardware purchase, installation, energy, and variable work charges are not active, even though future hardware coefficients exist in the catalog.

The company module alone changes cash through its deduplicated ledger. Preparation, recruitment, and severance emit stable expense facts; products emit stable invoice receipt facts. Existing cloud rent and salary do not fall when utilization is low. Unpaid expenses become arrears without negative cash and stop the clock and optional commands.

## Prepared data and finite model development

The starter packet has 100 raw units, 80% quality, and domain coverage of 100% conversation, 35% documents, 25% coding, and 25% tools. It permits hosted use and weight transfer but does not grant feedback rights. Preparing it costs **$1,000 once and two data staff-weeks**. Partial progress is saved; the packet becomes ready only at completion. Prepared units are reusable rather than consumed by a training run.

The opening recipe adapts the compact, dense Seed 0 lineage. It requires **12 effective development CUw and four MU of training workspace**. Its evidence is copied into the run at admission so later packet changes cannot alter completed work retroactively. Pauses stop the next week's requests and retain completed work, physical work, and checkpoint identity.

For each capability, the result is calculated from a fixed Seed 0 anchor and an absolute recipe target:

`anchor + (target - anchor) × min(work / required work, relevant evidence / required evidence, 1) × quality`

Relevant evidence is ready volume multiplied by domain coverage. Reliability uses the same work/evidence/quality constraint with fixed 70 and 90 anchors and the ready behavior-evidence volume. These are fictional game rules, with fixed-point rounding in the implementation.

| Attribute | Seed 0 | Absolute target | Completed starter adaptation |
| --- | ---: | ---: | ---: |
| Conversation | 40 | 50 | 48 |
| Documents | 30 | 32 | 30.56 |
| Coding | 20 | 20 | 20 |
| Tools | 20 | 24 | 20.8 |
| Reliability | 70 | 90 | 86 |

A saved 50% checkpoint has conversation 44 and reliability 78; the final model receives a separate immutable version ID. The midpoint remains inspectable after completion. Repeating an identical recipe and evidence cannot compound gains. Renaming the model or copying the packet under another display ID does not create another improvement allowance. An unfinished matching run must be resumed, and a completed matching run is rejected with an explanation.

There is one authored evidence family and one training recipe in this wave. This is not yet a general pretraining, data acquisition, architecture search, alignment-method, or continual learning system. Future evidence identities must represent actual distinct evidence and rights rather than unlock improvement through renaming.

## Evaluation is retained evidence

Basic evaluation consumes **two development CUw and 0.5 research staff-weeks**. Either meter may finish first. Previously completed compute is not repeated while research catches up, and completed review is retained while compute waits.

Completion produces one report with **20 routine held-out conversation cases**, stable case IDs, saved technical and execution draws, observed pass counts, and snapshots of the model's existing capability and reliability. It does not modify those trained values. Technical case probability uses `clamp(0.05, 0.98, 0.5 + conversation / 100)` for the opening difficulty-zero cases; execution reliability is a separate factor. At conversation 48 and reliability 86, the combined reference success probability is 84.28%. A particular 20-case observation need not equal that probability.

The existing report is retained, and repeating the same basic suite on that model is rejected. Basic Chat eligibility requires a completed report, conversation at least 45, and reliability at least 65. Observed case passes are not substituted for those gates. A midpoint checkpoint can be evaluated while its training run continues but does not meet the conversation gate. Behavior subtypes, adversarial suites, misalignment incidents, and separate honesty/refusal/calibration evidence remain planned.

## Basic Chat, usage, and the regular consumer market

One Basic Chat offer is supported. Deployment consumes **one ML staff-week** and activates at the next boundary. It requires the model's matching eligible evaluation and hosted-use rights. Price and allowance changes apply at a subsequent boundary; the current contract record receives the new terms while historical invoices preserve the amounts actually billed.

The reference plan is **$12 per account-week for 100 exchanges**. Allowed prices are $1–$100 per week; allowances are 25–500. The regular reference user attempts `min(100, allowance)` exchanges per week, each costing **0.0002 CUw**. At the reference allowance this is **0.02 CUw per paid account-week**. Increasing allowance beyond 100 does not invent heavy-user demand or improve fit in this slice. Lower allowances reduce both attempted work and consumer fit.

Each trial requires **0.005 CUw** and has two execution weeks to finish. Paid demand has priority over trial work within the product grant. A completed trial may convert in `market`, and its subscription first uses and pays in the following week. Incomplete trials expire; they cannot create customers without real executed work.

### Capacity and memory

Serving reserves **110% of executed physical work** inside the serving allocation. Headroom is reserved capacity, not additional executed work or an additional cloud invoice. Product usage and `lastWork` count physical execution only. Failed attempts still consume that work.

The opening memory rule reserves the model's resident weights once plus **one standard peak session per active or trial account at 0.02 MU each**. Seed-derived weights use two MU, so memory for nine subscribers and 20 trials is `2 + 29 × 0.02 = 2.58 MU`. A live idle product retains its weights. The complete aggregate product memory request must fit; this wave does not place a smaller subset of sessions after an oversized request fails. Session duration distributions, token-length caches, and batching are not yet modeled.

New trial admission uses a **one-week forecast** of the next subscriber count, remaining trials, serving work with headroom, and session memory. It is a limit on admission, not a reservation or a guarantee of future service. A trial costs less work than a paid account; subsequent conversions can outgrow capacity after that forecast horizon. The player must expand or reallocate serving capacity as subscriptions grow. Pausing service or reducing capacity can also invalidate earlier expectations.

### Demand, pricing, and churn

The market contains 4,000 regular reference consumers. A one-time 40-person waitlist obeys the same reach limit of 20 new trials per week. Further shoppers are limited to 3% of the remaining outside population per week. Actual granted commercial time adds 15 reach per FTE. Active cohorts and trials consume the finite population.

Reference conversion is 45%, modified by conversation fit relative to 48, price fit relative to $12, saved trust, and allowance fit. Capability and price multipliers cap at 1.5; allowance fit is `min(1, allowance / 100)`. Conversion is bounded to 5%–80%. Trust begins at 50 and has no incident-driven update in this wave.

Weekly churn starts at 1%. Incomplete service, execution error above the 18% tolerance, prices above $12, and allowances below 100 increase it, with a 25% ceiling. Price and allowance therefore affect demand as well as workload. Smaller plans cannot retain reference-plan conversion and churn while avoiding reference-plan serving cost. The current model's service error rate is an aggregate expectation from capability and reliability; consumer episodes are not individually simulated.

### Bills and service credits

Gross subscription billing is active accounts multiplied by the weekly price. A proportional credit applies to unfulfilled paid work. Fulfilling half of the requested paid work produces a 50% service credit rather than erasing the complete subscription bill. Execution errors consume compute and influence churn; they are separate from missing-capacity credits.

Pausing an active product stops acquisition and service and gives its existing subscribers full service credits. Usage, credits, invoices, ledger receipts, and customer counts remain separate records. The first-sale milestone requires positive posted earned revenue, not a trial, signup, forecast, or unposted gross bill.

## Reference first sale: Week 10 and $108

The reference route uses an ML hire and allocates all four opening CU to development during adaptation. Keeping the default two-CU development ceiling makes that stage take six weeks instead of three. The following sequence is the implementation fixture in `tests/wave1-integration.test.ts`; it is one concrete route rather than a guaranteed deadline for every strategy.

| Week | Work and boundary outcome |
| --- | --- |
| 0 | Queue starter preparation, hire one ML engineer, and allocate four CU to development. |
| 1 | Pay the $1,000 preparation and $1,500 recruitment fees. Founder completes one data staff-week. The engineer is onboarding and paid. |
| 2 | Founder completes preparation. The engineer remains onboarding. |
| 3–5 | The engineer is ready from Week 3. Adaptation executes four CUw per week and completes at Week 5. The founder is assigned to research. |
| 6 | Evaluation completes its two CUw and 0.5 research staff-week. The model meets the Basic Chat gate. |
| 7 | Deployment completes one ML staff-week; four CU are allocated to serving. Activation is scheduled for Week 8. |
| 8 | Product and model activate. Twenty waitlist users enter trials for Week 9; no revenue is posted. |
| 9 | Trials execute 0.1 CUw. Nine subscribers convert and begin service next week. The remaining 20 waitlist users enter trials. Revenue remains zero. |
| 10 | Nine subscribers execute 0.18 CUw and 20 trials execute 0.1 CUw. Full paid fulfillment yields the first invoice and receipt: **9 × $12 = $108**. |

The engineer adds $300 to the existing $1,000 weekly rent and overhead. Reference cash after Week 10 is **$48,000 − $2,500 in fees − 10 × $1,300 + $108 = $32,608**. This receipt completes the first-sale milestone; it does not make the company profitable at that scale.

## Browser, saves, and migration

The UI remains three sparse columns: Business/People, Data/Lab/Models, and Compute/Basic Chat. Actions unfold as their prerequisites become available. Details expose scores, work, checkpoints, evaluation evidence, invoices, and capacity explanations. Quotes and forecasts come from selectors and command previews rather than duplicate UI formulas.

First visit, restore, import, and reset pause the clock. A week is ten active seconds at 1×; 2× and 5× are available. Hidden pages and long clock gaps pause execution, and there is no offline catch-up. One Web Lock holder may advance and autosave; another tab observes until ownership is explicitly reacquired. Without tab coordination, play is memory-only with export.

The established browser key remains `frontier-lab.wave0.snapshot`, and the writer lock remains `frontier-lab.wave0.writer`. Schema 1/content 0.1.0 saves follow this upgrade path:

1. Check the checksum of the original state before changing any field.
2. Validate the published Wave 0 structure and version.
3. Add the Wave 1 maps, founder assignments, fleet diagnostics, market defaults, and zero-cost reservation fields on old queued commands.
4. Validate the complete upgraded schema 2 state and return `migratedFrom: 1`.

Migration preserves cash, arrears, week, revision, next ID, queued command identities and intent, schedules, ledger, receipts, RNG, journal, model versions, and data packets. It does not replay time or reset progress. Before the first upgraded browser write, the adapter archives the exact original bytes under `frontier-lab.wave0.original`. An archive failure prevents overwriting the primary save. Explicit replacement also retains one previous primary snapshot under `frontier-lab.previous.snapshot`.

Corrupt, unknown-version, or incompatible input is left untouched and can be exported as raw recovery bytes. Changing a v2 save's version headers does not make it an authentic legacy save. The checksum detects accidental corruption; it is not authentication or anti-cheat protection. The authentic fixture at `tests/fixtures/wave0-snapshot.json` was produced by the original Wave 0 source and retains queued commands, financial history, scheduled work, and named random draws.

## Planned waves and extension constraints

| Planned wave | Systems that are not active in Wave 1 |
| --- | --- |
| Wave 2 — Strategic company | Research execution and application work; deeper model design and training methods; new data sources and evidence; richer consumers and rivals; owned hardware; standard facilities and data centers |
| Wave 3 — Agents and commitments | Agent work, independent outcome checks, human review, business commitments, outcome billing, and licensing |
| Wave 4 — Late game | Applied research, compatible custom chip design, and distinct campaign victory routes |
| Wave 5 — Release | Complete campaign checks, later save migrations, balance work, browser review, and release preparation |

Future systems should retain the current separation between research knowledge, paid application work, trained model versions, deployment configuration, evaluation evidence, customer obligations, and financial settlement. New research cannot silently grant a trained model or installed capacity. New hardware must enter an explicit compatible pool with truthful work and memory grants. More detailed data lineage and behavior evidence must extend the finite improvement rules without making retries or renamed inputs a source of free gains.

The next market expansion needs explicit cohort workload and concurrency assumptions, a deliberate conversion-capacity policy, and bounded costs for any richer agent or consumer simulation. Licensing and outcome billing need distinct contracts and receipts, while company settlement remains the single money writer. Every extension must preserve deterministic replay, transactional failure behavior, and a tested migration path for existing companies.
