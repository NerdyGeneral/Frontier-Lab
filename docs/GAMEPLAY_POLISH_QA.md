# Frontier Lab 0.36 gameplay and compatibility QA

## Baseline and scope

The published 0.35 engine log contained **942 tests: 889 passed, 53 failed**. The failures were inherited from earlier releases; that number did not mean 53 independently confirmed production defects. This pass investigated the failing assertions against the source rules and, where available, the exact original published Git revisions.

The release work keeps the existing resource costs, finite work requirements, customer populations, deadlines, billing, and save validation requirements. Original historical snapshot fixtures and their published expected hashes were not regenerated to make tests pass.

## Player-facing fixes

- Manual and delegated model drafts, plus up to twelve named blueprints, are saved locally for the current lab. A successful primary save synchronously binds their metadata to those exact bytes, closing the immediate-save/close gap. Stale timers and asynchronous completions cannot overwrite a replaced lab's workspace. Blueprint editing does not spend money or advance time; game exports remain game snapshots, while draft metadata stays in this browser.
- Manual/delegated handoffs retain the exact training command, including advanced and synthetic choices. Restored drafts finish loading before new navigation intents apply. Specialist evaluation recommendations match the selected model goal and retain the ordinary research and paid-report requirements.
- The model designer has compact sections, visible current-setting summaries, a resource/skill forecast strip, local undo, and a copied comparison candidate. Exact research links open the required discovery, and the general research shortcut opens the custom designer. Selecting Research resets the actual workspace scroll container so its heading and section tabs remain visible.
- Four specialist briefs require owned qualifying models, paid evidence, real serving work, and two qualifying service weeks before a once-only payment. New calendars vary announced opportunities by campaign seed. New rival campaigns expose their efficiency, reliability, or reach approach and reserve enough capacity to progress their paid research. Existing saved calendar sequences and active rival campaigns retain their original rules.
- Narrow-screen controls wrap long names. The forecast strip stops sticking when the observed visual viewport becomes short, including when a phone keyboard opens. Existing measured navigation offsets keep the task above the bottom navigation.

## What the inherited failures actually covered

| Failure group | Count | Cause and correction |
| --- | ---: | --- |
| Historical oracle and progression setup | 28 | Tests imported an old campaign into current rules, advanced it using modern staff output and market opportunities, and then changed only its header before comparing it with an old full-state hash. Historical replay now runs under the fixture's actual content version. Progression scenarios first reproduce the original paid setup and hash, then explicitly upgrade before testing current features. |
| Resource and staffing assumptions | 13 | Tests removed only the named specialist, while modern employees still supplied secondary Research, Design, or Data points. Starvation fixtures now remove every contributing employee through ordinary allocation commands. Exact small grants use the founder's shared allocation rather than assuming a quarter-time specialist still produces 0.25 normalized work units. Zero-grant, weekly-cap, independent-meter, pause, and paid-provenance assertions remain. |
| Display wording | 7 | Assertions expected old staff-week terminology or superseded explanatory text. Current assertions check the current point labels and the same operational condition. |
| Current-version assertions | 3 | Tests asserted the obsolete 0.33 build version. They now compare newly initialized state with the active content/build metadata. |
| Canary population | 1 | A hardcoded account count no longer described the current market. The test now derives paid demand from the pre-service cohorts and their authored contracts, then checks exact disjoint 10% candidate traffic, full service, and one exact subscription invoice. |
| Operations wage forecast | 1 | The expected staffing cost assumed one normalized work unit per full-time specialist. The comparison now uses the authored 30 Operations points, retaining the exact incremental upkeep, wage, and sunk-capital assertions. |

### Production compatibility fixes

Some original-version replays still differed after their rules were selected correctly. Side-by-side execution against the original published commits isolated these differences to persisted quote and bottleneck text. `src/modules/lab.ts`, `compute.ts`, `prepared-releases.ts`, `release-rehearsals.ts`, `runtime-guardrails.ts`, `assured-api.ts`, and `batch-inference.ts` now retain the original wording for historical staff rules while preserving current point terminology for modern campaigns.

`src/modules/workforce.ts` exposes one `usesWorkPointProfiles` predicate and includes 0.36, preventing the new release from falling back to old one-role employee output. This does not change the current authored point profiles or grant arithmetic.

The backward-header tests for earned cost accounting, replay research, explicit batch placement, and two-skill curricula now start at their actual feature-era versions. This prevents unrelated new calendar metadata from intercepting the rejection before the feature the test is meant to examine.

### Additional scenario coverage reached after repairing the setup

The Wave 12 natural progression test now records its initial valid pretty save as well as the later compact saves. It still verifies the two-megabyte boundary, exact reloads, original-save recovery, and refusal to replace a usable save with oversized output.

The Wave 14 digest continuation exposed a capacity-planning assumption in the old scenario. The current public market left only **75.57 of the required 90 useful CUw** available before the six-week deadline. Reallocating the finished lab's 12 CU did not improve those grants: the compatible physical pool was the limiting resource. The corrected fixture rents 16 additional general cloud CU through an ordinary command, advances the paid boundary, and allocates that capacity before accepting the digest. The scenario now passes with full completion and the exact $22,500 payment; neither the deadline nor required work was reduced.

Wave 7's recovery scenario similarly encountered a genuine serving-capacity shortage after public demand grew. It now buys compatible headroom while the original action is paused and releases the finished lab allocation. The existing twelve-week bound, saved action/evidence key, actual paid work, and exactly one final customer invoice remain asserted and pass.

## Authentic 0.35 save migration

The new fixtures were generated from the untouched published commit **`46dc6912d46dd783dce678b23257ee03ee4a6676`**, using ordinary paid commands.

| Fixture | Saved week | Bytes | Canonical checksum |
| --- | ---: | ---: | --- |
| `tests/fixtures/polish-035-initial-published.json` | 0 | 41,945 | `89ffa217` |
| `tests/fixtures/polish-035-active-published.json` | 573 | 1,561,004 | `1af98daa` |

The active fixture contains paid customization research, a running customized 120-CUw design, and a queued action. `tests/gameplay-polish-migration.test.ts` checks that:

- Migration changes only the content/build headers for authentic 0.35 saves. Cash, time, research, existing opportunity sequence, rival intent, model evidence, queued commands, and every other saved field remain equal.
- The active training plan remains exactly equal through save/reload and four ordinary weeks of continued paid work. The queued action is accepted and completed work increases.
- New specialist receipts/proofs, new calendar sequencing, rival tactics, and queued specialist commands cannot be smuggled through older headers, even with a recomputed checksum.
- The first browser write archives the exact original 0.35 bytes, including original line endings and trailing whitespace, before writing the upgraded primary save.
- If the archive write fails, the prior primary save remains untouched.

Older pre-opportunity saves legitimately receive a new calendar anchored at their saved week, with `sequenceVersion: 2`. Existing 0.34/0.35 calendars retain their already-announced sequence. Exact migration assertions distinguish these cases.

## Verification record

The following are completed focused observations, not a substitute for the final full run:

- Resource regression batch: **161/167 passed**. All original gameplay/resource/canary failures in that batch passed. The six remaining failures were five newly expected calendar fields and a missing test import; those test corrections were made before the full gate.
- Natural progression batch: **7/9 passed** before the final historical wording and save-observation corrections.
- Final historical/progression batch: **19/20 passed**, including every original Wave 12/13 oracle state, exact compact-save observations, and the repaired Wave 12 natural progression. Wave 14's current digest capacity scenario remained unresolved in that run.
- Four isolated feature-era backward-header cases: **4/4 passed**.
- TypeScript verification after the regression changes: **passed**.
- Authentic 0.35 migration and exact browser backup suite: **5/5 passed** (release integrator's focused run).

### Full engine gate and targeted follow-up — complete

- Log: `/tmp/frontier-036-full-engine.log`
- The frozen full run completed with **961 tests: 953 passed, 8 failed**.
- Five failures matched the known post-compilation corrections: Wave 14's paid compatible-capacity purchase and obsolete 0.35 current-version assertions in `model-design-migration`, `strategy-migration`, `custom-synthetic-admission`, and `wave26-synthetic`. The complete five-file follow-up passed **23/23**, recorded in `/tmp/frontier-036-postgate-known.log`.
- W20-R01 previously required Swift's final price to be lower under every campaign tactic. Its revised sixty-week observation checks ordinarily quoted cash-funded commands, exact application of accepted price/allowance changes, authored tactic selection, accepted positioning, and real paid model or efficiency work. Harbor's paid license renewals, finite shared markets, and validation checks remain.
- W21-R04 checks the new calendar-version rejection first, then removes only that metadata to retain the previous strategy, workforce, and campaign-rule rejection checks. The complete `wave21-release` file, including W20-R01 and all three natural campaign routes, passed **5/5** in `/tmp/frontier-036-release-final.log`.
- W7-N01's capacity correction passed **1/1** in `/tmp/frontier-036-recovery-final.log`, retaining the original time bound and all once-only action/invoice checks.
- The post-gate saved-byte binding and SHA-256 tests passed **14/14** in `/tmp/frontier-036-workspace-sync-tests.log`. Seven of those cases were added after full-suite compilation; the other seven were also present in the full run.
- **All 53 inherited failures are resolved. No engine test remains unresolved.** Deduplicating the full run and targeted results by exact test name yields **968 distinct engine tests with passing latest results**. This is a combined verification record, not a claim that a single 968-test full run was executed.

### UI gate

- The complete UI run in `/tmp/frontier-036-full-ui.log` finished **200 tests: 199 passed, 1 failed**. The remaining market test assumed a fixed opportunity name despite the new seeded calendar; its corrected focused suite passed **2/2** in `/tmp/frontier-036-market-ui.log`.
- Four additional regressions for the live-discovered research and short-viewport paths pass **4/4** in `/tmp/frontier-036-live-corrections.log`: exact Week 0 M8 inspection without opening the paid catalog; return to the same retained training task and intent; ordinary method navigation after paid starter preparation with prerequisites intact; and a named, scrollable All menus path to every destination group. Combined with the corrected full-run results, **204 distinct UI tests have passing latest results**; this is not a claim of a single 204-test run.
- Draft persistence, import validation, stale-session protection, immediate save/close/reopen binding, and late asynchronous-digest rejection are covered by the passing workspace follow-up above.
- Final TypeScript check: **passed**, recorded in `/tmp/frontier-036-final-typecheck.log`.
- Production build through the supported Sites build helper: **passed**, recorded in `/tmp/frontier-036-final-build.log`, and passed again after the live-discovered UI corrections in `/tmp/frontier-036-corrected-build.log`. The bundler reports its existing large-chunk advisory; it is not a build failure.

### Browser checks before publication

- On the 0.36 managed preview, verified that the Research heading and section tabs remain visible on entry; the Model customization shortcut opens the custom designer; editing the candidate name updates the forecast; and a named blueprint saves with visible confirmation. The lab remained paused, with no paid commands executed during these checks.
- The shared preview daemon subsequently switched to another active project, so the attempted browser reload could not establish Frontier draft restoration. The immediate-save/close/reopen behavior is covered by the passing persistence regressions above.
- The 390px layout received a source/CSS reachability review, including bottom-navigation height, layer order, short visual viewport behavior, shrinking controls, and the mobile research list. This is not a claim of physical-phone testing.
- Desktop comparison, synthetic/delegated handoffs, exact research routing, and goal-specific evaluation are covered by the rendered interaction tests. Authentic saved-game migration and backup failure behavior are covered by the ordinary paid-state fixtures and browser-persistence tests.
- The published build receives a separate live-site smoke check; its observed results are reported with the release.

### Live-site follow-up during release

The first 0.36 publication opened the existing Week 0 lab with the same $48,000 and paused clock. The custom-designer shortcut worked. A changed draft name survived a real browser reload and re-entry, after which the original name was restored. Keeping a comparison, applying the Research analyst purpose, returning from a research detour, and Undo also retained/restored the expected design and 24-CUw budget. The browser log showed no application errors; its separate extension metadata errors were not attributed to the game.

This smoke check exposed two additional UI edge cases for the final release correction: a named research requirement entered the still-locked catalog in an unprepared starting lab, and at 400% browser zoom the 340-by-234 CSS-pixel viewport left only 15px for a fixed task between header and navigation.

Exact research links now inspect the selected discovery in the always-visible tree while the catalog remains gated, retain the return-to-training path, and explain the unchanged funding requirement. Unlocked catalogs still use the normal focused method task. At a short observed visual viewport, the destination grid folds into the existing All menus directory while All menus, Results, Save, and Settings stay visible. That directory becomes a named, scrollable region between the measured header and bottom utility row. Ordinary phone-height navigation is unchanged. The four focused regressions and the correction's TypeScript check pass; final live verification is reported with the release.

These checks establish deterministic accounting, provenance, migration, and interaction behavior. They do not establish long-term balance or player enjoyment through playtesting.
