# Phase 30B — Guided opening journey

Build **0.30.1**, content **0.28.0**, save schema **5**. This phase implements the opening journey in the UI Overhaul Plan, using the shared decision menus from 30A and the existing simulation commands.

## Player experience

The opening guide follows selected data through preparation, training, evaluation and the first Basic Chat deployment. It names the current dataset or candidate, distinguishes queued decisions from actual projects, shows recorded progress and blockers, and links directly to the next relevant task. A completed deployment is separate from the later first sale. When several completed candidates are available after a reload, the guide asks for a named choice.

Training now offers Guided and Advanced views of the same retained form. Guided groups real methods into Adapt with data, Refine a candidate and Build a model. Base model, primary dataset, readiness, work and memory remain visible. Advanced settings expose the existing profiles, architecture, checkpoints, retention and experiment controls. Switching presentation does not change the training choices or payload. Locked methods remain discoverable with their research prerequisite.

An unprepared selected dataset has a direct preparation action. Training → Data → resources uses one bounded parent link, so **Return to training** restores the original form. Data, evaluation and launch resource detours expose their own named return. Leaving a review retires its captured commitment without discarding the form values; a returning player reviews current costs and eligibility again.

Completed training follows its exact output model into evaluation. The displayed report determines its Basic Chat capability claim: diagnostic evidence cannot borrow eligibility from another report. A qualifying capability report carries its own model and report into the first launch menu, even when another candidate is newer.

The first Basic Chat launch uses the ordinary `deploy_product` path. It shows the candidate, relevant capability evidence, price per account per week, included exchanges, deployment effort, resident memory, current quote and effective week. The authoritative command path continues to check policy, commercial rights, memory, funds and other prerequisites. An existing Basic Chat product opens its current workspace and model replacement controls.

## Implementation contracts

| Area | Contract |
| --- | --- |
| Retained owners | Data, Training, Evaluation, first Basic Chat launch and the existing resource planner. Each still owns one original form. |
| Exact navigation | Typed dataset, training-dataset and first-launch intents validate ownership and identity. Consumers apply each intent once, then respect manual edits. Missing targets require explicit recovery. |
| Journey state | A pure selector derives queue, project, report, deployment and sale states. Session focus stays outside GameState and is cleared by accepted company replacement. |
| Receipt identity | Accepted command IDs resolve their actual preparation/training/evaluation/deployment records after settlement. Weekly rejection or a missing record cannot become invented success. |
| Submission | Existing current-state checks, in-flight gate and epoch/request guards admit at most one command. Rejection and cancellation preserve the draft. |
| Helper return | One bounded parent, no modal stack. Returning also invalidates a child review so its later inline edits cannot reuse an old captured payload. |
| Compatibility | Existing economics, research, training, evaluation, deployment, clock, saves and Classic forms retain their simulation behavior. |

## Verification

**96 focused automated checks passed:** 40 rendered UI checks and 56 task, journey, submission, clock and browser-gate checks. TypeScript and the supported production build passed. Comparison with exact published 30A source matches 27 complete state/result/save checkpoints and four snapshot-writer comparisons; only the intentional new-company build header differs.

In the managed browser, the ordinary opening reached prepared data in Week 2, completed Stable-profile training in Week 7, a capability report in Week 8 and live Basic Chat in Week 10. Its single deployment retained the evaluated model, a $12.50 weekly price and 125 included exchanges. The first sale remained incomplete at activation. Resource detours, Escape, named Resume, narrow reflow and keyboard focus were exercised. The original preview snapshot was restored byte for byte afterward.

See [design QA](../design-qa.md), [browser evidence](evidence/wave30b-browser.json), [UI checks](evidence/wave30b-ui.log), [core checks](evidence/wave30b-core.log) and [parity evidence](evidence/wave30b-parity.json) for the evidence and verification limits.

## Next phase

**30C** is the persistent Results inbox and focused staffing menus. **30D** consolidates navigation. Advanced release operations, persistent result acknowledgements and a new navigation structure are outside this phase.
