# Wave 15 — Replay curricula

## Player-facing change

Wave 15 adds a paid way to retain one evaluated skill while adapting a different domain. The player chooses a separate prepared replay corpus and a 25% or 50% replay budget. Relevant data, quality, and paid update progress determine how much of the incoming skill survives. The Lab shows the extra work, expected capability range, retained-skill floor, and licensing consequences before admission.

The interface keeps the existing plain-text, three-column layout and native controls. Replay controls appear inside **Lab → Model design and training method** after the research is available. Saved work and selected models expose the frozen replay receipt in a collapsible detail. New companies keep the established opening.

Content and build version are **0.16.0**. Save schema remains **5**. Optional replay fields are created only by explicit training choices; discovering the method does not alter any existing model.

## Research and admission

**R4C — Replay curricula** requires **Efficient adaptation (R4)**. Discovery costs **$3,000**, **6 research CUw**, and **3 research staff-weeks**. Both research meters must finish, and the method becomes available at the normal following weekly boundary. Payroll and GPU charges remain separate from the entry fee.

Replay supports the three ordinary adaptation recipes:

| Recipe | New focus | Permitted preserved skills |
|---|---|---|
| Conversation adaptation | Conversation | Documents, coding, or tools |
| Document adaptation | Documents | Conversation, coding, or tools |
| Coding and tools adaptation | Coding and tools | Conversation or documents |

The base must be owned and have its own completed, paid **Expanded capabilities** report. Runtime variants and adapters cannot be replay bases, and a replay run cannot also create an adapter. A sparse base retains the ordinary compatible-memory and fast-fabric requirements. Replay is not a foundation, distillation, policy, calibration, or reliability recipe.

The selected replay packets must be owned, prepared, and licensed for hosted model use. Their underlying source IDs must be separate from the primary corpus. A curated or renamed revision of a primary source cannot become a second replay source. Multiple revisions of a replay source contribute evidence only once under the existing corpus rules.

Held-out evaluation cases establish the incoming baseline; they are not training data. Ordinary policy labels contain no replay domain evidence. A feedback packet can supply relevant replay evidence only after its existing paid review and availability requirements are satisfied.

An older prepared packet without retained preparation or review proof remains available to ordinary training. Replay requires that provenance before admission; paying for a curated revision supplies a new valid preparation receipt. The authored Seed 0 is an eligible base after its own paid Expanded capabilities evaluation, with its origin correctly treated as Week 0.

## Work and retention rules

Let `r` be the selected nominal replay share, either 0.25 or 0.50. Let `W0` be the ordinary update work after the selected profile, Efficient adaptation, and architecture multipliers, before data cleanup. Let `Wfocus` be that primary work after its own cleanup saving.

```text
nominal replay work = ceil(W0 × r / (1 − r))
paid replay work = nominal replay work − replay corpus cleanup saving
total update work = Wfocus + paid replay work
```

The primary and replay cleanup receipts stay separate. Cleaning the primary corpus does not discount replay processing. Cleaning replay does not add evidence, raise quality, change outcomes, or remove data rights. The replay share is nominal before these independent cleanup adjustments.

The added work goes through the existing development allocation, ML supervision, actual hardware conversion, and connected memory checks. It consumes recorded physical GPU work and the existing owned-variable-cost ledger. There is no second synthetic charge for the same GPU execution. Rented reservations and staff wages continue according to the existing rules. Automated checkpoint overhead remains additional metered work.

For the selected preserved domain:

```text
coverage = min(1, relevant replay units / 100)
retention strength = 2 × r × coverage × weighted replay quality
full-work floor = floor(incoming capability × retention strength)
earned floor = floor(full-work floor × completed updates / total updates)
candidate capability = max(ordinary adaptation result, earned floor)
```

All values use the game's fixed-point rounding. A partial checkpoint must earn its preservation through paid progress. Replay cannot improve the preserved domain above the incoming base unless the ordinary adaptation already produces a higher score. Other domain targets and profile draws, behavior, policy inheritance, reliability, resident weights, and architecture retain their ordinary rules.

These are authored game parameters, not estimates of real model-training performance.

## Example decision

The earned company's public model has coding **53.57**, documents **31.38**, and reliability **89.00**. Its existing document specialist has documents **55.66** but coding **20.36**. Separately prepared, curated document and coding packs each contain 120 units at 95% quality.

For a stable, dense document adaptation with Efficient adaptation and no cleanup saving:

| Choice | Primary updates | Extra replay updates | Total updates | Coding at completion | Documents at completion |
|---|---:|---:|---:|---:|---:|
| Ordinary adaptation | 19.8 CUw | 0 CUw | 19.8 CUw | 20.36 | 55.66 |
| 25% coding replay | 19.8 CUw | 6.6 CUw | 26.4 CUw | 25.44 | 55.66 |
| 50% coding replay | 19.8 CUw | 19.8 CUw | 39.6 CUw | 50.89 | 55.66 |

The lighter option improves retention but does not reach the coding-50 customer gate. The stronger option retains coding eligibility while developing document specialization. At 90% replay quality, the same stronger budget preserves only 48.21 coding. Curation therefore changes a commercial outcome, not just a descriptive data score.

Reliability remains a separate choice. This document adaptation still has reliability 89.00; the long-form digest order requires at least 90.00. The natural campaign pays for ordinary reliability training after replay, using a genuinely distinct combined document-and-coding corpus. It does not weaken the existing duplicate-run rule to repeat an already-used reliability curriculum.

## Evaluation, rights, and product use

The replay receipt captures the exact incoming model, its fingerprint, paid capability report, baseline score, ordinary profile identity, separate corpus, work budget, and finite floor. The output needs fresh capability evidence and, when applicable, its own paid policy holdout. The incoming report does not certify the output.

Model rights intersect the base lineage, primary corpus, and replay corpus. A hosted-only replay source restricts the new model, later reliability-trained descendants, and compressed deployment variants. More permissive later data cannot restore missing distribution rights. The natural campaign's original public lineage was already hosted-only and stays that way through replay.

Training and evaluation do not replace a live product. The player still chooses a deployment or separately accepted batch order. Public billing carry, runtime-guardrail bindings, existing terminal batch receipts, and feedback studies retain their own records. A model with the required actual scores and fresh reports can serve more than one eligible order type; physical capacity and commercial handling still determine delivery.

## Identity and save invariants

Ordinary profile draws use exactly the pre-existing recipe/corpus/target-tier identity. Selecting replay, changing its budget, or supplying a different replay corpus cannot reroll the new skill.

The distinct replay admission identity binds the ordinary identity, preserved domain, nominal budget, and replay corpus fingerprint. Command IDs, renamed reports, and another descendant do not create another attempt at the same curriculum. The two budget choices are separately paid options. The exact base and report remain frozen in the receipt even though their names cannot generate a fresh identity.

The replay training-evidence fingerprint binds the primary and replay fingerprints plus the preserved baseline and choice. Ordinary runs retain their original evidence IDs. Pause and reload preserve update work, physical work, checkpoint versions, profile adjustments, and the frozen receipt.

All prior save generations remain supported. Wave 14 imports change only content/build headers from **0.15.0 to 0.16.0**, without advancing time or adding replay state. Browser upgrade first preserves the exact original bytes under **`frontier-lab.wave14.original`**. Existing originals remain intact, and failed archive or primary writes retain the earlier usable save.

The **2,000,000-byte UTF-8 limit** remains unchanged. Existing conditional whitespace compaction preserves all evidence. Older headers reject replay fields and R4C knowledge, projects, frozen methods, and commands rather than accepting future mechanics under an earlier version.

## Verification and continuation

The [earned campaign](evidence/wave15-progression.json) continues the published Week 500 company to **Week 535 with 18 ordinary commands**, without resource grants. The 25% and 50% replay runs consume **14.666666669** and **22.000000003 physical CUw** on the actual owned training GPUs. Their attributed variable costs are **$1,099.99** and **$1,649.98**. Those figures exclude payroll, reserved cloud rent, shared infrastructure, the research fee, and later evaluation. A further **16 normalized CUw** reliability tune preserves both capability scores and reaches reliability **92.80**.

The same final candidate earns **$15,000** from a completed code order. The simultaneous digest exposes a connected-pool bottleneck: it completes **38,808 of 60,000 requests**, earns **$14,553**, and records **$7,947** of unfinished-work credits. Each batch must use one connected pool; nominal spare capacity across sites cannot simply be added into one grant.

Increasing cloud capacity from **80 to 96 CU**, then allocating the resulting **160 nominal CU** to serving, lets the remaining digest complete all 60,000 requests for **$22,500**. The added reservation runs for seven weeks in this campaign, costing **$22,400**. This is an expensive delivery repair with only $100 left from that invoice before other costs; it is not presented as an optimal strategy. The installed owned pools remain active. The final company has **$5,836,671.75**, with no arrears. Its **1,451,812-byte** save, checksum **`9a5b6de8`**, reloads byte-for-byte.

The independent compatibility oracle was generated only with the archived published Wave 14 source at commit **`bfef7d414b23b271b37f5a136b8cc0a376647b1f`**, tree **`3933071a1a4bd77bf0d4ae05fec883149dac8288`**. Its authentic Week 477 checkpoint has checksum **`101cc8f9`**. All **23 future full-state hashes**, through Week 500 checksum **`38350449`**, match after normalizing only version headers. This includes ordinary training, public token carry, physical batch costs, fixed invoices, expiring short history, and retained source proofs. Reloading before each step produces the same outcomes.

The release's earned progression, full acceptance gate, visible browser checks, and exact final receipts are recorded in the companion evidence files. The replay tests exercise actual paid research and GPU work, ML and compute starvation, checkpoints, source overlap, rights, fresh evaluation gates, and later commercial use.

The [final acceptance gate](evidence/wave15-validation.json) passed **564 tests**, with zero failures or skips, in **171.97 seconds**. Nonincremental TypeScript, the official production build, and whitespace checks passed. The [browser play test](evidence/wave15-browser.json) ran an actual replay from Week 504 to 512, verified both budget forecasts and the effect of data quality, paused and reloaded identical bytes, completed training and both paid reports, and restored the original preview lab exactly. There were no application-origin console errors. Two independent audit findings—undocumented legacy preparation and the authored seed's absent timestamp—were fixed and covered by ordinary admission/recovery regressions before this final gate.

The principal new files are `src/contracts/wave15-replay.ts`, `src/content/wave15-replay.ts`, `src/modules/replay-curriculum.ts`, `src/core/wave15-replay-validation.ts`, and `src/ui/replay-training-controls.tsx`. Integration stays within the existing training planner, validator, runtime rights, Lab panels, research catalog, and snapshot migration; it adds no independent training or billing engine.

The next useful hardware follow-up is a clearer preview of connected-pool batch capacity and operating costs. Current dispatch chooses the largest effective grant and then considers physical efficiency; displayed total spare capacity can still overstate what one batch can use in one pool. Explicit placement and reservation-cost choices deserve a separate module. Replay remains limited to one preserved domain and the two authored budgets, leaving multi-domain curricula, new synthetic-data shortages, and persistent consumer sessions for separately designed modules.
