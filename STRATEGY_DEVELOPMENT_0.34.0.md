# Frontier Lab 0.34.0 — delegated development and campaign strategy

Build and content version: **0.34.0**. Save schema: **5**.

## Delegated model development

Open **Projects → Development plans**. Choose a starting model, owned datasets, a training method or custom design, a final evaluation, project-fee budget, cash reserve, and deadline. One active plan connects preparation, training, and evaluation through ordinary paid commands. It reuses prepared sources, waits for actual completed outputs, and tests the exact model it trained.

The project-fee limit covers data-preparation and training-setup fees. Payroll, rent, and metered compute remain normal company expenses. Reserve checks include known weekly base bills and already committed spending; variable costs and future revenue remain uncertain. The UI explains these boundaries before admission and beside active work.

**Run until a decision** advances the normal game clock and pauses when the plan becomes blocked or its report is ready. The result appears first, with direct actions to inspect the exact report, choose a release, or continue developing that model. The plan does not automatically release a model. Players can pause, resume, revise limits, or stop future work while retaining completed outputs. A same-week pause or cancellation takes precedence over an unstarted paid stage. Budget retries preserve paid work and do not charge twice.

Custom designs include size, sparsity, data mix, and actual compute work. Ordinary foundation/adaptation methods expose Stable, Balanced, and Ambitious approaches; distillation exposes its teacher and target skill. Audited synthetic curricula use their ordinary provenance rules. Internal custom recipe identifiers are represented by the custom-design editor rather than duplicate unusable choices.

One unfinished delegated plan is allowed at a time. A campaign retains up to 100 plans; manual development remains available. Recent history is shown immediately and the complete retained plan history is reachable with **Show all saved plans**.

## Strategic variety

Live Chat, API, and Business Documents products expose strategy near their primary controls:

| Choice | Actual simulation effect |
| --- | --- |
| Economy routing | Sends 80% of work to the installed secondary model. |
| Balanced routing | Sends 60% to the secondary model. |
| Quality routing | Sends 20% to the secondary model. |
| Broad audience | Retains neutral market positioning. |
| Value audience | Rewards an affordable, suitable offer and penalizes a mismatched price promise. |
| Professional audience | Depends on demanding task quality, reliability, and delivered service. |

Routing requires an installed two-model route. Its share affects real serving work, skill outcomes, reliability, and advanced capabilities. Historical routes retain their old behavior until the player explicitly adopts a strategy. Existing signed prices remain intact. Frozen release and runtime-audit configurations keep their captured policy; an incompatible strategy change makes old evidence stale. Strategy changes and prepared releases cannot race each other.

Open **Company → Chapters & ambitions** to select one persistent goal:

1. Your first paying product: paid player training, evaluation, and reliable service.
2. Make two models earn their keep: an efficient operating portfolio with sustained surplus.
3. Build an advanced specialist: a model with earned advanced capability and qualifying service.
4. A frontier model in the real world: an earned custom frontier model with broad capabilities and sustained surplus.

Qualifying weeks and their evidence are recorded automatically. Changing focus or later losing a condition does not erase an earned chapter. The original three company endings remain available below these shorter goals.

## Longer campaigns and replayability

### Research focus

Each paid Architecture research iteration offers Balanced engineering, Capability depth, Compute efficiency, or Reliable execution. These choices distribute diminishing gains differently across future design potential, training/serving efficiency, and reliability targets. Existing models keep their trained outcomes. New custom designs capture the research knowledge available when the plan is admitted.

### Harder challenges

Open **Research → Challenges** for Applied, Frontier, and Horizon tiers. Each contains 21 authored combined-skill tasks across all seven domains. A title requires at least 17 total passes and at least two of the three cases in every skill. Each higher tier requires the previous achievement and raises skill and reliability requirements.

The tests consume ordinary development compute and Research points, require a paid capability baseline, and retain the model's existing release evidence. Outcomes are fixed for the tested abilities; changing a name or test identifier cannot reroll a result. Titles persist through saving, exporting, and reopening the campaign.

Reachability was checked with a funded continuation of the authentic published Wave 26 company from Week 556 to Week 638. The continuation bought, prepared, and curated data; paid for five Reliability-focused Architecture levels; completed a 32B custom foundation's 1,600 CUw; and ran a baseline followed by all three challenges. Each tier passed 21/21. This verifies a legal late-game path, not a fresh-company speedrun. Compact evidence is retained under `docs/evidence/strategy-034-challenge-progression.json`.

### Rival plans and market opportunities

**Products → Market & rivals** shows rival intentions and review dates. Swift pursues affordable API expansion, Atlas pursues a dependable model release, and Harbor pursues enterprise relationships. Rivals pay normal costs, perform normal research/training/evaluation, and adapt to cash pressure. Announced intentions are not guarantees of completion.

Rotating buying windows are announced six weeks ahead and remain open for four weeks. They increase shopping among the existing finite pool of available customers. Offers still need to qualify and compete, with adequate reach, compute, memory, and service. Players can prepare for a window, choose a different audience, or keep their current profitable niche. No extra weekly confirmation is required.

## Discoverability and workflow

- Development plans and Challenges have direct workspace tabs and searchable All menus entries.
- Chapters and market forecasts are inspectable before the first sale.
- Locked choices show their prerequisites rather than disappearing.
- Routine plan and chapter actions schedule directly and show an inline acknowledgement.
- The main navigation, clock, Results, and Save remain usable around task pages, including at phone widths.
- Opening a workspace section on a phone brings its content into view below the header.
- Switching workspaces retains the task draft. Completed plans show their results above the next-plan editor.

## Save compatibility

Published 0.33 saves retain cash, elapsed week, identifiers, random streams, staff, contracts, trained models, frozen plans, active research, paid work, and queued commands. Migration updates version metadata and anchors the new market calendar at the saved week. It does not award research, rewrite old models, or advance time. Existing older migrations remain supported.

The first upgraded browser write archives the exact original 0.33 save before replacing it. Tests cover whitespace preservation, compressed fallback, archive failure, primary-write failure, retry, and revalidation if another source changes the primary save. New strategies and evidence cannot be smuggled through an older content header. New custom-training admissions also respect the audited synthetic-data boundary; historical paid design receipts are preserved.

## Verification

- Real desktop browser journey: scheduled a delegated document adaptation, automatically trained and evaluated it, paused at Week 13, and opened the exact output report.
- Phone-sized browser journey: inspected the plan and custom-design forecast, retained the draft while changing workspace, scheduled a chapter with one action, and inspected opportunities/rival plans. Navigation stayed accessible and the observed layout had no horizontal overflow.
- Full rendered UI suite: **178/178 passed**.
- Focused development-plan, research/challenge, strategic-policy, market-dynamics, and migration tests cover ordinary paid actions, replay, budgets, deadlines, cancellation races, frozen evidence, finite demand, and historical backups.
- The untouched published baseline ran **887 tests: 834 passed, 53 failed**. The new full run plus focused reruns of changed expectations and the later paid-progression tests verifies **875 passing tests out of 928**, with the **same 53 pre-existing failing test names and no new regression failures**. This is a combined verification rollup, not a second complete run. Updated expectations cover explicit version/calendar metadata, navigation additions, stronger rejection precedence, and player-owned service invariants while rivals legitimately progress. No failing legacy assertion is reported as passing.
- TypeScript, production build, and clean source packaging are release gates.

No new package dependencies were added.
