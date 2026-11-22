# Wave 24 — Studio shell and first sale

Wave 24 implements the **first of the five graphics-expansion waves** in the Frontier Lab Studio Expansion Plan. The new Studio view presents the existing company simulation as a warm isometric garage, with interactive workstations and a compact workbench. The complete opening loop remains playable: prepare data, train a model, evaluate it, deploy Basic Chat, serve trials and earn the first payment.

**Presentation/package version:** 0.24.0. **Simulation/content build:** 0.23.0. **Save schema:** 5, unchanged.

## Studio presentation

The opening room uses original garage artwork, a founder portrait and a separate ML engineer portrait. Cream walls, mint flooring, wooden workstations and dark teal equipment follow the expansion plan's visual direction. The engineer appears when a relevant employee is ready. Character and station movement are presentation effects; they do not grant resources, advance the clock or affect outcomes.

Six stations open the existing action panels:

| Studio station | Existing panel | Main decisions |
| --- | --- | --- |
| Data desk | Data | Prepare, acquire and curate datasets |
| Training bench | Lab | Choose and fund model training |
| Test station | Models | Inspect checkpoints and run evaluations |
| Team desk | People | Hire, assign the founder and allocate staff |
| Compute rack | Compute | Reserve cloud capacity and allocate workloads |
| Release desk | Basic Chat | Deploy a qualified model and manage service terms |

The HUD shows actual cash, runway, team size and usable compute. Pause/resume, single-week stepping and speed controls use the existing clock. Navigation opens Studio, Projects, Research, Market, Finance and Save. Existing advanced screens remain available through their appropriate unlocks and workbench links, including racks and facilities, chips, cost accounting and capacity forecasting.

The Projects board exposes active, blocked and completed work. Project identities come from the simulation, and the player can explicitly pin up to four projects. Queued commands remain labeled as pending changes for the next boundary; they are not displayed as already executed projects. Status labels and blockers are drawn from recorded work, resource grants and engine explanations.

## Interaction and accessibility

The desktop inspector sits beside the room. Narrow layouts use a responsive workbench for the same forms. A scene-free list provides an alternate way to reach all six opening stations. The interface provides a workstation skip link, visible focus, keyboard-operable controls, Escape to close an inspector and return focus, and a reduced-motion preference.

Completion sounds are optional and muted on a fresh preference set. Multiple project completions are combined into a short notification. Motion preferences, selected view, sound, scene visibility and pinned-project IDs are stored separately from the company snapshot.

Studio and Classic keep the **same original form components mounted**. Switching panels or views therefore retains ordinary unsent form drafts instead of recreating a second set of commands or inputs. Both views share the existing quotes, command admission, weekly settlement and save operations.

## Simulation and save boundary

`src/core/studio.ts` adds a pure presentation selector, `getStudioView(state, content)`. It creates immutable station, project, milestone and summary objects without modifying the supplied state. Money remains in integer cents, resources retain the existing fixed-point units, and progress uses basis points.

The engine, economic rules, resource allocator, clock implementation, snapshot envelope and schema are unchanged. The visual overhaul does not require a new save migration. Classic remains available as an alternate presentation of the same run, and existing import, export, recovery and single-writer protections continue through the original persistence paths.

## Verified opening journeys

Two separate paths were exercised. Their economic outcomes are recorded separately because they did not establish identical model-selection histories.

| Evidence | Settled week | Company cash | Last weekly revenue | Result |
| --- | ---: | ---: | ---: | --- |
| Browser Studio journey | 10 | $32,572 | $72 | Paid Basic Chat service reached through the new interface |
| Automated completed-model journey | 10 | $32,608 | $108 | Completed training output evaluated and deployed through normal commands |

The browser journey recorded **$1,300 in weekly operating costs** at Week 10. Its canonical state hash was **`a929777b`**. Switching to Classic and reloading retained that hash and the settled company state.

The automated journey explicitly selects the training run's completed `outputModelId`. It starts with `createInitialState(CONTENT, 'release')`, reaches the first payment through normal commands, serializes and reloads the run, and compares deterministic continuation. The browser journey used the model selected in its interface. Its different revenue is not treated as a failed equivalence check against the automated model choice.

## Validation recorded

The [targeted acceptance evidence](evidence/wave24-checks.txt) records **84 distinct passing checks**:

- **79 existing checks** across clock behavior, browser persistence, first-sale integration and Wave 17 compatibility.
- **5 Studio checks** covering the real opening state, pending versus settled work, stable project IDs, blocked and paused activity, the first-sale path, selector purity, unchanged serialized state and historical snapshot compatibility.

The initial combined run included an incorrect $72 expectation in the completed-model test. The engine returned $108. That expectation was corrected to the observed completed-model result, and the Studio suite passed 5/5 on its focused rerun. The evidence file retains the initial failure and its resolution. No production economic behavior was changed to satisfy the assertion.

A broader repository regression run was interrupted because it contended with browser verification. **The validation claim is the focused coverage above, not a completed full-suite run.**

Responsive inspection used native Chrome zoom and observed CSS viewport widths of **340 px, 779 px and 1363 px**. These are desktop-browser responsive checks. DevTools device emulation was blocked by organization policy, so the checks are not presented as emulated-device or physical-touch-device testing.

The Studio screenshot is recorded at [frontier-lab-wave24-studio.png](images/frontier-lab-wave24-studio.png).

## Remaining expansion waves

Wave 24 establishes the presentation shell and opening gameplay. The following systems remain future expansion work:

| Wave | Planned next work |
| --- | --- |
| **25 — Projects, staffing and compute** | Studio room tier, richer project queue, workforce and connected-pool planning, projections and atomic plan application |
| **26 — Research tree and synthetic data** | Navigable visual research graph, proposed synthetic-data discoveries, generation, review, lineage and targeted curricula |
| **27 — Release desk and private appliance** | Richer release and incident operations, deterministic canary cohorts and a qualified appliance buyer path |
| **28 — Campus and successor silicon** | Campus artwork, facility specialization and a separately qualified second-generation chip |

The current Research screen continues to use the existing catalog. The current launch and infrastructure panels continue to expose established operations. Their availability in Studio does not imply that the planned new research graph, planning mechanics, canary system or campus expansion has been implemented.

## Production preparation

Final TypeScript checking and the Sites production build passed. The UI package is 0.24.0; simulation content and save compatibility remain on their existing versions.
