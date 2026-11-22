# Wave 3 — Agents and commitments

Wave 3 extends the existing company simulation with bounded support jobs, retrieval-backed business service, reserved private deployments, and customer-hosted model licenses. The content/build version is `0.4.0`; the snapshot schema is `4`. The opening lab, first sale, training and research pipelines, public rivals, and physical infrastructure remain part of the same weekly simulation.

## Design boundary

The player runs a fictional AI company. All calls, tools, invoices, refunds, GPU quantities, business customers, and agent actions are game records. The implementation does not call a live language model, contact a customer, purchase compute, or connect a payment provider. Its purpose is to make the resource and behavior tradeoffs inspectable.

The new systems follow four rules:

1. Model claims, independent checks, human decisions, and completed side effects are separate durable facts.
2. Admitted work captures its model and relevant configuration. Later product or model changes do not rewrite an already accepted obligation.
3. Staff, serving work, connected memory, delivery effort, and finance use the existing company resource and ledger systems.
4. A board or market represents finite authored demand. Repeatedly pressing a command does not create a new customer, unlimited fees, or duplicate side effects.

## Research opens applications

| Method | Application in Wave 3 | Continuing cost |
| --- | --- | --- |
| R6 — Retrieval | Deploy Business Documents and install an index over prepared, eligible evidence | Index installation, data upkeep, extra query work |
| R9 — Defined workflows | Run support jobs within a fixed permitted workflow | Model calls, connected memory, tool work, bounded budgets |
| R10 — Outcome verification | Check task outcomes independently before outcome billing | Separate verification work and review where required |
| R11 — Bounded agents | Select actions autonomously within the admitted allowlist and limits | The same calls, checks, budgets, and approval boundaries |
| R12 — Enterprise operations | Accept private-hosted contracts or supported customer-hosted licenses | Delivery, reserved service capacity or commercial support, service credits |

Research completion makes a method available on its normal availability boundary. It does not create a deployed product, installed index, successful job, or paid contract. Earlier evaluation, data, model-family, checkpoint, calibration, and preference-tuning rules are described in the historical Wave 2 architecture document.

## Support jobs and bounded agents

The support board supplies three authored order types in four-week intakes. Each company can accept each type once per intake; cancellation does not reopen or reroll the same cases. Each accepted job records the selected evaluated model, operating mode, tool permissions, step limit, retry limit, and work budget. The player can inspect the admitted configuration throughout the job's lifetime.

Draft mode prepares work for review. Approval mode keeps designated side effects behind a human decision. Bounded autonomy chooses among permitted actions within the configured limits. An agent's confidence or completion claim never broadens its permissions. Out-of-scope actions remain blocked, and an approval must correspond to the specific proposed action.

Actual model calls, retries, verification checks, and physical work are metered. A job can stall on serving allocation, connected memory, a missing permission, review, or exhausted budget. These states are visible rather than silently completing work. Saved model behavior influences the task. Basic and independent proposal checks can miss a confident error; the later customer-outcome audit observes the actual applied result. The higher outcome fee requires independent verification as well as an accepted result. A basic approved workflow can earn only its explicit draft fee.

Receipts identify what happened and prevent duplicate effects on repeated commands or after save/load. Outcome receipts, direct costs, and company ledger entries remain distinguishable. A completed answer can be wrong; a proposal that passes a check can still await authorization; an authorization does not itself count as an executed side effect. Before applying an action, the job must have enough remaining work and steps for both the action and its audit. Cancellation is unavailable after the side effect, so an applied action cannot evade the audit and any resulting service penalty.

## Retrieval and business service

Business Documents uses the existing product deployment, serving, market, billing, and pause rules. R6 enables this product for the player. Its customers are organizations in the finite business market, separate from consumers and developer accounts.

An index is an installed product asset tied to a selected prepared packet with eligible hosted-use rights. Installation consumes ML staff effort. The index records the selected evidence; later training or data preparation does not silently replace that evidence. Running retrieval incurs data upkeep and query work, and its document-task benefit depends on an operating index. It does not add free capability to saved model weights.

Private-hosted business contracts capture a model and eligible evidence for a customer deployment. Delivery includes deployment and index preparation. Accepted service obligations reserve a weekly workload, compute headroom, and connected memory; they compete with consumer, API, agent, research, and development plans. Reservations affect admission and scheduling priority. The player can still reduce serving allocation, park GPUs, or cut data/support upkeep; doing so can breach the signed commitment and trigger credits or termination. Delivery status, term, renewal choice, fulfilled work, and service credits remain visible. A delayed or underserved obligation does not bill as perfect service.

Customer-hosted licenses distribute a model only when its captured rights allow weight distribution. Delivery takes ML effort and continuing support takes commercial staff. The buyer supplies runtime GPUs, so the license does not consume the player's inference allocation. The player's delivery and support obligations still have real costs, finite terms, and credits when support falls short. A model's hosted-use permission alone does not authorize weight distribution.

The business contract board uses the same finite organization population as generic Business Documents. Contract commitments cannot manufacture an additional copy of an already occupied organization.

## Module and interface ownership

| Area | Responsibility |
| --- | --- |
| `contracts/wave3-agents.ts`, `content/wave3-agents.ts`, `modules/agents.ts` | Agent commands, authored jobs, execution state, checks, approvals, receipts, and player views |
| `contracts/wave3-commerce.ts`, `content/wave3-commerce.ts`, `modules/business.ts` | Retrieval records, business opportunities, contract obligations, delivery, support, and player views; integrated through the existing products module as the single writer of its slice |
| Existing compute/workforce modules | Shared grants and actual resource limits |
| Existing products and markets modules | Generic product service and finite customer accounting |
| Existing company ledger | Receipts, expenses, and cash conservation |
| `ui/agent-panels.tsx`, `ui/business-panels.tsx` | Read-only views, local form drafts, and typed queued commands |
| Snapshot validation and migrations | Durable state, ownership, references, bounded values, and historical compatibility |

React does not implement a second admission or billing model. Action controls use the engine's `previewCommand` result for costs and blockers, then queue typed commands. View helpers supply product, business, and agent records for the player. Rival panels continue to display public company activity; private rival jobs, invoices, and balances are not included in the new player panels.

## Paperclips-style interface

The page retains three sparse desktop columns, native inputs, ordinary buttons, thin rules, short tables, and native details sections. It collapses to one column on narrow screens. Support agents appear with the company's market activity. Business commitments appear beside the existing consumer/API products and infrastructure. These later panels unfold after the first sale, when the loaded run already owns the relevant work, or when the player has completed their opening research: R9 for agents, R6 or R12 for business. This permits an agent-first or business-first research route without adding sections to the untouched opening lab.

Locked methods name the research that opens them. Active work, blockers, and pending approvals stay visible; detailed configuration, meters, terms, and receipt history live in expandable sections. Every approval control names the job and proposed action. Forms keep their draft values across weekly ticks, while a replacement run remounts the panels. Queued controls are grouped by their target so an action for one job or contract does not disable unrelated work.

The UI distinguishes requested/effective work from physical GPU work; claims from verified outcomes; an approval from a side effect; gross fees from credits; and company-hosted inference from buyer-provided compute. Custom chip design and later product branches remain planned.

## Save compatibility and exact recovery

The primary key remains `frontier-lab.wave0.snapshot`, and the single-writer lock remains `frontier-lab.wave0.writer`. Schema 4 accepts valid historical schemas 1, 2, and 3 through their migration paths. Checksum verification and historical validation precede migration. Migration does not advance the week or settle queued actions.

Before the first upgraded browser write, the adapter preserves the raw original bytes in the corresponding recovery key:

| Historical schema | Original recovery key |
| --- | --- |
| 1 / Wave 0 | `frontier-lab.wave0.original` |
| 2 / Wave 1 | `frontier-lab.wave1.original` |
| 3 / Wave 2 | `frontier-lab.wave2.original` |

Existing originals are never overwritten. An archive failure prevents the primary write. If the primary write fails after a successful archive, both the old primary and exact original remain exportable. Invalid, empty, or future-version stored input continues to block automatic replacement. Explicit new-lab/import replacement retains the previous raw run as before.

The migration fixture `tests/fixtures/wave2-snapshot.json` was generated by running the archived published engine from commit `613f0e326e3384063868139a56a13cf3cb20e397`, using its own serializer and schema-3 checksum. Its version headers were not rewritten. The Week 11 run includes first-sale history, active R1 research, a purchased GPU rack awaiting Week 17 delivery, two queued player commands, and intact rival/RNG state. `wave2-expected.json` contains the published engine's player state, ledger, resources, and random streams at baseline and after three additional weeks. This provides a historical oracle for checking an idle upgrade independently of the new engine's own output.

## Release limits

Wave 3 does not implement custom chip design, fabricated chip supply chains, a general workflow editor, real browser/tool execution, live enterprise procurement, or a campaign victory route. The support and customer boards are intentionally authored and finite. Later research branches remain visible as planned content. Long-campaign balance is separate from deterministic execution and save compatibility.
