# Wave 31A — Desktop foundation QA

**Candidate build:** 0.31.0. **Content:** 0.28.0. **Save schema:** 5.  
**Recorded:** 10 November 2026. **Source validation:** all planned Wave 31A scope checks passed; the production build is complete. The exact publication receipt is recorded in Sites saved-version/deployment history and the final release response, so this source record requires no post-publication edit.

## Scope

This wave applies the desktop foundation to the real game: a compact company-and-clock header, labelled navigation, a Studio room fitted to the available space, exclusive Room/List workstation views, occupied-only pinned work, and the original data-preparation task in a two-column setup-and-cost layout. Narrow and short windows reflow. The existing command, review, retained-draft, clock, and save owners remain in place.

The broader Research, staffing/compute, project-library, product, and company workspace migrations remain later phases of the desktop plan. This record does not establish that every advanced task is free of scrolling.

## Recovered baseline and rollback reference

The source was recovered through the existing Site repository and matched the published version 35 revision exactly:

| Reference | Value |
| --- | --- |
| Published baseline build | 0.30.5 |
| Published Site version | 35 |
| Source commit | `4d6fdd47b208b2a40a682ca9a611716220940ed6` |
| Frozen source snapshot | 480 tracked files |
| Snapshot SHA256 | `377ac307da000c47162c96c4df9a44b5431487e59fc2b9c6a253fd2e3007ef4e` |

The snapshot and per-file manifest were retained in the QA workspace. Existing publication history supplies the production rollback reference. No player-save payload is included in this document or its source-controlled evidence summary.

## Protected simulation and save scope

The source-scope check covered **206 files** under `src/core`, `src/modules`, `src/contracts`, `src/persistence`, and `src/content`. The only changed file was `src/content/catalog.ts`, where the build label changed from `0.30.5` to `0.31.0`. No protected file was added. After normalizing that one build-version string, all 206 files matched their baseline bytes.

The normalized aggregate SHA256 for both baseline and candidate was:

```text
640924bb9281a277eae68c10870a1b4c65f898c5fa97e7ca727f591c7d592342
```

The aggregate hashes sorted `path + NUL + file SHA256 + newline` entries. This establishes the recorded source scope; it does not replace the UI and interaction checks below.

## Automated verification

| Check | Observed result | Coverage |
| --- | --- | --- |
| Focused core tests | **101 passed; 0 failed** | Task ownership, exact intents, retained drafts, acknowledgements, deferred operations, clock, Results, navigation, and persistence. |
| Rendered UI/helper tests | **116 passed; 0 failed** | 108 existing checks plus eight data-layout checks. These render components and exercise helpers; they do not measure a browser layout. |
| State/save replay | **37 exact checkpoints matched** | Full command results, settlement results, authoritative state, and serialized save bytes across three scenarios. |
| Storage replay | **9 exact comparisons matched** | Browser-storage snapshots, previous snapshots, and the additive saved-byte receipt. |
| New-company comparison | **Matched except build header** | Only the documented fresh-company build-version field was normalized. |
| TypeScript on final candidate | **Passed; exit code 0** | Final recorded TypeScript process completed successfully. |
| Production build | **Passed; exit code 0** | Official Sites build helper completed all five Vinext/Vite stages. |

The focused core invocation was:

```sh
node scripts/test-wave0.mjs wave30-task-state wave30-submission wave29-browser-task clock wave30b-task-state wave30b-journey wave30c-results wave29-persistence-cache wave30c-results-persistence wave30d-navigation
```

The UI invocation was:

```sh
node scripts/check-wave30e-ui.mjs tests/wave31-data-ui.test.tsx
```

The data checks verify the exact selected packet and its original authoritative quote; a missing staff allocation without changing the engine's scheduling rules; scheduled, working, paused/waiting, and completed states; rejection of missing or foreign selections; advanced-command reachability; unchanged Classic presentation; read-only and insufficient-cash disabling; a real stalled preparation job; and cleanup access for a researched single-dataset case.

The existing nonblocking Vite chunk-size warning for a chunk above 500 KB remains. This verification makes no runtime-performance improvement claim.

### Replay method and limits

The existing parity harness was adapted in the scratch QA workspace to use the published version 35 commit and expected candidate build 0.31.0. The baseline engine migrated each old fixture once and serialized it; both engines then imported those identical bytes. Imported states, command results, serialized saves, and storage contents were compared without normalization. Only the separate new-company comparison normalized its build header.

The three scenarios were opening through first sale, an advanced commercial company, and focused staffing/resources. Both a pre-edit baseline run and the final 0.31.0 comparison passed. The full historical gameplay suite was not rerun. The protected source comparison supports reusing the 101-check core result while subsequent changes remain confined to UI, styles, and the recorded metadata field.

## Mounted browser verification

The managed display was limited to 1364 pixels wide. Desktop target measurements therefore used the **actual game in a fixed-size, same-origin iframe** at the stated CSS viewport sizes. These are rendered-game measurements, with the outer test wrapper excluded. They do not represent a native full-size monitor capture or an operating-system scaling test.

| Screen / viewport | Observed geometry |
| --- | --- |
| Studio, 1440 × 900 | Root client and scroll dimensions both **1440 × 900**; header **76 px**; room viewport **892 × 614 px**; uncropped scene approximately **892 × 595 px**. |
| Studio context panel, 1440 × 900 | Panel **320 × 734 px**; client height **732 px**, scroll height **732 px**. Footer begins at **y = 868 px**, height **32 px**. |
| Prepare data, 1440 × 900 | Task frame **1100 × 761 px**, top **70 px**; body client and scroll heights both **524 px**. Action footer begins at **y = 756 px**, height **73 px**. |
| Data review, 1440 × 900 | Body client and scroll heights both **470 px**. |
| Studio, 1920 × 1080 | Root client and scroll dimensions matched; header **76 px**; sidebar **192 px**. With one pinned preparation project, scene approximately **967 × 645 px**. |
| Studio context panel, 1920 × 1080 | Panel **360 × 914 px**; client and scroll heights both **912 px**. |
| Workstation List view | **Six station buttons; zero room hotspots**. Room and List controls were not duplicated. |

These checks establish no outer-page scrolling in the recorded opening Studio states and no body scrolling in the recorded preparation and review states at the desktop target sizes. Long histories, advanced records, and other task bodies may still require their labelled content scroller.

### Short desktop windows

The preparation task was also measured at three shorter desktop sizes. In each case the frame itself fit without scrolling, the body supplied the one vertical scroller, and the action footer remained fixed within the frame.

| Viewport | Task frame | Frame client / scroll height | Body client / scroll height | Footer vertical bounds |
| --- | --- | --- | --- | --- |
| **1366 × 768** | **y = 24–744 px** | **718 / 718 px** | **483 / 524 px** | **y = 670–743 px** |
| **1366 × 650** | **y = 24–626 px** | **600 / 600 px** | **365 / 524 px** | **y = 552–625 px** |
| **1440 × 780** | **y = 24–756 px** | **730 / 730 px** | **495 / 524 px** | **y = 682–755 px** |

The short-window Studio layout allowed necessary document-level vertical scrolling and had no horizontal overflow.

### Six-destination shell smoke check

Studio, Projects, Research, Products, Operations, and Company were opened through the actual navigation at **1440 × 900**; all routed correctly and the root fit that viewport after a Research layout correction. Research initially increased the outer document height to **944 px**. Setting the play area as the positioning container, with its desktop minimum-height and maximum-width overrides reset, contained the absolutely positioned accessibility labels. After correction the root client and scroll dimensions were both **1440 × 900**; Research's content region had **712 px** client height and **1930 px** scroll height.

Other destinations used internal content scrolling where needed. This verifies the shared desktop shell and route smoke checks. Their broader workspace redesigns remain later phases.

### Mounted task and time flow

The following sequence was observed in the actual game and recorded during browser acceptance:

1. Open the starter dataset, visit the staff plan, and return to the same selected dataset.
2. Double-activate confirmation; exactly **one** command appears in the queue.
3. Advance time once; the lab reaches **Week 1**, cash becomes **$46,000**, and the preparation job records **1 of 2 staff-weeks (50%)**.
4. Keep an expanded disclosure open while resizing through **1920 → 720 × 450 → 360 × 256 → 1440**; it remains open.

At **360 × 256 CSS pixels**, the task had no horizontal overflow and used one frame scroller with approximately **1922 px** of scrollable height. Shift+Tab reached the footer; Tab wrapped to Close at the top; Escape closed the task and returned focus to the workbench. Necessary vertical scrolling was permitted.

The fixed-size viewport checks above were supplemented by actual native Chrome zoom changes through the browser UI:

| Native browser zoom | Observed viewport | Observed result |
| --- | --- | --- |
| **125%** | **1090 × 749 CSS px** | No horizontal overflow. |
| **150%** | **909 × 624 CSS px** | The task body had **341 px** client height and **591 px** scroll height; its footer remained visible. |
| **200%** | **681 × 468 CSS px** | One frame scroller with **1099 px** scrollable height; Shift+Tab reached the footer. |
| **400%** | **340 × 234 CSS px** | No horizontal overflow. Keyboard navigation completed **Review → Confirm for Week 1 → Keep planning**; exactly one action was queued and time did not advance. |

Actual browser zoom and the iframe desktop viewport measurements are separate checks. Necessary vertical scrolling at enlarged text sizes was permitted. Chrome was returned to **100% zoom** and the game to **Room mode** after testing.

## Mature-save browser acceptance

A valid advanced save was prepared from `tests/fixtures/wave27-canary-published.json` by the existing deserialize/serialize path. It passed a second import and exact round trip. No game fields were edited, no commands were submitted, and no weeks were advanced during preparation.

The fixture is **Week 553, Campus**, with **$6,103,378.40 available cash**, **13 ready staff**, **176 CU**, and **90 project records**. Its unfinished Basic Chat canary is **Blocked** following a useful-answer regression; its stopped-canary evidence remains present. This is a mature blocked-project fixture, not a currently-progressing job.

An optional middle-stage fixture from `tests/fixtures/wave24-browser.json` is **Week 10, Studio**, with **$32,572**, **two ready staff**, **4 CU**, and four completed project records.

The Week 553 Campus fixture was imported through the actual game UI. At **1440 × 900** and **1920 × 1080**, root client and scroll dimensions matched exactly. The header remained **76 px** high at both sizes; all six hotspots and the larger company values fit. The context panel's client/scroll heights matched at **732 px** and **912 px**, respectively.

A mature-state primary button initially overflowed its narrow panel by **7 px**. Wrapping corrected it: the button measured **265 px** client width and **265 px** scroll width, with **61 px** height. The 1440 × 900 context panel still measured **732 px** client and scroll height after that correction.

The optional Week 10 Studio fixture was prepared for follow-up use; this record does not claim it was imported during the completed Campus checks.

### Original save restoration

After the test journeys, the original lab was restored through the game UI and downloaded again. The restored download matched the original **byte for byte**:

| Restoration evidence | Result |
| --- | --- |
| Size | **41,831 bytes** before and after |
| Exact byte comparison | **Equal** |
| SHA256 | `2e4dd272a8fb14d5640dcac03e6a4148c606ad862b6bb4fa7e8368e62a5a4fbc` |

Only this checksum and comparison result are retained in source-controlled evidence; the player-save payload is excluded.

## Release completion checklist

- [x] Confirm final TypeScript result.
- [x] Record mature Campus layout, large-value header, and all six workstation hotspots.
- [x] Complete actual Chrome zoom checks at 125%, 150%, 200%, and 400%.
- [x] Restore the original preview save and record exact-byte comparison without committing its payload.
- [x] Complete short-window task checks at 1366 × 768, 1366 × 650, and 1440 × 780.
- [x] Smoke-check all six desktop destinations and correct the Research outer overflow.
- [x] Complete the production build through the official Sites helper; all five stages passed.
- [x] Remove the temporary layout-check page before building; the recursive distribution check found **zero** matching files.

Publication follows source finalization. The pushed source revision, saved Site version, deployment result, and published URL are recorded by Sites publication history and the final release response. They are deliberately outside this pre-publication source record; their confirmation does not require another source mutation.

## Evidence

[Compact verification summary](evidence/wave31a/verification.json) records the executed test counts, fixture/checkpoint summaries, source hashes, observed browser measurements, and save-restoration comparison. The following captures are retained with the source:

- [Studio at 1440 × 900](evidence/wave31a/studio-1440x900.png).
- [Data preparation at 1440 × 900](evidence/wave31a/data-1440x900.png).
- [Data task at actual 400% Chrome zoom](evidence/wave31a/data-zoom-400.png).

Raw core/UI logs, the detailed parity output, and the source snapshot remain in the execution QA workspace for the release owner. No secrets or player-save contents are included in the compact summary.
