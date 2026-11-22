# Frontier Lab 0.38.3 — gameplay debug check and recovery fix

Build **0.38.3** fixes a confirmed previous-run recovery defect: replacing a lab preserved its paid game state but omitted the separately saved planning workspace. Restoring that backup could lose the development goal, drafts and blueprints. Content remains **0.38.0** and save schema remains **5**.

**Prepublication verification is complete.** The persistence regressions, complete UI execution, corrected fixture reruns, final TypeScript check and isolated production build passed. Publication and the live 0.38.3 recovery check follow separately. The full **1,046/1,046 engine pass is a fresh clean 0.38.2 baseline before this patch**, not a claim that the entire engine suite was rerun on 0.38.3.

## Recovery behavior

The automatic previous-run archive now uses the existing portable-save envelope, preserving the exact saved snapshot together with validated planning metadata. Recovery restores both. The current company is saved before replacement so a newly edited goal or draft can be included even when its separate browser-storage write failed.

The metadata must belong to that exact saved lab. Live metadata requires the successful save receipt's exact bytes; a stored workspace requires the snapshot's SHA-256, byte length and player identity to match. Foreign, malformed or stale metadata cannot be attached to a different campaign. Core-state validation, strict workspace validation and envelope integrity all remain enforced.

A failed current save, invalid live metadata or failed required archive stops replacement. Raw engine-only, historical and corrupt recovery copies retain their existing compatibility and original bytes. Metadata cannot grant research, resources or paid work. Recovery compression now accommodates the portable envelope while retaining finite bounds: **3,000,000 text units**, **18,000,002 outer decoded JSON bytes**, and the existing **32 MiB inner snapshot limit**. Independent read-only review found no concrete blocker in the four changed production implementation files.

## Automated checks and exact scope

| Check | Result | Scope |
| --- | --- | --- |
| Full engine baseline | **1,046/1,046**, 522.13 s | Clean build 0.38.2 at commit `cbe6ef5798ce1a881fe334135a68f0169f8f77ae`. The runner copied its sources at startup, before the persistence patch. |
| Patched persistence and compatibility | **129/129**, 32.99 s | Core saving, capacity, metadata binding, origins, historical migration and new previous-workspace cases. |
| Complete UI execution | **259/259**, 67.96 s | All UI cases, including the real replacement/recovery callbacks. |
| Final callback rerun | **19/19**, 3.89 s | Complete affected callback file after a test-only fixture correction. Included in the UI scope above. |
| Final previous-workspace rerun | **8/8**, 5.64 s | Complete new core regression file after the same fixture correction. Included in the persistence scope above. |
| Final TypeScript / production build | **Passed / passed** | Final corrected source; build ran in isolation. |

Every passing test run reports zero failures, cancellations, skips and todos. Initial TypeScript checking caught an unsupported `documents` purpose in two new test fixtures; both now use the supported `analyst` purpose. The 129-case run preceded that fixture correction, and the complete corrected eight-case file passed afterward. The complete callback file also passed its final rerun. No production code changed for these corrections. The counts overlap and must not be added into a unique release-test total.

The new regressions verify paid progress and queued work alongside both drafts, goals and blueprints; exact sidecar binding; live metadata after sidecar-storage failure; rejection of stale receipts; quota compression; preservation on archive/primary write failure; same-byte replacement; legacy recovery; and finite decompression. Actual UI callbacks additionally cover stale sessions, delayed work, memory-only imports, blocked originals and failed saves.

The [machine-readable check record](evidence/debug-0383-release-checks.json) contains exact commands, counts, scope, source fingerprint and **SHA-256 hashes for every retained log and trace**. Logs are retained in [evidence/debug-0383](evidence/debug-0383). The successful build retains the existing large-client-chunk and framework route-classification notices; neither was fatal. The previous lint backlog is outside this pass, with no fresh lint count claimed.

## Paid gameplay coverage

### Fresh campaigns and late endings

The baseline suite ran three separate fresh **Garage / release-rules** campaigns with seed `frontier-lab-wave-0`. These use accepted commands, real weekly costs, paid preparation/training/evaluation, research and earned revenue. Funding helpers wait for cash to be earned; they do not mint resources or force progress.

| Route | Earned week | Verified outcome |
| --- | ---: | --- |
| Platform | **203** | Paying consumer and developer services without a business product. |
| Specialist | **208** | A contested buyer, licensed weights delivery and renewals. |
| Frontier | **214** | Earned cash funds hardware, research and a held-out frontier release. |

These routes include repeated paid training/evaluation and preservation of the ending through reload and continuation. Their fresh results are in the retained engine log under `W21-R01`, `W21-R02` and `W21-R03`.

### Three-origin opening and save continuation

A separate [three-origin diagnostic](evidence/debug-0383/opening-scenarios.json) ran the same deliberately simple paid opening through Week 10. It is not an earliest-completion strategy.

| Origin | Seed | Start cash | Data prepared | Training | Evaluation | Live service | Paying-service chapter | Week 10 cash |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Garage | `frontier-lab-wave-0` | $48,000 | W2 | W3–W5 | W6 | W8 | W10 | **$38,380** |
| University | `frontier-lab-wave-0:university` | $30,000 | W1 | W3–W5 | W6 | W8 | W10 | **$13,380** |
| Consultancy | `frontier-lab-wave-0:consultancy` | $36,000 | W2 | W3–W5 | W6 | W8 | W10 | **$31,380** |

Each pays for **12 CUw** of training and its held-out evaluation, and finishes with zero arrears. Consultancy earns its **$8,000 pilot payment at Week 8**; its paying-service chapter is still Week 10. At W3 active training, W5 queued evaluation and W10 paying service, each origin passed restored-state equality **and independently advanced next-week parity**: **nine paired save/continuation checks** total. The diagnostic source and log are retained with the results. Its bounded ledger-expense field is not a lifetime-spending total.

A distinct [manual/delegated opening trace](evidence/debug-0383/manual-delegated-opening-trace.json), also on clean 0.38.2 with the default Garage seed, reaches first sale at **W10 manually** and **W14 through delegation**, ending at W11 and W15 respectively. It records **17 + 18 = 35** successful canonical save roundtrips followed by continued play. Those checks are not literal-byte equality or separately advanced next-week comparisons. The trace's one-off generator was not retained; the three-origin script is a separate reproducible diagnostic.

### Advanced systems continuation

The baseline advanced-systems test loads the authentic `systems-036-active-published.json` campaign at **Week 574** (build 0.36.1/content 0.36.0, default Garage seed). It then pays for research prerequisites, architecture levels 1 and 2, and four candidates across expert networks, persistent-state models and adaptive reasoning. It earns all four associated challenges and four paid client outcomes, each requiring two delivery weeks, while maintaining positive cash/no arrears and passing state validation and reload equality.

This is a mature-save continuation. It is not one uninterrupted fresh-origin-to-advanced-systems playthrough. The current test does not emit its final week, so the older historical Week 763 record is not presented as a fresh measurement. University and Consultancy were exercised through W10, not all endings. Program tests earn the first Efficient systems accreditation and test subsequent gating; they do not establish natural completion of every stage of every program. The 20 custom-seed cases cover starting worlds and experiment terms, not 20 complete campaigns. Many of the 1,046 engine cases are unit/validation checks rather than paid campaigns.

## Actual public-browser gameplay

The [browser checkpoint record](evidence/debug-0383/browser-0382-gameplay.json) documents actual controls in a fresh random **Garage campaign on public build 0.38.2**, with no injected state or fabricated resources. Preparation finished W2, paid training W5 and evaluation W6. Reloading during active training at W3 preserved **4/12 CUw and $44,000 cash**. Next decision at 5× stopped on training completion.

Deployment reached 100% at W7 with activation scheduled for W8; the decision run next stopped at the first paid-product chapter at W10. The lab kept **4 rented CU at $1,000/week**. W10 billed five accounts **$60**, leaving **$37,060**; W11 billed eleven accounts **$132**, leaving **$36,192**. Both observed service weeks completed **100% of requests**. The W11 cash change was exactly **$132 − $1,000 = −$868**. These figures belong to the random browser campaign and differ from the deterministic three-origin diagnostic.

All **five in-game diagnostics** passed: catalog/state validation, deterministic 20-week replay, once-only rent/overhead, read-only forecast preservation and atomic rejection of invalid allocations. The test-created [Week 11 portable save](evidence/debug-0383/browser-gameplay-week11.portable.json) retains **Coding partner**, **QA Restore Draft** and **QA Recovery Blueprint** for the recovery check. The user's original pretest save was exported privately and is not included in the repository.

**Postpublication work remains separate:** verify live 0.38.3 previous-run recovery of those planning records and paid state, then restore the original browser save. The manual run reached Week 11; the late-game evidence above comes from automated paid campaigns. No complete manual late-game or physical phone-device playthrough is claimed.
