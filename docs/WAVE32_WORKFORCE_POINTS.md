# Wave 32 — Weekly workforce points

**Recorded:** 10 November 2026.  
**Candidate build:** 0.32.0. **Content version:** 0.29.0. **Save schema:** 5.  
**Status:** validated release candidate prepared for publication. The integrated checks, mounted browser acceptance, production build and final TypeScript check passed. Publication is recorded in Sites saved-version/deployment metadata after publication; this document does not claim that the candidate is already published. [Structured verification and evidence](evidence/wave32/verification.json) preserve the observed results.

## User goal and release scope

The user found fractional staff assignments and staff effort difficult to understand. They asked for employees to visibly generate points each week, with specialists contributing more in their strengths and those points advancing development. The resulting contract puts **employee output, project requirements and project progress in the same named point categories**. A person’s output level is a separate setting.

This is a simulation change as well as a presentation change: a ready specialist now supplies a three-category profile, rather than adding only their assigned fraction to one role. Existing normalized work units and saved project progress are retained. The authored rates, conversion and readiness rules are centralized in [workforce-points.ts](../src/modules/workforce-points.ts); [workforce.ts](../src/modules/workforce.ts) applies them to current-version company capacity.

Build 0.32.0 also includes the current Wave 31B named-task navigation and shared decision layouts. [The Wave 31B QA record](WAVE31B_TASKS_QA.md) remains a separate record of that earlier scope. Its presentation-only source-parity findings must not be treated as proof that Wave 32 leaves simulation behavior unchanged. Build and content identities are declared in [catalog.ts](../src/content/catalog.ts), [wave29.ts](../src/content/wave29.ts) and [package.json](../package.json); the schema constant remains in [types.ts](../src/contracts/types.ts).

## Canonical categories and units

| Saved role key | Player-facing point category | Typical uses |
| --- | --- | --- |
| `research` | Research | Research projects, model architecture preparation and evaluation |
| `ml` | Design | Training supervision, deployment and model applications |
| `data` | Data | Dataset preparation, curation and data review |
| `infrastructure` | Operations | Infrastructure installation, upkeep and site work |
| `commercial` | Business | Customer acquisition, support and commercial operations |
| `hardware` | Hardware | Chip research, design and prototyping |

The labels are defined by `WORK_POINT_LABELS` in [workforce-points.ts](../src/modules/workforce-points.ts). “Design” is the label for the existing `ml` category; hardware design still uses Hardware points, and model architecture preparation still uses Research points where the existing project requires them. Requirements remain owned by their respective modules, including [research.ts](../src/modules/research.ts), [company.ts](../src/modules/company.ts) and the definitions in [wave2-lab.ts](../src/content/wave2-lab.ts).

**20 displayed points equal `RESOURCE_SCALE` normalized staff-work units.** `formatWorkPoints` performs the display conversion; it does not rewrite the saved value. Thus an existing requirement of two normalized staff-work units displays as 40 points, and a half-unit requirement displays as 10 points. Compute quantities continue to use their existing CU, CUw and MU units. The conversion functions and integer-preserving profile calculations are in [workforce-points.ts](../src/modules/workforce-points.ts).

## Full weekly specialist profiles

These are the complete outputs of a ready employee at 100%. Zero means that the employee does not supply that category. Each profile totals 45 points, distributed 30/10/5; those categories cannot be exchanged for one another.

| Employee specialty | Research | Design | Data | Operations | Business | Hardware | Total / week |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Researcher | **30** | 10 | 5 | 0 | 0 | 0 | 45 |
| ML engineer | 10 | **30** | 5 | 0 | 0 | 0 | 45 |
| Data engineer | 5 | 10 | **30** | 0 | 0 | 0 | 45 |
| Infrastructure engineer | 0 | 10 | 5 | **30** | 0 | 0 | 45 |
| Product / commercial | 5 | 10 | 0 | 0 | **30** | 0 | 45 |
| Hardware specialist | 5 | 10 | 0 | 0 | 0 | **30** | 45 |

The source of truth is `STAFF_POINT_PROFILES` in [workforce-points.ts](../src/modules/workforce-points.ts). UI code uses `getStaffPointProfile`, `getStaffPotentialOutput` or `getEmployeeWorkOutput`, which return normalized units suitable for `formatWorkPoints`. It must not pass the raw displayed numbers in `STAFF_POINT_PROFILES` into that formatter, which would apply the conversion twice.

### Founder focus

The founder has **20 total points per week**, shared across Research, Design, Data, Operations and Business. Choosing a focus sends the whole budget to one category. Advanced splitting displays 0, 5, 10, 15 or 20 points per category while preserving the existing saved quarter-week allocation values and total-budget validation. The founder cannot generate Hardware points.

The starting founder assignment remains Data. The saved budget and assignments originate in [engine.ts](../src/core/engine.ts); validation and boundary application remain in [company.ts](../src/modules/company.ts). The focus controls and retained draft are implemented in [studio-staffing.tsx](../src/ui/studio-staffing.tsx) and the PeoplePanel portion of [panels.tsx](../src/ui/panels.tsx).

### Readiness, salary and advanced output levels

New hires start at 100% output automatically. Hiring takes effect at the next ordinary weekly boundary. `readyWeek` is the actual hire week plus the authored onboarding duration, currently two weeks for each role. During onboarding the employee supplies **zero points in every category**, and full salary is already due. Salary also remains unchanged when an employee’s output is reduced or set to zero. These rules are implemented by [company.ts](../src/modules/company.ts) and [workforce.ts](../src/modules/workforce.ts), using role costs from [catalog.ts](../src/content/catalog.ts).

Existing partial allocations are preserved. The advanced employee control displays 0%, 25%, 50%, 75% or 100%, scaling every component of the profile. For example, a ready ML engineer at 25% supplies 7.5 Design, 2.5 Research and 1.25 Data points per week. The same employee supplies zero before `readyWeek`; their card shows the exact future profile and date separately. [workforce-points.ts](../src/modules/workforce-points.ts) performs both calculations.

The staffing form distinguishes current output from the proposed next-week output. Invalid or empty drafts continue to be handled by the original command validation. Presentation guards prevent invalid employee values or unsafe founder totals from throwing while rendering the draft. See [studio-staffing.tsx](../src/ui/studio-staffing.tsx) and [components.tsx](../src/ui/components.tsx).

## How points advance work

The existing company allocator remains authoritative. At each allocation boundary it obtains the company’s available role totals, creates one remaining budget per company and category, and orders requests by the existing staff priority, then request ID. Each demand receives at most the smaller of its requested amount and the remaining amount in that category. The grant is subtracted before the next request. Unpaid-bill suspension still prevents productive allocation. This logic is in `grantResources` in [company.ts](../src/modules/company.ts).

Specialist secondary output therefore helps real projects automatically. A Researcher’s five Data points can advance a data job, while their Research points serve research demands. Projects share each category; the UI does not create employee-to-project assignments or permit a point to be counted twice. Profile aggregation is in [workforce.ts](../src/modules/workforce.ts); request and grant shapes are in [types.ts](../src/contracts/types.ts).

| Term shown to the player | Meaning and source |
| --- | --- |
| Full profile / potential output | The authored profile at the selected percentage, before checking readiness; `getStaffPotentialOutput` |
| Available points per week | Current readiness-adjusted output; `getEmployeeWorkOutput` and aggregated `getWorkforce().capacity` |
| Allocated last week | Category-level grants recorded in `company.lastStaff.granted` by the company allocator |
| Completed points | A project owner’s stored `completedStaff`, converted for display |

**Allocated points are not automatically completed work.** In particular, Design supervision can be allocated while a training run is limited by GPUs or memory. The compute allocator uses the staff grant to cap supervised compute and separately checks compatible pools, allocation ceilings and memory. Research separately increments its point-work meter and compute-work meter, and both must finish before the discovery unlocks. See [compute.ts](../src/modules/compute.ts), [research.ts](../src/modules/research.ts) and the phase ordering in [engine.ts](../src/core/engine.ts).

There is no point bank. Remaining weekly capacity is discarded when the next week’s budgets are constructed; finished project progress stays saved. There is also no individual provenance for granted work: grants identify a request and category, not the employee who supplied it. Employee cards show contribution capacity, while team tables show allocation. They must not claim that a named person completed a particular project or personally spent a particular grant. [company.ts](../src/modules/company.ts) and [types.ts](../src/contracts/types.ts) define these boundaries.

## Save compatibility and recovery

| Version field | Value for this candidate | Meaning |
| --- | --- | --- |
| Save schema | 5 | Existing record shapes and normalized progress units remain valid |
| Content version | 0.29.0 | Enables the specialist point profiles |
| Build version | 0.32.0 | Identifies this implementation and combined UI release |

The 0.28-to-0.29 path is `migrateWave28State` in [migration.ts](../src/core/migration.ts). It validates the historical state under its source content version, clones it, changes the content and build metadata, then validates the upgraded state. It does not advance a week, multiply saved progress, rebuild queued commands, grant retrospective points or alter stored employee fractions. Existing project requirements, completed work, cash, wages, receipts, assignments and pending choices remain stored in their original normalized units. The new specialist supply affects future allocation boundaries.

[snapshot.ts](../src/core/snapshot.ts) verifies the original checksum before routing to migration. [workforce.ts](../src/modules/workforce.ts) retains the previous one-role capacity rule for historical content validation and enables the new matrix only for the workforce-points content version. This is necessary to validate authentic old receipts before applying the future rules.

The browser persistence path archives the original stored 0.28 snapshot **before** replacing the primary save with upgraded bytes. It uses the `frontier-lab.content028.original` recovery key and the “Export original 0.28 content save” recovery option. An existing original archive is not overwritten. If the archive write fails, the upgraded primary write does not proceed. Recovery exports return the exact original snapshot text without parsing or remigrating it; when quota requires compression, the recovery codec verifies the decoded text’s length and hash. These guarantees are implemented in [wave0-browser.ts](../src/persistence/wave0-browser.ts) and [recovery-codec.ts](../src/persistence/recovery-codec.ts).

These source contracts are supported by the dedicated migration and recovery tests below. The mounted browser restoration also passed: importing the untouched original save and exporting it under the new content version reproduced the starting migrated save byte for byte. The migration's permitted metadata differences and exact comparison are recorded in the validation section.

## UI and Wave 31B integration

| Surface | Player-facing change | Source |
| --- | --- | --- |
| Hiring and team output | Specialty-first weekly profiles, exact onboarding output/date, visible roster, founder focus and advanced percentages | [studio-staffing.tsx](../src/ui/studio-staffing.tsx), [studio-staffing.css](../app/studio-staffing.css) |
| Original People panel | Visible employee output cards with the same values and retained allocation controls | [panels.tsx](../src/ui/panels.tsx) |
| Data, training and evaluation | Matching point requirements and team output; Design supervision remains separate from GPU work | [lab-panels.tsx](../src/ui/lab-panels.tsx) |
| Research | Category point requirements, current output, completed point meters and resource guidance | [studio-research-method.tsx](../src/ui/studio-research-method.tsx), [studio-research-tree.tsx](../src/ui/studio-research-tree.tsx) |
| First launch and product progress | Design-point deployment requirements and completed deployment work | [product-panels.tsx](../src/ui/product-panels.tsx) |
| Command review | Exact employee/model/project identity, point-based facts, actual costs and next-week effects | [studio-command-review.tsx](../src/ui/studio-command-review.tsx), [studio-management-review.ts](../src/ui/studio-management-review.ts) |
| Resource planner | Current/proposed point capacity, required points and allocated points alongside independent compute | [studio-planner.tsx](../src/ui/studio-planner.tsx), [studio-planning.ts](../src/core/studio-planning.ts) |
| Project cards, results and help | Consistent point labels for stored progress, output and onboarding guidance | [studio.ts](../src/core/studio.ts), [studio-results.ts](../src/core/studio-results.ts), [selectors.ts](../src/core/selectors.ts), [player-guide.tsx](../src/ui/player-guide.tsx) |

The combined Wave 31B work keeps a single retained form owner for each workspace. Named tasks distinguish hiring from team output and compute allocation from renting. The footer promotes only one exact visible `data-studio-primary-for` control and invokes that original control; missing, disabled or ambiguous bindings do not fall back to a different command. Resource detours keep the original form draft and exact target. The contracts are in [studio-tasks.ts](../src/core/studio-tasks.ts), [studio-task-primary.tsx](../src/ui/studio-task-primary.tsx), [studio-interaction-context.tsx](../src/ui/studio-interaction-context.tsx) and [studio-shell.tsx](../src/ui/studio-shell.tsx).

Settings and the real quote appear side by side in focused dialogs and stack on narrow screens. The presentation wrapper owns no draft state or command logic. Training history is hidden only for the focused training task; simple staffing and compute decisions do not acquire additional forced wizard steps. See [studio-decision-layout.tsx](../src/ui/studio-decision-layout.tsx) and [studio-decision-layout.css](../app/studio-decision-layout.css).

## Validation record

### Integrated automated checks

**371 distinct tests passed, with zero failures or skips.** The count is **109 affected existing core + 109 task lifecycle + 136 integrated UI + 17 dedicated point-engine cases**. The [structured verification](evidence/wave32/verification.json) records the group totals and hashes of the retained logs.

| Check | Observed result | Evidence and scope |
| --- | --- | --- |
| Affected existing core suites | **109 passed** | [Existing core log](evidence/wave32/existing-core.log); affected gameplay, resource and persistence regressions |
| Task lifecycle suites | **109 passed** | [Lifecycle log](evidence/wave32/lifecycle.log); retained owners, reviews, detours, submission and acknowledgement identity, including the combined 31B navigation work |
| Integrated UI suites | **136 passed** | [Integrated UI log](evidence/wave32/integrated-ui.log); includes all **nine** new point-profile UI cases |
| Dedicated workforce point engine cases | **17 passed** | [Point test log](evidence/wave32/new-point-tests.log); the same run also contains the nine UI cases already included above |
| Focused rerun after the final employee-name review presentation change | **26 passed** | [Employee review UI log](evidence/wave32/employee-review-ui.log); overlaps the integrated UI coverage and is not added to the distinct total |
| Final TypeScript check | **Passed; exit 0** | `npm run typecheck`; [typecheck log](evidence/wave32/typecheck.log) |
| Official production build | **Passed; exit 0** | Sites build workflow; [production build log](evidence/wave32/production-build.log) |

The dedicated [engine suite](../tests/wave32-work-points.test.ts) covers all six profiles; readiness and partial output; the founder budget; company ownership; paid onboarding and assignment boundaries; secondary output advancing real work; independent training/research compute constraints; shared allocation without double grants; rollback; pure planning previews; migration; deterministic save/reload; mature-company continuation; exact original-byte archiving and write-failure protection; and secondary Research output satisfying foundation admission. The [new UI suite](../tests/wave32-work-points-ui.test.tsx) covers visible profiles, saved fractions, onboarding, payroll, exact employee identity, invalid drafts, observer controls and allocation terminology.

The 26-case combined point run contains **17 engine + nine UI cases**; those nine UI cases are counted once in the 136-case integrated group. The later 26-case employee-review rerun is also overlapping coverage. The production build completed with the existing large-bundle and route static-analysis notices and no build errors. This is validation of the point mechanics and affected regressions, not a claim that every historical economy test was rerun.

### Earlier bounded implementation checks

These implementation checks were recorded before the integrated gate. They are **not additional tests to add to the 371 distinct total**.

| Check | Observed result | Scope |
| --- | --- | --- |
| Existing staffing UI suites | **17 / 17 passed** | Exact role/person selection, foreign/missing target recovery, retained values, onboarding date, full salary, founder overbudget rejection, one Classic form per person and observer disabled state |
| Transient invalid-draft render checks | **7 / 7 passed** | Empty, invalid-text, negative and above-100% employee drafts; empty, overbudget and unsafe-sum founder drafts rendered without throwing or changing game state |

The existing suites are [wave30c-staffing-ui.test.tsx](../tests/wave30c-staffing-ui.test.tsx) and [wave30e-staffing-helper-ui.test.tsx](../tests/wave30e-staffing-helper-ui.test.tsx). Their point-language expectations were updated while retaining the behavioral assertions. The seven additional checks were a transient server-render command; they are not seven newly committed test cases and must not be added to a final suite count as though they were.

The observed staffing command was:

```sh
node --import tsx --test --test-reporter=spec \
  tests/wave30c-staffing-ui.test.tsx \
  tests/wave30e-staffing-helper-ui.test.tsx
```

A read-only source audit checked the main Data, Training, Evaluation, Research, Planner and review conversions for wrong units and misleading allocation claims. Review draft guards, onboarding terminology and the first-launch requirement were corrected during integration. That review is not browser acceptance or an exhaustive simulation regression result.

### Mounted employee output and project progress

The release owner exercised the mounted local preview in native Chrome through the documented game controls and exported states with **Download save**. No console-created game state was used. The observed desktop viewport was **1363 × 936**. The [browser evidence](evidence/wave32/verification.json) records the actual salary, readiness, point grants and stored progress.

A Researcher hired in **Week 1** had **readyWeek 3**, supplied **zero points while onboarding**, and incurred the full **$450 weekly salary**. Once ready, the card showed **30 Research, 10 Design and five Data points per week**. The founder remained focused on Data, supplying 20 more Data points. See the [hire preview](evidence/wave32/researcher-hire.png), [onboarding card](evidence/wave32/researcher-onboarding.png) and [ready employee card](evidence/wave32/researcher-ready.png).

| Recorded boundary | Research progress | Data preparation progress | Allocation observed |
| --- | --- | --- | --- |
| Week 3 | **30 / 40 Research points** and **2 / 2 CUw**; still running | **25 / 40 Data points**; still running | **30 Research** and **25 Data** points granted; Data capacity combines founder 20 with Researcher five |
| Week 4 | **40 / 40 Research points**, **2 / 2 CUw**, complete; discovery available in **Week 5** | **40 / 40 Data points**, complete | Only the remaining **10 Research** and **15 Data** points granted |

The [Week 3 capture](evidence/wave32/week3-project-progress.png) and [Week 4 completion capture](evidence/wave32/week4-completion.png) show the corresponding progress. Research's compute meter finished before its point meter. At the next boundary the allocator granted the remaining work required for completion, even though team capacity was still 30 Research and 25 Data points. The 10/15 values are grants to finish work, not unused capacity or individually attributed employee spending.

### Proposed output, retained drafts and exact state

The employee review for a proposed **50%** output showed **30 → 15 Research**, **10 → five Design** and **five → 2.5 Data** points, with salary still **$450 per week**. The review was **not confirmed**. This establishes the actual proposed values without claiming that the employee's saved output changed.

The founder's **Design focus** survived a detour into Hire and return. The advanced draft then showed **10 Design / 10 Data**, and the employee's partial-output draft remained retained. The [founder split capture](evidence/wave32/founder-split.png) and structured receipt document the selected values. The recorded Week 3 exports before and after these draft-only journeys were **104,077 bytes**, byte-identical, with SHA256:

```text
f508df8fae5984d61f9a642de8a171004e2868513d70b22521a82a5d8e80cac9
```

Exact disabled action binding, invalid targets, observer restrictions and retained-owner lifecycle remain covered by the integrated UI and lifecycle suites. The [historical 31B browser journeys](WAVE31B_TASKS_QA.md) preserve their earlier, separately scoped navigation evidence; they are not substituted for current point-output acceptance or simulation validation.

### Native zoom, wrapping and keyboard reachability

The [native zoom receipt](evidence/wave32/zoom-checks.json) records **200%** and **400%** browser zoom. Vertical scrolling is the intended short-viewport behavior in both samples.

| Sample | Viewport, CSS px | Dialog width / scroll width, px | Observed result |
| --- | --- | --- | --- |
| 200% review | **681 × 468** | **640 / 640** | No measured horizontal overflow; vertical scrolling is required |
| 400% review | **340 × 234** | **337 / 337** | Keyboard focus reached **Confirm for Week 4**; button bounds **159.46–222.05 px** fit within the viewport |
| 400% team output | **340 × 234** | **337 / 337** | No wide child elements were measured |

The [200% review capture](evidence/wave32/review-zoom-200.png) and [400% review capture](evidence/wave32/review-zoom-400.png) accompany the exact measurements. The confirmation was not executed during the zoom check. These results establish the recorded states' wrapping and keyboard access, not a claim that the footer is initially visible without scrolling at every viewport.

### Original-save restoration and migration integrity

After browser QA, the release owner imported the untouched original **0.28** save through the UI and exported it under **0.29**. The resulting **41,831-byte** export matched the starting migrated save **byte for byte**, restoring **Week 0**, with SHA256:

```text
6578bdb1f2166ad1b73bf39024fa29877ebd7596efe921e6752e6aeee41f04bb
```

The untouched original was also 41,831 bytes, with SHA256 `2e4dd272a8fb14d5640dcac03e6a4148c606ad862b6bb4fa7e8368e62a5a4fbc`. Comparing it with the migrated starting save found changes only at **`checksum`**, **`contentVersion`**, **`state.contentVersion`** and **`state.buildVersion`**. All saved economic state and progress remained unchanged. The checksum changed because the permitted metadata changed; the migrated bytes are not claimed to equal the old-content bytes.

The browser receipt establishes actual UI restoration and repeatable migration. The dedicated engine/recovery tests separately establish exact original-byte archiving before the upgraded primary write, preservation of an existing archive and failure protection. The [structured restoration evidence](evidence/wave32/verification.json) includes only hashes, lengths, changed paths and the result. No player-save payload is included in the repository.

### Publication record

The candidate has passed its recorded prepublication gates. Publication and the identity of the published source are recorded externally after the release is saved and deployed; the candidate's own source record does not invent a future commit or claim a deployment has already succeeded.

| Release field | Recording location |
| --- | --- |
| Final source commit / tree | Recorded in Sites version/deployment metadata after publication |
| Saved Site version | Recorded in Sites version/deployment metadata after publication |
| Deployment result and published build | Recorded in Sites version/deployment metadata after publication |
| Published URL and post-deployment smoke check | Recorded in Sites version/deployment metadata after publication |

The source evidence remains a **validated and built release-candidate record**. A publication result requires the saved-version/deployment metadata and the subsequent live-build check.
