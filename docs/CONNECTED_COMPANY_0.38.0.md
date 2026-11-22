# Frontier Lab 0.38 — Connected company

This release implements the seven priorities from the gameplay and workflow review. It connects model development, paid customer outcomes, company progress, research, and competition while keeping the existing weekly simulation and save schema 5.

## 1. Reliable workspaces and long campaigns

Desktop workspaces have one scrolling content area. The header, navigation, and clock remain outside it, including when a long custom model form is open. Docked task pages also reserve space for the shared stop reason and decision-clock controls. Routine actions keep their visible quote and submit directly. Retiring an empty offer has one final review because retirement cannot be undone.

Unpaid-bill messages now describe the actual terminal state and direct the player to inspect, export, or start another lab. This release does not introduce loans or an arrears-recovery mechanic.

Delegation no longer stops permanently after 100 plans. Older finished or cancelled plans compact into an archive when the retained detailed history reaches its limit. Their models, paid jobs, reports, command receipts, objectives, and evidence remain available. Archive validation checks the retained records and their bound proof.

## 2. A project keeps its objective

Choose a purpose, systems challenge, or customer brief in **Projects → Develop a model / Development plans**. An authorized project retains that choice. A customer objective pins the actual client, requirements, and acceptance window; later offers do not silently replace it.

A delegated systems project performs ordinary paid preparation and training, a capability evaluation, then the matching paid systems challenge against its exact output model. Results retain both reports. Customer delivery and product release remain explicit player decisions. Coding projects lead to Developer API; analyst and visual projects lead to the business workspace with the intended candidate selected.

Before scheduling, the project shows an estimated duration and operating-cost range, setup fees, staff and memory constraints, deadline concerns, and any customer-window risk. These are planning estimates based on current resources; competing work, future staffing, hardware, and revenue can change the outcome.

Downloaded saves now include the planning workspace: manual and delegated drafts, the selected goal, and named blueprints with their objectives. Imported planning data is validated separately and cannot authorize commands or grant paid work. Ordinary historical save files remain supported.

## 3. Operating designs matter to ordinary customers

New public offers and private commitments can promise a specific workload. Existing offers preserve their prior rules until the player explicitly changes their configuration; existing signed contracts keep their captured terms.

| Customer workload | Operating need | Commercial consequence |
|---|---|---|
| Everyday assistance | Existing skill, price, and service requirements | A broad baseline service |
| Fast interactive work | Response time and expert-routing quality | Useful-answer performance and audience fit |
| Compact private work | Model and session memory within a small footprint | Local and private audience fit |
| Continuing casework | Retained facts with reasonable response time | Context-related errors and customer churn |
| Verified analysis | Checked completion within a response deadline | Delivered-answer errors and specialist demand |

The UI displays the chosen model's operating fit, relevant metrics, and tradeoffs. A heavier model, extra verification, or additional retained state still consumes the corresponding real compute and memory. Private operating promises can earn higher frozen fees, but the exact model must meet the promised thresholds. Paid rehearsals and canaries capture the same workload so release evidence measures the service being offered.

## 4. A small, deliberate portfolio and client relationships

The company can maintain **four public offers**, with **at most two of each product kind**. Paused offers and queued deployments count against admission limits. Product screens have an offer selector, a visible creation option, names, and customer workloads. An empty paused offer can retire after customer and trial wind-down and after protected commitments and unfinished installations are resolved. Retirement keeps financial history and frees the slot.

Offers compete within finite customer populations. Multiple offers share the company's commercial resources and split its competitive reach; duplicating an offer cannot create shoppers or free customers.

Systems commissions develop through **pilot → repeat → partner** relationships. Successful paid delivery earns progressively larger commitments and lasting access to matching public customers. Each accepted order freezes its duration, load, payment, and relationship terms. Historical version-one orders retain their original obligations.

## 5. Company progress recognizes different businesses

All four chapters track qualifying outcomes in the background. Pinning one chapter guides the player without turning other progress off. A qualifying model upgrade or another qualifying customer service can continue the company's unfinished streak. Missing operating requirements still resets an unfinished streak; earned chapters remain.

Chapter rewards provide applied research access, more efficient experiment work, reduced research-point requirements, and access to frontier-stage experiments. Efficiency can come from suitable operating designs and engineering approaches, rather than one mandatory installation.

Four additional ambitions recognize sustained outcomes:

- **Efficient intelligence provider:** profitable, measured efficient service and independent research.
- **Private AI supplier:** dependable private deployments or customer-hosted licensing with real delivered revenue.
- **Verified work company:** revenue from checked model work supported by paid verification research.
- **Silicon supplier:** profitable qualified hardware delivery and the cash to keep operating.

The original three ending routes remain available. Historical classic campaigns retain their original ending rules while gaining the new progression layer prospectively.

## 6. Advance to decisions and delegate real responsibility

**Next decision** runs the ordinary weekly engine at the selected speed. Its visible stop rules cover completed manual work, available research, approaching deadlines, changed opportunities, and degraded paid service. A blocked or completed delegated plan and a settled customer commission stop for review. New chapter and ambition achievements are included in opportunity stops.

The paid-service rule watches public fulfillment, private hosting, customer-hosted support, and assured API commitments. A new fall below 95% stops the run even when an outage earns a full service credit. An already observed continuing shortfall does not stop every following week.

The player chooses a cash reserve and a maximum duration of 4, 12, 24, or 52 weeks. Before advancing, the cash guard accounts for queued spending and known weekly bills; settled cash is checked afterward. Metered work can add cost, so this is a decision aid rather than a guaranteed no-loss autopilot. The review link opens the relevant workspace. Intermediate jobs owned by a running delegated plan do not interrupt its automatic handoffs.

Up to **three unfinished projects** can be authorized. Each requires a distinct founder or ready senior development lead. Their explicit staff/compute shares total at most 100% and cap requests before the shared allocator. Paused projects retain their reservation until changed or stopped. Losing an available lead blocks further project work and presents a reassignment decision.

## 7. Research programs, world conditions, and funded rivals

Three programs—**efficient systems, persistent systems, and verified systems**—each have four stages: pilot, production, fleet, and frontier. Experiments pay an entry fee, consume shared research compute and staff, and test a particular model with a paid capability baseline against progressively harder operating requirements. Passed evidence becomes available at the following boundary. Each completed stage earns a small demand-access benefit for matching workloads; it does not create customers.

The final stage can be unlocked through the frontier chapter or an earned specialist ambition, allowing a successful small or private company to continue research without becoming a conventional frontier-model vendor.

Each campaign has a visible, fixed market condition favoring responsive, local, persistent, or checked services. Conditions affect matching new experiment fees and competitive interest. Founding origins retain a lasting advantage: garage fee discipline, university research methods, or consultancy relationship access. These modifiers do not rewrite past receipts or customer populations.

Rivals can pursue local, continuity, and verified operating systems. Their plans must hire staff, purchase and prepare suitable evidence, fund prerequisite research and training, obtain independent evaluation, and meet workload requirements before release. Ordinary cash, service, resource, and duplicate-training rules remain in force.

Rivals reserve the larger systems-work compute floors only after the corresponding paid work exists. If a new rental is unaffordable, they can continue funded work more slowly with their existing capacity instead of waiting for an ideal allocation.

## Save compatibility and verification

Authentic 0.37 saves migrate by changing version metadata only. New company progression starts prospectively at activation; historical models, reports, paid training, contracts, and random streams are retained. The first successful browser upgrade archives the original 0.37 save bytes before replacing the primary save. Older supported versions continue through their existing migrations. New records are rejected under historical version headers.

The [release-check record](evidence/connected-company-038-release-checks.json) lists the final automated gates and observed browser coverage. The browser playthrough used a disposable local campaign; the production campaign was not reset, imported, or advanced. It exercised the cash-reserve guard and direct finance link, the complete desktop design form, objective selection, a paid delegated preparation/training/evaluation sequence, automatic stopping, and the exact model's handoff to product setup. A browser-policy restriction prevented refreshing that local preview for the final UI adjustments. Those adjustments have automated coverage; any subsequent live-site verification is reported separately.
