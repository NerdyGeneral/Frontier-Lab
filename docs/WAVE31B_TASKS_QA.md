# Wave 31B — Historical named tasks and decision layouts QA

**Historical candidate build:** 0.31.1. **Recorded:** 10 November 2026.  
**Release disposition:** this Wave 31B work is included in the combined **0.32.0** release; **0.31.1 was not separately deployed**.  
**Status:** the recorded focused automated checks, browser task journeys, final native 400% review wrapping and keyboard-footer check, and original-save byte restoration passed for the historical 31B candidate.

**This record predates the user-authorized workforce productivity changes.** Its protected-source and economy-parity results apply only to the recorded 0.31.1 candidate against published 0.31.0. They do **not** establish economy parity for 0.32.0, which changes specialist output. [Wave 32 — Weekly workforce points](WAVE32_WORKFORCE_POINTS.md) records the combined release's current simulation contract and its separate validation, build and publication gates. No final 0.32.0 browser, build or deployment result is inferred here from these older receipts.

## Scope and implementation contract

Wave 31B gives training, evaluation, the first Basic Chat launch, staffing, and compute a shared decision layout with editable settings beside their costs and requirements. It also makes task selection explicit where several decisions share one retained workbench.

| Named task | Existing retained owner |
| --- | --- |
| Hire staff (`hire-staff`) | `people` |
| Assign time (`assign-staff`) | `people` |
| Allocate compute (`allocate-compute`) | `compute` |
| Rent or release compute (`rent-compute`) | `compute` |

The canonical `ActionControl` exposes a stable task identity through `data-studio-primary-for`, independently of its current command kind. A named task footer requires one exact visible match. Incomplete, blocked, missing, or ambiguous choices cannot substitute another command. Review still activates the original form control and its current authoritative payload.

The retained form key remains the company epoch plus the owner's draft generation. Switching between named tasks sharing an owner retires the previous review and request identity without resetting that form's draft generation. The existing reducer controls review, submission, acknowledgement, detours, and company replacement.

This is historical acceptance for **Wave 31B**, not the complete Wave 31D workspace refit. The task names and staff-effort wording below are the labels observed before the later point-based changes. The recorded task bodies may require vertical scrolling. No universal reduction in scrolling, runtime performance improvement, or full economy regression claim is made.

## Historical baseline and protected source

The source baseline was clean when captured and matched published Site version 36. Every comparison in this section concerns that frozen baseline and the historical 0.31.1 candidate, not the current combined 0.32.0 source.

| Reference | Value |
| --- | --- |
| Baseline build / Site version | **0.31.0 / 36** |
| Baseline commit | `3658d92e5156b9983d77261447eb0670b64262b6` |
| Baseline Git tree | `01edec62bc0d64ac63ea2518a61e6e6b0c1ced88` |
| Frozen source archive | **484 tracked files; 2,856,056 bytes** |
| Archive SHA256 | `0e3739b65d21fc3e22b4dfbceab716238262adce714ba040b4b3cadcc5a24e98` |

The initial manifest covered 206 files under `src/core`, `src/modules`, `src/contracts`, `src/persistence`, and `src/content`. The agreed presentation exception was `src/core/studio-tasks.ts`, leaving **205 protected simulation files** for the separate source comparison.

Of those 205 files, **204 were byte-identical** to the baseline. The sole changed file was `src/content/catalog.ts`, where `buildVersion` changed from `0.31.0` to `0.31.1`. No protected file was added or removed in that comparison. Normalizing only that version string restored the exact baseline aggregate:

```text
de8c3fac49c20bdab172f3e02859f33f71cebc4de00899725af47d38dea8ce47
```

The recorded 0.31.1 raw aggregate was:

```text
a1b6ad4da07d2986ae7510c8f1d25c306d0b7766b94cc119d621caeaa4e679d7
```

Aggregation hashes sorted `path + NUL + file SHA256 + newline` entries. The original inclusive 206-file manifest remains frozen separately.

The `studio-tasks.ts` exception was checked exactly: removing the four approved task registry entries restored its baseline SHA256, `c0077bf1dfa99441dc7f6384b355108f8ac0314c3e1436648c3940e2a09dd080`. The recorded candidate file hash was `7ff380f39f226250182e0312f0837dcafa68ce0343c6b2d7819dadf18f00763b`. Its reducer and all other task code were unchanged at that gate.

A second source check after the browser-driven staffing presentation changes matched all 205 raw hashes and the task-file hash from the final 31B parity gate. That check supported reusing the recorded lifecycle and replay results for the then-presentation-only fixes. The later authorized workforce simulation changes fall outside this source comparison and require the Wave 32 checks.

## Historical automated verification

| Check | Observed result | Scope |
| --- | --- | --- |
| Focused lifecycle suite | **109 passed; 0 failed** | 101 existing cases plus eight new named task navigation cases. No skips or cancellations. |
| Unique rendered UI/helper checks | **127 passed; 0 failed** | 117 existing integrated checks plus ten new menu/form checks. |
| Targeted rerun after staffing presentation fixes | **22 passed; 0 failed** | The 12 existing staffing cases and ten new menu/form cases. These overlap the 127 unique checks and do not increase that count. |
| State/save replay | **37 exact checkpoints matched** | Full command results, settlement results, authoritative state, and serialized saves across three scenarios. |
| Persistence replay | **9 exact comparisons matched** | Existing storage writes plus the saved-byte receipt path; three exact byte receipts checked. |
| Fresh-company comparison | **Matched except build header** | Only the documented new-company build version was normalized. |
| TypeScript after the browser-driven presentation fixes | **Passed; exit 0** | `node node_modules/typescript/bin/tsc --noEmit`. |
| Standalone 0.31.1 production build / deployment | **Superseded by the combined 0.32.0 release** | The final combined build and publication results belong in the Wave 32 release record. No standalone 0.31.1 deployment occurred. |

### Focused commands

The lifecycle command was:

```sh
node scripts/test-wave0.mjs wave30-task-state wave30-submission wave29-browser-task clock wave30b-task-state wave30b-journey wave30c-results wave29-persistence-cache wave30c-results-persistence wave30d-navigation wave31b-task-navigation
```

The 117-check existing UI integration command was:

```sh
node scripts/check-wave30e-ui.mjs tests/wave31-data-ui.test.tsx
```

The new ten-case UI suite was run separately:

```sh
node --import tsx --test --test-reporter=spec tests/wave31b-menu-ui.test.tsx
```

After the staffing spacing, context, label, and founder-preset disclosure adjustments, the affected checks were rerun together:

```sh
node --import tsx --test --test-reporter=spec tests/wave30c-staffing-ui.test.tsx tests/wave31b-menu-ui.test.tsx
```

### What the new cases establish

[Named task navigation tests](../tests/wave31b-task-navigation.test.ts) cover exact task resolution into the existing owner; unchanged draft generation through compute and staffing mode changes; retirement of old reviews and receipts; blocking a sibling switch during submission; duplicate confirmation admission; rejection of late acknowledgements; training-to-compute detours and return; close/reopen; explicit reset; and company replacement.

[Menu and form tests](../tests/wave31b-menu-ui.test.tsx) cover the named hire and assignment forms, locked recruitment, exact founder/employee targeting, invalid and missing assignments, observer controls, named compute entries, the retained allocation/rental input sections, disabled unchanged rental, and Classic compute access. The footer's strict action-selection cases remain in its existing dedicated suite and are not duplicated in this count.

These component and helper tests establish rendered semantics, selected values, and command-control scope. The mounted browser checks below establish actual navigation, retained React drafts, focus behavior, and geometry.

## Replay method and limits

The historical parity harness compared the 0.31.1 candidate with the frozen published v36 source and expected candidate build `0.31.1`. The baseline engine first migrated each fixture and serialized it. Both implementations then imported those identical bytes. Command results, states, save bytes, and storage outputs were compared without field normalization. Only the separate fresh-company comparison normalized its build header.

The scenarios are:

- Opening through the first sale, using ordinary paid commands.
- An advanced commercial company from the existing published Campus fixture.
- Focused staffing and resources, including founder/employee assignments and the existing atomic people/compute plan.

All 37 checkpoints and nine persistence comparisons matched. The full historical economy/gameplay suite was not rerun. Source protection established that the historical 31B simulation and persistence implementation remained unchanged beyond the recorded build label; it did not establish that every possible gameplay path was exercised. **These results do not claim 0.32.0 economy parity:** the combined release intentionally changes workforce productivity and has separate engine, allocation, migration and recovery validation.

The first-training, evaluation, and first-launch browser states were generated through the existing verified opening trajectory with ordinary engine commands, then imported through the game UI. No ad hoc economy fields were injected. Private fixture save bytes are excluded from this source record.

## Mounted browser task journeys

These historical checks used the actual pre-points game UI in Chrome. The measurements below are CSS pixels from the recorded browser states. They supplement the automated checks and apply to the stated tasks and viewports.

### Command admission and unchanged authoritative state

Double-confirming starter data preparation scheduled **exactly one** `prepare_data` command for `starter-public`. The game week did not advance.

A separate draft-navigation journey began with the prepared-data fixture and ended with an exported save. The before and after exports matched **byte for byte**, with SHA256:

```text
c2ccfd92fce3f31a707a928e4d6c43fcb509aee2a08a96e25c04c7ae9f05ba49
```

This is a comparison of the test fixture before and after draft navigation. The separate original-save restoration check was subsequently completed for this historical candidate; its receipt is recorded below. Neither comparison verifies the later 0.32.0 migration or original-content recovery export.

### Training, staffing, and return

The training draft selected `document-adaptation`, base `seed-0`, dataset `starter-public`, and the `balanced` profile. It survived **planner → hire → assign → return**. The same method and inputs remained after closing and reopening the task and after the observed **1920 × 1080**, **1366 × 650**, and **720 × 850** viewport changes.

In staffing, the selected hire role remained **Data** after switching into assignment and back. The founder's draft remained **0.5 FTE ML / 0.5 FTE Data**, with the other observed roles at zero. The task title and original review control continued to identify the chosen action. Escape and the original return destination behaved correctly in the recorded journeys.

### Compute choices and exact disabled binding

The allocation draft retained **0 serving / 3 development / 1 research CU** after visiting rental, and the rental draft retained **6 CU** across the corresponding mode changes. Returning from the compute task preserved the original Studio destination.

Clearing the development allocation produced an incomplete draft. Its disabled primary still read **Review: Set compute allocation**. A blocked **2 CU** rental kept **Review: Change cloud capacity** disabled. Neither case selected the sibling command as a replacement.

The allocation review was also opened through the actual named primary. Its confirmation remained a next-week decision; opening the review did not advance time.

### Evaluation and first Basic Chat launch

Evaluation retained the exact candidate **`model-command-17`** with **`basic-conversation-1`**. Selecting the locked **`expanded-capabilities-1`** suite kept the same model selected and the evaluation primary disabled.

The first-launch draft retained candidate **`model-command-17`**, report **`report-evaluation-command-29`**, displayed price **$15**, and allowance **120** through a resource detour and return. This check establishes retained launch inputs and report identity; it does not claim that the launch was confirmed during this journey.

## Selected browser measurements

The table uses the settled or appropriate labelled samples. Body heights are shown as **client / scroll height**. Footer bounds are viewport coordinates; fractional values are rounded to one decimal here and retained at their recorded precision in the JSON evidence.

| Task and viewport | Body height, px | Footer vertical bounds, px | Observed layout |
| --- | --- | --- | --- |
| Training, **1366 × 650**, settled | **365 / 569** | **552–625** | Two columns; body scroll supplies the needed vertical space. |
| Training, **720 × 850** | **597 / 1081** | **764–833** | One stacked column; selected method and fields retained. |
| Founder assignment, compact **1440 × 900** | **615 / 938** | **802–875** | Two columns; edited split retained. |
| Compute allocation after rental, **1440 × 900** | **615 / 882** | **802–875** | Two columns; 3 development / 1 research retained. |
| Compute review, **1440 × 900** | **344 / 344** | **666.5–739.5** | Recorded review body fits without vertical body scrolling. |
| Evaluation, **1440 × 900** | **453 / 453** | **720.6–793.6** | Recorded evaluation body fits without vertical body scrolling. |
| First Basic Chat launch after return, **1440 × 900** | **615 / 721** | **802–875** | Two columns; launch inputs retained. |

For these samples, the reported viewport scroll width equals the viewport width, and body scroll width equals body client width. No horizontal overflow was measured in these selected states. Vertical scrolling remains necessary for several task bodies.

The two-column samples reported grid tracks of approximately **529.6 px / 481.4 px**. The 720-pixel training sample reported one **639 px** track. These are observations of the captured states, not fixed dimensions promised for every viewport.

The **1920 × 1080** training capture establishes the observed viewport and retained draft values. It may have preceded layout settling, so this record makes no claim about its body, grid, or footer dimensions. The intermediate `training-1366x650-retained` resize measurement is omitted in favor of `training-1366x650-settled`. Bootstrap focused DOM text, anonymous input records, earlier staffing geometry, and redundant draft captures are not included in the curated source evidence.

### Completed native zoom and keyboard-footer check

The [native zoom receipt](evidence/wave31b/native-zoom-checks.json) retains the 125%, 150%, 200% and 400% observations, including the intermediate review overflow and its final correction. The launch draft retained model `model-command-17`, price **15** and allowance **120** at the recorded setup zoom levels.

At **400% native browser zoom**, the final review sample had a **340 × 234 CSS-pixel viewport**, viewport scroll width **340 px**, and review-body client and scroll widths both **337 px**. The corrected review therefore showed no measured horizontal overflow. After keyboard navigation brought the footer into view, its bounds were **92.31–233.90 px**, fully within the 234-pixel viewport, and **Confirm for Week 7** was enabled. This establishes wrapping and keyboard reachability; it does not claim that confirmation was executed.

Vertical scrolling remains part of the short-viewport behavior. Before keyboard navigation, the corrected review footer was below the viewport. The earlier `400-percent-keyboard-confirm-visible` diagnostic had a **515 px** body scroll width against a **337 px** client width and is explicitly superseded by `400-percent-review-wrapping-fixed` and `400-percent-review-final`. It is preserved as diagnostic provenance, not counted as final acceptance. The [wrapped review capture](evidence/wave31b/review-zoom-400-wrapped.png) shows the historical pre-points copy.

### Completed original-save byte restoration

The [original-save restoration receipt](evidence/wave31b/original-save-restoration.json) records **41,831 bytes** before and after restoration, with exact byte equality and matching SHA256:

```text
2e4dd272a8fb14d5640dcac03e6a4148c606ad862b6bb4fa7e8368e62a5a4fbc
```

Only the hash, byte counts and equality result are included. No player-save payload is copied into this evidence directory. This completed check belongs to the historical 31B browser session; the combined 0.32.0 original-content backup, migration and recovery-export checks remain separate.

## Historical acceptance and combined release handoff

- [x] Freeze the published v36 baseline and source manifest.
- [x] Pass 109 focused lifecycle checks and 127 unique UI/helper checks.
- [x] Pass the 22-case affected UI rerun and TypeScript after staffing presentation fixes.
- [x] Match 37 replay checkpoints, nine storage comparisons, and three saved-byte receipts.
- [x] Confirm protected simulation scope and the exact four-alias task metadata exception.
- [x] Record the named task journeys, draft-navigation byte comparison, and selected settled viewport samples.
- [x] Complete native 400% review wrapping and keyboard-footer acceptance after the scoped CSS correction.
- [x] Restore the original save and verify exact exported bytes in the historical 31B session.
- [x] Copy the clean receipts and selected historical browser captures into the evidence directory.
- [x] Carry the 31B work into combined build 0.32.0 without a separate 0.31.1 deployment.

The combined production build, current-source validation, current browser save/recovery checks, saved Site version, source revision, deployment result and published URL are tracked in [the Wave 32 release record](WAVE32_WORKFORCE_POINTS.md). They are not completed by this historical handoff.

## Evidence

[Structured verification evidence](evidence/wave31b/verification.json) includes the historical scope, source hashes, exact test accounting, replay checkpoints and storage receipts, the draft-navigation byte comparison, curated browser samples, completed native zoom and restoration receipts, and the combined-release handoff. It contains no private fixture saves or player-save bytes.

Copied evidence:

- [Native zoom observations](evidence/wave31b/native-zoom-checks.json), with anonymous inputs omitted and the original receipt SHA256 retained.
- [Original-save restoration metadata](evidence/wave31b/original-save-restoration.json), copied byte for byte without any save payload.
- [Training at the labelled 1440 × 900 viewport](evidence/wave31b/training-1440x900.png).
- [Compute review at the labelled 1440 × 900 viewport](evidence/wave31b/review-1440x900.png).
- [Corrected 400% review wrapping](evidence/wave31b/review-zoom-400-wrapped.png).

The screenshots document the historical pre-points UI; their desktop captures include the QA viewport controls. Full test logs, the parity harness, frozen source archive, and unfiltered measurement input files remain in the execution QA workspace. Their relevant hashes and observed results are retained in the structured source evidence.
