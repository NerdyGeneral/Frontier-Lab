# Wave 3 release handoff

**Frontier Lab — Agents and commitments**

Content/build version: **0.4.0**. Save schema: **4**. Implementation and verification are complete; this document does not record a deployment.

## Delivered scope

Wave 3 adds bounded support work, document retrieval, private business deployments, and customer-hosted model licenses to the existing training, research, consumer/API, rival, and infrastructure simulation. The new systems use the same deterministic weekly clock, staff and compute grants, and financial ledger.

The Universal Paperclips-style interface remains three sparse columns with ordinary buttons, native form controls, short tables, and expandable details. Current work, blockers, and approvals stay visible. Shared engine previews supply admission checks, costs, resource estimates, and reasons an action is unavailable. Player panels show owned records; rival activity remains public information.

## Progression

| Research | Playable application |
| --- | --- |
| R6 — Retrieval | Deploy Business Documents and install a document index over prepared evidence with hosted-use rights. |
| R9 — Defined workflows | Accept authored support orders with an evaluated model, explicit permissions, and step/retry/work limits. |
| R10 — Outcome verification | Use independent proposal checks and qualify successful audited work for the higher outcome fee. |
| R11 — Bounded agents | Let the model select steps inside its admitted tools and budgets. |
| R12 — Enterprise operations | Sign reserved private deployments or supported customer-hosted weight licenses. |

The new panels appear after the first sale, when the company already owns relevant work, or when its opening research is complete: R9 for agents; R6 or R12 for business. This supports agent-first and business-first routes while keeping an untouched opening lab simple. First-sale messages accept revenue from any implemented customer product.

## Behavioral and economic contracts

- **Agent work:** Three order types recur in four-week intakes. Each can be claimed once per company per intake. The admitted model, permissions, and budgets are frozen. Planning, tools, checks, retries, commercial review, and audits consume actual resources. A model's completion claim alone creates no revenue.
- **Approval and outcomes:** Draft delivery, a human decision, an applied action, and an accepted outcome audit are distinct records. Draft and outcome fees are alternatives. Applied actions have durable receipts; remaining work and steps must cover the action and its audit. An action cannot be cancelled after application to escape the audit or a resulting penalty.
- **Retrieval:** Installation takes two ML staff-weeks. Evidence quality and document coverage determine the potential benefit; data upkeep sustains freshness. Query tokens, lookup work, and index memory consume company resources without changing the saved model's weights.
- **Private hosting:** Delivery takes four ML staff-weeks, including the index. The fixed workload reserves serving headroom and connected memory. Twelve-week terms carry data/support obligations, service credits, renewal conditions, and termination for repeated breaches. Reducing allocation, parking GPUs, or cutting upkeep can breach a signed commitment.
- **Customer-hosted licensing:** The model must retain weight distribution rights throughout its training lineage. Delivery takes two ML staff-weeks and support needs commercial staff. The customer supplies runtime compute, so licensing creates no company inference workload or token bill. Setup remains a company expense; revenue begins only after delivery.

Generic document subscriptions and named contracts share the finite business organization population. Existing consumer and developer markets remain separate.

## Verification completed

| Check | Result |
| --- | --- |
| Full automated suite | **182 tests passed.** |
| TypeScript | **Passed.** |
| ESLint | **Passed.** |
| Browser: approved support workflow | A useful job earned **$350 only after the complete approved and audited workflow**. The completion claim and approval did not create an early fee. |
| Browser: Aster customer-hosted license | The agreement waited for **two ML staff-weeks of delivery**, then earned **$220 per week**. The checked scenario had **zero serving allocation and zero occupied GPU memory**, confirming that the customer supplied inference compute. |

The automated coverage includes deterministic execution, permissions and bounded work, receipts and billing, shared resources, business obligations and credits, finite populations, licensing rights, snapshot migration, and browser recovery. These checks establish the tested behavior; they do not establish long-campaign balance.

Browser scenarios used validated QA fixtures, rather than normal campaign progress. Saved evidence: [approved agent workflow](images/frontier-lab-wave3-agents.png) and [customer-hosted business license](images/frontier-lab-wave3-business.png). The original Week 16 preview run was restored through the normal import flow after verification. The final full lint run passed, and `git diff --check` was clean.

## Save compatibility and recovery

Valid Wave 0, Wave 1, and Wave 2 saves migrate to schema 4 without advancing time. The primary browser key and single-writer lock are unchanged. Before the first upgraded write, exact original bytes are archived separately:

| Original run | Recovery key |
| --- | --- |
| Wave 0 / schema 1 | `frontier-lab.wave0.original` |
| Wave 1 / schema 2 | `frontier-lab.wave1.original` |
| Wave 2 / schema 3 | `frontier-lab.wave2.original` |

Existing originals are preserved. A failed archive prevents primary replacement; a failed primary write leaves the old save and successful archive recoverable. Invalid or future-version input blocks automatic overwrite and remains exportable. Explicit import/new-lab replacement also retains the previous raw run. The Wave 2 migration fixture and three-week oracle were generated with the actual published historical engine, preserving queued actions, research, delivery, rivals, and random streams.

Saves remain browser-local with portable JSON export. One tab owns the clock and writes; hidden pages pause, and there is no offline catch-up or account synchronization.

## Limits and next work

All models, tools, customers, money, and GPU activity are fictional simulation records. There are no live model calls, external agent actions, real purchases, or payment integrations. Workflows and customer boards are authored; a general workflow editor is not included.

The later roadmap retains applied research, compatible custom chips, chip production, and distinct victory routes. Long-campaign balance and complete campaign acceptance remain future work. Publication status is tracked separately from this implementation handoff.

For current mechanics and module boundaries, see [WAVE3_ARCHITECTURE.md](WAVE3_ARCHITECTURE.md). The repository README and authored catalogs describe the current build; Wave 0–2 documents remain historical.
