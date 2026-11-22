# Wave 7 release handoff

**Frontier Lab — Specialists and agents**

Content/build **0.8.0**; save schema **5**. Wave 7 implements the four remaining authored research branches: Adapter bank, Action receipts, Independent holdouts, and Budgeted planner. **All 28 authored research programs are now implemented.** Discoveries still require their prerequisites, fees, staff, compute, and appropriate application steps.

The game keeps its sparse Universal Paperclips-style interface: native controls, compact metrics and tables, and expandable details. These systems use the existing deterministic weekly engine, physical resource allocator, and company ledger. The implementation and verification described here are complete; production build and publication remain release-pipeline steps whose results are recorded separately.

## Unlocks and ordinary costs

CUw measures normalized compute work; MU measures resident memory. Research work uses the research allocation, while training, evaluation, and system installation use development capacity. Agent execution and recovery use serving capacity. Staff effort and GPU work are separate meters. Payroll, cloud rent, and owned-hardware operating costs continue under the ordinary economy.

| Program | Prerequisites | Discovery fee and work | Application after discovery |
| --- | --- | --- | --- |
| **R4B — Adapter bank** | R4 | **$1,000**, **2 ML staff-weeks**, **2 research CUw** | Install the bank for **1 ML staff-week and 1 development CUw**. Then pay the selected dense adaptation recipe and each candidate's own evaluation. |
| **R9A — Action receipts** | R9 | **$1,000**, **2 ML staff-weeks**, **2 research CUw** | Install recovery for **1 ML staff-week and 1 development CUw**. Every handoff subsequently pays its model-dependent serving work. |
| **R10A — Independent holdouts** | R10 and R1 | **$1,500**, **2 research staff-weeks**, **4 research CUw** | Run a **100-case diagnostic suite for 4 development CUw and 1 research staff-week**, after a paid capability report on that exact candidate. |
| **R11A — Budgeted planner** | R11 | **$3,000**, **4 research staff-weeks**, **8 research CUw** | Train with the **16-CUw planner curriculum** and prepared behavior evidence, under ordinary ML supervision. Evaluate the resulting candidate separately. |

The two system rollouts activate at the next weekly boundary after both meters finish. Holdouts and planner training use their paid evaluation and training projects directly; neither needs an additional system rollout. Research knowledge also becomes available at its normal next boundary. New holdout and planner admissions cannot be backdated before their research became available.

The quoted curriculum work is its authored base budget. Existing eligible training efficiencies retain their normal rules and are captured when the run is admitted. Optional checkpoint work remains separately charged. The source coefficients are in [the research catalog](../src/content/catalog.ts), [training and evaluation definitions](../src/content/wave2-lab.ts), and [system rollout definitions](../src/content/wave4-research.ts).

## Frozen-base adapters

After installing Adapter bank, choose an original dense base and an adaptation recipe in **Lab**, then enable **Train as an adapter**. The run records the exact base and creates a separate immutable specialization. It keeps the ordinary recipe's work, finite targets, evidence accounting, and saved outcome adjustment. Adapter and full-update choices share the same training identity, preventing a second outcome roll from changing the storage option.

Each distinct adapter adds **0.25 MU** to its base. An individual candidate reserves the full base plus its adapter. When eligible public products load compatible adapters in the **same actual compute pool**, the allocator charges that exact base once and each distinct adapter once. Another pool must load its own copies. Similar names, matching model sizes, or unrelated ancestry do not establish shared weights.

For example, two specializations of a 2-MU base occupy **2.5 MU** of bank weights in one pool, compared with **4.5 MU** for separate full candidate reservations. Two products using the same adapter can also reuse that adapter's resident weights within the pool. Placement failures create no reusable residency, and ordinary non-weight memory remains charged.

Boundaries are explicit:

- Every completed candidate needs its own paid capability evaluation before service. Its base's report is not inherited as release evidence.
- Per-request inference, serving headroom, sessions, caches, retrieval indexes, customer billing, and normal physical work retain their costs.
- Training and evaluation reserve their full workspace. Stored candidates consume no serving memory until a workload loads them.
- The bank applies to eligible public products. Private deployments, internal work, and routed model pairs retain their separate reservations.
- Adapter bases cannot be sparse designs, deployment formats, or another adapter. Adapter outputs cannot be stacked into further training or compression applications.
- Hosting and weight-distribution rights remain constrained by the base, training evidence, and ancestry. A storage saving does not create a license permission.

The **Applied research → Adapter bank** details show the shared base, evaluated specializations, active public products, and the potential weight residency when placed together. Compute remains the source of actual occupied memory after placement.

## Independent outcome holdouts

In **Models**, select an already capability-evaluated version and choose **Independent outcome holdouts**. Allocate development compute and research staff. Either meter can finish first, and the existing project controls can pause and resume the remaining work.

The saved report compares model completion claims, actual useful outcomes, basic-checker decisions, and independent-checker decisions on **100 reserved support cases**. It calls the same draft, checking, and planning rules used by the agent system. Checker mistakes are shown with two denominators: incorrect outcomes among accepted decisions, and accepted failures among all unsuccessful cases. A zero denominator is displayed explicitly rather than presented as a success rate.

The report also measures one bounded planning attempt per case: necessary read-tool calls, all planned read-tool calls, avoidable repeat lookups, and out-of-scope proposals. These counts help compare candidates and choose live work budgets and verification settings.

The reserved bank is separate from training and live customer intakes. Its identity depends on the company, game seed, and protocol. Candidates face the same bank; changing a name, command ID, report ID, or evaluation week cannot reroll it. Each candidate retains one report for this suite. The report captures its exact candidate fingerprint and prior paid capability baseline.

**This is diagnostic evidence.** It changes no weights, capability scores, reliability, or checker accuracy. It cannot qualify a product, agent, teacher, chip prototype, or other capability gate, and it preserves the candidate's existing preferred capability report. It performs no live customer action and creates no customer bill. Finite observed results do not guarantee future live outcomes; even an independent checker can accept an incorrect claim.

## Budgeted planner curriculum

After R11A, choose **Budgeted planner curriculum** in Lab with a saved model and prepared behavior cases. The curriculum has a fixed lineage baseline multiplier of **10,000 basis points** and a target of **8,000**: at most a **20% reduction in the existing chance of an avoidable repeated lookup**.

Attainment depends on paid update work, distinct behavior evidence, and evidence quality. The full target uses 100 behavior cases; partial or lower-quality evidence earns a smaller effect. The demonstrated 95%-quality corpus yields a final multiplier of **8,100**, or a **19% reduction in repeat chance**; its halfway checkpoint is **9,050**. These are model properties, while a 100-case report records the particular outcomes observed in that finite sample.

The effect applies only to the avoidable-repeat branch of bounded planning. Necessary lookups, out-of-scope proposal behavior, permissions, checker accuracy, draft outcomes, capability scores, and reliability keep their existing rules. Every executed call still consumes resources, and hard work and step budgets still apply.

The candidate is a new immutable version requiring its own evaluation. Ordinary descendants retain its earned planner trait; a new foundation starts fresh, and deployment variants preserve their source's trait. Repeated curricula cannot compound the baseline into unlimited savings. Different names, equivalent evidence, or new command IDs do not create another roll or improve an already attained finite target.

## Paid agent recovery

Install **Action receipts and recovery** in the agent section after R9A. An eligible paused job, or a job stopped by a work or step budget, can continue in a new execution. Ordinary pause/resume remains available. A customer order permits **at most two handoffs**.

Each continuation first executes a metered recovery pass. Its base cost is **0.01 serving CUw per case**, multiplied by the model family factor—1 for compact, 2 for medium, 4 for large—and the model's ordinary runtime-work multiplier. The pass records 300 input and 50 output tokens per case, requires connected model/session memory, and consumes one step. These are simulated work meters, not real API charges. Subsequent unfinished stages consume their normal costs.

Recovery preserves the original model, permissions, customer terms, evidence identity, retry allowance, completed stages, partial-stage work, and all previously spent compute and staff effort. The player chooses **cumulative** work and step ceilings that retain the previous budgets and cover recovery plus the saved stage. Admission also reserves enough budget for the mandatory audit when the saved stage is an action. The existing maximums remain 24 steps and 32 CUw; later stages and retries still need room within those limits.

Action and invoice identity belong to the customer order across executions. An already applied action keeps its original durable receipt, and a continuation can perform its unpaid audit without sending the action again. It charges no additional intake fee, creates no second customer order, and cannot invoice the same outcome twice. Closed invoices, delivered drafts, verified or penalized outcomes, permission violations, rejected checks, exhausted retries, and rejected reviews cannot be reopened through recovery. A recovery pass cannot reverse an incorrect authorized action or reroll its correctness.

## Ordinary campaign evidence

[The progression receipt](evidence/wave7-progression.json) continues the authentic published Wave 6 company from **Week 269 to Week 328**: **59 ordinary weeks and 22 commands**. All player commands were admitted and committed. Existing customers and rivals continued operating. The run grants no cash, research, staff, data, models, or resources, and records no arrears.

| Retained measure | Result |
| --- | --- |
| Starting and minimum cash | **$1,927,803.09** |
| Final cash | **$2,584,021.68** |
| Final weekly revenue / operating expenses | **$37,554 / $25,750** |
| Final snapshot checksum | `dd80fdc4` |
| Shared adapter weights | **4.5 → 2.5 MU**, two public products on one exact base |
| Recovery work already spent / final cumulative work | **2.70 → 2.98 CUw** |
| Recovery pass / remaining audit | **0.20 / 0.08 CUw** |
| Recovered customer outcome | One action receipt and one **$350** invoice |

The planner comparison uses the same reserved evidence key, `fa384525`, for both exact versions:

| Diagnostic, 100 cases | Before training | Trained planner |
| --- | ---: | ---: |
| Claimed completions | 57 | 57 |
| Actually correct outcomes | 48 | 48 |
| Basic-checker accepts / false accepts | 49 / 1 | 49 / 1 |
| Independent-checker accepts / false accepts | 48 / 0 | 48 / 0 |
| Necessary lookups | 166 | 166 |
| Planned read-tool calls | 209 | 202 |
| Avoidable repeated lookups | **43** | **36** |
| Out-of-scope proposals | 6 | 6 |

The unchanged outcome and checking columns demonstrate the scope of the planner improvement. The observed zero independent false accepts applies to this sample; it is not a universal checker guarantee. The recovery example retains the action applied in Week 325, pauses before its audit, pays recovery in Week 327, and finishes the audit and single invoice in Week 328.

Reproduce the integrated campaign with `npm test -- wave7-progression`. Setting `FRONTIER_WAVE7_OUTPUT` to an output directory also writes the pre-recovery snapshot, completed snapshot, and progression receipt. The recorded company is a demonstrated continuation, not an optimal strategy or a promised completion time for another company.

## Verification and browser checks

[The validation receipt](evidence/wave7-validation.json), dated **2026-11-07**, records:

- **308 automated tests passed**, with **0 failures and 0 skips**, using `npm test`.
- `npm run typecheck` completed with exit code 0.
- `git diff --check` completed with exit code 0.

Coverage includes paid research and installation, adapter placement and memory conservation, independent evidence and capability separation, finite planner gains and inheritance, recovery history and once-only settlement, hostile imports, original-byte recovery, ordinary progression, and existing billing, hardware, rivalry, campaign, and persistence behavior.

Browser QA in managed-preview Chrome imported the naturally earned **Week 326** company through the UI, inspected its planner holdouts and expanded adapter bank, queued a paid recovery, and advanced two weeks. The completed audit produced **one new $350 invoice**. Reloading the **Week 328** company preserved the completed recovery and **$700 in total agent receipts**, including the earlier settled order.

The inspected adapter training configuration forecast **9 CUw and 4.5 MU** of workspace. The planner curriculum forecast **16 CUw and 4 MU**, with the adapter option disabled. After verification, the original **Week 16** preview company was restored through UI import and checked paused with **$16,364** cash. TypeScript was rerun successfully after the final UI wording changes.

Verified screenshots: [independent holdouts](images/frontier-lab-wave7-holdouts.png), [adapter bank](images/frontier-lab-wave7-adapters.png), and [paid recovery](images/frontier-lab-wave7-recovery.png). These checks establish browser behavior and persistence on the integrated checkout; production build and deployed-revision results are recorded separately by the release pipeline.

## Save compatibility and the authentic Wave 6 oracle

Schema **5** is retained. Valid **Wave 0–6** snapshots migrate without advancing time. A Wave 6 import validates its original checksum and representation, rejects Wave 7 features hidden behind an older content header, and changes only content/build headers from **0.7.0 to 0.8.0**. Existing model results, project meters, customers, prices, rights, invoices, and random streams are preserved.

Before the first upgraded browser write, the exact original Wave 6 bytes are archived under `frontier-lab.wave6.original`. Existing originals are not overwritten, and a failed archive prevents replacing the primary save. Earlier recovery archives, portable JSON export, single-writer locking, hidden-page pausing, and no offline progress retain their established behavior. Saves remain browser-local rather than account-synchronized.

The compatibility fixture and oracle were produced by the **published Wave 6 engine**, commit `870fd3792f162542740c53d7df154d52f8917c5f`. The fixture starts at **Week 269**, checksum **`4246bec5`**, with an agent awaiting human approval and its approval command queued. [The oracle](../tests/fixtures/wave6-expected.json) records **12 subsequent weeks, 270–281**. The new engine matches every complete canonical state hash after normalizing only the content/build headers back to 0.7.0.

The comparison crosses approval and paid review in Week 270, the customer action in Week 271, resource-limited audit progress, a customer-hosted license renewal in Week 275, and the completed audit with its single **$350** invoice in Week 277. The final Week 281 hash is **`65283396`**. This checks unchanged ordinary simulation outcomes and settlement timing when the new programs are not used, alongside the separate Wave 7 adoption campaign.

All costs, scores, token quantities, probabilities, and GPU units are authored game parameters. This release makes no live model API calls, real hardware purchases, or payment integrations. Earlier release documents remain historical; their previously planned four branches are implemented in this release.
