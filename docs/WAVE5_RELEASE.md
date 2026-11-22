# Wave 5 release handoff

**Frontier Lab — Release**

Content/build version: **0.6.0**. Save schema: **5**. This document records release changes and reproducible campaign evidence; production build and publication are tracked separately.

## Delivered scope

Wave 5 completes ordinary-command playthroughs of all three campaign ambitions, adjusts trust pacing, repairs specialist progression across successful contract renewals, and improves navigation and guidance. It preserves the existing training, model behavior, product billing, compute, data-center, agent, licensing, applied-research, and custom-chip systems.

The natural campaign drivers begin with `createInitialState(CONTENT)`, the standard $48,000 opening, and seed `frontier-lab-wave-0`. Both run with all three authored rivals enabled. Player hiring, research, data purchases and curation, training, evaluations, deployments, compute changes, and contracts go through ordinary commands and weekly boundaries. There are no direct player-state grants or external funding. Rivals retain their normal one-time scenario assets and operate under the shared engine.

## Guidance and navigation

The Universal Paperclips-style page remains sparse: native controls, short tables, thin rules, and expandable details. Three desktop columns collapse to one on narrow screens.

- **Jump to** links follow the panels currently available to the company. **Top** links return from long sections, including the late-game panels.
- **How to run your lab** explains the data-to-first-sale sequence; FTE, CU, CUw, and MU; cloud rent and owned-hardware costs; research versus implementation; model evaluation; campaign ambitions; and weekly timing and portable saves.
- An unmet ambition requirement links to the relevant controls. Exact targets, current values, and streaks still come from the authoritative campaign view.
- Completed research links to its application: training, evaluation, deployment, agents, infrastructure, or paid systems. Research does not silently upgrade an existing product.
- The milestone recognizes earned endings and a completed first sale before applying the opening checklist. A valid advanced run is no longer sent back to an irrelevant opening step.
- Market help explains the release trust rules. Import and recovery text recognizes Wave 4 and avoids hardcoded destination-wave labels.

These additions are presentation and guidance. They add no saved fields and do not maintain a second set of economic calculations. Existing command previews continue to supply current admission requirements, costs, and rejection explanations. The deployment-variant quote also states that the task-score penalty is applied.

## Trust pacing and contract continuity

### Company trust

`src/content/wave5-balance.ts` holds the release coefficients. The interface displays changes as points on the 0–100 trust scale.

| Settled paid-product observation | Weekly trust change |
| --- | --- |
| Every observed paid product meets its service and reliability checks | **+0.10 points** |
| The same service checks pass, and every observed paid product also uses a model with confident-error tendency below the baseline | **+0.25 points total** |
| Any observed paid product misses the service or reliability checks | **−0.25 points** |

The engine combines the observed products into one company result per week. Adding products does not multiply trust gains, and calibrating only one product does not qualify a mixed portfolio for the larger gain. The service checks require at least 98% fulfillment and an execution-error rate no greater than 18%. Products without paid accounts do not generate this observation. Trust remains bounded from 0 to 100.

These rules connect the platform ambition to reliable paid operation and calibrated model behavior. They do not guarantee a completion date: customer acquisition, competition, staffing, capacity, upgrades, and service interruptions still affect the company’s path.

### Specialist commitments across renewals

The specialist ambition requires a mature named business commitment alongside the trained domain model, served organizations, and financial and service requirements. A first term needs at least four delivered weeks, current service meeting the customer’s SLA, and a term average meeting that SLA.

A successful renewal now preserves the relationship’s earned maturity when the current term’s counters reset. It does not exempt the renewed contract from current delivery: the latest service and the new term’s average must still meet the SLA. Renewal itself still requires the complete prior term, adequate average service, no unresolved breach, and renewal enabled. Expired or undelivered commitments provide no qualifying billed service.

This removes the artificial maturity reset that could break the specialist streak despite uninterrupted successful delivery. It uses existing term records and introduces no new save fields.

## Natural campaign evidence

The checked-in receipts contain provenance, commands by kind, financial results, stages, proof windows, and final snapshot checksums. Counts below are from settled campaign weeks, so customers who only convert for the following week are excluded.

| Route | Earned in | Consecutive qualifying proof | Receipt |
| --- | --- | --- | --- |
| Trusted platform | **Week 188** | Weeks 177–188; 12 weeks | [Business campaign](evidence/wave5-business.json) |
| Essential specialist | **Week 252** | Weeks 241–252; 12 weeks | [Business campaign](evidence/wave5-business.json) |
| Frontier laboratory | **Week 235** | Weeks 228–235; 8 weeks | [Frontier campaign](evidence/wave5-frontier.json) |

The platform and specialist endings belong to one continuing business run. Frontier uses a separate continuation of the ordinary opening, funded by earned consumer revenue before expansion. These receipts establish viable deterministic strategies for the recorded seed and balance. They do not establish optimal timing, universal profitability, or complete coverage of every optional system.

### Platform and specialist company

The business run executes **221 commands** from the initial company through Week 252. Its lowest cash balance across the full run is **$37,648.00**. The final settled week records:

| Measure | Week 252 result |
| --- | --- |
| Cash | **$1,725,584.09** |
| Weekly revenue | **$36,004.00** |
| Weekly operating expense | **$18,500.00** |
| Paid consumers / developers / business organizations | **1,067 / 129 / 13** |
| Paid product families | **3** |
| Weakest paid service | **100%** |
| Company trust | **93.9%** |
| Arrears / audited agent penalties | **$0 / $0** |

The company trains and evaluates separate calibrated consumer, developer, and business models. Its medium document specialist earns a **77.00** document score and **92.8%** reliability. The medium foundation consumes 240 useful CUw, a 24-MU workspace, six preparation staff-weeks, and 500 prepared broad-data units with 95 quality in all four domains. The final company rents 82 cloud CU.

One named **Vector Studio customer-hosted license** is sufficient for the commitment requirement. It is signed in Week 201 and begins delivered service in Week 203. It bills $250 per week, has billed $12,500 by the final checkpoint, and has issued no service credits. Buyer-provided inference compute means its recorded player inference work is zero; delivery and ongoing support still follow the license system’s rules.

The specialist proof crosses the actual renewal boundary in **Week 251**. Weeks 251–252 are the first two weeks of the new term, yet the successfully delivered relationship retains its maturity. The receipt separately records the real renewal boundary and the other early-term proof weeks, avoiding the assumption that any young term proves a renewal happened inside the window.

Final checkpoint: Week 252, checksum **`be2188bd`**. Reproduce with:

```sh
npm test -- wave5-business
```

### Frontier laboratory

The frontier route uses **143 commands across the ordinary opening and its continuation**. The opening earns its own reserves through Week 96; the continuation then buys hardware and data, employs the needed staff, researches and installs supervision, trains a large foundation, evaluates it, calibrates its behavior, and serves paid API customers alongside the compact consumer product.

The reported **$57,126.88 minimum cash** covers the continuation from Week 96, not the entire lifetime of the opening company. Final results are:

| Measure | Week 235 result |
| --- | --- |
| Cash | **$178,184.85** |
| Weekly revenue | **$11,616.00** |
| Weekly operating expense | **$4,947.85** |
| Paid consumers / developers | **603 / 73** |
| Weakest paid service | **100%** |
| Conversation / documents / coding / tools score | **88.62 / 85.99 / 83.21 / 81.59** |
| Model reliability | **92.8%** |
| Behavior holdout | **2 confidently wrong cases out of 100** |

Three general racks and five memory-rich racks supply **64 owned CU**, with zero cloud CU at the checkpoint. Recorded purchases include $190,000 of hardware and $36,000 of data, alongside the $70,000 large-foundation entry fee. The stable foundation completes **990 useful CUw**, approximately **1,285.71 physical CUw**, a **72-MU workspace**, **20 preparation staff-weeks**, and **1,500 broad-data units** with quality 95 in every domain. These are paid, completed projects rather than supplied late-game assets.

Final checkpoint: Week 235, checksum **`7da89a9a`**. Reproduce with:

```sh
npm test -- wave5-frontier
```

Each campaign test checks every week of its ending proof, state validation, a snapshot round trip, and matching next-week results after reload. The tests retain earned endings after that continuation. Optional `BUSINESS_CAMPAIGN_EXPORT` / `FRONTIER_CAMPAIGN_EXPORT` paths write playable snapshots; the corresponding `*_CAMPAIGN_RECEIPT` paths write the metrics receipts.

## Verification record

| Check | Recorded result |
| --- | --- |
| Full automated regression suite | **231 tests passed; zero failures or skipped tests.** |
| TypeScript | **Passed** on the integrated checkout. |
| Patch whitespace | **`git diff --check` passed.** |
| Browser: prior save | The existing Week 16 Wave 4 run migrated automatically; the original Wave 4 recovery export was available. |
| Browser: guidance | Expanded the play guide, followed section navigation and Top links, followed an unmet trust criterion to its controls, and followed completed research to Models. |
| Browser: model evidence | Displayed the actual held-out behavior report. |
| Browser: natural frontier snapshot | Displayed the earned Frontier laboratory ending from Week 235. |
| Browser: natural business snapshot | Displayed Trusted platform earned in Week 188 and Essential specialist earned in Week 252, then continued the company to Week 253. |
| Browser: reload | Reloading the Week 253 business run retained both earned endings. |
| Browser: original run restored | The original user preview run was restored at Week 16 and verified saved. |

The browser checks inspect snapshots produced by the natural command-driven campaigns; they do not claim that all 235 or 252 weeks were played through browser controls. Saved screenshots show the [frontier result](images/frontier-lab-wave5-frontier.png) and [company ambitions](images/frontier-lab-wave5-ambitions.png).

Production build and publication are performed by the Sites pipeline after these checks; their outcomes are tracked in the Sites version record and release response.

## Save compatibility and recovery

Wave 5 keeps **schema 5** because the stored representation is unchanged. A valid Wave 4 save with content/build **0.5.0** is validated in its original representation, cloned, and upgraded to content/build **0.6.0**. The import changes only those headers: it does not advance time, grant cash or research, change project progress, synthesize campaign history, or award an ending. The new trust pacing and renewal interpretation apply when play continues.

The primary browser save key and single-writer lock remain unchanged. Before the first upgraded write, the browser archives the exact prior bytes under the appropriate recovery key:

| Original run | Recovery key |
| --- | --- |
| Wave 0 / schema 1 | `frontier-lab.wave0.original` |
| Wave 1 / schema 2 | `frontier-lab.wave1.original` |
| Wave 2 / schema 3 | `frontier-lab.wave2.original` |
| Wave 3 / schema 4 | `frontier-lab.wave3.original` |
| Wave 4 / schema 5, content 0.5.0 | **`frontier-lab.wave4.original`** |

Existing originals are never overwritten. An archive failure prevents replacement of the primary save. A failed primary write retains the old primary and any successful archive. Invalid or unsupported input blocks automatic replacement and remains exportable. Explicit replacement also retains the previous raw run. The save controls offer an **Export original Wave 4 save** recovery option when that archive exists.

Compatibility coverage includes the authentic published Wave 4 engine at commit `0fef8d0e2c010ca4ce351ff5215a2df757376480`, with fixture checksum `326eb5c9`. Its five-week oracle checks that already paid engineering, fabrication, fabric installation, rollouts, and queued commands retain their published completion schedule. This fixture is separate from the natural campaign receipts.

Saves remain browser-local with portable JSON export. One tab owns the clock and writes. Hidden pages pause, with no offline catch-up or account synchronization.

## Explicit remaining scope

Seven authored research subbranches remain visibly planned and unavailable to purchase:

| Planned branch | Intended extension |
| --- | --- |
| R2A — Deduplication | Expose duplicate clusters and the distinct evidence retained during preparation. |
| R4B — Adapter bank | Share a compatible resident base among adapters with explicit memory and rollout costs. |
| R6A — Evidence links | Execute citation-support checks with per-request work. |
| R9A — Action receipts | Extend existing once-only support-job receipts into recovery across resumed multi-job procedures. |
| R10A — Independent holdouts | Compare claimed and actual outcomes on an additional unseen-case suite. |
| R11A — Budgeted planner | Train a finite reduction in avoidable repeated stages while retaining hard budgets and necessary checks. |
| R12A — Capacity forecast | Forecast demand, headroom, and contract fit with stated assumptions and a heavier-load case. |

Current support jobs already retain action receipts. The planned recovery branch does not make that existing feature unavailable. The active behavior suite, calibration recipe, run supervisor, memory format, and prefix cache also remain playable.

The accepted campaigns exercise particular model and infrastructure strategies. They do not constitute natural playthroughs of every sparse-model, chip-specification, routing, caching, data-center, private-hosting, or agent-policy combination. Those systems retain their module-level coverage and earlier release records. Further balance work can compare alternative strategies against these reproducible baselines.

Models, customer populations, scores, money, token prices, and hardware are fictional simulation records. The game has no live model calls, external agent actions, real purchasing, payment integration, or account-synchronized game saves.

For established mechanics and module boundaries, see [WAVE4_ARCHITECTURE.md](WAVE4_ARCHITECTURE.md). The [README](../README.md), current source catalogs, and this release record describe Wave 5; earlier release documents remain historical.
