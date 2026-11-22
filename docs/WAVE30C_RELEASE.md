# Phase 30C — Results and resource decisions

Build **0.30.2**, content **0.28.0**, save schema **5**. This phase adds the global Results inbox and focused staffing decisions specified in the UI Overhaul Plan. It extends 30A’s shared menus and 30B’s exact opening journey.

## Player experience

**Results** is reachable throughout Studio and Classic. Recent outcomes groups the newest 200 supported retained records by their real completion or activation week. Type, week and review-state filters help find an older result. Opening an outcome marks it reviewed; individual dismissal, restoration and **Mark week reviewed** change only local attention flags. Dismissed records remain reachable through the filter while the underlying game retains them.

Training leads to its exact output candidate, evaluation to its own report, prepared data to that dataset, and research, deployment and staff readiness to their recorded targets. Missing or foreign targets explain why the follow-up is unavailable. Another candidate, report or employee is never selected implicitly. The supported historical sources are data preparation and synthetic audit, completed training, retained evaluation reports, completed research, active deployments and employee onboarding.

**Needs attention** keeps current constraints separate from historical outcomes. It shows recorded project blockers, waiting work, staff onboarding, compute constraints and relevant save/controller issues. These items change as their source conditions change. A new completion updates the global count and brief nonmodal feedback; it does not open a menu over an unfinished decision.

The **Hire** menu shows role, current recruitment cost, recurring salary, the week hiring/payroll begins and the actual onboarding date. Existing hiring rules start an employee at one FTE in the hired role; onboarding supplies no productive capacity. This does not assign the employee to a named project or guarantee a grant.

**Assign time** keeps founder and employee choices explicit. Founder time is shared across roles. An employee’s allocation changes the role’s intended capacity while full salary continues. Current/proposed assignments, readiness and recorded role-level grants remain distinct. Missing employees require explicit reselection. Hire and assignment share one retained staffing form.

Contextual resource review explains the selected constraint and preserves the originating draft. The existing combined people/compute planner still applies one atomic plan through its ordinary command path. There is no automatic hiring, rental or allocation when a player follows a shortage link. Results, staffing and helper detours use the same single modal host, with a named route back to the retained task.

## Persistence and compatibility contracts

| Area | Contract |
| --- | --- |
| Evidence | Derive historical outcomes from stable owned source records and recorded weeks. The UI cache stores no duplicate outcomes and cannot recreate missing history. |
| Bounded retention | Deduplicate stable kind/source/completion identities; select the newest 200 before applying reviewed/dismissed filters. Older evidence is available only while its original records remain. |
| Local review marks | A versioned sidecar contains an independent random timeline token, player ID, SHA-256 binding to successfully persisted snapshot bytes and at most 200 flags. The envelope is capped at 64 KiB. |
| Quiet startup | A verified matching save restores flags without replaying celebrations. A new or unverifiable timeline starts retained historical outcomes reviewed. |
| Replacement | Accepted new lab, import or recovery resets task identity and establishes a fresh UI timeline, even when company IDs or snapshot bytes repeat. |
| Ownership | Only the controlling owner session persists shared review marks. Observer and memory-mode marks stay local. Async save/hash completion is guarded by timeline and save identity. |
| Failure | A UI-storage failure may reset review marks or keep them local; it cannot block or corrupt the game save. Exported saves do not include inbox flags. Game save and sidecar writes are intentionally separate. |
| Commands | Quotes, readiness, review invalidation, real acknowledgements and duplicate prevention continue through the existing controller. Browsing and reviewing outcomes do not change simulation state. |

The snapshot writer exposes an additive receipt containing the exact bytes successfully written. Its existing result API, validation, recovery archives and serialized game format remain compatible. No economic rules, research gates, staffing formulas or save schema were changed.

## Focused verification

**149 distinct automated checks passed:** 58 rendered UI checks, 75 core/cache checks and 16 Results persistence checks. TypeScript validation passed. These are scoped release checks; the entire historical repository test suite was not rerun.

The deterministic comparison uses exact published 30B source, commit `94795f80b62a7b05ab1dd0b012e3ca2a49b86b71`. Three scenarios cover the opening through first sale, an advanced commercial company, and focused staffing/resource decisions. All **37 full state, command-result and serialized-save checkpoints** match. All **nine snapshot-writer comparisons** match exact stored bytes, including three checks that the new receipt identifies the actual primary snapshot. The initial new-company comparison normalizes only its intentional build-version header; imported-fixture continuations do not normalize economic, random, command or saved-state differences.

The staffing parity scenario includes paid recruitment, assignment during onboarding, a founder split, recorded readiness, missing-employee rejection and an atomic founder/employee/cloud/compute plan. Results tests cover exact older targets, unavailable/foreign entities, stable deduplication, real completion dates, the 200-record window, review/dismissal filters, onboarding transitions and frozen-state purity. Persistence checks cover quiet reload/replacement, malformed or mismatched metadata, write failures, observer isolation and deferred callback races.

Mounted browser acceptance passed through ordinary UI actions. Double-clicking hire produced one accepted command; payroll began in Week 1 and the employee became ready in Week 3. Completion raised the unread count without opening a modal. Reload retained the unread outcome quietly, dismissal survived another reload, and importing identical snapshot bytes established fresh reviewed, non-dismissed history. The exact employee’s 0.5-FTE assignment survived a planner detour and was accepted for Week 4. In the advanced Week 553 fixture, the Week 508 training result opened its exact **Document adaptation 17** candidate despite newer models. A Basic Chat canary constraint opened its named resource context while retaining the evaluation draft. Results and staffing remained usable at 200% and 400% browser zoom; Shift+Tab wrapped within the Results dialog, Escape returned to the parent, and the hire review remained keyboard-reachable at 400%. The original **41,831-byte** preview snapshot was restored exactly. The supported production build passed all five stages. These are scoped browser and automated checks; [design QA](../design-qa.md) records the detailed evidence and verification limits. [30B design QA](WAVE30B_DESIGN_QA.md) preserves the previous release’s acceptance record.

Evidence: [UI checks](evidence/wave30c-ui.log), [parity summary](evidence/wave30c-parity.json) and [parity run](evidence/wave30c-parity.log).

## Next phase

**30D** migrates the remaining menu families—research methods, advanced releases, Campus/racks/chips, product/business decisions, and company/system controls—then consolidates the six-destination navigation. Those remaining workspaces stay available through their existing routes in 30C.
