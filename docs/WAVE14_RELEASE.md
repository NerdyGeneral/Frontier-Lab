# Wave 14 — Batch inference

## Release intent and implemented scope

Wave 14 gives the company a way to earn money from deferred model work while preserving capacity for its ordinary services. Existing Developer API customers offer finite benign backlogs. The player installs a paid scheduler, chooses a qualifying model and weekly work limit, then manages actual GPU capacity, resident memory, commercial handling, and a fixed delivery deadline. Compression and specialist training can change which work is worth accepting.

Content and build version are **0.15.0**; save schema remains **5**. The scheduler, job history, and terminal invoice collection are optional state created by explicit adoption. Existing companies receive no automatic installation, order, staff, model, customer, or money. The prior engine's ordinary progression remains identical when the new application is unused.

The interface retains the Universal Paperclips style. **Batch inference** is an expandable Developer API section with an installation button, three finite order types, model and work-limit selectors, short progress metrics, ordinary pause/end buttons, and detailed receipts. The UI uses the simulation's admission, meter, cost, and invoice helpers. There is one economy and one command path.

The authored values are in [the batch catalog](../src/content/wave14-batch.ts), the lifecycle is in [the batch module](../src/modules/batch-inference.ts), and the stored evidence is defined by [the batch contracts](../src/contracts/wave14-batch.ts).

## Paid scheduler and customer admission

Completed **Enterprise operations (R12)** unlocks scheduler installation. This wave adds an application to existing research rather than another research node.

| Requirement | Authored amount |
|---|---:|
| Installation expense | $1,500 |
| Development GPU effort | 2 normalized CUw |
| ML implementation effort | 2 staff-weeks |
| Maximum development effort per week | 1 CUw |
| Maximum ML effort per week | 1 staff-week |
| Separate development workspace | 1 MU |

The fee posts when the installation command commits. GPU and ML grants are independent: one can advance while the other is short. Both must finish before the scheduler becomes ready; activation occurs at the following weekly boundary. Owned or rented hardware performs the actual GPU work through the normal allocator. Missing staff, compatible memory, or the required development allocation can delay completion.

Order admission requires the company's active Developer API, existing paying developer accounts, actually executed paid service, and a recent positive public token invoice with its posted receipt. These are finite extra jobs from existing customers. Accepting them does not create market accounts, add another recurring customer cohort, or consume a separate enterprise-buyer population.

The chosen model must be owned, evaluated with its exact paid capability report, permitted for hosted use, and eligible under the existing commercial policy rules. Applicable policy-trained models and descendants need their own paid policy report. The selected model's evaluated domain score and reliability must meet the order's requirements. A report for the public model does not automatically qualify another variant.

Admission also checks that at least one connected compatible compute pool can fit the selected model and the batch workspace. It does not reserve future serving work or promise completion. Existing live commitments retain their ordinary capacity admission rules; a deferred batch backlog consumes only the capacity actually left to it.

## Finite orders, prices, and model tradeoffs

All three orders use fixed **$50 per million completed input tokens** and **$250 per million completed output tokens**. The quote is a maximum earned bill for completing the whole order.

| Order | Minimum evaluated domain score | Minimum reliability | Requests | Input / output tokens per request | Delivery window | Full completed-order bill |
|---|---:|---:|---:|---:|---:|---:|
| Archive tagging | Documents 30 | 80 | 40,000 | 2,000 / 250 | 4 weeks | $6,500 |
| Code index | Coding 50 | 80 | 60,000 | 2,500 / 500 | 6 weeks | $15,000 |
| Long-form digest | Documents 55 | 90 | 60,000 | 5,000 / 500 | 6 weeks | $22,500 |

Each company can accept **three claims of each order**, for **nine retained jobs**. The four-company engine supports at most 36 jobs and one scheduler per company. Queued acceptances count toward the finite bounds. Completing, cancelling, or missing a deadline does not return the claim. Rivals do not automatically adopt the new application.

At acceptance the job captures its model identity and intrinsic fingerprint, paid report references, rights, family, architecture, resident weights, and inference-work modifier. Its order, token rates, token lengths, weekly cap, and calendar are also frozen. Selecting a model for a batch does not replace the public API's deployed model.

For an ordinary compact model, full completion requires **26 normalized CUw** for archive tagging, **60 CUw** for code indexing, and **90 CUw** for the digest. Larger model families multiply per-request work. A compression variant with an 80% work modifier reduces the code order to **48 CUw**, provided its own paid evaluations still meet the coding, reliability, policy, and rights requirements. Compression's quality penalty can make an order unavailable even when it reduces the work.

This connects earlier systems to a concrete operating decision. Curated data and paid adaptation can improve the relevant domain; reliability training can satisfy a stricter order; compression can fit more requests into the delivery window. Every new model or variant still pays its own training or implementation and evaluation costs. A high quote is not a profit guarantee.

## Actual GPU work, memory, and commercial handling

The player fixes a **2, 4, 8, or 16 normalized CUw weekly cap** when accepting the order. Each active week requests the lower of that cap and the remaining work. Batch work uses the company's **serving allocation** after ordinary workloads. Idle research or development allocation is not borrowed automatically.

Among batch GPU requests, earlier deadlines run first, with a deterministic ID tie-break. Every job needs its own selected model residency plus **0.25 MU** of batch workspace in one compatible pool. Public model residency, adapter sharing, routing, prefix caches, session features, and runtime-checker work are not inherited. Sparse architectures retain their fabric requirement, and custom chips retain architecture and compiler compatibility. There is no latency-headroom reservation for deferred work.

Each running job requests **0.25 commercial FTE** for handling. This competes for real productive staff after ordinary support and before optional customer acquisition. Handling priority is separate from GPU deadline order. A partial commercial grant proportionally limits the GPU work that can execute; zero handling produces zero batch execution. Staff allocated to handling can still be spent in a week when compatible GPU capacity is unavailable.

Normalized work measures the model computation completed. Physical GPU work is the capacity actually used on the selected pool after its hardware conversion. The engine records both, including integer conversion remainders. Hardware can therefore change physical work and costs without changing the fixed normalized workload. A shortage of full resident memory can stop a job even when some raw GPU capacity is idle.

Accepted jobs remain bound to their chosen model. Later changes to the public API's model, route, cache, conversation features, runtime checker, or active state do not rewrite that batch's meter. The existing public workload and the batch retain separate actual grants and invoices.

## Calendar, pause, cancellation, and request carry

An accepted job can execute in its acceptance week. Its inclusive deadline is **acceptance week plus delivery-window length minus one**. An archive accepted in Week 476 has Weeks 476–479 available. Only the actual resources granted in those weeks can advance it.

Pause and resume take effect at the next command boundary. A paused job requests no GPU work or commercial handling and retains a zero-progress calendar receipt. Its deadline continues. GPU scarcity, missing memory, or a shortage of handling likewise does not extend the original window.

Work accumulates across active weeks before conversion into whole completed requests. A fraction too small to finish another request remains useful toward the next week. Input and output tokens count only whole completed requests; the game does not charge for an unfinished request. The model and fixed token lengths make the conversion reproducible from retained work receipts.

Completion resolves when the full required work is reached. Otherwise, the inclusive deadline ends the job after that week's actual grants. Explicit ending stops future work at its command boundary and settles progress already earned. It does not execute another batch week before cancellation. The scheduler and order history remain available afterward.

## Terminal billing, cost attribution, and retained evidence

An order posts **one final invoice**, on completion, deadline, or cancellation. It does not add recurring public token charges. Billing uses the following sequence:

1. Divide cumulative executed normalized work by frozen work per request and round down to whole completed requests.
2. Multiply those requests by the fixed input and output token lengths.
3. Apply the frozen token rates and round the combined result down to whole cents.
4. Credit the difference between the full quoted bill and the earned amount.
5. Post the earned amount once under the job's unique invoice ID.

Credits represent unfinished quoted work. They reduce the earned bill and do not create an additional cash expense or a separate penalty. The cancelled archive in the earned campaign completed **12,307 requests**, earning **$1,999.88** of its $6,500 quote and recording a **$4,500.12** credit.

The company pays for actual hosted inference through its existing GPU economy. Owned equipment incurs variable operating usage; cloud execution consumes an allocated share of rented capacity. Batch work does not add a second cloud rent charge. A **batch-inference** activity in Compute costs connects the actual resource grants and terminal revenue to the normal weekly ledger. Scheduler development and its installation fee remain implementation expenses.

The job also exposes a lifetime GPU cost estimate calculated from retained physical work and the tariff of each pool used. That estimate is useful after the eight-week detailed cost-report window expires. It excludes payroll, fixed facility costs, and shared cent-allocation rounding. It is not a net-profit measure or a substitute for the exact weekly cost report.

Every supported job retains its full four- or six-week calendar, paused rows, actual commercial effort, normalized progress, whole-request counts, and coalesced physical hardware receipts. Final invoices and the posted proof of each admitting public invoice survive the ordinary public-invoice, ledger, and cost-report retention windows. A completed job can therefore be reloaded and checked long after its short-lived source views expire.

The [batch validator](../src/core/wave14-batch-validation.ts) binds stored terms to authored orders and accepted commands, checks paid source reports and customer admission, reconstructs calendar progress and token billing, and reconciles available resource frames. Scheduler first grants cannot invent earlier progress; cumulative GPU and ML effort must match a fully retained resource span. Jobs cannot add early invoices, duplicate a terminal invoice, extend a deadline, or regain a consumed order claim through cancellation.

## Sparse operating interface and forecast boundary

The order form displays quality requirements, the full quote, token rates, selected-model work, separate memory, handling demand, and the minimum weeks at the selected cap. That minimum assumes the cap is fully granted every week. If even that lower bound exceeds the delivery window, the UI explains why only partial payment is possible.

The job view shows its frozen delivery window, completed requests, normalized work, actual physical work, commercial effort, GPU tariff estimate, bottleneck, and final earned bill. Expandable receipts expose weekly grants and completed tokens. Pause, resume, and end remain ordinary queued actions.

Capacity forecast includes a separate **Deferred batch backlog** summary with remaining work, active weekly limits, maximum handling demand, and deadlines. The established **twelve-week recurring forecast does not predict batch completion**. Its recurring commitments and the current backlog summary have different scopes; neither promises that a batch will receive its full cap.

## Earned company continuation

The [natural campaign receipt](evidence/wave14-progression.json) starts from the published Wave 13 company at **Week 472**, checksum **`653fbcd2`**, source commit **`16ebd574c5feff6bf5cd422c3b474d7fb5606182`**. It advances **28 real weeks using 16 ordinary commands** to Week 500. No cash, staff, equipment, reports, model quality, research, or capacity is granted directly.

| Milestone | Observed week |
|---|---:|
| Scheduler installation fee and actual development/ML effort begin | 473 |
| Both paid implementation meters complete | 474 |
| Scheduler activates | 475 |
| First archive starts using the existing qualified public model | 476 |
| Compressed variant holds its own paid capability and policy reports | 477 |
| Original and compressed code jobs begin with equal 8-CUw weekly limits | 478 |
| First archive finishes and settles | 479 |
| Original code job expires; compressed code job finishes | 483 |
| Second archive pauses, resumes, then ends | 485–487 |
| Paid document adaptation and reliability training gain fresh qualifying reports | 494 |
| Compact document specialist runs the larger digest | 495–500 |

The five terminal results are:

| Order and model | Completed requests | Executed normalized work | End reason | Earned bill | Unfinished-work credit |
|---|---:|---:|---|---:|---:|
| Archive, original compact | 40,000 / 40,000 | 26 CUw | Completed | $6,500.00 | $0.00 |
| Code, original compact | 48,000 / 60,000 | 48 CUw | Deadline | $12,000.00 | $3,000.00 |
| Code, compressed compact | 60,000 / 60,000 | 48 CUw | Completed | $15,000.00 | $0.00 |
| Archive, paused/resumed original | 12,307 / 40,000 | 8 CUw | Cancelled | $1,999.88 | $4,500.12 |
| Digest, trained compact specialist | 60,000 / 60,000 | 90 CUw | Completed | $22,500.00 | $0.00 |
| **Total** | | | | **$57,999.88** | **$7,500.12** |

The code comparison has the same weekly cap, six-week calendar, and **48 normalized CUw actually executed** for both jobs. The original would require 60 CUw to finish; the compressed variant requires 48 CUw. That explains the extra 12,000 completed requests and $3,000 earned by the variant.

Actual physical work was **45.090909092 CUw for the original** and **48 CUw for the compressed model** because they received different pools in the real fleet. Their recorded GPU tariff estimates are **$5,381.81** and **$9,600.00**, respectively. This campaign demonstrates improved request completion at equal normalized work and deadline; it does not demonstrate lower actual physical GPU cost from compression. The controlled integration test separately isolates the model effect under matching hardware conditions.

The later specialist uses existing curated document data, paid stable document adaptation, paid reliability training, and fresh capability and policy evaluations. It qualifies for the digest without replacing the public API. The second archive's earlier cancellation remains fully accounted for through those later training and settlement weeks.

Every one of the 28 weekly cost and revenue reports reconciles to the company ledger. The original public deployment and existing feedback-study evidence remain unchanged; batch service creates no new consented study or training packet. Final company cash is **$5,111,836.92**; minimum observed cash is **$4,597,702.65**. Those are whole-company balances, including all other ongoing operations.

The final Week 500 checksum is **`38350449`**. Its compact snapshot is **1,300,835 bytes** and serializes identically after import. The receipt records each command, scheduler grant, job, terminal invoice, tariff estimate, service observation, and reconciled weekly cost frame.

## Save migration and independent compatibility oracle

Valid snapshots from Waves 0–13 migrate without advancing time. Importing Wave 13 retains schema 5 and changes content/build headers from **0.14.0 to 0.15.0**. The browser archives the exact original bytes under **`frontier-lab.wave13.original`** before replacing its primary save. Existing archives are preserved. Failure to write the archive blocks the upgrade; a later primary-write failure retains the old primary and the original archive.

The three new collections—`batchSchedulers`, `batchJobs`, and `batchInvoices`—remain absent before installation. Every earlier header rejects them even when empty, and rejects all four new command kinds. Old headers cannot be used to smuggle batch state past current validation. The current loader also retains the previous protection against assurance records relabelled under a pre-assurance header.

The portable **2,000,000-byte UTF-8 limit is unchanged** for both input and output. Pretty JSON is preserved byte-for-byte while it fits. If only formatting pushes a legal history over the bound, serialization uses compact JSON without removing evidence. Compact output that still exceeds the bound remains rejected, and browser persistence keeps the previous usable save.

Compatibility evidence was generated from an archived copy of the exact published Wave 13 engine **before Wave 14 implementation**. The [authentic fixture](../tests/fixtures/wave13-snapshot.json) starts at **Week 451**, checksum **`4062e51d`**, with Sentinel's first earned invoice and the company's paid runtime, release, and feedback history intact. It is not a state produced by the new engine and relabelled as old.

The [independent expected outcomes](../tests/fixtures/wave13-expected.json) contain **21 future full-state hashes across Weeks 452–472**, with nine original commands. They cover disabling and restoring the exact checker, a stale configuration, replacement rollout, explicit requalification, a second buyer, zero-serving capacity, finite invoices, and both fixed expiries. Detailed comparisons include billing, public token carry, company finances, retained audits, frozen release and feedback evidence, and cost attribution.

The old engine first switches to compact output at **Week 457**; its original Week 451 detailed cost report expires by **Week 459**. The final prior-engine checksum is **`653fbcd2`**, with a **1,172,854-byte** save. Wave 14 matches all 21 complete outcomes after normalizing only version headers, including a reload before every future tick. There is no batch state or extra RNG consumption in that continuation.

## Verification and handoff status

| Check | Observed result |
|---|---|
| Focused Wave 14 compatibility, browser persistence, and earlier migration gate | **83 tests passed**, zero failures |
| Ordinary Week 472–500 campaign | Passed; 16 commands, 28 weeks, five settled jobs, checksum `38350449` |
| Independent source review | Two related scheduler first-grant proof gaps identified and fixed; no additional must-fix settlement, chronology, priority, or retention issue found |
| Complete repository test gate | **535 tests passed**, zero failures or skips; 153.415 seconds |
| Type checking and production build | Nonincremental TypeScript passed; official Sites production build passed with exit code 0 |
| Desktop browser interaction | Passed: authentic Week 472 import, paid scheduler rollout, distinct models queued together, fixed deadline settlement, pause/resume/cancellation, exact reload, and original preview restoration |
| Publication target | The existing owner-private Frontier Lab Site; the native release receipt identifies the deployed saved version of this source |

The [browser receipt](evidence/wave14-browser.json) records a separate visible campaign from Week 472 through Week 485. Its first three orders begin in Week 476: the archive completes in Week 479; the original and compressed code models settle in Week 481 with $12,000 plus a $3,000 credit and $15,000 with no credit, respectively. A second archive starts in Week 482, pauses in Week 483, resumes in Week 484, and is cancelled in Week 485 after 12,307 completed requests. The $1,999.88 invoice and $4,500.12 credit survive an exact export/reload comparison. The preview's original Week 0 save was restored byte-for-byte afterward.

The browser checked [distinct cost activity labels and deferred revenue timing](evidence/wave14-browser-costs.txt). GPU work can be paid before the terminal customer invoice, so a single week's contribution is not a whole-job profit figure. Inspection found zero application-origin console errors; 71 existing browser-extension metadata-delivery errors were separate from the game. This browser pass covered the desktop managed preview. Production publication uses the existing owner-private audience and is verified through the native deployment receipt.

The [validation receipt](evidence/wave14-validation.json) records the complete gate and the final wording-only rebuild. The [interface screenshot](images/frontier-lab-wave14-batches.png) shows the retained three-column text-and-buttons layout.

The focused compatibility gate ran:

```sh
node scripts/test-wave0.mjs wave14-compatibility wave1-persistence wave1-migration wave2-migration wave3-migration wave4-migration
```

The main test and source map is:

| File | Responsibility |
|---|---|
| [wave14-batch.test.ts](../tests/wave14-batch.test.ts) | Paid scheduler and model admission; finite queued claims; hostile save validation; partial grants; physical compatibility; immutable terminal invoices |
| [wave14-batch-integration.test.ts](../tests/wave14-batch-integration.test.ts) | Residual service, public usage and feedback boundaries, frozen variants, staff/memory limits, fractional requests, compression, and long-term proof retention |
| [wave14-progression.test.ts](../tests/wave14-progression.test.ts) | Earned published-company continuation and ledger reconciliation |
| [wave14-compatibility.test.ts](../tests/wave14-compatibility.test.ts) | Authentic old-engine hashes, repeated reloads, legacy-header rejection, and all prior migrations |
| [wave1-persistence.test.ts](../tests/wave1-persistence.test.ts) | Exact browser originals, archive preservation, and storage-failure behavior |
| [batch-inference-panel.tsx](../src/ui/batch-inference-panel.tsx) | Sparse order selection, progress, operating actions, and receipts |

The simulation continues to use fictional prices, AI scores, workloads, and hardware units. This wave introduces no external model API, real GPU purchase, payment processor, uploaded customer data, or online inference. Batch completion supplies a delivered-work receipt and company revenue; it does not automatically create training data, improve weights, or certify general model behavior.
