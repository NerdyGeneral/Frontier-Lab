# Frontier Lab — Wave 0

Wave 0 is the simulation foundation and an inspectable game page. It is not the first-customer loop. The next wave replaces the small company/compute foundation adapters with full workforce, preparation, training, evaluation, usage, and billing modules.

## Source map

| Source | Responsibility |
| --- | --- |
| `src/contracts/types.ts` | Schema 1, fixed-point units, commands, owned slices, resource ports, facts, reports |
| `src/core/engine.ts` | Command admission, seven phases, atomic transactions, immutable handler inputs |
| `src/core/foundation-modules.ts` | Minimal ledger, reserved cloud bill, allocation policy, boundary deliveries |
| `src/core/resources.ts` | Collect work requests; validate authoritative compute and staff grants |
| `src/core/math.ts` | Checked integer arithmetic, high-precision intermediates, fractional carry |
| `src/core/random.ts` | Saved named random streams |
| `src/core/clock.ts` | Active-time adapter, pause, speeds, suspension handling |
| `src/core/validation.ts`, `snapshot.ts` | Validate complete state and versioned snapshot envelopes |
| `src/content/` | Opening rules, six roles, three hardware classes, 28 planned research entries |
| `src/ui/FrontierLab.tsx` | Sparse Paperclips-style page; no economic formulas |
| `src/persistence/wave0-browser.ts` | Local snapshot and Web Locks writer ownership |
| `tests/`, `scripts/test-wave0.mjs` | Headless acceptance fixtures using Node and the existing TypeScript dependency |

## Values and boundaries

Money is integer cents. Capacity (CU), work (CUw), memory (MU), and staff demand (staff-weeks) use 1,000,000,000 stored units per displayed unit. Model scores use basis points: a displayed score of 40 is 4000. Content coefficients are authored values, converted before economic use. Never serialize BigInt or floating economic state.

Opening: $48,000 cash; 4 rented general CU; 8 MU; 2 CU allocated to development; no active work, employees, customers, or products. Cloud rent is $800 per week, including idle capacity. Founder draw and overhead add $200. All numbers are fictional game rules.

One displayed week consists of `commit`, `reserve`, `execute`, `resolve`, `settle`, `market`, and `plan`. A complete candidate week is validated before publication. Exceptions or invalid values return the original state. No UI effect writes economic state directly.

Commands have stable IDs and become effective at the next boundary. Both admission and execution validate them. A preview returns `sourceRevision`; it does not mutate state or draw random values. The engine creates command receipts and deduplicates economic fact IDs.

## Module integration

Each module declares unique state slices in `owns`. It receives a frozen snapshot and returns replacements for those slices plus typed facts. The company owner alone posts the financial ledger; the compute owner alone grants physical resources. Every intermediate result must contain serializable, safe integer state before another module can observe it.

The reserve phase has two passes. All ordinary reserve handlers first return `workRequests`. Then the company and compute `grantResources` hooks receive the complete request frame and return `staffGrants` and `computeGrants`. The execute phase reads `context.resources`. The frame is ephemeral for that one week; long-running tasks retain their progress in their own saved domain slice. The foundation has no real jobs and issues no fabricated work or grants.

Use `context.random.draw('candidate:stage:attempt')` for outcomes. The coordinator prefixes the module ID, updates the saved stream only in the candidate transaction, and discards the draw if the week fails. `drawNamed` is also available for isolated fixtures. Do not use wall-clock time or `Math.random()` in economic rules.

Completion in resolve may schedule availability for a future boundary. A model release must name its owning company. Delivered equipment enters inventory; receipt alone never creates installed capacity, memory, or a new cloud bill.

## Saves and the clock

Snapshots contain schema/content/build versions, current revision/week, IDs, random streams, domain state, queued commands, receipts, scheduled changes, a bounded journal, and the last weekly trace. A checksum detects accidental corruption; it is not authentication. Unsupported schema or content versions are rejected rather than guessed or silently migrated.

First visit, restore, import, and reset are paused. One week takes ten active seconds at 1x; 2x and 5x are supported. Hiding the page pauses it. Returning requires resume. Clock gaps over two seconds are treated as suspended execution and discarded. No offline catch-up occurs. Arrears or a rejected tick stops time.

One Web Lock holder may advance and write a browser-local run. A second tab is read-only and may explicitly reacquire after the first closes. A browser without Web Locks gets a memory-only session with export. Corrupt saves are left untouched until an explicit confirmed replacement. Full IndexedDB recovery, migrations, and multi-slot saves remain M13 work.

## Next wave and verification

Wave 1 must connect preparation → adaptation → evaluation → deployment → customer usage → correctly settled billing. Real work must pass through resource grants. One weekly ledger must account for every expense and receipt. Model, product, deployment, agent configuration, and contract identifiers stay distinct.

Research execution, model improvements, customer growth, rivals, facilities, chips, licensing, and agent jobs are not active in this release. Catalog entries are marked planned and `implemented: false`.

See `docs/WAVE0_ACCEPTANCE.md` for actual test/build/browser evidence and remaining limits. Use `npm test` and `npm run typecheck`; publishing uses the official Sites source helper and build workflow.
