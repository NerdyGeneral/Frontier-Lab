# Dark Studio UI

**Build:** 0.30.5. **Content:** 0.28.0. **Save schema:** 5.

Baseline: build 0.30.4, commit `5ebddf587281af55c881450918652cd01a995e34`.

## Player experience

- A shared navy/slate palette replaces the beige surfaces across Studio, Classic, Research, Results, staffing, releases and Campus. Cyan identifies primary actions; violet marks research. Status labels and icons still accompany their colors.
- Sans headings, larger navigation and clearer control borders improve scanning. Keyboard focus remains visible.
- Garage, Studio and Campus use coordinated night artwork with their existing room layout and station positions.
- Setup dialogs keep a review action in the footer. Where a workbench has several commands, an action selector names the actual visible commands. The original form button retains the payload, validation and review handler; the footer does not reconstruct commands.
- More options contains resource planning, Results, Save and draft reset. Escape closes the open utility disclosure before closing the task.
- Review screens group the chosen setup, costs and next step. Generic help is expandable; specific financial, licensing and service-interruption terms remain visible.
- Research distinguishes **Unlocked** from assigned resources. Staff and compute work are independent meters, and the checklist says which work will wait. Cash readiness accounts for existing reservations. Resource help selects the required staff role and preserves the research draft.
- Available now cards expose reachable discoveries before the full 35-node tree. Locked choices highlight the full prerequisite path and link to the next unfinished prerequisite.
- The company header opens finances, team or compute. Cash distinguishes spendable, total and reserved amounts; team readiness and last-week compute work are named accurately. Runway remains conditional on the existing estimate.
- The main time button is **Next week**. Scheduled receipts offer **Keep planning** or **Advance to Week N**. The queue indicator opens and focuses Work queue. **Make another choice** returns accepted/processed receipts to setup without submitting their old payload again.

## Invariants

No engine formulas, prices, research requirements, save schema or serialization formats changed. Resource help changes the selected form, never staff allocations by itself. Review still captures the exact current payload and game revision, confirmation revalidates, and the existing deferred operation guard owns simulation advancement. The retained task owners continue to preserve drafts through reviews and resource detours.

## Verification

| Check | Result |
| --- | --- |
| Rendered UI and focused helper checks | **108/108 passed** using `node scripts/check-wave30e-ui.mjs`. |
| Surface recheck after utility-focus adjustment | **14/14 passed**. Mounted keyboard behavior remains a separate browser check. |
| Focused core checks | **101/101 passed**, covering task ownership, exact intents, acknowledgements, deferred operations, clock, Results, navigation and persistence. |
| TypeScript | **Passed** on final code with `npm run typecheck`. |
| Production build | **Passed** on final code with the supported build helper. |
| CSS syntax | **14/14 stylesheets parsed**. |
| Palette text contrast | Main text/panel **14.55:1**; muted text/panel **8.28:1**; muted text/raised panel **7.06:1**; action text/cyan **10.31:1**. These static pairs do not establish full rendered accessibility compliance. |
| Source scope | No changes under `src/core`, `src/modules`, `src/contracts` or `src/persistence`; the content catalog changes only the build version. |

Evidence: [UI checks](evidence/dark-ui-checks.log), [surface recheck](evidence/dark-ui-focus-recheck.log), [core record](evidence/dark-ui-core.json), [TypeScript](evidence/dark-ui-typecheck.log), [build](evidence/dark-ui-build.log), and [palette calculations](evidence/dark-ui-contrast.json).

The full historical gameplay suite was not rerun. The first integration run exposed two TypeScript narrowing errors and a marker value that confused an existing duplicate-ID assertion. These were fixed before the final successful checks. Independent review also caught and fixed incorrect retained staffing targets, the missing return from processed receipts to setup, and focus left inside a closed utility disclosure.

The shared managed preview is occupied by another project and was left running. No alternate preview server was started. Live browser acceptance is performed after publication; it is reported separately from these prepublication checks.

## Artwork provenance

The built-in image-generation tool edited the three existing room images. The brief was a lighting and palette change only: preserve camera, isometric geometry, workstation/server counts and positions; use slate-blue floors/walls, cyan screens and restrained warm lamps against a navy background; add no people, text or UI. The garage edit served as the style reference for the larger rooms. All three generated images were visually inspected, then encoded to WebP with the existing image dependency.

- `public/studio/garage-room-night.webp` — 1536 × 1024
- `public/studio/studio-room-night.webp` — 1536 × 1024
- `public/studio/campus-room-night.webp` — 1536 × 1024

The earlier artwork remains in source history. The night images are used by the room scene, and the Campus introduction uses the new Campus artwork. The existing vector favicon was recolored to the same navy/cyan palette.

## Live acceptance corrections

The first live pass verified the dark garage, research available cards, persistent action button, staff-role handoff, exact founder-allocation review, invalid-allocation feedback, and More options Escape/reset focus. It exposed Chromium reporting layout rectangles for actions in closed native disclosures. The footer visibility filter now explicitly excludes those closed sections. The research compute shortcut also opens the retained compute task directly so the return to research remains available. These corrections are included in the final typecheck, UI gate and production build.
