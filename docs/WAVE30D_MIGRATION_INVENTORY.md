# Phase 30D migration inventory

This inventory is based on the published 30C source, commit `b69fdea096175d25479f82d076a28b044f2ef6ff`. It records the retained owner and exact operation families that the six-destination cutover must preserve. A listed command is not a claim that every gated state was manually exercised; completed checks and browser limits belong in the current design QA.

## Destination and retained owner map

| Destination | Retained workspaces | Decision task |
| --- | --- | --- |
| Studio | Room, station context menus, first-launch guide, pinned work | Existing shared tasks; no duplicate forms |
| Projects | `data`, `lab-projects`, `models`, `model-corpus-compare`; atomic `planner` | Prepare data, train, evaluate, plan week; comparison remains read-only |
| Research | Tree/list, `research`, `applied-research`, `synthetic-data` | Research method, apply discovery, synthetic-data decision |
| Products | `product`, `developer-api`, `business-commitments`, `agents`, `release-desk`, `market` | Basic Chat launch/management share one product owner; API, business, agents and release each retain their own owner; rivals remain read-only |
| Operations | `people`, `compute`, `infrastructure`, `chips`, `campus` | Staffing, compute, infrastructure, chip/fabrication and Campus decisions |
| Company | `business`, `compute-costs`, `capacity-forecast`, `company-log`, `campaign` | Rename/company commitment, cost-accounting installation, forecast installation; journal and ambitions stay read-only |
| Global utilities | Results, Save/recovery, clock, preferences | Save replacement remains in the controller's existing confirmation flow; preferences remain reversible presentation state |

Narrow navigation has four primary destinations—Studio, Projects, Research and Products—plus a labelled More route for Operations and Company. Results, clock, Save and preferences need named routes without the room scene.

## Exact operation families retained

The following names are command discriminants, not additional simulation APIs. Existing quotes, ownership checks, prerequisites and weekly admission remain authoritative.

| Owner / source | Operations and gated variants |
| --- | --- |
| Research catalog and tree | `start_research`, `set_research_paused`. Preserve node search/filter, list alternative, exact prerequisite routes, recorded completion and availability week. Locked content stays inspectable without becoming eligible. |
| Applied research | `create_model_variant` (compression, compact memory), `install_product_efficiency`, `set_product_efficiency_enabled`, `start_system_rollout`, `configure_research_assistant`, application `set_job_paused`. Includes adapter bank, cost accounting, forecasts and recovery where currently exposed. |
| Synthetic data | `start_synthetic_generation`, `set_synthetic_job_paused`, `start_synthetic_review`; targeted `start_training`, capability/independent `evaluate_model`, and `set_job_paused`. Retain exact teacher, licensed source, accepted packet, audit, curriculum and comparison evidence. |
| Basic Chat and Developer API | `deploy_product`, `set_product_terms`, `set_product_features`, `set_consumer_sessions`, `upgrade_product`, `set_product_paused`; existing efficiency controls. Retain separate deploy and service activation states, prices/allowances, exact serving model and actual usage/billing. |
| Product evidence and guardrails | `install_runtime_guardrail`, `set_runtime_guardrail_enabled`, `start_feedback_study`, `cancel_feedback_study`, `start_feedback_review`, `set_feedback_review_paused`. Preserve paid audit, review work and model/product configuration evidence. |
| Assured API | `sign_assurance_contract`, `requalify_assurance_contract`, `cancel_assurance_contract`. Retain accepted qualification, named obligations and termination terms. |
| Batch API | `install_batch_scheduler`, `accept_batch_job`, `set_batch_job_paused`, `cancel_batch_job`, `set_batch_capacity`, `set_batch_job_placement`. Preserve automatic/selected GPU pools, connected-memory constraints, deadlines, capacity preview and exact compared plan. |
| Business customers | Business-docs `deploy_product`, `set_product_terms`, `set_product_paused`; `install_retrieval`, `sign_business_contract` (private-hosted/customer-hosted), `set_business_renewal`. Preserve renewal terms, paid retrieval work, exact customer/model and existing receipt history. |
| Support and coding agents | `start_agent_job`, `set_agent_job_paused`, `review_agent_job` (approve/reject), `cancel_agent_job`, `recover_agent_job`; recovery `start_system_rollout`. Coding uses the same command family with distinct intake, tool, audit and payment terms. Preserve explicit approval and independent outcome audit. |
| Public release desk | `start_release_rehearsal`, `set_release_rehearsal_paused`, `start_prepared_release`, `set_prepared_release_paused`, `discard_prepared_release`, `promote_prepared_release`, `start_release_rollback`, `start_release_canary`, `stop_release_canary`. Retain exact product, incumbent, candidate, fingerprint validity, paid/spent preparation, metered thresholds and explicit promotion/rollback. |
| Private appliance, inside release desk | `accept_private_appliance_order`. Keep exact evaluated model, validated design, foundry route, frozen package, two-rack fabrication, shipment, delivery work, acceptance receipt and support term. Do not imply acceptance means installed/service-ready. |
| Compute | `allocate_compute`, `set_cloud_capacity`. Retain reservation versus actual weekly work, connected memory and complete continuing rental cost. The existing `apply_studio_plan` remains the combined atomic people/compute route. |
| Racks and infrastructure | `order_rack`, `install_rack`, `set_rack_parked`, `start_rack_relocation`, `set_rack_relocation_paused`; `start_facility`, `fund_facility_stage`, `set_facility_paused`; `start_facility_retrofit`, `set_facility_retrofit_paused`. Keep ordered, inventory, installing, active/parked and commissioned states separate. |
| Campus site profiles | `start_facility_specialization` comes from the selected profile's authoritative payload; `set_facility_specialization_paused`. Preserve site identity, profile tradeoffs, paid replacement, required work and future activation. |
| Chips/fabrication/networking | `start_chip_design`, `start_chip_successor`, `start_chip_prototype`, `set_chip_project_paused`, `order_chip_batch`, `accept_hardware_order`, `install_fast_fabric`, `set_fabric_paused`. Gen 2 is reachable from Campus and Chips; delivery/install remains under the exact rack. Preserve design generation, parent, foundry slots, location and hardware buyer gates. |
| Company / analysis | `rename_company`; cost-accounting and capacity-forecast `start_system_rollout` actions. Full ledger, compute attribution, forecasts, journal and ambitions remain workspaces. |
| Existing opening / staffing | `buy_data`, `prepare_data`, `curate_data`, `deduplicate_data`, `start_training`, `evaluate_model`, `set_job_paused`; `hire_staff`, `dismiss_staff`, `assign_founder`, `set_staff_allocation`. The earlier exact-entity/draft/acknowledgement guarantees still apply. |

Nested product components are part of their retained product/API/business owner. Keeping only the top-level launch/price controls would strand assured service, batch inference, feedback, guardrails, efficiency, rollback and agent workflows.

## Direct links and return-path contracts

Every key in `STUDIO_PANEL_TITLES` has a centralized destination mapping. Existing panel hashes win over screen aliases: `#market` opens Rivals, `#research` opens the catalog, and `#campus` opens the Campus workbench. Choosing the Research destination opens its tree instead. Old screen return targets `release`, `campus`, `market` and `finance` normalize to the appropriate new destination without deleting their panel.

Preserve at least: `#data`, `#lab-projects`, `#models`, `#model-corpus-compare`, `#research`, `#applied-research`, `#synthetic-data`, `#product`, `#developer-api`, `#business-commitments`, `#agents`, `#release-desk`, `#market`, `#people`, `#compute`, `#infrastructure`, `#chips`, `#campus`, `#business`, `#compute-costs`, `#capacity-forecast`, `#company-log`, `#campaign`, `#save` and `#lab`.

Internal section anchors such as `#research-tree-details` must remain native scroll/focus targets rather than being treated as unknown global destinations. Both initial URL hashes and later hash changes need the same mapping; ordinary read-only navigation must not pause or queue work.

## Verification boundaries and concrete risks

- The research tree lives outside the legacy workbench subtree. Its action callback must use the shared review flow while the full map remains an exploration workspace. Exact method intents must not fall back to a default method.
- Release and Campus retain drafts with their own memo boundaries. Explicit reset must include the owner generation; ordinary navigation must preserve candidate, package and profile drafts.
- Basic Chat launch and later management intentionally share one retained owner. Switching lifecycle tasks retires old review/receipt identity while preserving that form's generation. The existing first-launch intent must remain exact.
- A single modal host serves setup, review, acknowledgement and Results. Resource/prerequisite helpers keep one bounded parent, and repeated helper visits must not introduce self-return loops.
- A rejected import preserves valid drafts. Accepted import/new lab/recovery invalidates task identities and asynchronous callbacks. Save and controller status must remain visible when no inspector is open.
- Visibility gates should expose existing owned/history records and explain locked operations; a direct link must not show an empty or mismatched destination when a workbench is gated.
- Required practical checks include: opening data→training→evaluation→launch; a middle-game product/compute/business choice; a late release or Campus/chip choice; exact old hashes; narrow More/utility routes; one modal and retained drafts; explicit acknowledgement and duplicate prevention; deterministic state/save parity.

`tests/wave30d-navigation.test.ts` covers centralized routing, legacy distinction, exact research intent purity, bounded prerequisite return, and product lifecycle task identity. Rendered review checks, mounted browser coverage and deterministic continuation evidence are recorded separately by the release workflow.
