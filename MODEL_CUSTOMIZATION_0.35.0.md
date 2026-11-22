# Frontier Lab 0.35.0 — research and model customization

Build/content version **0.35.0**; save schema **5**. This update adds 13 paid discoveries, bringing the authored research catalog from 41 to 54. They unlock actual engineering and training choices in the existing custom designer and delegated development plans.

## Where to play

- **Research → Pathways → Model customization:** a focused view of the 13 new discoveries, organized into four pathways. The selector sits at the top of Research. Map and List views retain search, stage filters, prerequisite links and exact research requirements.
- **Projects → Training → Design your own:** choose a purpose, engineer the model, set the seven-skill data mix and choose the compute budget. A discovery’s **Use in custom design** action opens its exact option. Hardware discoveries select a new foundation automatically.
- **Projects → Development plans:** the same designer feeds the existing prepare/train/evaluate workflow, with its fee budget, reserve, deadline and final review.
- **Projects → Models:** saved model profiles show the engineering choices used to create a version. Model comparisons and development history retain this identity.

## Research expansion

Entry fees are in-game prices. Payroll, rented compute, actual GPU use and later training remain separate expenses. Each discovery needs both staff work and compute, then unlocks at the following weekly boundary.

| ID | Discovery | Prerequisites | Entry fee | Design choice unlocked |
| --- | --- | --- | ---: | --- |
| M1 | Grouped-query attention | Checkpoint automation (R3) | $1,800 | Lower training memory and serving work, with fitting and skill tradeoffs |
| M2 | Sliding-window attention | M1; Retrieval (R6) | $4,200 | More efficient local attention with reduced long-context capacity |
| M3 | Hybrid attention | M2; Enterprise operations (R12) | $12,000 | More reasoning and context potential, with extra memory and compute |
| M4 | Extended context | Data curation (R2); R3 | $3,000 | Higher long-context and document potential with larger resource requirements |
| M5 | Ultra-long context | M4; R12 | $16,000 | A stronger context specialization with substantial memory, evidence and serving costs |
| M6 | 8-bit weights | Compression (R7); Activation recomputation (D5) | $6,000 | A smaller, cheaper-to-serve foundation with capability and reliability costs |
| M7 | 4-bit weights | M6; Memory format (R7A) | $14,000 | A more aggressive memory and serving reduction with larger quality costs |
| M8 | Reasoning curriculum | Evaluation suite (R1); Efficient adaptation (R4) | $4,200 | A reasoning specialist training objective |
| M9 | Agentic curriculum | Defined workflows (R9); Function calling (D3) | $6,500 | A coding and tool-use training objective |
| M10 | Grounded curriculum | R6; Structured extraction (D2) | $4,800 | A document and long-context training objective |
| M11 | Multimodal curriculum | R2; R4 | $8,000 | A multimodal training objective |
| M12 | Careful responses | Behavior cases (R1A); Calibration curriculum (R5A) | $3,500 | Fewer confident mistakes, with more unnecessary refusals |
| M13 | Expressive responses | R1A; Support dialogue (D1) | $1,800 | Fewer unnecessary refusals, with more confident mistakes |

## Model design choices

The designer now offers 18 choices across five groups, including the five baseline choices:

| Group | Choices | When it can change |
| --- | --- | --- |
| Attention | Standard, grouped-query, sliding-window, hybrid | New foundation |
| Context capacity | Standard, extended, ultra | New foundation |
| Weight precision | Full, 8-bit, 4-bit | New foundation |
| Training focus | Generalist, reasoning, tool/workflow, document-grounded, multimodal | New paid custom training run |
| Response style | Keep starting behavior, careful, expressive | New paid custom training run |

Five editable purpose presets—**Balanced, Customer support, Coding partner, Research analyst, Visual assistant**—set an initial combination, data mix and budget. They are planning shortcuts, not new fixed recipes. Unresearched choices remain visible and can be previewed, with a named unlock requirement. Starting a run still requires the discovery and suitable prepared evidence.

An adaptation inherits the parent’s family, size, sparsity, attention, context and precision. Its objective and response style can change through paid training. Switching the starting model updates inherited hardware while retaining the draft’s name, training priorities and budget. A new foundation is independent of the reference model’s hardware.

### Examples of real tradeoffs

- Grouped-query attention uses **15% less training workspace** and **10% less serving work**, but needs **5% more compute for the same fit** and reduces reasoning/multimodal capacity by **2%**.
- An 8-bit design uses **35% less deployed model memory** and **15% less serving work**, with **1.5% lower skill capacity**, a **one-point lower reliability target**, and **10% greater training intensity**. A 4-bit design pushes those memory and serving reductions to **60% and 30%**, at larger quality costs.
- Extended context raises long-context potential by **10%**, but increases evidence demand, fitting effort, memory and serving work. Ultra context makes a larger version of that tradeoff.
- A reasoning objective increases reasoning capacity by **12%** and coding by **4%**, with reductions in other skills plus additional evidence, fitting and inference requirements.
- Careful and expressive behavior use opposing error/refusal targets. Both require **at least 100 reviewed behavior examples**. Actual gains depend on their quality and the work completed.

These are authored game coefficients. Multipliers combine with the chosen family, size, sparsity, research history, data weights and the benchmark ceiling. A larger potential bonus can be limited by missing evidence, a small compute budget or the score ceiling. The forecast shows the resulting model, not simply the nominal bonuses. Context profiles affect capabilities and resource demand; they do not introduce literal token-window limits or change the existing product token meter.

The entire chosen compute budget remains paid work. Training intensity changes how much that work achieves. Research does not improve an existing deployed model automatically. New runtime costs flow into the game’s existing serving and resource allocation systems.

## Streamlined workflow and forecasts

All new controls are inline. There are no extra confirmation popups for choosing a purpose, inspecting a locked option or adjusting a design.

The forecast shows the seven expected skill scores, reliability, confident-error and unnecessary-refusal tendencies, setup fee, actual training work, training memory, deployed memory, serving work, evidence demand and a nominal GPU-time estimate. Estimates continue to account for the selected prepared data. Actual timing also depends on staff, hardware and competing jobs.

Research and design navigation preserves the exact requested option. Saved model profiles make later comparisons and improvements traceable to the choices that produced them. Existing training methods, deployment decisions, challenge tiers and development-plan controls remain available.

## Persistence and integrity

The new optional, versioned customization block freezes the chosen options, effects, required discoveries, hardware serving cost and behavior training evidence in the paid plan. Checkpoints and final models inherit that record. Later research cannot rewrite a run already in progress.

The absence of customization uses the original formula and receipt structure. Neutral explicit defaults share the old engineering identity, preventing a renamed or default-toggled duplicate from rerolling training. Response targets use an absolute lineage baseline, so alternating styles cannot compound endless gains. Existing policy refusal limits remain in force, and a later ordinary calibration run still uses its own earned outcome.

The 0.34 migration changes only build/content metadata. It retains cash, week, identifiers, contracts, model scores, research, random streams, calendar, queued commands, development plans and paid history. Earlier supported generations remain supported. Before the first upgraded browser write, the exact original 0.34 save is archived; recovery can be exported from Save. If that archive cannot be written, the original primary save remains untouched.

Historical headers reject new customization evidence and M-series discoveries before migration. Paid M discoveries validate their actual prerequisites at the admission week, accepted command, immutable method identity and fee evidence. Genuine origin knowledge remains a valid prerequisite.

## Verification

Verification covers authentic published save fixtures, ordinary paid discovery and training commands, checkpoints, pause/resume, later research, frozen receipt validation, behavior evidence, policy boundaries, actual runtime costs, delegated-plan admission and save/reload. No new runtime dependencies were added.

| Check | Result |
| --- | --- |
| Full UI suite | 190 passed, 0 failed |
| Full engine suite on the untouched published 0.34 source | 928 tests: 875 passed, 53 failed |
| Full engine suite on the expanded 0.35 source | 942 tests: 889 passed, 53 failed |
| Engine regression comparison | The same 53 failing file/test names; all 14 added tests passed |
| Final customization checks after the policy-floor refinement | 4 passed, including paid policy-to-custom continuation |
| New and existing migration checks | 16 passed |
| Focused designer/development-plan checks | 21 passed |
| Research/tree checks | 24 focused checks and 74 broader regression checks passed |
| TypeScript | Passed |

The engine suite is not fully green. Fifty existing failures have identical assertion details in both runs. Three existing migration assertions still expect obsolete version 0.33; their reported actual version changes from 0.34 to 0.35. The final policy-floor patch was checked with the affected customization suite and TypeScript after the full comparison.

Desktop browser checks verified the research selector, exact discovery-to-designer navigation, locked previews, live forecasts, and preservation of a named draft after navigating away and back. A 390 × 844 phone viewport verified all 13 discoveries, persistent navigation, the same research-to-design action, preset selection, and no page-level horizontal overflow. No application console errors were observed. The temporary responsive test page was removed before packaging.
