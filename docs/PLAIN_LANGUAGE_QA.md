# Plain-English UI update

**Build:** 0.30.4. **Content:** 0.28.0. **Save schema:** 5.

This update rewrites player-facing copy after Phase 30D. Its baseline is commit `932e004ab6cb4599f3a18512a82006a8f0e430cd` (build 0.30.3). It adds no gameplay phase.

## What changed

The main menus, decision reviews, opening guidance, research, training, products, releases, agents, staffing, compute, infrastructure and company screens use clearer language. All 35 research descriptions explain their practical effects while retaining their requirements and limits. The player guide explains the game's work, compute and memory units. Save controls now use Download save and Load save.

| Previous wording | New wording |
| --- | --- |
| Review commitment | Review your choice |
| Current commitment | Cost and requirements |
| Recurring salary | Weekly pay |
| Usable availability | Ready to use |
| Minimum cohort sample | Minimum requests per model |
| Export snapshot / Import snapshot | Download save / Load save |

The [player wording guide](PLAYER_COPY.md) records these conventions for later updates. Historical event messages already stored in saves are not rewritten.

## Verification

| Check | Result |
| --- | --- |
| Existing rendered UI acceptance suite | **88/88 passed** in the final run. |
| Focused core, task, clock, navigation and persistence checks | **101 verified:** 57 unaffected checks passed in the initial run; all 44 checks in the four affected files passed after updating stale wording expectations. |
| TypeScript | **Passed** with `npm run typecheck`. |
| Supported production build | **Passed** with the Sites build helper. |
| Source comparison | **Passed across 66 changed non-test source files:** 1,024 copy changes reviewed, with no unexpected structural or protected-string changes. The [source audit](evidence/plain-language-source-audit.json) records presentation exceptions and its limits. |

The initial core run passed 96 of 101 checks. Its five failures were old wording expectations; six text assertions were updated across four files, including an expectation previously hidden behind a failing assertion. Assertion types, order and counts were preserved, along with numeric, entity and negative checks. The final rendered UI suite also retains its existing behavioral assertions. The full historical repository suite was not rerun for this copy update.

Final evidence: [UI output](evidence/plain-language-ui.log), [initial core output](evidence/plain-language-core.log), [core recheck](evidence/plain-language-core-copy-recheck.log), [TypeScript](evidence/plain-language-typecheck.log) and [production build](evidence/plain-language-build.log).

Independent semantic review checked the distinction between compute work and cash spending, queued choices and their costs, and inherited licensing restrictions. The final copy keeps those distinctions explicit. Gameplay formulas, requirements, identifiers and save formats remain unchanged; the build version advances to 0.30.4.

## Browser acceptance

The shared local preview was occupied by a different project. It was left running. Publication and read-only checks of the live Frontier Lab menus are reported in the release handoff after deployment; they are not claimed by this prepublication record. The preceding Phase 30D browser and parity evidence remains a historical record, not a new run for this update.
