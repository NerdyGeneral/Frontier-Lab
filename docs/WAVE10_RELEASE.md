# Wave 10 release handoff

**Frontier Lab — Customer feedback and reviewed training data**

Content/build **0.11.0**; save schema **5**.

## Playable loop and choices

Preference tuning (**R5**) now opens **Customer feedback** inside **Basic Chat** and **Developer API**. The same native disclosure contains collection, paid review, progress and links back to Data. The interface keeps ordinary buttons, selectors, compact tables and the existing weekly clock.

1. Open a prospective study against the current deployed source model.
2. Collect only consenting examples from four future calendar weeks of actual paid service.
3. Fund a quick or verified review with data staff and development compute.
4. Select the resulting prepared dataset for an ordinary training run.
5. Evaluate the exact new candidate, compare it through a paid rehearsal and explicitly prepare a release.

Collection and review never alter existing model weights, product behavior, prices or customer counts. These are authored aggregate game mechanics; no external model API or real conversation data is involved.

### Sampling, consent and finite scope

| Choice | Result |
| --- | --- |
| Representative sample | Broader task coverage: **80%** conversation coverage for Chat or coding coverage for API; **half** the cases become behavior units |
| Failure-focused sample | Concentrates estimated mistakes, false refusals and uncertainty: **45%** primary-domain coverage; **one behavior unit per case** |
| Hosted training only | **25%** modeled opt-in among served paid accounts; derived model weights cannot be distributed |
| Weight distribution consent | **10%** modeled opt-in; distribution also requires inherited rights from the primary source and every sampled routed model |

Each study is capped at **25 cases per week and 100 total**. Partial fulfillment reduces the count of served accounts before consent is applied. Only the paid portion of completed exchanges contributes. Failure-focused cases are additionally bounded by the estimated negative responses in that paid, consenting traffic. Integer participation needs at least four served accounts for hosted-only consent or ten for distribution consent; low use can yield fewer or zero cases.

Trial usage, benchmarks, rehearsal traffic, agents, generic Business Documents, private-hosted commitments and customer-hosted licenses are outside this public-product consent protocol. Existing training packets' legacy `rights.feedback` flags do not grant or deny this separately modeled customer consent.

The source deployment is fixed at study admission. A frozen source deployment and at most four observed deployment receipts preserve the history after ordinary upgrades or prepared handovers replace the live deployment object. Changing it stops further capture for that study, including after a later rollback. Paused service and unserved demand consume the calendar window without generating examples. Ending early keeps prior captured cases and captures nothing in the ending week. A nonempty closed report becomes reviewable at the following boundary. An empty report cannot generate a dataset.

There can be one active study per product. Retained history is bounded at **eight studies per product and sixteen overall**. Product-week source identities are stable, so repeated review or later curation cannot create fresh evidence from the same responses.

### Paid review and physical costs

| Review per 100 captured cases | Data staff-weeks | Development CUw | Output quality |
| --- | ---: | ---: | ---: |
| Quick | **1** | **0.5** | **65%** |
| Verified | **2** | **1** | **90%** |

Costs scale proportionally with the actual case count. Data work is capped at **one staff-week per week**. GPU processing uses **one MU** of separate workspace and a compatible general-purpose pool. Staff and compute progress independently; either can become the bottleneck. Pausing preserves paid progress.

The shared allocator supplies actual hardware grants. Bounded receipts reconcile normalized useful work with physical GPU work and its tariff. Existing cloud rent, payroll and owned-hardware bills pay for that work; review adds no duplicate ledger charge. The existing operating cost meter includes it under Development work.

A study permits one review. Completion first records a ready result; the dataset becomes available in `lab.commit` at the **next weekly boundary**. Before that boundary there is no raw packet that could bypass review through generic data preparation.

### Data, training and licensing

The output is a prepared reusable dataset with its exact captured source IDs, review receipt, quality, specialized coverage, behavior units and consent rights. It supplies **zero broad foundation units**. Failure-focused counts describe a deliberately selected sample and are not an independent product failure-rate estimate or a held-out benchmark.

Existing curation creates a separate revision and preserves the study's source identity and rights. Combining original and curated copies counts each underlying source once. Ordinary training freezes the selected corpus and finite targets; it consumes its own staff, GPU work and workspace. Evaluation remains separate and does not train the weights. A new release remains an explicit player decision.

Weight-distribution rights are the intersection of customer consent and inherited rights from the primary model and each routed secondary that actually contributed sampled cases. Zero-case routes add no restriction. Hosted-only feedback can train hosted products, but its descendants cannot be licensed as distributable weights. A review never changes the rights of an already saved model.

### Module boundaries

The Lab remains the sole owner of data and model state. Collection runs in `lab.resolve` after all modules have executed and current product usage is available. Paid review participates in the existing reserve/execute/resolve phases; packet publication occurs in commit. The implementation is split into collection and review contracts, authored content, pure simulation helpers, validators and product-specific UI components. Existing training recipes, serving economics, product release operations and rival plans remain the integration points.

## Earned end-to-end continuation

The [integration campaign](../tests/wave10-progression.test.ts) resumes the authentic published company and completes its prior paid rollback through ordinary commands. At **Week 389**, its normalized checksum rejoins the published **`4dff9002`** state before adopting feedback. The [complete progression receipt](evidence/wave10-progression.json) then records **19 ordinary weeks and eight commands**, with no resource grants or arrears.

| Stage | Observed boundary and work |
| --- | --- |
| Study queued | **Week 389** |
| Prospective collection | **Weeks 390–393**; **25 cases each week**, **100 total** |
| Reviewable report | **Week 394** |
| Verified review | Starts **395**, finishes **396**; **2 data staff-weeks**, **1 development CUw**, **1 MU** workspace |
| Dataset available | **Week 397**; **90% quality**, **100 behavior units**, **45% coding coverage**, **zero broad units** |
| Separate calibration training | **Weeks 398–399**; **16 useful development CUw**, **8.888888890 physical CUw** |
| Exact candidate evaluations | Capability and behavior reports available by **Week 401** |
| Paid paired rehearsal | Available **Week 403** |
| Prepared release | Work in **404–405**; available **406** |
| Explicit handover | Queued **406**, scheduled **407**, live **408** |

The company used its already earned training GPU pool for review. **1 normalized CUw** required **0.555555556 physical CUw**, attributed as **$41.66** of owned GPU variable cost in the settled report. Ordinary staff payroll, rented capacity and shared infrastructure expenses continued separately. Review introduced no second bill for the same work.

The candidate was trained from the company's original coding adaptation using only the new reviewed feedback. Its confident-error tendency changed from **10% to 5.5%**. Its base model's capability scores and reliability remained unchanged; false-refusal tendency remained **7%**. Every prior model stayed byte-identical. The currently serving API remained on its incumbent until the explicit handover.

A paid comparison against that incumbent retained **76 useful answers out of 100** for both models, with **11 → 6 confident errors**, **9 → 9 false refusals**, and **4 → 9 clarifications**. The candidate's coding score is **53.57**, compared with the incumbent's **54.20**; both have **89** reliability. This demonstrates a behavior tradeoff, not a universal capability upgrade. The comparison uses its established finite benign case bank; it does not promise a future live error rate or certify all deployment conditions.

Throughout all nineteen observed weeks, the funded API remained active and **100% served**, with one invoice per week, unchanged product/contract identity and uninterrupted fractional token carry. Each settled cost report reconciled attributed and shared compute to total compute, then compute and other operating costs to the company ledger. The hosted-only study's weight-distribution restriction propagated into the candidate.

Final recorded campaign state: **Week 408**, **`282813c5`**, **1,505,616 bytes**. The exported snapshot round-tripped byte-for-byte and remained below the existing 2 MB limit. Cash remained positive throughout; the minimum observed balance was the starting **$3,092,023.58**. This is one verified continuation of an already established company, not an opening-game completion estimate or an isolated profitability experiment.

## Browser and release verification

The [browser evidence](evidence/wave10-browser.json) records an independent run through visible controls on the managed preview. It imported the published Week 389 company, selected failure-focused hosted-only collection, stepped the four paid weeks, started verified review, selected the resulting dataset and original coding base in the Lab, queued both evaluations, paid for a paired rehearsal and release preparation, and explicitly handed the API over in **Week 408**.

The UI displayed **Calibration curriculum 12** as live, **154 billed API accounts**, **100% fulfillment**, the unchanged **$60.01 reference price / 599-request limit**, and **$23,064.63** of API billed revenue in the final week. The browser's IDs differ from the scripted campaign, so it has its own checksum: **`877897ec`**, **1,504,361 bytes**. Export → reload → export produced identical bytes. The preview's original **Week 0** company was then restored through file import and exported identically; the test did not replace a user's production-browser save.

The [captured interface](images/frontier-lab-wave10-feedback.png) shows the closed 100-case study, selected response estimates and completed paid review in the sparse three-column layout.

The final implementation gates passed:

- **406 automated tests**, zero failures, zero skips; includes the new collection, review, full progression and prior-engine compatibility cases.
- **TypeScript check**: `npm run typecheck` passed.
- **Production build**: the official Sites `build-site.mjs` completed successfully.
- **Browser workflow and persistence**: all stages through release verified; exact export/reload and original-save restoration checked.
- **Source whitespace validation**: `git diff --check` passed.

[Machine-readable verification](evidence/wave10-validation.json) records these gates. Browser interaction was verified on the managed preview; the existing private publication requires the owner's ChatGPT sign-in in the cloud browser. Sites publication status is checked separately when publishing. No real model API, payment system or new third-party dependency was added.

## Save compatibility and prior-build history

Valid **Wave 0–9** snapshots migrate without advancing time. A Wave 9 import first verifies the original checksum and saved representation, retains schema **5**, and changes only the content/build headers from **0.10.0 to 0.11.0**. Previously paid training, research, model rehearsals, release preparation, rollback entitlements, hardware, facilities, workloads, agents, contracts, billing remainders, cost reports and random streams remain intact. The earlier published generations retain their established migrations. [Migration routing](../src/core/snapshot.ts) verifies the source checksum before [migration](../src/core/migration.ts) can change any field.

Neither optional `data.feedbackStudies` nor `data.feedbackReviews` is initialized by migration. A company must use ordinary future commands to adopt those systems. The existing `packet.rights.feedback` boolean remains valid legacy metadata and is preserved; the new optional `packet.feedback` field is separate review provenance.

Every older header rejects both new maps, including empty objects, all four feedback commands, and new feedback provenance on either a data packet or a frozen `trainingRun.evidence` packet. A pause command with `paused: false` is still a new command and is rejected under an older header. The four commands are `start_feedback_study`, `cancel_feedback_study`, `start_feedback_review`, and `set_feedback_review_paused`. Earlier guards remain active: authentic Wave 9 rehearsal and release records cannot be relabeled as Wave 8 data. These cases are exercised in [Wave 10 compatibility checks](../tests/wave10-compatibility.test.ts).

Training continues to freeze its aggregate corpus proof and selected source IDs. Aggregate training evidence does not copy one source packet's review provenance onto a merged dataset; the reviewed source packet retains that proof. This follows the existing separation between individual packet receipts and the complete training corpus in [the training planner](../src/modules/lab-planner.ts).

## Original browser saves remain recoverable

The Wave 9 migration returns marker **10**. Reading an old browser save does not write or replace its bytes. Before the first upgraded write, [the browser persistence adapter](../src/persistence/wave0-browser.ts) archives the exact original under **`frontier-lab.wave9.original`**, then writes the current primary save. The recovery control exposes **Export original Wave 9 save** with filename **`frontier-lab-wave9-original.json`**. Older recovery copies remain available.

An existing Wave 9 original is never overwritten, including after repeated current saves. If the original archive cannot be written, the primary save remains untouched. If the archive succeeds but the primary write fails, the old primary and the successfully written original are both retained. The same behavior is verified independently from simulation replay in [browser persistence checks](../tests/wave1-persistence.test.ts). A confirmed replacement still uses the separate previous-save recovery copy.

The **2,000,000-byte** snapshot limit is unchanged. Serialization and import both measure UTF-8 bytes. An oversized current run cannot replace the previous usable browser save; raw recovery exports do not parse or rewrite their source.

## Authentic published Wave 9 baseline

The durable [Wave 9 snapshot](../tests/fixtures/wave9-snapshot.json) and [twelve-week expected oracle](../tests/fixtures/wave9-expected.json) were generated with the exact published source commit **`de0cb0a0c4b2b3ca8fb1cc9534b528f86fd85b6e`**, archived before Wave 10 production edits. Expected outcomes came from that archived Wave 9 engine.

The archived source first reran its ordinary [Wave 9 progression campaign](../tests/wave9-progression.test.ts). Its complete generated receipt matched the published [Wave 9 progression evidence](evidence/wave9-progression.json), including the **Week 389** checksum **`4dff9002`**, **nine ordinary commands**, and **1,392,923-byte** serialized final state. No money, research, staff, models, resource progress or hardware was granted to construct this baseline.

From the authentic **Week 380** state after the rehearsal, the original command `wave9-natural-command-6` starts forward release preparation and one ordinary week produces the migration fixture:

| Preserved starting evidence | Recorded value |
| --- | --- |
| Fixture week | **381** |
| Original content/build | **0.10.0** |
| Save schema | **5** |
| Canonical checksum | **`843ffe68`** |
| Serialized state envelope size | **1,404,495 bytes**, before the fixture file's trailing newline |
| Forward bundle status | **Preparing** |
| Paid normalized preparation work | **1 of 2 development CUw** |
| Paid physical GPU work | **0.555555556 CUw** |
| Paid ML preparation work | **1 of 2 staff-weeks** |
| Matching rehearsal | Complete; available **Week 380** |
| Live API model | Original source; candidate still evaluated and unreleased |
| Retained compute cost reports | **Eight** |

The company already has earned hardware, completed infrastructure work, paid commercial contracts, operating agents, active rivals and a genuine fractional API billing remainder. These are retained in the fixture rather than recreated as simplified test substitutes.

During development, the exact source archive and reproduction scripts were retained at `/workspace/scratch/4788498e7ff5/wave10-history/`. The committed fixture and oracle provide the durable baseline, including the source commit, original campaign commands, preparation command, future command schedule, saved financial and operational observations, and complete-state hashes.

## Twelve future weeks from the published engine

For a company that does not adopt feedback, the current engine matches **all twelve complete saved states for Weeks 382–393**, normalizing only `contentVersion` and `buildVersion` back to **0.10.0** before comparison. No resource, economy, model, history, command or random field is excluded.

The three future commands are explicit player intent from the original campaign. Each is submitted at the recorded current week through the ordinary command path, with its original ID; each is admitted and receives an accepted receipt. Their availability and execution boundaries remain unchanged:

| Command queued | Ordinary commitment and outcome |
| --- | --- |
| **Week 383:** promote the prepared release | Commits in **384**; candidate becomes live in **385** |
| **Week 385:** start paid rollback preparation | Work finishes in **386**; bundle becomes available in **387** |
| **Week 387:** promote the prepared rollback | Commits in **388**; retained source becomes live in **389** |

The forward handover fixes the original rollback deadline at **Week 391**. Save/reload never extends it. The source keeps serving through preparation and through the promotion command boundary. After restoration, the saved release and rollback histories remain complete.

| Saved week | Published state hash | Forward release | Rollback | Live API model |
| --- | --- | --- | --- | --- |
| **382** | `b3789595` | Ready | — | Source |
| **383** | `af6e20bb` | Ready | — | Source |
| **384** | `527b0225` | Scheduled | — | Source |
| **385** | `7cbc5b43` | Released | — | Candidate |
| **386** | `4ebb2e6b` | Released | Ready | Candidate |
| **387** | `e3c6c34c` | Released | Ready | Candidate |
| **388** | `e0df50f2` | Released | Scheduled | Candidate |
| **389** | `4dff9002` | Released | Complete | Source |
| **390** | `674c06e2` | Released | Complete | Source |
| **391** | `0edc9678` | Released | Complete | Source |
| **392** | `6b8a10af` | Released | Complete | Source |
| **393** | `014efbcf` | Released | Complete | Source |

The replay rejoins the original natural campaign's **Week 389** checksum exactly. It then continues for four more ordinary weeks, reaching **`014efbcf`** in Week **393**. This checks future behavior beyond a successful one-time import.

Every observed API week has **100% fulfillment**, the same product and billing contract, and exactly one invoice. At the forward switch, billing carries **722,800 → 212,800**; at restoration, it carries **902,400 → 502,200**. Those values are the token meter's fractional billing numerator, not cents. The unchanged contract retains its original terms, and neither switch resets its remainder.

The historical **Week 379** rehearsal cost report remains canonically unchanged while retained, then expires normally in **Week 387**. Eight reports remain in the bounded history. In each future week, assigned compute plus shared compute equals total compute, and the report's company revenue and operating expenses equal the settled company ledger. The original source model and completed rehearsal remain unchanged throughout. These are observations of this funded fixture; preparation itself does not guarantee sufficient resources for every company.

Repeated save/reload is also tested for all twelve weeks, including saves while explicit promotions are queued. The restored path stays canonically identical to uninterrupted advancement, preserves both once-only cutovers, and retains the original rollback deadline. The checksum and deterministic hashes protect simulation consistency; they are not authentication or an anti-cheat mechanism.

## Focused compatibility verification

The focused gate verifies **99 distinct checks** across `wave1-migration` through `wave4-migration`, `wave5-compatibility` through `wave10-compatibility`, and `wave1-persistence`.

All **37 prior-engine compatibility checks** passed, including the nine new Wave 10 cases. The first combined run also exposed a shared authored-content validator that still expected Wave 9 to be the current roadmap entry. After correcting its completed/current threshold for Wave 10, only the five affected migration and browser-persistence suites were rerun; all **62 checks passed**, with zero failures and zero skips. The unchanged compatibility suites did not need another run for that content-only correction.

The nine new compatibility cases cover exact header-only migration, twelve published future hashes, repeated save/reload around queued promotions and both cutovers, source checksum corruption, empty-map and command guards under every prior header, packet and frozen-evidence provenance guards, preserved legacy rights, and rejection of a relabeled authentic Wave 9 release history. Three new storage cases independently verify exact original-byte retention, non-overwrite behavior and both archive/primary-write failures. No full-suite run, production build or publication is claimed by this focused gate.

Reproduce the complete compatibility selection with:

```sh
node scripts/test-wave0.mjs wave1-migration wave2-migration wave3-migration wave4-migration wave5-compatibility wave6-compatibility wave7-compatibility wave8-compatibility wave9-compatibility wave10-compatibility wave1-persistence
```
