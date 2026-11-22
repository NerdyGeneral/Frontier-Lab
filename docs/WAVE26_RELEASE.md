# Wave 26 — Research tree and synthetic data

Wave 26 continues the Frontier Lab Studio expansion with a navigable research map, model and corpus comparisons, and a paid synthetic-data workflow.

**Package/build/content version:** 0.26.0. **Save schema:** 5.

## Research notebook

Research opens a full-width notebook with a map of the 29 existing discoveries and two new programs. Five lanes cover Data & learning, Evaluation & alignment, Models & serving, Retrieval & agents, and Operations & silicon. The map reads the actual research catalog and prerequisites. Selected-node details explain the first unmet gate, discovery costs, work requirements and available applications. Search, filters and a list alternative support finding a method without losing its dependencies.

The original catalog and application forms remain accessible alongside the map. Synthetic data and Compare are direct notebook destinations and are also reachable from the Data, Training and Evaluation workstations.

## New discoveries

| Program | Prerequisites | Discovery fee | Staff work | Research compute |
| --- | --- | ---: | --- | ---: |
| S1 — Synthetic provenance | R2A and R10A | $6,000 | 3 Data staff-weeks | 6 CUw |
| S2 — Targeted synthetic curriculum | S1 and R4C | $9,000 | 5 ML staff-weeks | 12 CUw |

S1 opens synthetic generation and review. S2 opens the targeted training recipe. Each application has its own price and resource requirements after the discovery finishes.

## Paid generation, review and training

Choose an eligible evaluated teacher, a licensed prepared source packet and a target capability. Generation costs $1,500 and consumes development GPU work, teacher memory and ML supervision. Funding the next step costs $500 and requests Data review plus a separate audit with Research staff and GPU work. An accepted packet records the teacher, original source lineage, audit and inherited rights.

A fixed batch is associated with its original source lineage and target domain. Source overlap, reserved holdout overlap and quality failures are quarantined. Only accepted unique cases become training units. Changing a source label, using a curated copy or selecting another teacher cannot create another independent batch from that same source and target. Synthetic outputs cannot feed recursive generation.

The targeted curriculum costs $1,000 plus normal resource use and requires S2. It uses an audited packet with a permitted student, preserves teacher lineage and bounds learning by the evaluated teacher. Final capability and independent outcome evaluations remain separately paid jobs.

Synthetic jobs appear in Projects, can be pinned, and expose their current phase and resource blockers. Planning previews identify generation, review and audit workloads by name.

## Comparison workspace

The model comparison separates capability scores from evidence on the exact model version, including independent holdout results. Corpus comparison makes prepared units, source overlap and rights visible. Selections are local UI drafts; comparisons do not queue work or alter the company.

## Compatibility

This release uses content/build version **0.26.0** and retains **save schema 5**. Synthetic jobs and training receipts are optional extensions; an existing company receives no synthetic records, money, research, employees or work when upgraded. The 0.23-to-0.26 migration clones the validated company and changes only its content/build headers. The dedicated migration test compares every retained slice and queued command after normalizing those two headers. Older supported saves continue through their existing migration paths.

Deserialization itself does not rewrite stored bytes. Before the first upgraded browser save replaces a 0.23 snapshot, the browser archives its **exact original bytes**. The recovery menu exposes them as **Export original 0.23 content save**. If that archival write fails, the primary save remains untouched and can still be exported. Tests cover the raw-byte export, preservation across later writes, and archival-write failure. New synthetic methods, commands and receipts cannot be hidden under a historical content header.

Generation, review, audit and targeted training use the existing weekly command boundary and shared staffing/compute allocator. Work depends on actual grants, compatible connected memory and normal operating costs. The existing silicon foundry and hardware-order admission rules now recognize 0.26 while retaining their historical-version restrictions. No fixed financial oracle was regenerated for this release.

Implementation references: [synthetic contracts](../src/contracts/wave26-synthetic.ts), [authored rules](../src/content/wave26-synthetic.ts), [receipt validation](../src/core/wave26-synthetic-validation.ts), [migration](../src/core/migration.ts), and [browser save/recovery adapter](../src/persistence/wave0-browser.ts).

## Automated verification

**187 distinct focused checks pass across the recorded runs: nine new Wave26 checks and 178 selected legacy checks.** Rerun counts are not added again. The full repository test suite was not run for this release.

| Coverage | Distinct checks | Recorded evidence |
| --- | ---: | --- |
| Wave26 synthetic workflow and compatibility | 9 | [Native run and resolution note](evidence/wave26-synthetic-checks.txt); [passing S03/S04 rerun](evidence/wave26-synthetic-rerun.txt) |
| Selected existing engine, persistence, laboratory, research, hardware, holdout, curriculum, release, Studio and planning suites | 178 | [Initial selected regression](evidence/wave26-regression.txt); [catalog rerun](evidence/wave26-catalog-rerun.txt), [curriculum rerun](evidence/wave26-curriculum-rerun.txt), [hardware rerun](evidence/wave26-hardware-rerun.txt) |

The initial legacy run passed 173 of 178 checks. It exposed the old 29-discovery test expectation, an unfinished curriculum-draft handling issue, and three silicon admission failures caused by exact-version guards. The corrected affected suites passed **33/33 catalog/core checks, 6/6 curriculum checks and 14/14 hardware checks**. The original failures remain in the initial log for review.

The recorded native Wave26 run passed eight of nine checks. Its remaining failure was a test comparing model rights, which contain `hosted` and `weights`, with the extra data-packet `feedback` field. Correcting that assertion required no engine change. The targeted rerun passed **2/2**, including an added teacher transfer-rights rejection check. Together these runs verify all nine distinct Wave26 checks.

The new checks cover paid research and teacher/source qualification; repeated, curated and partially overlapping sources; actual ML/GPU shortages; paused progress and exact save/reload continuation; distinct Data review and Research/GPU audit stages; immutable accepted packets; restricted training paths and teacher ancestry; independent paid evaluation; pure views; recovery bytes; and forged receipts or historical headers with recomputed checksums.

Reproduction entry points:

```sh
node scripts/test-wave0.mjs wave26-synthetic
```

### Command-derived automated acceptance

The [acceptance fixture helper](../tests/fixtures/wave26-synthetic.ts) continues the published [Wave16 company](../tests/fixtures/wave16-snapshot.json) from Week 537. It settles the saved queued commands, preserves the resulting serving allocation, rents additional capacity and pays for both new discoveries through ordinary commands. It does not inject cash, completed research, employee readiness or resource grants. The [Wave26 tests](../tests/wave26-synthetic.test.ts) verify the resulting stages and save/reload invariants.

| Stage | Week | Observed result |
| --- | ---: | --- |
| Qualified teacher and source ready | 546 | S1 and S2 completed through paid research; live serving allocation preserved |
| Teacher generation finished | 548 | 100 unaccepted candidates after 16 development CUw; review still requires separate funding |
| Audited packet available | 552 | 53 accepted units; 20 source overlaps, 10 reserved overlaps and 17 quality failures quarantined |
| Separate student training finished | 554 | 12 development CUw completed; Documents capability 41.55, with other capabilities and reliability preserved |
| Paid capability and independent evaluations finished | 556 | The new candidate has its own reports; independent holdout records 36 actual successes out of 100 cases |

These are deterministic game outcomes. The accepted packet records 77% audit quality, and the student's result reflects that evidence quality rather than automatically matching the teacher. The automated fixture uses explicit command IDs; a browser journey using the normal command counter has different identities and checksums and requires its own comparison oracle.

### Browser acceptance

The visible browser workflow completed all five application orders from Week 546 through Week 556. It verified generation across reload, disabled reserved policy sources and repeat-source batches, paid staff/GPU receipts, the next-boundary release of accepted data, targeted training, and both separately paid evaluations. The final exported snapshot is **byte-for-byte identical** to the independently generated default-command-ID oracle: checksum **7e9a62b6**, Week 556, revision 947 and cash $6,155,197.86. The company's ongoing revenues and normal operating expenses remained part of the campaign; that ending cash is a test-state identity, not a promised synthetic-data return.

The comparison UI displayed Seed 0 Documents capability at 30 and the targeted student at 41.55, with its other capabilities and reliability unchanged. The independent report recorded 36 actual successes, 48 claimed completions, and 37 independent-checker accepts including one false acceptance. Model capability, audited data quality and independent outcome evidence remain visibly distinct.

An existing content-0.23 Week 15 save retained its $17,428, two people and 8 CU. An ordinary R1 order survived reload and settled once with its actual staff progress and research-compute blocker. Native desktop browser zoom checked CSS widths of 1363, 779 and 340 px, with no horizontal page overflow or off-screen inputs; these are not physical touch-device tests.

Evidence: [browser walkthrough](evidence/wave26-browser.json), [exact oracle comparison](evidence/wave26-browser-oracle.json), [weekly acceptance trace](evidence/wave26-acceptance.json), [model comparison](images/frontier-lab-wave26-comparison.png), and [independent outcome](images/frontier-lab-wave26-outcome.png).

## Interface performance

Research graph summaries reuse the same domain gates without copying the complete company for every node. The selected action and existing controls share an immutable full-payload quote for the same game/content objects. A changed state or payload requires a fresh quote, and submission still validates admission independently.

On the accepted Week 556 save, cold research-tree state copies fell from 25 to 3 and repeated renders with unchanged state used zero. All 186 node-status and 161 exact blocker-message comparisons passed. These Node measurements describe eliminated rendering work; long campaigns still use synchronous simulation settlement. See [performance and freshness evidence](evidence/wave26-performance.json) and the [design QA](../design-qa.md).

## Current scope limits

Each generation job is a fixed 100-candidate, single-domain batch. An overlapping original source lineage can supply a given target domain only once, including when a different teacher or curated copy is selected. That history is retained; the current save admits at most **32 synthetic jobs**. Accepted packets remain reusable.

The targeted recipe uses one audited packet and a separate student. Its maximum target is bounded by the family ceiling, five capability points below the teacher, and fifteen points above the saved foundation anchor; evidence quality can produce a smaller gain. It preserves the other capabilities and reliability. Replay, mixed curricula, adapters, profile rerolls and optional automated checkpoints are outside this recipe's supported choices. Synthetic data and synthetic-trained descendants cannot start a recursive generation chain.
