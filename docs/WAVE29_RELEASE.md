# Wave 29 — Responsive workbenches

Build **0.29.0**, content **0.28.0**, save schema **5**. This wave improves how the completed Studio expansion behaves in an advanced company. The five planned expansion waves remain documented in their earlier releases.

## What changes while playing

Studio workbenches now wait until their first visit before doing their expensive calculations. Once visited, a workbench keeps its unsent form values while hidden. Returning to it supplies the latest company state, quotes, action availability and callbacks. Opening another company resets those local drafts. Classic continues to expose each ordinary workbench once.

The Research Tree and Projects planner use the same visibility gate. The implementation preserves the existing section hierarchy and CSS; the artwork, scene progression and navigation layout carry forward. A direct `#campus` opening selects the Campus screen.

The clock displays **Working**, and the persistent status line names the pending operation, such as **Settling Week 614…**. Time controls are disabled while that operation is pending. A one-operation admission gate rejects rapid repeated activation and prevents a canceled callback from affecting a later company. The browser receives a paint opportunity before synchronous work starts. Computation still runs on the main thread; this release does not introduce a background worker.

Same-week decisions immediately show **Saving decisions · Week N…**, followed by **Saved in this browser · Week N** only after the write succeeds. Failed writes retain the existing recovery and retry path. The footer has an explicit accessible name containing the current save message. Operation errors stay visible above the Research Tree or planner, where the ordinary inspector may be hidden. Each action control describes its corresponding quote or blocker through a unique ARIA target.

Time accumulated before a decision or diagnostics check is preserved. Time spent doing that work is excluded from the active countdown. Opening the import picker pauses immediately, before file selection. Pending work is canceled when the page becomes hidden; a synchronous operation already executing remains atomic. Existing no-offline-progress behavior remains in effect.

## Where repeated work was removed

| Advanced-company operation | Published implementation | Wave 29 |
| --- | ---: | ---: |
| Accepted action preview, full-state copies | 3 | 1 |
| Command submission, full-state copies | 4 | 2 |
| Idle weekly settlement, full-state copies | 31 | 1 |
| Initial Studio render, hidden-workbench full-state copies | 103 | 0 |

The first three rows use the preserved Week 612 company. The last row is a cold server render with 20 eligible ordinary workbenches plus the standalone Tree and planner. It is a measure of deferred render work, not browser frame rate or total interaction time.

The final pure-Node timing sample on that same advanced company is recorded below. Commands use five measured samples after a warmup; weekly settlement uses three. Shared-machine timing varies, while copy counts are deterministic.

| Core operation | Before median | After median |
| --- | ---: | ---: |
| Accepted action preview | 74.81 ms | 26.08 ms |
| Rejected action preview | 17.95 ms | 29.64 ms |
| Command submission | 411.17 ms | 332.78 ms |
| Weekly settlement | 1,451.28 ms | 912.93 ms |

The rejected preview did not improve in this sample; it still makes one whole-state copy. The complete [core performance record](evidence/wave29-core-performance.json) reports every measured operation and the [exact compatibility comparison](evidence/wave29-core-parity.json).

Command admission now returns the one validated quote used for the action. Submission and settlement still revalidate their own current state. Weekly module reads reuse immutable copies of unchanged durable slices only within that one operation. Every replacement slice receives its own copy; mutable coordinator fields such as queues, receipts, journal and random draws are copied for each read. Full input and output validation remains. Values whose internal state is not protected by `Object.freeze`, including Map, Set and Date, retain fresh-copy isolation.

Browser persistence keeps validation metadata for the exact previous primary-save bytes, scoped to the actual Storage object. It retains one entry, not a collection of trusted game states. Every new state still goes through full serialization and validation. Changed previous bytes are checked again; reads return fresh state objects. Metadata advances only after a successful primary write. Archive-before-replacement ordering and invalid-save protection remain intact.

In a six-sample Node memory-storage probe using the 1,476,889-byte Week 593 save, a warm exact-byte entry reduced the median write from **689.35 ms to 410.30 ms**. The new state was fully validated in both cases; previous-save parses changed from six to zero. The cold Studio render measured approximately **3.43 s before and 44.7 ms after**, with no hidden workbench executed. These observations exclude browser storage-disk behavior and do not establish a universal speedup. See the [persistence measurements](evidence/wave29-persistence-performance.json), [render measurements](evidence/wave29-ui-performance.json) and the [validation inventory](evidence/wave29-validation-summary.json).

## Compatibility and verification

Content and schema versions do not change. Existing 0.28 snapshots keep their saved build header and serialize without a header-only migration; new companies receive build 0.29.0. Archive keys and prior migrations remain unchanged.

The published source was retained as the reference before the core change. Eight accepted/rejected command cases and 19 continuation checkpoints cover ordinary actions, paid Studio transactions, facility replacement and Gen 2 fabrication/installation. The final comparison checks full states and serialized bytes, including rejection reasons, fees, receipts and random state. Focused malicious-module tests cover attempted mutation, fee mismatch, stale reads, exotic values and whole-operation rollback.

A separate native-browser run imported the earned Week 612 company, queued **160 serving / 9 development / 8 research CU**, and rapidly double-clicked Step week. Exactly one boundary settled. Its Week 613 export matches an independent replay on published commit `6b82a6dd08e2d2ab7b78bd066a0cd043167dec38` in all **1,465,122 bytes**: checksum **`bc84a4ff`**, SHA-256 `5f0e28199e891dcbcf1a6a51210b793ea0f5fcc59011dc2bd7b464be241357da`. The reference was generated before the browser export was read. See [browser evidence](evidence/wave29-browser.json) and [reference provenance](evidence/wave29-browser-reference.json).

The live checks also verify real draft retention, a retained Research search, a refreshed allocation table after a hidden week, one Classic form, company-reset draft clearing, import pausing, visible errors and the painted settlement/save transitions. The focused SSR suite deliberately distinguishes rendered output from its separate memo-policy unit check; it does not treat a comparator test as proof of mounted hook retention.

The original Week 556 company was backed up before testing and matched the prior export exactly. It was restored through visible import and confirmation, then observed paused and saved at Week 556 with its one queued Week 557 action intact. The original company was never advanced. A browser URL-policy denial blocked observation immediately after the final requested reload, so a post-restoration reload/export byte comparison is **not claimed**. No alternate browser workaround was used.

**149 distinct focused checks pass: 118 existing checks and 31 new Wave 29 checks across ten source test files.** Repeated passing occurrences are counted once, and the inventory links the corrected historical Campus expectation to its final passing run. TypeScript, scoped lint and all five production-build stages passed. The existing large-client-chunk warning remains. The [design QA](../design-qa.md) and [validation inventory](evidence/wave29-validation-summary.json) state the exact focused-test coverage and limitations. This wave does not claim a full repository test run, a new narrow-screen audit or a complete accessibility certification.
