# Wave 27 design QA

**Review date:** 9 November 2026. **Package, build and content version:** 0.27.0. **Save schema:** 5.

## Scope and visual direction

Wave 27 adds the Release workspace from the Frontier Lab Studio Expansion Plan. Public rollout connects paid rehearsal and preparation to a metered canary, an incident record and an explicit handover. Private appliance follows one qualified buyer order through fabrication, shipment, installation, acceptance and a separate support term. S3 and S4 bring the research catalog to 33 methods; discovery grants eligibility without granting hardware, customers or completed work.

The workspace continues the established cream paper, muted mint and dark teal palette, serif headings, outlined controls and compact evidence cards. Public rollout and Private appliance have their own persistent tabs. Cohort comparison, the incident desk and shared capacity sit together on wide screens and stack into one column at narrow widths. The appliance dossier keeps qualification, the delivery timeline and settlement evidence visually distinct. Classic gives the new desk its own paper surface and retains the same controls.

The interface uses code-native HTML and CSS, the ordinary command pipeline and exact saved evidence. Labels distinguish research, qualification, scheduled work, actual grants, completed delivery and posted receipts. Setup fees, work allowances and recurring charges are named separately. See the [release notes and authored rules](docs/WAVE27_RELEASE.md), [public desk](src/ui/studio-release-desk.tsx), [appliance desk](src/ui/studio-appliance-desk.tsx) and [scoped styles](app/release-desk.css).

## Public rollout and incident behavior

The form exposes the actual prepared candidate, incumbent, chosen traffic share, per-cohort sample floor and cumulative candidate CUw allowance. Available shares are 1%, 5% and 10%; sample floors are 100–10,000 completed requests in each cohort. The allowance is positive, at most 32 CUw and sufficient for the chosen floor. The $1,000 setup fee is separate. Copy explains that the allowance limits work and does not reserve future capacity or constitute a cash deposit.

The desk shows exact model revisions, frozen release configuration, preparation work and staff grants, separate resident memory, connected pools and action blockers. Cohort rows retain their requested/completed denominators, fulfillment, useful answers, confident errors, false refusals, clarifications, work, memory and attributed compute cost. Trials remain on the incumbent. Both paid cohorts settle through one existing product invoice; attributed GPU cost does not create another charge.

Incident presentation preserves scope, affected revision, severity, sample quality and a dated routing boundary. Scheduled copy identifies the first eligible traffic week. A stop decided after observed traffic says incumbent-only routing starts at its recorded following boundary; it does not claim that restoration already happened. Configuration or arrears detected at commit can stop traffic at that same boundary. After the recorded restoration week, the desk identifies completed restoration. Historical reports retain incidents and omit historical promotion actions.

Qualification requires actual evidence and enables a separate prepared handover. Stopped canaries cannot be promoted. The existing paid rollback remains available after a completed handover. Saved observation receipts retain gross bill, credits and net bill even if the bounded invoice list later drops the original row; the desk then identifies retained settlement proof instead of claiming no invoice existed. The [12 interface scenarios](docs/evidence/wave27-ui-checks.json) include this pruning case and both sides of the restoration boundary.

### Live canary acceptance

The browser imported the ordinary-command-derived Week 550 company, selected 10% traffic, a 100-request sample floor in each cohort and a 4 CUw allowance, then submitted the start action with Enter. The draft survived changing tabs and leaving and reopening Release. Duplicate starts and premature handover were disabled. Week 551 charged one $1,000 setup fee and showed a scheduled canary with no experimental traffic; reload preserved that state.

At Week 552, 76,700 eligible paid requests split into 69,030 incumbent requests and 7,670 candidate requests. Both cohorts achieved 100% fulfillment. Useful-answer rates were 83.94% and 77.28%, a 6.66 percentage point regression that triggered the five-point gate. The candidate consumed 1.534 CUw. The week produced one $11,460 product invoice with zero service credits and one corresponding ledger receipt.

The Week 553 view showed completed incumbent routing, retained the original deployment and model, and had no candidate traffic in current grants or the following request list. Handover remained disabled. That week produced one $11,496 invoice and one ledger receipt. The final screenshot verifies dated stop copy and an inline incumbent-to-candidate arrow.

The final browser export exactly matches the independent default-command-ID oracle in both bytes and validated state: 1,461,888 bytes, checksum and canonical state hash `9f0a4cc6`, Week 553 and cash $6,103,378.40. All 24 oracle assertions pass with no state differences. Ending cash includes the company's other ordinary operations and is not a canary profit estimate.

Evidence: [exact canary browser/oracle comparison](docs/evidence/wave27-canary-browser-oracle.json), [browser observations](docs/evidence/wave27-browser.json) and [final Week 553 canary screenshot](docs/images/frontier-lab-wave27-canary-stopped.png).

## Private appliance behavior and acceptance

The buyer dossier exposes Cedar Records' actual requirements and qualified or blocked model/design/foundry choices. It retains draft IDs instead of silently changing the selected model or hardware. The captured package binds the evaluated model, runtime, rights, report and design. Qualification requires a compact or medium dense model with Documents capability of at least 60 and reliability of at least 90%, distribution rights, two wide-memory dense-inference racks, at least 14 useful CU and 32 MU, sufficient workload throughput and resident workspace, and fabrication within eight weeks.

The timeline uses real order phases and grants. Fabrication and $1,000 delivery setup are paid at the order boundary; racks ship directly to the buyer. Installation requires two actual ML staff-weeks after shipment, with at most one per week. The following acceptance boundary creates the installed artifact and pays the $38,000 bundle once. A distinct 12-week customer-hosted license/support term charges $300 per week and requests 0.25 Commercial FTE. The receipt section separates that recurring service from the equipment payment. Buyer-operated inference consumes no lab serving work and creates no lab token charge.

The live browser journey ordered the two-rack, 14 CU/56 MU package using the standard six-week foundry route. It displayed $22,400 fabrication and $1,000 setup. Shipment at Week 576 preceded the first actual ML staff-week; the second was granted at Week 577. Healthy installation now has explanatory text even when no bottleneck is recorded. Acceptance and the one $38,000 bundle payment occurred at Week 578, together with the first $300 support invoice. Week 579 added the second support invoice without duplicating the bundle.

The final export matches the independent oracle byte for byte and as validated state: 1,463,152 bytes, checksum `0e2eb06a`, Week 579, revision 972, next ID 3259 and cash $6,450,317.79. The evidence records one bundle receipt and two service invoices. Ending cash includes the rest of the company's business and operating expenses.

Evidence: [paid appliance acceptance trace](docs/evidence/wave27-appliance-acceptance.json), [exact browser/oracle comparison](docs/evidence/wave27-appliance-browser-oracle.json) and [accepted appliance screenshot](docs/images/frontier-lab-wave27-appliance.png).

## Responsive layout, keyboard and navigation

The Release workspace was inspected in managed Chrome using native desktop zoom. These are measured CSS viewports, not device emulation or physical touch-device tests.

| Desktop zoom | CSS viewport | Observed result |
| --- | --- | --- |
| 100% | 1363 × 936 | No document horizontal overflow or offscreen Release inputs; wide layout and keyboard focus verified. |
| 175% | 779 × 535 | No document horizontal overflow or offscreen Release inputs; public content fits one approximately 669-pixel column. |
| 400% | 340 × 234 | No document horizontal overflow; public layout is one 279-pixel column; Release form controls use 16-pixel text. Appliance inputs remain within horizontal coordinates 44–293. |

Keyboard navigation reached the Private appliance button with a visible 3-pixel solid outline. Controls retain explicit labels, accessible headings, table captions and action-specific disabled explanations. The responsive layout stacks form fields and keeps table scrolling within its own container. Source checks also verify that label targets and ARIA references resolve and HTML IDs are unique.

The Business Documents “Product setup & protection” link opens `business-commitments` and the visible Business customers inspector. Classic retains `release-desk`, `public-release` and `private-appliance` anchors, the same command controls and no document overflow. Links retain real anchor destinations alongside Studio navigation callbacks.

All 49 authored meaningful text/status foreground-background pairs meet the 4.5:1 check, with a minimum of **4.616:1**. Four foreground constants were darkened to resolve seven initially failing combinations. This calculation covers the authored paper, card, table, history and receipt surfaces; disabled controls and decorative marks are outside this text check. It is not a claim of a complete accessibility certification.

Evidence: [live layout, focus and navigation observations](docs/evidence/wave27-browser.json), [contrast calculations](docs/evidence/wave27-ui-contrast.json) and [interface scenarios](docs/evidence/wave27-ui-checks.json).

## Draft persistence and bounded performance work

An advanced company of roughly 1.5 MB exposed lengthy synchronous command/weekly-step acknowledgements and reloads. A bounded inspection found new Release selectors scanning model and report history while their desk or inner tab was hidden. The new Studio project-summary additions were small in the same diagnostic and did not explain the multi-second delay.

The Release desk and its inner tabs now mount on first visit, then retain mounted drafts while hidden. Visibility memo gates skip inactive updates; reopening refreshes from the current game, permission and callback context. Importing or starting a new lab still resets the workspace through its existing epoch key. The simulation, validation, load lifecycle and other app components were not refactored for this change.

| Diagnostic snapshot | Prior always-mounted desk | Hidden desk after gate | Active Public desk after gate |
| --- | ---: | ---: | ---: |
| Week 570 appliance order | 147.7 ms | 0.3 ms | 63.3 ms |
| Week 552 stopped canary | 228.2 ms | 0.2 ms | 233.9 ms |

These are Node server-rendering measurements under shared machine load, not browser input-latency measurements. The stopped-canary active render still performed four whole-state copies; its hidden render performed none. No universal visible-render speedup is claimed. Twelve comparator assertions verified refresh after relevant context changes, and input state hashes remained unchanged. All 12 active interface scenarios were rerun after the memo change. A development refresh error caused by changing the component export to a memoized export cleared after a full reload; the final live workspace then loaded and completed acceptance.

Advanced-campaign weekly settlement, validation, serialization and substantial existing rendering remain synchronous and can briefly stall the interface. The bounded fix removes unnecessary hidden Release work; it does not resolve all advanced-campaign latency. See [before/after measurements and freshness assertions](docs/evidence/wave27-render-profile.json).

## Verification and resolved findings

**264 distinct focused checks pass:** 245 selected existing checks and 19 new Wave 27 checks. Reruns are counted once, and the full repository suite was not run.

| Coverage | Distinct checks | Final recorded result |
| --- | ---: | --- |
| Engine/catalog, browser persistence and migration | 92 | Complete rerun passes; includes four new Wave 27 migration checks. |
| Selected legacy market, billing, commerce, hardware, release, session, Studio, planning and synthetic suites | 157 | All pass. |
| Canary workflow | 9 | Complete rerun passes. |
| Appliance workflow | 6 | Five initial passes plus the corrected lifecycle rerun. |

Initial failure logs remain available. Resolved findings include older research/roadmap gates excluding S3/S4, a preview/submission inconsistency for unexpected canary payload fields, and test expectations that needed to respect existing model admission and bounded ledger retention. The selected tests cover paid qualification, actual shared-resource grants, deterministic traffic, hard allowance limits, stop and promotion decisions, once-only bills, delivery timing, support, migration archives and rejection of forged future fields. See the [independent test summary](docs/evidence/wave27-test-summary.json) and [release verification details](docs/WAVE27_RELEASE.md#verification).

Separately, 12 server-rendered interface scenarios span the opening lab, migrated Week 556 company, six appliance stages and four canary stages. They verify actual phase and grant text, temporal routing copy, frozen billing after invoice pruning, label/ARIA targets, anchors, unique IDs and no render-submitted commands or state mutation. These scenarios and the 49 contrast calculations are not added to the 264 focused-test count.

The new Release interface files pass focused ESLint. The changed-file lint comparison retains **two pre-existing errors and thirteen pre-existing warnings** from the published Wave 26 base; no new rule/severity/headline diagnostics were introduced. This is not a clean repository-wide lint claim. See the [baseline comparison](docs/evidence/wave27-eslint-baseline.json).

The final browser console review since **2026-11-09T18:38:03.519Z** found **zero application errors or warnings**. **94 extension-origin messages** were excluded. The final stop-copy screenshot and visible keyboard state were verified after the stable reload. See [browser evidence](docs/evidence/wave27-browser.json).

## Save compatibility and restored preview

The 0.26-to-0.27 migration preserves the existing company and queued commands, updates validated build/content headers and grants no resources or work. Original 0.26 browser bytes are archived before replacement and exposed through Recovery; an archive-write failure preserves the primary save. New canary/appliance records remain absent until adoption, and historical content headers cannot conceal new commands, research or receipts. These guarantees are covered by the recorded migration checks.

After the two acceptance journeys, the original preview company was restored through the visible import flow. Its export is byte-identical to the preserved original: **1,525,373 bytes**, SHA-256 `386201e80c678710e9a45427d5eab92a075d6e9429721920f8c2ebe7e599254c`. The company remains paused at **Week 556 with $6,155,197.86**, retaining its one queued Week 557 action. No additional week was settled in that company. See [restoration evidence](docs/evidence/wave27-preview-restoration.json).

Wave 26 design QA is preserved in [docs/WAVE26_DESIGN_QA.md](docs/WAVE26_DESIGN_QA.md).

Final TypeScript checking and the production Worker/client build both passed. See [build evidence](docs/evidence/wave27-build.json).
