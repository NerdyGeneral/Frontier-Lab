# Wave 0 handoff contract

Scope is M01 plus opening M14 content, with a minimal inspectable Paperclips page. This is not the first-sale game loop. Do not implement hiring/training/products as functioning controls yet. One private Sites project, existing Vinext tooling, no paid LLM calls, no database service.

Shared types: src/contracts/types.ts. Resource integers use 1e9 per CU/CUw/MU; money is integer cents; capability/reliability use basis points (score 40 => 4000). No floating economic arithmetic. Content stores resource values in those integer units; the staffWeeks/hardwareMultiplier fields are authored coefficients, converted by common helpers before economic use.

Public engine API (root owns implementation):
- createInitialState(content=CONTENT): GameState
- previewCommand(state,payload,content=CONTENT): PreviewResult; no side effects/draw consumption.
- submitCommand(state,payload,content=CONTENT, explicitId?): SubmitResult; defaults to player company, queues at next boundary, deduplicates IDs. accepted/reason/state returned.
- advanceWeek(state,content=CONTENT,modules?): TickResult; explicit stepping works while UI paused. Atomic rejection preserves state.
- createDefaultModules(content): readonly DomainModule[]; registered owners, stage hooks and typed facts.
- validateState(state,content=CONTENT): Rejection[]
- runDiagnostics(state,content=CONTENT): DiagnosticResult; runs isolated deterministic engine checks, never changes live company.
- serializeState(state,content=CONTENT): string; versioned envelope and checksum.
- deserializeState(text,content=CONTENT): {ok:true,state:GameState}|{ok:false,error:string}; validates and preserves state on failure.
- formatMoney(cents), formatUnits(units), canonicalStateHash(state) helpers.
- BrowserClock class in src/core/clock.ts: constructor({onWeek,onVisibilityPause?}); setPaused(boolean), setSpeed(1|2|5), pulse(timestampMilliseconds, visible=true), reset(timestampMilliseconds?), dispose(); no requestAnimationFrame inside core. UI calls pulse from own interval with performance.now(); callbacks only, no direct economy writes.

Engine sources: src/core/index.ts reexports. Content: src/content/catalog.ts exports CONTENT, src/content/validate.ts exports validateContent(content):string[]. UI only imports these public entrypoints. Root will create test runner command after installer finishes; don't edit package or lockfiles.

Wave 0 working actions: start/stop clock, 1x/2x/5x, step one week, rename company, queue serving/development/research capacity allocation within four rented CU, inspect initial Seed 0 report, run read-only diagnostics, export/import a versioned snapshot. A small browser-local save adapter is allowed if clearly described as Wave 0; full M13 IndexedDB recovery/migrations remains later. No fake revenue or work: four rented CU cost $800/week plus $200 overhead whether used or idle; all actual work remains zero before real jobs exist. Reject optional commands during arrears, allow inspection/reset/export. Stop auto time on financial arrears, error, hidden page, import, or lost tab ownership.

UI: one sparse white page, dark text, small native-looking buttons, thin rules, compact semantic tables, two/three desktop columns stacked on mobile. Business top-left; Seed 0 and compute useful. Show Foundation build/Wave 0 and explain training/hiring/sales arrive in Wave 1. Do not place a long feature-marketing page above the game. Optional details may show weekly trace/catalog and foundation diagnostics. Announce deliberate actions, not all ticking counters. Numeric inputs stay stable while ticks occur. Include opening reset with confirmation because it discards a run; save failures must be visible.

Catalog content: Source design /workspace/scratch/4788498e7ff5/output/pdf/Frontier_Lab_Consolidated_Game_Design.pdf; source JSON plan /workspace/scratch/4788498e7ff5/tmp/module_build/content/00.json, M01.json, M14.json. All game values fictional. Opening $48k, 4 cloud CU/8MU, $200/CU/week +$200 overhead, Seed0 40/30/20/20 and reliability70, 40 waitlist and no active paying customers. Founder1FTE. Source seed model owns company-player. Starter data100 raw/0ready, quality80, coverage100/35/25/25, preparation$1000+2SW. First adaptation12CUw,targetconversation50,reliabilityanchor70,target90. Evaluation2CUw/.5R-SW/20cases. Rendering should not imply the starter data is already ready.

Agents own disjoint source paths. Catalog owner src/content only. UI owner app/page.tsx, app/globals.css, src/ui and src/persistence/wave0-browser.ts only. Tests reviewer tests/wave0.test.ts, tests/clock.test.ts, scripts/test-wave0.mjs, docs/WAVE0_ACCEPTANCE.md only. Root owns core/contracts, app/layout metadata, package scripts, project setup/source sync/hosting. Return errors as ordinary typed reasons. No module or UI can call Math.random to advance economic state.
