# Frontier Lab 0.36.1 — save and gameplay repairs

This release addresses the seven reproducible defects identified in the review of the published 0.36.0 source. Build/package version is 0.36.1; content version remains 0.36.0 and game-state schema remains 5.

## Saving and recovery

Small saves retain their existing JSON bytes. A campaign whose compact JSON exceeds 2,000,000 bytes uses a versioned JSON wrapper containing deterministic gzip/base64 data. The decoded snapshot retains every report, model, receipt, queued command, and checksum; no history is discarded to make it fit. Import still enforces a 2,000,000-byte file bound and independently limits decoded snapshots to 32 MiB. The inner snapshot follows the same checksum, historical migration, and domain validation as an ordinary save. Newly compressed exports require this build or a newer compatible reader.

Before the UI commits a weekly result, a capacity preflight ensures that the result can be represented by the supported save format. If it cannot, the current week remains intact and the player can export it. This preflight does not substitute for full validation when saving.

A browser quota error first tries a compressed primary snapshot. If necessary, the writer losslessly compresses only its own recovery copies, verifies their exact original text, and retries. It never deletes the previous primary to make room. Repeated imports can reuse an already preserved identical recovery copy rather than expanding it again. Unrelated browser storage is not touched.

Saved model drafts and blueprints bind to the actual bytes written, including a compressed primary. Existing original and previous-run recovery downloads reproduce their original text exactly.

Every primary save path now shares the same live session and origin guards. A failed save pauses simulation, retains its warning when the player queues another plan, and requires a successful retry before Resume or Next week can advance. Save export remains available. The initial placeholder campaign cannot be saved by a hidden-page callback before the player chooses an origin.

## Model development

New ordinary and custom foundations carry an immutable, identity-bearing independent-rights marker. Their commercial rights depend on evidence actually used in training; the selected comparison reference no longer imposes its ancestry's restrictions. Adaptations retain inherited restrictions, and restricted data used by a new foundation still restricts that foundation.

Existing paid foundations keep their original saved licenses and release identities. Rewriting these would invalidate captured commercial and training evidence. A corrected new foundation has a distinct identity, so a historical plan does not prevent training its corrected replacement. Validation rejects adding or removing the marker on paid records or using it to give an adaptation independent rights.

Previews, manual training, and delegated authorization now share completed/running/queued training-identity checks. A duplicate custom order is rejected before a delegated plan is authorized. The current queued command is excluded from its own duplicate lookup so a valid order still starts and is charged once.

## Economy and competitors

Runway uses the latest settled week's recurring public-service, commercial-license/private-hosting, and assured-service invoices, after service credits. One-time briefs, agent jobs, batch deliveries, hardware sales, and appliance payments still increase cash and earned revenue, without being projected as recurring income. The estimate uses invoice history rather than the bounded ledger display. Finance text explains this distinction.

Serving-capacity repair preserves a rival's justified engineering allocation instead of filling every unused CU with idle development. This lets cash recovery finish releasing rented capacity. Active paid research and training retain their minimum resources, and historical campaigns without the newer tactics retain their existing rules.

## Verification

The regression suites exercise the original failure conditions rather than only checking helper output:

- `snapshot-capacity`: eighteen ordinary paid evaluations cross the former save ceiling; every report survives export and browser reload. Also covers transport/decoded bounds, corrupt compressed data, finite storage, original recovery bytes, and blueprint restoration bound to compressed save bytes.
- `foundation-rights`: actual new training using restricted references and unrestricted or restricted corpora; adaptation restrictions; old published campaigns and captured release identities; corrected replacement admission; tampered marker rejection.
- `development-plans`: completed and queued custom duplicates are rejected before delegation, while the original queued order still starts once.
- `economy-recovery`: the consultancy pilot's $8,000 remains spendable cash with finite 25-week runway; recurring licenses remain included; a natural 130-week rival campaign releases idle rentals and remains solvent without injected cash or capacity.
- `campaign-saving-ui`: executes the production lifecycle callbacks, checking unstarted origins, stale saves, failed-save pause/resume and manual-step protection, and refusal to commit a weekly result outside supported save capacity.

The existing preview campaign opened at Week 13 with $3,070 and remained paused. Download save completed; a real browser reload restored the same week and cash. The All menus directory and finance workspace were accessible, with the updated runway explanation. No application console error was observed; the browser's separate extension metadata messages were not game errors. No paid commands or campaign reset were performed during this browser smoke check.

The save-growth reproduction reached Week 577 with 52 reports after eighteen new evaluations. Its complete 2,023,878-byte snapshot now exports as 211,177 bytes and reloads with every report intact.

### Release gates

| Check | Result |
| --- | --- |
| Model development, foundation rights, and historical model migrations | 44 tests passed |
| Economy, market behavior, founding runway, and customer briefs | 21 tests passed |
| Save capacity, browser persistence/recovery, historical progression, and model workspace | 99 unique tests passed |
| Save lifecycle, menu directory, research navigation, command flow, and task/summary UI | 26 tests passed |
| TypeScript (`npm run typecheck`) | Passed |
| Production build (Sites `build-site.mjs`) | Passed |
| Patch whitespace (`git diff --check`) | Passed |

This totals 164 focused engine/persistence tests and 26 UI tests. Additional decoder checks and an 18-test persistence rerun after the gzip integrity correction also passed; overlapping tests are not added to those totals. The existing repository's entire historical test suite was not rerun.

The test groups were `custom-model-design`, `development-plans`, `foundation-rights`, `model-customization`, `model-customization-migration`, `model-design-migration`, `wave2-lab`, `economy-recovery`, `gameplay-markets`, `market-dynamics`, `founding-runway`, `customer-briefs`, `snapshot-capacity`, `wave1-persistence`, `wave28-recovery`, `wave29-persistence-cache`, `saved-snapshot-hash`, `gameplay-polish-migration`, `wave12-progression`, and `model-workspace`. The legacy `wave2-lab` group used the repository's `scripts/test-wave0.mjs` harness.

UI verification ran `campaign-saving-ui`, `studio-menu-directory-ui`, `research-requirement-navigation-ui`, `studio-command-flow-ui`, `wave30e-task-primary-ui`, and `wave30e-summary-ui` together with Node's test runner and the `tsx` import hook.

## Scope and remaining balance question

This is a focused compatibility and correctness patch. Advanced-skill score compounding is unchanged: altering it requires a deliberate cumulative-training rule and versioned receipts that preserve paid/active outcomes. These regressions do not establish the balance or enjoyment of every long campaign, and the browser smoke check is not a complete desktop or phone playthrough.
