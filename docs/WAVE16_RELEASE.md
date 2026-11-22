# Wave 16 — Compute planning and profitability

Content/build version: **0.17.0**. Save schema: **5**.

## Delivered decisions

Wave 16 makes the existing connected-pool constraint visible before a batch order is accepted. In **Developer API → Batch inference**, compare automatic dispatch with individual cloud or owned pools, inspect conditional delivery and costs, and choose a placement. An accepted live order can change its selected pool at the next boundary or return to automatic dispatch.

The model, separate workspace, token prices, original deadline, admitted work limit, paid progress, and invoice rules stay with the order. Explicit placement does not reserve a pool exclusively or increase its priority. A selected pool that is busy, parked, incompatible, or gone supplies no work; the batch waits until its resources or placement change. The original deadline continues.

The optional placement history records each applied choice and its command/week. Historical cost and work receipts use the placement that was in force in their own week, including after the player changes it. Ordinary acceptance with no explicit pool retains the earlier save shape and automatic allocation behavior.

## Capacity plans

The forecast accepts a proposed **total cloud reservation** and **total serving allocation**. Comparing spends nothing. **Apply compared capacity** queues one atomic change, retaining development and research allocations and using the existing live-product memory, nominal capacity, rental-limit, arrears, and command admission checks. Conflicting queued allocation or rental changes are rejected.

The quote shows total weekly cloud rent and its change from the current reservation. Rent continues after an order finishes until the player changes the reservation again. The plan neither accepts a new order nor resumes a paused one. It requires the existing paid batch scheduler; this wave adds no separate research fee or hidden equipment grant.

## Conditional deadline forecast

The planner is bounded to the remaining delivery window, at most six weeks. It captures actual next-week reserve requests from the existing domain modules, then calls the same staff and compute allocation owners as live execution. Ordinary demand includes public products, commercial commitments, agent work, training, evaluations, research, infrastructure work, and research assistance.

Each comparison advances only finite batch work, request carry, completion, and expiry. Earlier batches compete at their normal priority and stop requesting resources when finished. Paused jobs remain paused. The displayed rows show useful model work, physical GPU work, actual selected pool, handling staff, whole completed requests, and bottlenecks. Token prices produce the projected once-only invoice and unfinished-work credit.

The forecast explicitly holds ordinary workload requests, current hardware readiness, assigned staff readiness, and customer load fixed. It does not finish other projects, commission future equipment, onboard future employees, change model configurations, process queued changes, simulate market acquisition/churn, or predict future contract renewal decisions. It assumes weekly bills remain funded and does not project cash depletion or new arrears. Players should check company runway separately, particularly because batch payment arrives at the terminal event.

These are conditional planning results. They do not reserve resources, draw randomness, modify the input state, or promise delivery under later player decisions or market changes.

## Costs without double counting

The UI keeps three quantities distinct:

| Quantity | Meaning |
| --- | --- |
| Future owned-GPU usage | Projected physical GPU work times its owned usage tariff. Shared weekly cent rounding remains an estimate. |
| Cloud-work attribution | The portion of already-reserved cloud rent associated with this job's projected physical work. It is included within rent, not an additional usage bill. |
| Extra cloud reservation | The full positive increase in company cloud rent over the common comparison window, even if a job finishes earlier or uses owned equipment. Count it once across jobs sharing the reservation. |

The displayed amount after extra rent and owned usage subtracts only those future costs from the remaining unearned invoice. It excludes existing cloud rent, payroll, fixed facility costs, construction, and previously paid work. A reduction in reserved capacity appears as a lower weekly company bill; rental savings do not become job revenue.

## Save compatibility and recovery

Wave 15 imports change only content/build headers from **0.16.0 to 0.17.0**, retain schema 5, and do not advance time. Browser upgrade preserves the exact source bytes under **`frontier-lab.wave15.original`** before writing the new primary save. Existing original archives remain intact. Archive failures or primary write failures preserve a usable prior save. The existing two-megabyte UTF-8 snapshot limit and lossless compact export remain in force.

The independent oracle was produced from the published Wave 15 commit **`3132248a7e1142a1783d9d352a9bdc889a16c92f`**, tree **`701d3995ab33b619811c4cb76d6ae1f3e5e1575c`**. All eight original campaign checkpoints matched byte-for-byte. Its Week 511 snapshot has checksum **`4138abaa`** and contains the paused paid 50% replay run. All **24 future full-state hashes**, through Week 535 checksum **`9a5b6de8`**, match after normalizing only version headers, including repeated reloads, training, evaluations, original automatic batch grants, credits, and cloud expansion.

New placement evidence and commands are rejected under older content headers. A pool that disappears after a paid rack relocation can produce only an authenticated zero-work, zero-memory batch grant in cost history; it cannot invent equipment or use a different pool silently.

## Implementation boundaries

- `src/contracts/wave16-planning.ts` defines the read-only comparison contract.
- `src/modules/batch-planning.ts` owns bounded forecasts and uses the existing reserve and allocation APIs.
- Batch placement extends the existing batch command and receipt owner; the compute owner applies atomic rental/allocation changes.
- `src/ui/batch-planning-panel.tsx` adds expandable controls and compact tables. Closed sections do not run forecasts; typing a hypothetical capacity waits for the explicit comparison action.
- The research catalog remains at 29 authored programs. No unrelated progression or product rules change.

## Release evidence

### Earned capacity and placement comparison

The [earned Wave 16 continuation](evidence/wave16-progression.json) starts from the exact published **Week 535** company, checksum **`9a5b6de8`**, and reaches **Week 540**. The selected branch uses **two ordinary commands**: reduce cloud reservation from **96 to 80 CU** and serving allocation from **160 to 144 CU** at Week 536, then accept the remaining archive-tagging order into the existing **8-CU colocation training pool** at Week 537. Both commands preserve the existing model, workloads, paid hardware, and earlier terminal orders.

An alternative branch begins from the same earned company, retains 96 cloud CU and 160 serving CU, and accepts the same order into general cloud at Week 537. It reaches the same comparison boundary without combining either branch's revenue or supplying extra assets. Both orders have a **16-CUw weekly limit**, **40,000 requests**, and the original **Week 540 deadline**.

| Measured result | Selected owned placement | Cloud comparison |
| --- | ---: | ---: |
| Completion week | 539 | 538 |
| Completed requests | 40,000 | 40,000 |
| Once-only batch invoice | $6,500.00 | $6,500.00 |
| Useful model work | 26 CUw | 26 CUw |
| Physical GPU work | 23.636363637 CUw | 26 CUw |
| Batch owned-variable usage | $1,772.72 | $0.00 |
| Batch cloud-work attribution, already within rent | $0.00 | $5,200.00 |
| Full company cloud reservation, Weeks 536–540 | $80,000.00 | $96,000.00 |
| Company operating expenses, Weeks 536–540 | $119,123.97 | $133,351.25 |
| Company revenue, Weeks 536–540 | $231,290.21 | $231,290.21 |

The selected plan reduces measured company operating expenses by **$14,227.28** over the common five-week window. That window includes the capacity-change week before batch acceptance. The owned plan finishes one week later while meeting the original deadline. Both branches inherit the same already-purchased hardware, keep all three public products fully served, retain exact public billing carry, and incur no arrears. Cloud-work attribution is included within reservation rent throughout this comparison.

The refreshed forecasts match actual GPU work, connected memory, commercial handling, and completion in this earned scenario. The selected branch ends with **$5,948,837.99** in cash, checksum **`6e77d37e`**, and a **1,456,012-byte** save that reloads byte-for-byte. The alternative ends at checksum **`0b1ae2ab`**. These results establish a concrete operating choice for the existing fleet; payroll, facility upkeep, and ordinary public usage are included in the reported company totals.

### Paid relocation and recovery from a missing pool

The [separate relocation continuation](evidence/wave16-relocation.json) starts from the earned **Week 522** company, checksum **`3c90ef74`**. Four ordinary commands hire an infrastructure employee, allocate serving capacity, accept a digest into the existing colocation pool, and start moving its rack to Site 1. The employee is hired at Week 523 and finishes onboarding at Week 525. The relocation pays its once-only **$1,500** fee and consumes **one infrastructure staff-week** across four elapsed move weeks, then commissions at Week 528. Normal salary, source upkeep, and operating coverage continue.

The batch completes **5,866 requests** in its initial Week 523 service. It receives no GPU work while the rack is parked during Weeks 524–527. Commissioning removes the original colocation pool before the final Week 528 allocation. Keeping that explicit placement produces an authenticated **zero-work, zero-memory grant**, retains the unavailable pool identity in cost evidence, and expires at the original deadline.

An alternative continuation applies one explicit return to automatic placement at Week 528. It uses **16 physical CUw** of available general cloud in that final week and completes **10,667 additional requests**. Both branches retain the original model, backlog, weekly limit, deadline, prior paid work, and earlier settled orders.

| Deadline settlement | Keep the unavailable pool | Restore automatic placement |
| --- | ---: | ---: |
| Completed requests | 5,866 / 60,000 | 16,533 / 60,000 |
| Final invoice | $2,199.75 | $6,199.87 |
| Unfinished-work credit | $20,300.25 | $16,300.13 |
| Final checksum | `29a66ba1` | `7107dd1d` |

Both orders expire at **Week 528**, keep public service fully delivered, reconcile real operating costs, and reload exactly. The recovery earns **$4,000.12** more completed-request revenue using the existing reservation. Its **$3,200** cloud-work attribution is already part of the weekly cloud bill.

This scenario also demonstrates the forecast's readiness boundary. The Week 527 automatic comparison predicts **13,537 total requests** with the hardware then available; actual explicit recovery reaches **16,533** after the rack commissions at the next boundary. The forecast excludes that future commissioning by design, and its assumptions make that limit explicit.

### Independent forecast check

The [independent forecast audit](evidence/wave16-forecast-audit.json) compares four pools over six weeks using the genuine **Week 522**, **1,427,198-byte** save. Three calls take **41.16 ms**, **36.56 ms**, and **33.55 ms** in the recorded environment, leaving the serialized source byte-for-byte unchanged. These are observed timings rather than a general performance guarantee.

An ordinary digest acceptance and real subsequent week match the first automatic forecast row exactly: **13.182224 effective CUw**, **11.98384 physical CUw**, **8,788 requests**, **0.25 commercial FTE**, and the Site 1 training pool. The result verifies the shared allocation path without treating later changing market demand or hardware readiness as frozen reality.

### Visible browser workflow

The [browser check](evidence/wave16-browser.json) imports the earned Week 535 company into the managed local preview and performs all actions through the visible controls. It compares 80 cloud CU and 144 serving CU, queues that capacity plan, and accepts the final archive order into the colocation pool at the same boundary. Week 536 executes 8.8 effective CUw with eight physical CUw and 0.25 commercial FTE. An export, paused reload, and second export match byte-for-byte: **1,455,549 bytes**, checksum **`d60e7088`**.

The browser then explicitly returns the active order to automatic placement. The next two receipts use Site 1 and colocation while retaining the original **Week 539** deadline. The order completes in **Week 538**, delivering **40,000 requests**, billing **$6,500**, and crediting **$0**. Its lifetime physical work is **23.636363637 CUw** with **$1,772.72** estimated owned usage. The final export is **1,459,377 bytes**, checksum **`dcf7400d`**. This browser branch queues capacity and acceptance together, so its timing differs from the two-boundary natural comparison above.

The captured application console has no warnings or errors. Browser-extension metadata errors and input protocol timeouts were checked separately against the resulting UI state; no duplicate game commands were issued. The original **41,803-byte Week 0** preview lab was restored exactly after testing. Its SHA-256 remains **`a4ae70db1a0b9fbc71b42fa9431e9cddfa2817bc604d08bcf007f2ef5cd704fc`**.

The compact native controls, expandable forecast, and tables retain the existing Paperclips presentation. Screenshots show the [planning comparison](images/frontier-lab-wave16-planning.png) and [completed order with placement receipts](images/frontier-lab-wave16-completed.png).

### Final release gate

The complete acceptance suite passes **584 tests**, with **zero failures, skips, or cancellations**. Nonincremental TypeScript and `git diff --check` also pass. The publication workflow requires the official production build to succeed before it commits, pushes, and packages this source; the [validation record](evidence/wave16-validation.json) is written only after that successful build. The original private audience is preserved.

The next proposed finishing wave is **Wave 17 — Training experiments and deeper curricula**.
