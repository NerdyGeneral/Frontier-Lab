# Frontier Lab 0.38.2 — debug pass and fixes

Build **0.38.2** fixes confirmed gameplay and workflow defects found during the debug review of 0.38.1. Content remains **0.38.0** and save schema remains **5**.

## Confirmed defects

| Area | Defect | Fixed behavior |
| --- | --- | --- |
| Delegated development | A cancelled plan with a capacity share still owned its paid stage job. Individually resuming that job could be accepted while its resource requests were silently removed, leaving it stuck. | Cancellation still pauses unfinished work. Explicitly resuming an individual job releases it to ordinary resource allocation, including after the cancelled plan is archived. The plan stays cancelled and does not restart automatic handoffs or charge another setup fee. |
| Manual/delegated handoff | Manual mode dropped unprepared secondary datasets from a delegated order, changing the data mix even when the player made no edits. | The complete owned selection survives handoff and draft restoration. Raw secondary datasets remain visibly checked with preparation actions. Manual training still requires all selected data to be prepared; delegation can prepare it automatically. |
| Research visibility | Paid systems experiments were absent from Projects and their finished evidence was absent from Results. | Each owned experiment has a project card showing actual progress, resource constraints and the evidence-availability boundary. Results records passed and unsuccessful experiments with the exact candidate, stage, fee and delivered work. |
| Research navigation | Architecture project cards and research-completion stops opened the legacy discovery catalog. Systems result links also lost the exact program and attempt, so a Verified systems result could open Efficient systems or newer evidence. | Projects, Results and decision stops retain the exact owned systems experiment and show its program and paid evidence, including an older attempt. Architecture stops select Architecture explicitly. Missing, foreign or invalid targets show an unavailable message instead of selecting a replacement. Ordinary discovery completions still open Discoveries' catalog. |
| Decision clock | Choosing **Next decision** while continuous play was running merely paused the clock. | The running clock adopts the selected stop rules and reserve without advancing a week just to change modes. The active decision-run control pauses it. An unsafe starting condition still stops the run. |

These fixes preserve paid progress, historical evidence, project identities and saved drafts. They do not grant research credit, prepare data, submit work or start new plans implicitly.

## Debug coverage

The complete engine suite passed **1,046 tests** on the final patched production source, including historical save validation, resource conservation, long paid campaigns, archived work and later-game systems.

**248 unique UI cases are verified.** All 245 existing UI cases passed in the complete run. The three added navigation cases initially used a test fixture that tried to repeat the same model at the same research stage; the game correctly rejected that attempt. The fixture was corrected to train and evaluate a distinct second model, and all three cases passed in the final focused rerun. Production code did not change between those runs. The rerun is overlapping coverage, not additional cases.

Final TypeScript checking and the production build passed. The first build, run alongside the full test suites, was stopped by the execution environment with exit 137; the isolated retry completed successfully. The [machine-readable check record](evidence/debug-0382-release-checks.json) records exact commands, counts, log hashes and verification scope, with retained logs in [evidence/debug-0382](evidence/debug-0382).

The important new regressions exercise real behavior:

- Paid preparation, training and evaluation make progress after cancelling a capacity-limited plan and explicitly resuming the individual job. Paused and blocked plans retain their resource restrictions, archived proof remains valid, and paid fees remain single charges. Completed preparation does not restart the cancelled training handoff, and resumed evaluation creates one retained report.
- Raw additional datasets remain selected in both an incoming delegated handoff and a restored manual draft. The ordinary command preview continues to block premature manual training.
- Paid systems research passes through blocked, working, awaiting evidence and complete states. Neither Results nor the decision clock announces evidence early. Unsuccessful constraints remain paid evidence without receiving accreditation.
- Research project, result and decision-stop links select the exact program and historical experiment in both Studio and Classic. A newer attempt does not replace the requested evidence. Missing, foreign and invalid-program targets cannot schedule work or silently substitute another result.
- The real clock callback changes continuous play into a guarded decision run, can pause that run, and respects an unsafe reserve at startup.

## Remaining findings and verification limits

The earlier repository-wide lint audit remains an unresolved backlog: **62 errors and 98 warnings** in that audited snapshot. This is not a fresh lint count for the final exact-experiment routing additions. Most errors concern existing React Hooks/ref patterns; other findings include memoization, naming/style and test typing. These findings need a separate, focused cleanup. They are not a count of reproduced gameplay failures. The misleading `useExperiment` action-helper name was corrected in this patch.

The production error-log sample returned two crawler requests with **404** responses, for `/robots.txt` and `/sitemap.xml`. It did not contain a game-page crash or worker exception. This is a bounded sample, not a guarantee about all historical traffic.

The managed local preview was unavailable because its URL had been rejected by browser security policy. No alternate host or transport was used to bypass that restriction. Public HTTPS browser verification follows publication and is reported separately from this source record. No phone-device or full manual campaign playthrough is claimed; paid progression and save compatibility are covered by the automated campaigns.

The larger Portfolio/Customers reorganization remains outside this debug release.
