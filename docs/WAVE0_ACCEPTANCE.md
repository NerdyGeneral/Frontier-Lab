# Wave 0 acceptance

Wave 0 establishes the shared simulation and opening catalog. It is not the first-sale game loop. The foundation page may inspect the seeded lab, queue a company name or compute-allocation policy, advance time, and export a versioned snapshot. Hiring, data preparation, training, research execution, products, agents, and rivals remain later work.

## Automated command

Run from the project root:

```sh
node scripts/test-wave0.mjs
```

The runner uses the existing TypeScript dependency to transpile only the pure engine, shared contracts, content catalog, and acceptance tests to a temporary CommonJS directory. Node's built-in test runner executes them; the temporary directory is removed afterward. This adds no dependencies and changes no production build inputs. Run the project's normal TypeScript check separately; transpilation alone is not a type check.

## Acceptance groups

| Group | Required evidence |
| --- | --- |
| W0-C01-C04 | Authored opening values; 16 core and 12 planned child projects; valid references and prerequisite graph; invalid prices/allocation rejected. |
| W0-E01-E13 | Exactly $1,000 weekly opening operating cost; no fabricated work/revenue; arrears without negative cash; seven phases; next-boundary releases; inventory-only delivery; single ledger postings; atomic rollback; safe intermediate updates; release ownership; requests precede owner grants and execution. |
| W0-A01-A06 | Commands wait for the next boundary; IDs are idempotent; allocation remains a capacity ceiling; invalid inputs spend nothing; previews/diagnostics preserve live state; exhausted safe counters reject unchanged. |
| W0-R01-R03 | Repeated 100-command runs produce the same state; named random streams are independent, reproducible, and preserved in snapshots; module draws are namespaced and roll back with a rejected tick. |
| W0-N01-N03 | Small compute quantities survive conversion; checked arithmetic handles large intermediates and rejects unsafe operands; fractional work charges accumulate before settlement. |
| W0-S01-S04 | Snapshot roundtrip preserves pending commands, schedules and draws; corrupt data, unsupported versions, malformed reports, and incomplete model maps are rejected. |
| W0-T01-T07 | Initial pause; 1x/2x/5x rates; hidden-page pause and no catch-up; suspension handling; speed changes; pause inside a tick; reset/disposal. |

The authored cash fixture is $48,000 at week 0, $47,000 after week 1, and $38,000 after ten weeks with no hiring or revenue. It must not be confused with the later first-hire fixture in the design PDF. The equipment fixture records an arrival in inventory; it does not create installed GPU capacity or increase cloud rent.

## Browser checks owned by the integrator

- Fresh first visit is paused and identifies the build as Wave 0.
- Pause, speeds, and explicit step control the actual engine state.
- Company naming and allocation remain pending until the correct weekly boundary; invalid allocations explain the reason.
- The Seed 0 report identifies an existing checkpoint; the public data packet is visibly unprepared.
- Hidden tabs do not advance payroll, training, or rivals; returning requires the intended resume behavior.
- An arrears or engine-error state stops automatic progression and remains inspectable/exportable.
- Export/import preserves exact state; import failure leaves the current company intact.
- If local autosave or tab coordination is present, its success/failure status is honest; two tabs cannot concurrently advance the same authoritative saved run.
- Desktop and narrow mobile layouts preserve labels, keyboard operation, focus, and inline details. Screen-reader announcements do not repeat on every counter tick.

## Results

Verified on 2026-11-06 with Node 24.22.1 and the existing TypeScript 5.9.3 dependency:

- `node scripts/test-wave0.mjs`: **40 passed, 0 failed, 0 skipped**. Both acceptance suites completed successfully, including the final boundary and resource-port regressions.
- Targeted strict TypeScript check: **passed with no diagnostics**. This follows the tests' imports through the shared contracts, content, and core, without requiring the interface to be complete:

```sh
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --types node tests/wave0.test.ts tests/clock.test.ts
```

The acceptance review confirmed that equipment arrivals preserve inventory quantities without installing usable capacity, and that module randomness is namespaced and only committed with a successful tick. The import regressions independently exercise checksum corruption and schema validation: malformed weekly reports and missing capability keys are rejected even when their checksum matches.

The final boundary cases verify that command counters cannot overflow, unsafe module-owned money is rejected before settlement, scheduled releases respect company ownership, and checked addition validates its operands. A two-request fixture confirms that every reserve handler runs before the company and compute owners grant resources, and that execution sees both complete grant sets. This checks the module interface for later work schedulers; it adds no gameplay jobs to the opening state.

## Integration evidence

- Full application `npm run typecheck`: passed with exit code 0 after the final contracts, collector, UI, and persistence changes.
- Official Sites production build: passed. The publication helper performs the final build after removing the temporary responsive-layout fixture.
- Managed Chrome preview: fresh opening was paused at Week 0 with $48,000, four rented CU, unprepared data, and no paying customers.
- An over-capacity allocation disabled submission and explained the limit. Queued rename and a 1/3/0 CU policy stayed pending, then both applied at Week 1. Cash became $47,000; the visible ledger showed one $800 rent charge and one $200 overhead charge, with no revenue or executed work.
- Resume at 5x advanced the actual engine; pause stopped it. All 1x/2x/5x rate, hidden-state and suspension semantics passed the headless clock fixtures.
- Reload restored the paused company. Export, advance, import confirmation and replacement returned to exactly Week 1, $47,000, and fingerprint `a83e1853`. An invalid snapshot was rejected without changing the Week 2 company.
- A second tab was visibly read-only with disabled time controls. Closing the owner and selecting “Use this tab” restored the latest Week 19 snapshot and enabled the new owner while paused.
- On-page diagnostics reported all five checks passed without changing the company. Confirmed reset restored the opening Week 0 state.
- Desktop visual review passed. A temporary narrow iframe supplied a 375px content viewport; body scroll width was also 375px, and the stacked layout was visually inspected. The QA route was removed before final packaging. This is a responsive browser check, not a physical-device certification.
- Captured console entries were extension metadata errors; no application-source errors were observed in the inspected log entries.

The preview was returned to a new paused lab. A screenshot is in `docs/screenshots/Frontier_Lab_Wave0.png`. Publication confirmation comes from the Sites deployment result.

## Scope and remaining verification

Hidden-page behavior, arrears stopping, numeric limits, and corrupted save shapes have automated coverage. Native tab visibility was not independently reproduced in the cloud browser, which kept the original page running while another automation tab was open. Physical mobile devices and assistive technologies were not exercised. Local saves are browser-specific; full recovery/migration features remain M13 work. Later module acceptance, first-sale integration, and campaign balance are outside this Wave 0 gate.
