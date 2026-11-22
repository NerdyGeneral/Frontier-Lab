# Wave 1 implementation contract

Scope: the first real customer loop on the existing private Frontier Lab Site. Keep the Paperclips page. Real prepare, hire/assign, adapt, evaluate, deploy, trial, serve, invoice and save. No new packages, real AI API, facilities, rivals, agent jobs or research execution. Root opened the hosted source at 1ec10c0 and owns publication.

## Shared files and API

Frozen records are in `src/contracts/types.ts` and `wave1.ts`. Root owns these, `src/core/*`, `src/content/*`, products/markets modules, schema validation/migration, selectors, package files and integration tests. Proposed changes go to root before implementation. Each agent owns its assigned module/UI files and focused tests only.

Content is schema 2/content 0.2.0/build 0.2.0. `CONTENT.firstSale` contains the new coefficients. Existing `CONTENT.preparation/firstTraining/evaluation/staff/hardware` remain authoritative. Root will initialize all added records and migrate v1 snapshots without resetting cash, week, queues, IDs or random state. Retain the old local key and writer lock. Back up original v1 bytes before the first upgraded save. Never overwrite corrupt/unknown input automatically.

Public core API remains `createInitialState`, `submitCommand`, `advanceWeek`, `previewCommand`, validation/snapshot/math/clock and diagnostics from `src/core/index.ts`. Root adds `getGameView(state,content=CONTENT):GameView` there. `PreviewResult` now supplies upfrontCostCents, weeklyCostDeltaCents, cashAfterCommitmentsCents and current weeklyCostCents. Do not calculate economics in UI.

`DomainModule.quoteCommand(state,command,content)` returns `{upfrontCostCents,weeklyCostDeltaCents,summary}`. Root centrally reserves queued upfront costs and subtracts already accepted same-boundary expense facts before another command may spend. Modules must emit exactly one stable expense fact for each recruiting/dismissal/preparation fee. They never directly debit money outside the company ledger. Cash is not deducted at queue time. Use IDs prefixed with the command ID; root caps new command IDs to 80 characters.

## Commands

Company: rename_company, hire_staff(role), dismiss_staff(staffId), assign_founder(allocations:RoleAllocation), set_staff_allocation(staffId,fte).
Compute: allocate_compute(serving,development,research), set_cloud_capacity(cu).
Lab: prepare_data(packetId), start_training(baseModelId,packetId), evaluate_model(modelId), set_job_paused(jobId,paused).
Products (root): deploy_product(modelId,priceCents,allowance), set_product_terms(productId,priceCents,allowance), set_product_paused(productId,paused).

Every action is queued and revalidated at the next boundary. Rejected commands spend nothing. Project admission can allow a job to wait for staff/allocated compute; explain that bottleneck. Raw data and ineligible model/rights/target IDs remain hard rejection gates. Commands in arrears stay blocked for this wave; inspection, export and reset stay available.

## Workforce and compute owner lane

Create `createCompanyModule(content)` in src/modules/company.ts and `createComputeModule(content)` in src/modules/compute.ts. Own company and compute slices respectively. Export reusable `getWorkforce(state,companyId,week=state.week)` and `getPayrollCents(state,companyId,content)` from company.ts (or workforce.ts reexported there). Workforce result is `{capacity:RoleAllocation,granted:RoleAllocation,ready:number,onboarding:number}`. Root/UI selectors consume these.

Founder assignments are fixed-point role FTE, total <=1, quarter increments; hardware is unavailable. Initial founder: data1, others0. Each employee has assignedFte 0..1 in quarter increments, initially1, always in their hired role. Grant shared role capacity across requests deterministically by priority then request ID. Operational/deployment requests precede optional training. Staff quantities are fixed-point staff-weeks. Preserve role capacity; payroll is paid once independent of assignments. Staff records carry hiredWeek, readyWeek=hiredWeek+2, assignedFte. Hire W1: salary in W1/W2, productive from W3. Recruit=5x weekly salary. Dismiss=2x salary, no current-week salary after boundary dismissal. Five opening roles; hardware stays gated. No senior bonuses in this slice.

Company retains the single deduplicated ledger settlement from Wave0, including exact once-only postings, receipts before expenses, arrears with no negative cash. Execute emits overhead + payroll. Preserve all company fields on updates. `activeStaff` means currently ready employees; onboarding displayed separately. lastStaff records capacity and reserved/granted role time for the week, not fabricated execution.

Compute general-cloud only. Desired cloud capacity is whole CU between0 and128; reject downsizing below current allocation or currently required active resident memory. Cloud MU=2*CU (plus any existing owned memory only if supported; opening owned0). All reserved cloud CU cost $200/week including idle capacity and energy. No variable cloud work fee. Existing equipment deliveries stay inventory-only.

All reserve handlers collect WorkRequests, then company grantResources issues StaffGrants, then compute grantResources issues ResourceGrants; execute reads the complete frame. No module invents work outside its grant. Requests use poolId `general-cloud`, priorities lower-first, and declared memory MU.

Training requests use `supervision:{role:'ml',workPerStaffWeek:4e9}`; compute caps work to granted ML time before recording physical execution. Reserve staff-only preparation/deployment requests with normalizedWorkCUw0; they do not fabricate compute. Evaluation's compute and research meters may progress independently. Serving request uses headroomBps1000: reserve 1.10 times physical work, but lastWork and all operating economics count actual physical work only. Headroom and category allocations are physical ceilings, not a second work multiplier. Workspace placement is all-or-nothing; blocked memory yields zero compute. Product aggregate request includes its one resident model once; lab workspace is separate. Prioritize serving before lab workspace. Save lastGrants reasons, lastReservedMemoryMU, occupiedMemoryMU and lastBottleneck for UI.

## Lab owner lane

Create `createLabModule(content)` in src/modules/lab.ts, owns data+models. Export `finiteOutcome` as useful for focused fixtures; signature can be your choice and documented. Preparation costs $1,000 once and2 data SW; it creates ready data only on completion, retains progress while paused and never consumes the reusable packet. First recipe uses compact/dense Seed0 lineage, prepared starter packet,12 effective development CUw and4MU workspace. Request work up to development allocation/remaining, ML demand=work/4 with fixed-point ceiling. Compute owner already caps for supervision: do not multiply the granted useful work again.

Maintain immutable version IDs. Midpoint/final checkpoints are included; checkpoint progress survives save/reload. Fixed Seed0 anchors and absolute targets come from content. Apply `min(work ratio, relevant-evidence ratio,1)*quality` once for each capability; reliability uses fixed70/90 anchors. Full starter outcome is conversation48, documents30.56, coding20, tools20.8, reliability86. Repeating the same recipe/lineage/evidence cannot compound gains. Reject an identical completed run with no improvement. Pause releases next-week work; resume continues the same run.

Basic evaluation consumes2 development CUw +0.5 research SW; both meters must finish. It produces one held-out20-case report and no trained capability change. Use stable case IDs and saved draws; retain completed evaluation evidence instead of rerolling it free. basicChatEligible checks evaluated model conversation>=45 and reliability>=65. Report capability/reliability are a snapshot of tested model values; case passes are separate observations. A lower checkpoint may be evaluated but still fail product eligibility.

Preparation/candidate/evaluation output may be materialized in resolve: reserve/execute already happened, so its next stage can only run next week. Product readiness is explicitly next-boundary. Lab commit must retain handling for due model_release ScheduledItems, checking ownership and consuming only due items. Products schedule a model release after deployment completes; the model and product become available at the same following boundary.

## Product and market lane (root)

One Basic Chat offer, separate product/deployment/contract/model IDs. Deployment takes1 ML SW and activates next boundary. Price defaults$12/week,100 exchanges, cap overflow. Regular-reference consumers form the first slice; full cohort mix and rivals arrive Wave2. Work is100*0.0002=0.02 CUw/account-week, adjusted for allowance (regular typical100); trial0.005 CUw, expires after2 execution weeks. Trial work and paid work are real shared serving demand. New cohorts use and pay starting the next week. One-time40-person waitlist obeys reach20/week; regular shopping then uses the finite4000 market and3% shopper ceiling. Commercial FTE can add reach when explicitly available. Conversion45% at reference fit/price/trust/service, fractional carry retained; churn1% baseline plus service/error/price penalties. Initial trust50.

Subscription invoice is price*active accounts less explicit proportional service credits. Delays do not erase the whole subscription bill. Failed attempts still consume compute. Keep usage, credits, invoices and ledger receipts separate and consistent. Product pause stops acquisition and service, with full service credits for existing accounts that week. First paid receipt qualifies the milestone. Details show the regular-reference scope and actual workload economics.

## UI and persistence lane

Keep three sparse columns with small controls and disclosures. Left Business/People; center Data/Lab/Models; right Compute/BasicChat. Expose hire plus onboarding, founder role allocation, employee allocation, preparation, adaptation progress/checkpoint/pause, evaluation report, deployment, price/allowance, capacity changes, usage/trials/payers and billed revenue. Get bottlenecks and nextMilestone from root getGameView. No costs/formulas in UI; all actions use previewCommand. Stage actions unfold; advanced unimplemented entries stay visibly planned.

First visit and restore pause, same 1x/2x/5x clock. Preserve single writer behavior. Add tests/wave1-persistence.test.ts if needed for original-save backup and failed-storage guard. Root owns snapshot migration and type validation; adapter may read `migratedFrom` from deserialize result if root supplies it. UI should show migration notice and allow recovery export of untouched invalid/legacy bytes. Disable mutations while reading an import file. No automatic reset when versions change.

## Verification and handoff

Each module owner adds focused tests in its assigned wave1-* file using existing Node+TypeScript runner conventions. Root integrates runner discovery, updates legacy fixtures, and adds a deterministic full first-sale sequence, resource competition, ledger, save/replay and migration cases. Test a realistic no-revenue hire/prep fixture:48k-10*(800+200+300)-1500-1000=$32,500. Do not force revenue off in an otherwise live loop. Root performs full typecheck, official build, managed browser QA, source push and private publication. Stop optional expansion after the Wave1 gate passes.
