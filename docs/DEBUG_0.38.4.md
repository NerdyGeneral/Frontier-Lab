# Frontier Lab 0.38.4 — gameplay and debug recheck

Build **0.38.4** fixes three reproduced gameplay/workflow defects found during a fresh review of published **0.38.3**. Content remains **0.38.0**, save schema remains **5**, and the previous release's complete planning-workspace recovery remains supported.

## Confirmed defects

### Randomized University and Consultancy starts

The actual public UI failed when choosing **New lab → University Spinout → Replace lab**. The current company stayed open and displayed a generic local-save failure. A source reproduction using the exported existing campaign showed that this failure occurred before any storage writes, so storage quota was not its cause.

The UI generates a fresh campaign seed, and the two alternate origins append their origin name. The validator incorrectly compared that stored seed with the catalog's default seed. The ordinary default-seed origin tests passed while real randomized alternate starts failed.

The validator now accepts the same bounded, nonempty base-seed contract as campaign creation, while retaining the required origin suffix. It keeps the saved seed unchanged, preserves deterministic replay, and continues to validate the origin's founding research, staff and release rules. Historical/default campaigns remain compatible. No identifier is shortened or regenerated during loading.

### Delegated stages and same-week cash commitments

A fresh Garage campaign authorized a delegated plan with a **$39,900 cash reserve**. At Week 1 it held **$47,000**, with a **$1,000 preparation stage** queued. A normal **$6,000 data purchase** was then queued for the same boundary. In the original queue order, both charges were accepted and Week 2 ended at **$39,000**; the plan blocked only afterward. Processing the purchase first instead rejected the stage and left **$40,000**.

The weekly engine had removed all due commands from the queue before admitting each one. The delegated reserve check could therefore miss commitments that had not yet been processed. The fix preserves command order and explicit manual spending while supplying the outstanding commitments to automatic stage admission. A stage must still fit its project-fee budget and reserve after known weekly bills.

The review also reproduced a rejected-cost-cut case: queued cloud capacity increased to 6 CU, allocation increased to 4 CU, and a subsequent reduction to 2 CU was rejected. Counting the requested final 2 CU understated the actual 6-CU bill. Both automatic delegated stages and **Next decision** now use current bills and pending increases; they do not treat an uncommitted cost cut as available cash. A valid cost cut can be applied with **Next week**, after which its actual savings count toward automatic continuation. This leaves explicit manual spending available. Metered work and newly completed installations can still add costs beyond the known base-bill projection.

### Independent controls for parallel development projects

The UI identified some pending development actions only by their command kind. Scheduling a plan for the Founder could falsely mark an otherwise eligible senior lead's plan as already scheduled. A queued control for one plan could likewise disable the corresponding control for another plan, although the engine accepted the second action.

Start actions now use the engine's responsible-lead identity, including the default Founder identity. Pause/resume, revision and cancellation actions identify their own plan. Genuine duplicate actions still show their queued state; independent projects remain actionable and retain the normal review and authoritative command checks.

## Verification record

Clean 0.38.3 source at commit `c59acc1d4668895c11a60cf4eb99a14eb00428d9` passed **1,054/1,054 engine tests** and **259/259 UI tests** before these newly reproduced failures.

On frozen 0.38.4 source, the complete engine run exited 1 after a file-level failure in `company-progression`; its only terminal diagnostic is “test failed,” with no named assertion or signal. All five tests in that file passed unchanged in isolation. Together, the runs cover **1,065 unique passing engine cases** with no overlap; the original full invocation is not a clean pass, and its failure cause remains unclassified.

| Final source gate | Result |
| --- | --- |
| Complete engine suite | **1,060 passed; 1 file-level failure**, exit 1 |
| Company progression, isolated rerun | **5/5 passed**, exit 0 |
| Complete UI suite | **267/267 passed**, exit 0 |
| TypeScript typecheck | Passed, exit 0 |
| Production build | Passed all five stages, exit 0 |

Focused verification completed with no failures, cancellations, skips or pending tests:

- **Origin validation: 5/5.** All origins cover randomized/custom seeds, the 128-character boundary, malformed seeds, and deterministic continuation of paid work after loading.
- **Actual save/replacement callbacks: 22/22.** Three new cases invoke the real `startOrigin` callback with deterministic browser-width random bytes. They verify the selected origin can be stored and resumed while the previous campaign and its planning workspace remain recoverable. Existing autosave, recovery and replacement cases also pass.
- **Parallel UI and command review: 21/21.** Rendered controls allow an eligible second lead to schedule a plan and allow separate projects to pause, resume, revise and cancel independently. Controls still identify a genuine queued duplicate, including the implicit and explicit Founder. Review and authoritative submission remain exercised.
- **Development plans and decision clock: 38/38.** These tests cover delegated admission against outstanding fees and higher weekly bills, rejection of an unaffordable stage, preserved manual spending, and the conservative handling of pending savings.

Focused counts overlap the full release suites and are not added to their unique totals. The machine record includes commands, timings and log hashes. All 504 files in the engine source/fixture/test manifest matched the frozen checkout.

An independent ordinary-command diagnostic passed **five scenarios**: an exact reserve boundary, a zero-fee rename, an explicit manual purchase, a rejected rent reduction, and a reviewed valid cut followed by resumption at the same reserve. The first four compare the next weekly result before and after serialization and confirm that advancing leaves the input campaign unchanged. The fifth verifies the clock blocks spending against an uncommitted cut, manual advancement applies it, and the same reserve then permits continuation; it does not claim a separate reload-parity check. These five scenarios are diagnostic evidence, not additional Node test cases.

### Evidence and scope

Typechecking also exposed archived reproduction scripts being compiled as application code. Only `docs/evidence` was added to the existing TypeScript exclusions; application source, tests and active scripts remain checked. The serial rerun passed. Vite retains its warning about minified chunks exceeding 500 kB.

[Release checks](evidence/debug-0384-release-checks.json) indexes the completed baseline, focused checks, before-fix reproductions, independent diagnostic and frozen-source manifest, with SHA-256 hashes. Their retained files are under [debug-0384](evidence/debug-0384/). The final engine run passed fresh Garage platform, specialist and frontier ending tests, earning their milestones in **Weeks 203, 208 and 214** respectively.

The initial 0.38.3 University replacement failure is a real mounted-UI observation. The parallel-project reproduction uses a valid established test fixture; it is not a claimed naturally earned browser campaign. The reserve scenarios use ordinary accepted commands and weekly settlement without grants or forced progress. The original exported campaign is private and is excluded from the evidence directory.

During the 0.38.3 live setup, the cloud-browser renderer also timed out and reported a crash. One reload recovered, and the scenario could then be prepared. No application stack or cause was established; this remains separate from the reproduced defects.

Live testing of the published 0.38.4 University delegated campaign and Consultancy start/recovery flow follows publication and is reported separately with the deployment result. Source-level callback and rendered-component checks are not presented as completed browser playthroughs.
