# Frontier Lab 0.38.5 — menus, continuity and gameplay check

Build **0.38.5** makes navigation easier to scan, removes an extra workstation action menu, and fixes a product view that could remain on a new-offer form after launch. The six main workspaces remain Studio, Projects, Research, Products, Operations and Company. Content stays **0.38.0** and save schema stays **5**. Simulation and persistence implementation are unchanged; the content catalog changes only its build metadata.

## What changed

### Compact menus with every destination retained

The opening All menus page previously displayed **27 feature cards and 12 shortcut buttons**, including long repeated unlock explanations. It now groups those same destinations into seven native disclosures: the six workspaces and Save & session. The current workspace starts expanded, and the other groups can be opened as needed.

Search and an explicit Workspace filter expose all matching groups immediately. Clearing the filters restores compact browsing. Every feature, direct shortcut and existing search alias remains available. Locked entries show a short **Locked** label; their full explanations remain available through accessible descriptions and titles, and on the selected workbench. These presentation changes do not grant eligibility or change command admission.

Research’s local Compare tab was misleading: it switched the player into Projects. That duplicate tab is removed. Comparison retains its canonical home under **Projects → Compare**, with explicit related links still available where useful.

### Direct workstations and workspace continuity

Room hotspots and the alternative workstation list now open their workbenches directly. They no longer first open a small action chooser. Hiring, allocation, training and other actions remain available inside the relevant workbench and through All menus shortcuts. Existing command reviews remain in place.

The main workspace navigation remembers the last ordinary section visited in each workspace. For example, returning to Company restores Journal if that was the last section used. Editing and review surfaces do not replace that remembered location or reopen automatically. Drafts remain explicit choices to continue. The history belongs to the current company and resets when the company changes.

Explicit destinations remain exact: Studio home, Work queue and named All menus entries do not unexpectedly redirect to a remembered section. Capacity restores its retained resource page and normal planning pause. Opening or closing the read-only All menus directory no longer pauses the simulation; ordinary action editors retain their existing clock behavior.

### Follow the offer that was actually created

A retained product panel could keep its selection set to **New** after a launch created a real offer. Returning to Products then showed another launch form, and first-launch copy could display zero subscribers while an existing offer had its own customers.

The panel now detects newly committed, owned offers of the relevant product kind. When the player was creating an offer, it follows the new offer into management. An existing selected offer stays selected, and explicitly choosing New establishes a fresh draft. Queuing an action alone does not invent an offer. First-launch metrics and instructions appear only when the owned portfolio is genuinely empty; additional-offer copy explains that existing customers and terms remain separate.

## Verification

The fresh baseline was published **0.38.4** source at commit `6eeb41f41dbf9876bb3a212a573398e2f08eacf9`. A [targeted engine check](evidence/menu-0385-engine-baseline.log) passed **100/100** cases. This was not a new complete long-run engine-suite invocation.

Focused checks passed **23/23** for directory/navigation, **15/15** for product selection and related behavior, and **10/10** for shell continuity and direct workstation controls. Six of the seven new product regressions failed before the fix. These focused counts overlap broader verification and should not be added to its unique total. Retained logs: [directory](evidence/menu-0385-directory.log), [product before](evidence/menu-0385-product-before.log), [product fixed](evidence/menu-0385-product-fixed.log), and [continuity](evidence/menu-0385-continuity.log).

| Final 0.38.5 source gate | Result |
| --- | --- |
| Complete UI suite | **287/287 passed**, exit 0; no failures, cancellations, skips or pending tests |
| Serial TypeScript check | Passed, exit 0 |
| Isolated production build | Passed, exit 0 |

The [full UI run](evidence/menu-0385-ui-final.log) included the 0.38.5 metadata and completed in **80,905.930702 ms**. The [typecheck](evidence/menu-0385-typecheck.log) and [production build](evidence/menu-0385-build.log) then ran serially. The build retains its existing warning about minified chunks exceeding 500 kB; it reported no build error. The [source manifest](evidence/menu-0385-engine-unchanged.json) confirms all **234 tracked engine, module, contract and persistence files** match the baseline.

## Gameplay evidence and limits

The [fresh baseline scenarios](evidence/menu-0385-natural-baseline.json), with their [generator](evidence/menu-0385-natural-baseline.mts) and [execution log](evidence/menu-0385-natural-baseline.log), cover **six ordinary-command cases** and **17 paired save-continuation checks**. They use paid work and weekly settlement without grants or direct progress edits. Each reload comparison checks the restored state and separately advanced next-week outcomes.

Manual Garage play reached its first invoice in Week 11 after a pause/resume exercise. Manual Consultancy completed its pilot in Week 8 and invoiced in Week 10. Delegated University reached review in Week 6, then required an explicit launch before invoicing in Week 10. The remaining cases verified pilot expiry, preservation and manual resumption of already-paid preparation after cancellation, and cancellation of a queued handoff without charging its stage fee.

Separately, live play on the published 0.38.4 UI started a normal Garage campaign, completed **$1,000 data preparation in Week 2**, performed **12 CUw of guided training at 2 CU through Week 8**, and completed the Basic conversation evaluation in **Week 9**. This live campaign has not yet been claimed as launched or billed. Updated-menu checks and launch verification follow publication.

This pass does not claim a fresh late-game ending run or newly completed mobile, zoom, touch or assistive-technology testing. Source review and rendered-component tests support the navigation changes; live layout and keyboard checks remain separate. The original exported campaign is private and excluded from public evidence. Restoration is planned after the live checks, not reported as already completed.
