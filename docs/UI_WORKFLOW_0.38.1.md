# Frontier Lab 0.38.1 — UI and workflow

Build **0.38.1** makes development, research and resource planning easier to follow. Content remains **0.38.0** and save schema remains **5**. The [Connected company guide](CONNECTED_COMPANY_0.38.0.md) remains the reference for campaign rules, customer outcomes and progression.

## Three workflow fixes

### 1. Keep one development project through manual and delegated work

Open **Projects → Develop a model**, then choose **Manual** or **Delegated**. Switching modes carries the selected design, training data and project details through the handoff, including the project name, objective, evaluation choice, fee budget, cash reserve, duration, responsible lead and capacity share. Returning to the other mode preserves those choices instead of rebuilding the project from defaults.

The form distinguishes two decisions:

- **Project objective** records the outcome you are pursuing and guides research suggestions and success checks.
- **Starting design** applies a template to model settings. It changes the training mix, compute budget, learning focus and response style; a new foundation also takes the template's attention, context and precision choices. **Undo** restores the previous design.

Compact headers put the objective, mode switch and model controls closer together. Delegated projects with a systems objective retain a capability baseline before the matching paid challenge. Advanced and behavior diagnostics remain separate from that baseline.

### 2. Edit limits without silently moving the deadline or resuming work

The limits editor shows the exact saved **Deadline week**, including an expired deadline. Editing another limit does not extend that deadline automatically. **Save limits** preserves whether the plan is running or stopped, along with the current job state. A stopped plan resumes only when the player chooses **Resume**. Selecting a different deadline still requires a valid future week.

### 3. Describe the actual simulation clock

Plan controls and the global clock distinguish **Continuous play** from **Running until a decision**. The decision-run control follows the lab's selected global stop rules and reserve. It no longer implies that ordinary continuous play is a plan-specific run, or that other stop conditions will be ignored.

## Research programs have one permanent home

Open **Research → Programs** for **Systems experiments** and the **Architecture program**. Programs remains visible from the beginning of a campaign, and each activity explains its own requirements.

Systems experiments show candidate constraints and provide direct routes to develop a candidate, improve the selected model, or inspect its exact evaluation. The Architecture program has one workspace owner; the discovery tree and legacy catalog link there. Moving between program types retains their drafts.

**Discoveries** is the main research tree destination. The legacy catalog remains available through a contextual shortcut and existing links. Search terms such as “research programs,” “experiments,” “architecture research” and “manage research programs” find the Programs feature.

## Plan resource changes and review their impact in Capacity

Open **Operations → Capacity**. Its four views keep the resource decision together:

| View | Use it for |
| --- | --- |
| Plan resources | Review hiring and compute together as one plan. |
| Allocation & rental | Adjust serving, development and research capacity or cloud rental. |
| Forecast | Inspect future demand and capacity requirements. |
| Costs | Inspect recorded compute and infrastructure charges. |

Forecast and Costs open their reports directly when available. Locked reports remain visible with their research requirements.

After previewing a resource plan, the summary shows upfront cost, weekly cost change, cash after next week, constrained jobs and live service capacity. One **Apply plan** action appears before the detailed tables. Sections with unpaid bills, staff shortages, constrained work or insufficient connected memory/capacity open automatically; healthy detail sections remain available in collapsed disclosures.

Applying still queues the reviewed changes atomically. Changing the draft or company makes the preview stale and requires another preview. Applying a plan does not advance time.

## Navigation and the work queue

**All menus** now presents **27 canonical feature entries**. Related actions appear as shortcuts within a feature, and historical panel/task names remain searchable aliases. The Menu/Task filter and duplicate destination rows are removed. Locked destinations retain visible explanations.

| Search or old link | Current home |
| --- | --- |
| Development plans; `#development-plans` | Projects → Work queue |
| Research pathways; research catalog | Research → Discoveries, with a catalog shortcut |
| Architecture research; systems experiments | Research → Programs |
| Plan people and compute; `#planner`; `#studio-plan-workbench` | Operations → Capacity → Plan resources |
| Compute costs; capacity forecast | Operations → Capacity, with Costs and Forecast shortcuts |

**Projects → Work queue** combines delegated plans with their preparation, training, evaluation and challenge jobs. Stage work appears with its plan instead of also filling the independent-project list. Active, blocked and completed filters account for the combined view. Stopping or archiving a plan does not hide unfinished paid stage jobs; those jobs remain visible until their work ends.

Archived project history links to the saved challenge or evaluation report for that project's exact output model. When the saved report is unavailable, the model remains the appropriate fallback instead of selecting another model's report.

## Compatibility, scope and verification

Existing campaigns keep **content version 0.38.0** and **save schema 5**. The build version advances to **0.38.1**. Project handoff metadata is optional so older planning drafts remain supported; existing paid work and reports retain their identities.

A new **Portfolio** overview and a combined **Customers** workspace are deferred. The current product, client, release and market workflows remain available.

The [release-check record](evidence/ui-workflow-0381-release-checks.json) records the automated checks, browser coverage and any remaining limits for this build.
