# Phase 30A — Shared decision menus

Build **0.30.0**, content **0.28.0**, save schema **5**. This is the first implementation phase of the Frontier Lab UI Overhaul Plan. It adds the shared interaction foundation while retaining the current Studio destinations and existing game rules.

## Player experience

Workstation hotspots and their scene-free list buttons now open the same short, labelled action menu. Players can inspect the full workbench, open a focused decision for Data, Training or Evaluation, or review people and compute. Keyboard selection closes the menu before focus moves into the destination.

The focused task uses a centered dialog on larger screens and a full-height sheet on narrow screens. The clock, save state, controller status and errors remain visible inside it. Entering a decision pauses the lab; leaving it keeps the lab paused. Read-only workbench and project inspection does not change the clock.

Data, training and evaluation actions pass through a commitment review using the existing authoritative quote. Confirmation waits for the controller's actual acknowledgement. An accepted receipt shows the real command ID and effective week. A rejection or cancelled deferred action returns to the existing setup and preserves its inputs. A receipt describes an accepted queued command, not completed work; after its queue entry has settled, reopening it identifies it as a historical acceptance and directs the player to Projects.

Back, Close and Escape keep a draft. Explicit Reset remounts only that registered form owner. A resource detour preserves the parent task and exposes a named return action; returning from a review requires a fresh review. The existing planning workbench keeps its atomic plan submission behavior.

Project cards now open a reusable project inspector. Completed training and evaluation cards can open the exact output candidate or report, and a completed training result can enter evaluation with its own output selected. A missing or foreign target produces an unavailable message and requires an explicit replacement choice.

## Implementation contracts

| Area | Contract |
| --- | --- |
| Task registry | Four bounded owners: Data, Training, Evaluation, and the existing people/compute planner. Task metadata lives outside GameState. |
| Retained forms | One shared surface wraps the existing ordinary workbench tree. Switching inline/dialog or opening a review does not reparent, duplicate or remount the form. |
| Lazy work | Unvisited panels remain unevaluated. Hidden visited panels keep their last React children and local inputs. Only explicit draft reset or company replacement changes their key. |
| Submission | A reviewed payload and current-state reference reach the existing submitCommand path. An immediate in-flight guard plus epoch, task-instance and request identities prevent duplicate or obsolete acknowledgements. |
| Review freshness | A changed company revision invalidates confirmation. Refresh recalculates the existing payload against current state; helper detours return to setup. |
| Company replacement | Accepted import/new lab remounts the shell and workbench epoch together, clearing task metadata, selected identities and draft generations. Invalid import preserves the current company and drafts. |
| Exact navigation | Typed model/report/training-result resolvers validate identity and ownership. The Models workbench consumes an intent once, then respects subsequent manual selection. |
| Modal behavior | One named aria-modal dialog, inert background branches, contained keyboard focus, visible Close/Back, safe Escape and opener or named fallback focus. |
| Responsive behavior | 44px controls, readable task typography, internal scrolling, narrow full-height sheet, short-viewport fallback, reduced-motion and forced-colors rules. |
| Compatibility | Classic uses the same existing forms and queue path. Content rules, save format, local recovery, eligibility checks and simulation settlement are unchanged. |

The exact product/candidate resolver is a foundation contract; this phase does not claim to migrate advanced release forms to consume it. Only the model/report/training-result consumers described above are connected.

## Deliberate phase boundary

The complete guided opening/training journey is **30B**. The persistent Results inbox and focused staffing menus are **30C**. Navigation consolidation is **30D**. This release provides their shared surfaces and contracts without removing current advanced workbench entry points.

## Verification

See [current design QA](../design-qa.md) for the final validation inventory, browser observations and remaining verification limits. Engine compatibility is checked with identical imported fixtures and command sequences; UI render and task-state checks are reported separately from mounted browser observations.
