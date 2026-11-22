# Wave 27 — Release desk and private appliance

Wave 27 continues the Frontier Lab Studio Expansion Plan with a dedicated Release workspace. Public rollout connects the existing paid rehearsal and preparation systems to a real serving canary, an incident record and an explicit handover. Private appliance qualifies a fixed model/hardware package for one buyer and tracks fabrication, installation, acceptance and a separate support term.

**Package, build and content version:** 0.27.0. **Save schema:** 5.

## Research and navigation

The Studio navigation now has a Release destination alongside Research, Projects, Market, Finance and Save. The workspace has Public rollout and Private appliance tabs, with links to exact model evidence, product protection, staffing and compute. Release work appears in Projects and the shared planning forecast. Classic retains the same command controls and anchor destinations.

| Discovery | Prerequisites | Fee | Staff work | Research compute |
| --- | --- | ---: | --- | ---: |
| S3 — Release telemetry | R1A and R12A | $7,000 | 4 Research staff-weeks | 8 CUw |
| S4 — Private appliance | R7A, R12 and S3 | $11,000 | 5 Infrastructure staff-weeks | 12 CUw |

These are ordinary paid discoveries. They bring the catalog to 33 methods. Completing research does not provide a prepared release, hardware, a customer order or completed delivery work.

## Public canary

A canary starts from an available forward prepared release with its paid rehearsal, preparation work and exact evaluated model/runtime identities. Setup costs **$1,000**. Choose **1%, 5% or 10%** of eligible paid requests, a floor of **100–10,000 completed requests in each cohort**, and a positive cumulative candidate-work allowance of at most **32 CUw**. The allowance must be large enough for the selected floor. It limits work; it is not a cash deposit or a reservation of future capacity.

Candidate requests are a deterministic, disjoint subset of paid traffic. Trials remain with the incumbent. The two models request their own actual serving work and connected memory from the shared allocator. The candidate receives lower resource priority. Public acquisition forecasts include both requests, and retention uses the observed combined behavior.

One combined usage record goes through the existing customer invoice writer. API input/output/internal tokens share the contract's single fractional billing carry. Subscription credits use request-based fulfillment even when the models require different work per request. Compute attribution remains part of the existing cost report; it does not create a second expense or customer invoice.

The desk reports each cohort's requested and completed requests, fulfillment, model revision, useful answers, confident errors, false refusals, normalized and physical work, connected memory and attributed compute tariff. Its cumulative comparison matches the incumbent's segment mix to the candidate's observed mix. Both cohorts must meet the floor before qualification or ordinary regression assessment. These observations describe paid benign-request behavior; harmful-request policy holdouts remain separate paid evidence.

The automatic gates cover:

- Severe availability or confident-error incidents once the relevant 20-request minimum is present: below 50% candidate fulfillment or at least 25% confident errors.
- A grant that fails to preserve 98% fulfillment for the candidate or the incumbent plus its trials.
- A sample-qualified regression of at least five percentage points in useful answers, confident errors or false refusals, or candidate compute tariff per completed request above 150% of the incumbent's.
- An exhausted allowance, eight observation weeks without sufficient evidence, changed configuration or company arrears.

A stop records scope, candidate revision, severity, evidence quality, the reason and the exact routing-restoration boundary. Configuration or arrears detected at commit stop candidate traffic at that boundary; stops decided after observed traffic restore incumbent-only routing the following week. An operator can also stop a scheduled or collecting canary at the next command boundary. Stopped or qualified traffic returns to the incumbent. Qualification enables a separate existing prepared-release promotion; it never switches the full product automatically. The original paid rollback workflow remains available after handover.

This first protocol supports stateless public requests through a single uncached route. Retained sessions, enabled routing/prefix caching/evidence checks, bound retrieval, and enabled or pending runtime guardrails expose specific gates. A canary cannot silently remove or transfer an installed protection. Each paid prepared bundle has one retained attempt, with at most 24 canaries per save and eight observations per attempt.

## Private appliance

Cedar Records buys one fixed customer-hosted document appliance. Qualification requires a compact or medium dense model with its exact paid evidence, Documents capability of at least **60**, reliability of at least **90%**, inherited weight-distribution rights, and a validated dense inference design with wide memory.

The order supplies **two racks**, at least **14 useful CU** and **32 MU**, sufficient throughput and resident workspace for the captured buyer workload, and a fabrication lead of at most **eight weeks**. Standard, Express and High-yield routes share their ordinary foundry constraints with owned batches and accelerator sales, including queued orders. A separate standalone license command cannot bypass this package's hardware requirements.

The lab pays the actual quoted fabrication cost and **$1,000 delivery setup** at the order boundary. The racks ship directly to the buyer and never enter the lab's fleet. Only after shipment can actual ML grants complete the **two staff-weeks** of installation. The following acceptance boundary freezes the installed artifact, pays the **$38,000 bundle once**, and starts a distinct **12-week customer-hosted license/support term at $300 per week**.

Support requests **0.25 Commercial FTE per week** from the existing staff allocator. Missing support creates ordinary service credits and can terminate the term under the existing business rules. Buyer-operated inference consumes no lab serving work and produces no lab token invoice. Later display-name or model changes do not rewrite the order's captured hardware, model identity, rights, report or delivery evidence.

## Save compatibility and receipt validation

The 0.26-to-0.27 upgrade validates and clones the existing company, changing only its build/content headers. It grants no research, money, hardware, customers, staff or work. New canary/appliance fields remain absent until adoption. Earlier supported saves retain their existing migration paths.

Before the first upgraded browser write replaces a 0.26 save, the persistence adapter archives its exact original bytes. Recovery exposes **Export original 0.26 content save**. An archive-write failure leaves the primary save untouched. Tests compare every retained slice and queued command from the published Wave 26 synthetic company.

Checksummed imports validate paid research and command evidence, exact evaluated identities and rights, shared resource grants, cohort math, deterministic outcomes, billing carries, incident decisions, foundry reservations, installation grants and once-only settlement. The same ordered canary decision function is used by simulation and validation: a stopped or qualified record cannot be resurrected by changing its status. New research, commands, receipts or Cedar contracts cannot be hidden under historical content headers.

Implementation references: [canary rules](../src/content/wave27-canary.ts), [canary decisions](../src/modules/release-canary.ts), [traffic and billing](../src/modules/canary-traffic.ts), [appliance workflow](../src/modules/private-appliances.ts), [receipt validators](../src/core/wave27-canary-validation.ts), [appliance validator](../src/core/wave27-appliance-validation.ts), and [browser recovery](../src/persistence/wave0-browser.ts).

## Verification

**264 distinct focused checks pass across the recorded runs: 245 selected existing checks and 19 new Wave 27 checks.** This counts each check once, without adding reruns again. The entire repository suite was not run for this release.

| Coverage | Distinct checks | Recorded result |
| --- | ---: | --- |
| Engine/catalog, browser persistence and new migration checks | 92 | Complete rerun passes, including four new Wave 27 migration checks |
| Selected legacy market, billing, cost, commerce, release, hardware, session, Studio, planning and synthetic suites | 157 | All pass |
| New canary workflow | 9 | Complete rerun passes |
| New appliance workflow | 6 | Five initial passes plus the corrected lifecycle rerun |

The initial smoke failures came from older research/roadmap gates that excluded S3/S4 and Wave 27; the corrected gates pass the complete affected rerun. The canary tests found one real preview/submission inconsistency for unexpected payload fields, now rejected in both paths. Its memory-shortage scenario was also corrected to respect existing resident-model admission rules before testing actual cohort workspace starvation. The appliance lifecycle assertion now checks upfront expenses when posted and permanent payment proofs after the bounded ledger trims older rows. That correction did not change production behavior. Original failure logs remain available alongside their resolved reruns.

- [Smoke and migration rerun](evidence/wave27-migration-rerun.txt)
- [Initial smoke failures](evidence/wave27-migration-checks.txt)
- [Selected legacy regression](evidence/wave27-regression.txt)
- [Canary checks, clean rerun](evidence/wave27-canary-rerun.txt)
- [Initial canary checks](evidence/wave27-canary-checks.txt)
- [Initial appliance checks](evidence/wave27-appliance-tests-initial.log)
- [Appliance lifecycle rerun](evidence/wave27-appliance-tests-lifecycle-rerun.log)
- [Read-only interface evidence](evidence/wave27-ui-checks.json)

The command-derived acceptance helpers continue the published Week 537 company through ordinary research, staffing, hardware and release commands. They inject no money, completed work, research or readiness.

### Appliance browser acceptance

The browser imported the command-derived Week 569 company and submitted one ordinary appliance order, `command-3218`. Its $22,400 fabrication commitment and $1,000 delivery setup settled in Week 570. Reload retained the paid order. The UI showed shipment in Week 576, one actual ML grant that week, the second grant and completed installation in Week 577, and buyer acceptance in Week 578. Acceptance produced one $38,000 bundle receipt and the first $300 service invoice. Week 579 produced a second $300 service invoice while the original bundle receipt remained singular.

The final browser export is **byte-for-byte identical** to the independent default-command-ID oracle: checksum **`0e2eb06a`**, Week 579, revision 972, next ID 3259, cash **$6,450,317.79**, and **1,463,152 bytes**. Ending cash includes the company's other ordinary business and operating costs; it is a test-state identity, not an appliance profit promise. Buyer inference produces zero lab serving work and zero lab token charges.

Evidence: [paid acceptance trace](evidence/wave27-appliance-acceptance.json), [exact browser/oracle comparison](evidence/wave27-appliance-browser-oracle.json), and [accepted package screenshot](images/frontier-lab-wave27-appliance.png).

### Canary browser acceptance

The browser imported the command-derived **Week 550** company with an available paid Chat rehearsal and prepared release. It selected **10% traffic, a 100-request sample floor in each cohort, and a 4 CUw candidate allowance**. The draft survived switching Release tabs and leaving and reopening the workspace. Enter submitted the ordinary command **`command-3134`**; duplicate start and premature handover controls were disabled. The **Week 551** boundary charged the single $1,000 setup fee and retained a scheduled canary with no experimental traffic. Reload preserved that scheduled state.

The **Week 552** observation split **76,700 eligible paid requests** into disjoint incumbent and candidate cohorts. Both exceeded the sample floor and reached 100% fulfillment. The measured useful-answer loss of **6.66 percentage points** triggered the five-point regression gate and recorded restoration for Week 553.

| Observed measure | Incumbent | Candidate |
| --- | ---: | ---: |
| Completed / requested paid requests | 69,030 / 69,030 | 7,670 / 7,670 |
| Useful answers | 83.94% | 77.28% |
| Confident errors | 5.24% | 10.00% |
| False refusals | 6.99% | 6.98% |
| Fulfillment | 100% | 100% |

The candidate consumed **1.534 CUw** of its 4 CUw allowance. Week 552 produced **one $11,460 Chat invoice**, with zero service credits and one corresponding ledger receipt. At **Week 553**, the desk showed completed incumbent routing, the original incumbent deployment and model remained in place, and the current grants and next-week request list contained no candidate traffic. Handover remained disabled. That restored week produced **one $11,496 Chat invoice** and one corresponding ledger receipt. The save retained exactly one canary observation and one setup payment.

The final live browser export is **byte-for-byte identical** to the independent default-command-ID oracle: **1,461,888 bytes**, checksum and canonical state hash **`9f0a4cc6`**, **Week 553**, and cash **$6,103,378.40**. Complete state and envelope equality, unchanged RNG streams, successful deserialization and validation, routing restoration, and once-only invoice settlement all pass. The comparison records **24 passed checks** with zero state differences. Ending cash includes the company's other ordinary operations throughout this acceptance journey.

Evidence: [exact canary browser/oracle comparison and frozen observation](evidence/wave27-canary-browser-oracle.json), [focused canary checks, clean rerun](evidence/wave27-canary-rerun.txt), and [ordinary-command acceptance fixture](../tests/fixtures/wave27-canary.ts).

### Interface and compatibility checks

The live Release workspace was inspected at 1363×936, 779×535 and 340×234 CSS pixels using native desktop browser zoom. Public rollout and Private appliance forms stayed inside the page, the narrow public layout became one column, and narrow form controls used 16-pixel text. Keyboard navigation exposed a solid 3-pixel focus outline. The Business Documents setup link opened its business commitments panel. Classic retained the same release controls and stable section anchors. These checks use desktop zoom, not physical touch-device testing.

Twelve separate server-rendered interface scenarios check labels, identities, frozen bills, anchors, temporal copy and input immutability. All 49 authored text/status color pairs exceed 4.5:1 contrast, with a minimum of 4.616:1. The new desk and inner tabs mount on first visit and preserve their drafts while hidden; freshness assertions cover reopening after game and action-context changes. This avoids the new desk's measured 148–228 ms cold rendering cost when it has not been opened. These Node diagnostics are not browser latency measurements. Advanced-company weekly settlement remains synchronous and can briefly stall the interface.

The final console review after the stable preview reload found no application errors or warnings; 94 extension-origin messages were excluded. Changed-file ESLint still reports two errors and thirteen warnings already present in the published base. The new Release interface files pass focused lint. The baseline comparison is retained rather than claiming a clean repository-wide lint run.

After acceptance testing, the original paused Week 556 preview company was restored through the visible import flow. Its export is byte-for-byte identical to the preserved original: 1,525,373 bytes, including the one queued Week 557 action. No further week was settled in that company.

Evidence: [browser observations](evidence/wave27-browser.json), [original preview restoration](evidence/wave27-preview-restoration.json), [interface scenarios](evidence/wave27-ui-checks.json), [contrast calculations](evidence/wave27-ui-contrast.json), [rendering diagnostics](evidence/wave27-render-profile.json), [lint baseline comparison](evidence/wave27-eslint-baseline.json), and [design QA](../design-qa.md).

Final TypeScript checking and the production Worker/client build both passed. See [build evidence](evidence/wave27-build.json).
