# Wave 25 — Projects, staffing and compute

Wave 25 is the second graphics-expansion wave for Frontier Lab. It adds the larger Studio room, a clearer project queue, and a paused workbench for reviewing workforce and compute changes together.

**Presentation/package version:** 0.25.0. **Simulation/content version:** 0.23.0. **Save schema:** 5.

## What changes for the player

The company moves visually from the Garage into the Studio after its first earned revenue. This is a presentation milestone derived from the existing company record: it costs nothing, grants no employees or hardware, and works with an established save. The new room keeps the cream, mint, oak and teal visual direction, adds four desks and a meeting corner, and preserves the six interactive workstation destinations. Actual usable capacity remains in the company HUD and compute inspector.

Projects now has two sections. **Work queue** shows queued decisions separately from active, blocked and completed projects. Each pending plan shows its member count, reserved upfront cost and next effective week. **Plan week** pauses the simulation and presents founder assignments, employee allocations, recruitment, cloud reservation and serving/development/research ceilings in one workbench.

Drafts survive navigation, Classic switching and ordinary week changes. A campaign import, reset or recovery opens a fresh draft. A new company state or changed input invalidates the previous review, and Apply stays unavailable until the player previews again. After a successful Apply, the draft is marked Queued and must be refreshed before another plan.

## Forecast and resource explanations

Preview compares the current plan with the proposed plan at the same next weekly boundary. Both branches run the ordinary simulation on private copies. They include queued actions, real employee readiness, onboarding salaries, live customers, and signed service obligations.

The comparison shows:

- Cash after settlement, upfront commitments, recurring cost changes, payroll, cloud rent, operating expenses, revenue and unpaid bills.
- Available staff time, requested time and actual grants by role.
- Work requested and granted, physical GPU work, memory and the pool selected for each workload.
- Signed private-hosted, customer-hosted and assured service requirements.
- Nominal and usable pool capacity, connected memory, staffing, power and cooling coverage.
- Explicit warnings when a plan reduces live service, pays employees who remain in onboarding, or ends the week with unpaid bills.

Memory is evaluated per compatible connected pool. The forecast never sums separate pools into a fictitious larger workspace. Parked equipment remains inventory but does not become usable merely because its nominal capacity is visible.

This one-boundary staffing/compute review is separate from the existing research-gated, twelve-week growth forecast. It does not unlock that research or change its readiness assumptions.

## Atomic application and save compatibility

`apply_studio_plan` is one bounded queued command containing existing planning actions. It supports founder assignments, existing employee allocations, hires, cloud reservation and compute allocation. A plan contains at most 64 actions, eight hires per role and 16 hires overall.

The coordinator validates and stages every member against a private candidate through the normal domain owners and quotes. At the weekly boundary it revalidates the complete bundle. A failure discards every staged assignment, hire, compute change and financial fact. A successful bundle publishes once, with one command receipt; recruitment facts retain stable identifiers and cannot charge twice after reload or retry. Other staffing/compute decisions cannot overwrite a queued plan.

Apply requires the exact source-state hash that was reviewed. It queues the plan without advancing time. UI-facing submission also checks the projected boundary, so a known future rejection can be reported before queueing.

The resource allocator and economic rates are unchanged. Unlike Wave 24, Wave 25 does extend the command coordinator and command-shape validation. No new persistent slice or schema migration is needed. Existing snapshots remain valid. A snapshot with a pending Studio plan requires this application build; earlier builds reject the unfamiliar queued command instead of partially applying it.

## Acceptance evidence

| Case | Observed result |
| --- | --- |
| Repair ML shortage while preserving service | In the command-derived Week 14 company, assigning its existing ML engineer from 0 to 1 FTE changes training from 0 to 4 CUw. Chat remains at 0.43 CUw and 100% paid demand fulfilled. |
| Forecast matches real settlement | Week 15 settles at $17,428 cash, $408 revenue and $2,100 operating expenses. Preview, automated continuation and browser Apply → save/reload → step agree. Both settled exports have checksum `5d5311e3`. |
| Disconnected memory | A real Week 544 continuation has three compatible 16-MU pools: 48 MU in aggregate. A 24-MU training workspace receives zero work and a clear explanation. Raising cloud capacity from 8 to 12 CU supplies one 24-MU pool and the preview grants 8 CUw. |
| Invalid combined plan | Admission tests retain the exact source state, queue and cash. A separate commit-revalidation test lets an incoming release invalidate a later plan; its earlier staged hire and founder assignment are discarded, and cash matches the normal week without the plan. |
| Save and draft safety | Queued plan survives reload, applies once, and cannot be replayed. Input changes disable Apply. Import resets the draft. Studio/Classic round trips retain it. |

The shortage and memory scenarios are ordinary command continuations of saved companies. No money, model capabilities, readiness dates or resource grants are injected into those scenarios. Focused low-cash guard tests separately set balances to exercise affordability boundaries.

The [targeted test log](evidence/wave25-checks.txt) records **142 distinct passing checks** across Wave 0 core behavior, Wave 1 persistence and first-sale integration, Wave 2 infrastructure, Wave 6 capacity forecasting, Wave 17 compatibility, Wave 24 Studio and the 10 new Wave 25 planning cases. This is focused regression coverage, not a completed full-repository test run. The [browser evidence](evidence/wave25-browser.json) records the independent UI walkthrough.

A repository-wide lint run reports the existing backlog of 10 errors and 45 warnings, including old unescaped JSX apostrophes, a reserved variable name, the existing preference-loading and forced-Save effects, and test `prefer-const` findings. All ten blocking errors were confirmed against the base commit. The [focused lint check](evidence/wave25-lint.txt) passed with zero errors or warnings for the new files and changed core contracts. Typechecking and the production build are separate required publication gates; their final result is recorded below.

## Visual and responsive review

The new room asset is 136,834 bytes. The room, founder and engineer stay aligned, and all six labels point to the correct station. Screenshots: [Studio](images/frontier-lab-wave25-studio.png), [planner](images/frontier-lab-wave25-planner.png), and [connected-memory inspection](images/frontier-lab-wave25-memory.png).

Responsive checks used ordinary browser zoom at CSS widths 340, 779 and 1363 pixels. No horizontal page overflow or off-screen form input was observed. The wide workforce table scrolls inside its own container. These are desktop-browser responsive checks; physical touch devices were not tested. The original reduced-motion, scene-free list, Classic and save/recovery flows remain available.

Review fixes include a visible amount for projected arrears, state-aware planner visibility when the journal opens, project-card navigation from All projects, stronger comparison-text contrast, and plain-language workload names.

## Next planned wave

Wave 26 is the research-tree and synthetic-data expansion. The research graph, new synthetic-data production/review systems, Wave 27 canary/appliance work, and Wave 28 campus/successor-silicon work remain future scope.

## Production preparation

Final TypeScript checking and the Sites production build passed for package 0.25.0. The 142-check focused regression and post-label 10-check rerun passed.
