import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { canonicalStateHash, createInitialState, getGameView, submitCommand } from '../src/core/index';
import { ActionControl, Section } from '../src/ui/components';
import { DataPanel } from '../src/ui/panels';
import { StudioShell } from '../src/ui/studio-shell';
import { StudioWorkbenchPanel, StudioWorkbenchProvider, retainedWorkbenchPropsEqual } from '../src/ui/studio-workbench-context';
import type { StudioWorkbenchVisibility } from '../src/ui/studio-workbench-context';

const studio: StudioWorkbenchVisibility = { mode: 'studio', panel: null, standalone: null, epoch: 0 };
const legacyIds = ['business', 'people', 'market', 'campaign', 'agents', 'data', 'lab-projects', 'models', 'synthetic-data', 'model-corpus-compare', 'research', 'applied-research', 'compute', 'compute-costs', 'capacity-forecast', 'product', 'developer-api', 'business-commitments', 'infrastructure', 'chips'];
const noCommand = () => assert.fail('Rendering must never submit a command');
const shellProps = (game: GameState) => ({
  game, paused: true, speed: 1 as const, canAct: true, isController: true,
  notice: 'The lab is paused.', saveMessage: 'Saved in this browser.', forceSaveOpen: false,
  plannerEpoch: 0, onToggleRunning: noCommand, onStep: noCommand, onSpeed: noCommand,
  onPause: noCommand, onQueue: noCommand, onApplyPlan: () => ({ accepted: false }),
});

test('W29-U01: unvisited Studio workbenches do not execute heavy children or add DOM wrappers', () => {
  let executions = 0;
  function HeavyPanel(): never { executions += 1; throw new Error('Hidden heavy panel executed'); }
  const html = renderToStaticMarkup(<StudioWorkbenchProvider value={studio}><div className="main-columns"><div className="lab-column">
    <StudioWorkbenchPanel panelId="data"><HeavyPanel /></StudioWorkbenchPanel>
    <StudioWorkbenchPanel panelId="planner" studioOnly><HeavyPanel /></StudioWorkbenchPanel>
    <StudioWorkbenchPanel panelId="research-tree" studioOnly><HeavyPanel /></StudioWorkbenchPanel>
  </div></div></StudioWorkbenchProvider>);
  assert.equal(executions, 0);
  assert.equal(html, '<div class="main-columns"><div class="lab-column"></div></div>');
});

test('W29-U02: the selected real Data panel retains its direct-child section, quote and current state', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  function HiddenModelPanel(): never { throw new Error('The inactive model panel executed'); }
  const html = renderToStaticMarkup(<StudioWorkbenchProvider value={{ ...studio, panel: 'data' }}><div className="lab-column">
    <StudioWorkbenchPanel panelId="data"><DataPanel game={game} view={getGameView(game)} canAct onQueue={noCommand} /></StudioWorkbenchPanel>
    <StudioWorkbenchPanel panelId="models"><HiddenModelPanel /></StudioWorkbenchPanel>
  </div></StudioWorkbenchProvider>);
  assert.match(html, /^<div class="lab-column"><section id="data"/);
  assert.equal((html.match(/id="data"/g) ?? []).length, 1);
  assert.match(html, /Prepare data<span class="action-label-cost"> · \$1,000<\/span><\/button>/);
  assert.match(html, /aria-describedby="[^"]+"/);
  assert.match(html, new RegExp(CONTENT.starterData.name));
  assert.equal(canonicalStateHash(game), before);
});

test('W29-U03: Classic renders every legacy section once and excludes Studio-only duplicate workbenches', () => {
  const calls: string[] = [];
  function Panel({ id }: { id: string }) { calls.push(id); return <Section title={id} id={id}><p>Current state</p></Section>; }
  const html = renderToStaticMarkup(<StudioWorkbenchProvider value={{ ...studio, mode: 'classic', standalone: 'planner' }}><div className="lab-column">
    {legacyIds.map(id => <StudioWorkbenchPanel key={id} panelId={id}><Panel id={id} /></StudioWorkbenchPanel>)}
    <StudioWorkbenchPanel panelId="planner" studioOnly><Panel id="planner" /></StudioWorkbenchPanel>
    <StudioWorkbenchPanel panelId="research-tree" studioOnly><Panel id="research-tree" /></StudioWorkbenchPanel>
  </div></StudioWorkbenchProvider>);
  assert.deepEqual(calls, legacyIds);
  for (const id of legacyIds) assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) ?? []).length, 1);
  assert.equal((html.match(/<section /g) ?? []).length, legacyIds.length);
  assert.match(html, /^<div class="lab-column"><section id="business"/);
  assert.doesNotMatch(html, /id="(?:planner|research-tree)"/);
  // The shared panel may also be used outside Studio without an extra provider.
  assert.match(renderToStaticMarkup(<StudioWorkbenchPanel panelId="data"><Panel id="data" /></StudioWorkbenchPanel>), /^<section id="data"/);
});

test('W29-U04: standalone selection renders one workbench with the props supplied for that render', () => {
  const calls: string[] = [];
  function Panel({ id, week, canAct }: { id: string; week: number; canAct: boolean }) {
    calls.push(id); return <section id={id}><span>Week {week}</span><button disabled={!canAct}>Apply</button></section>;
  }
  for (const selected of ['planner', 'research-tree'] as const) {
    calls.length = 0;
    const html = renderToStaticMarkup(<StudioWorkbenchProvider value={{ ...studio, standalone: selected }}>
      <StudioWorkbenchPanel panelId="planner" studioOnly><Panel id="planner" week={612} canAct={false} /></StudioWorkbenchPanel>
      <StudioWorkbenchPanel panelId="research-tree" studioOnly><Panel id="research-tree" week={612} canAct={false} /></StudioWorkbenchPanel>
      <StudioWorkbenchPanel panelId="data"><Panel id="data" week={612} canAct /></StudioWorkbenchPanel>
    </StudioWorkbenchProvider>);
    assert.deepEqual(calls, [selected]);
    assert.match(html, /Week 612/);
    assert.match(html, /<button disabled="">Apply<\/button>/);
    assert.equal((html.match(/<section /g) ?? []).length, 1);
  }
});

test('W29-U05: the actual initial Studio Shell defers legacy, planner and research preview work', () => {
  const game = createInitialState(), before = canonicalStateHash(game), originalClone = globalThis.structuredClone;
  let stateClones = 0;
  function HeavyPanel(): never { throw new Error('Unvisited Shell child executed'); }
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (value && typeof value === 'object' && 'slices' in value && 'playerCompanyId' in value) stateClones += 1;
    return originalClone(value, options);
  }) as typeof structuredClone;
  let html: string;
  try {
    html = renderToStaticMarkup(<StudioShell {...shellProps(game)}><StudioWorkbenchPanel panelId="data"><HeavyPanel /></StudioWorkbenchPanel></StudioShell>);
  } finally { globalThis.structuredClone = originalClone; }
  assert.equal(stateClones, 0);
  assert.match(html, /id="studio-plan-workbench"[^>]*hidden=""/);
  assert.match(html, /id="studio-research-tree"[^>]*hidden=""/);
  assert.doesNotMatch(html, /studio-planner-heading|research-tree-search|id="data"/);
  assert.equal(canonicalStateHash(game), before);
});

test('W29-U06: pending Shell feedback stays outside the inspector and disables every clock action', () => {
  const game = createInitialState();
  const html = renderToStaticMarkup(<StudioShell {...shellProps(game)} busyMessage="Settling Week 1…" errorMessage="The command could not be queued." saveKind="waiting" saveMessage="Saving the latest changes…"><p>Workbench</p></StudioShell>);
  const clockStart = html.indexOf('class="studio-clock"'), clockEnd = html.indexOf('</header>', clockStart);
  const clock = html.slice(clockStart, clockEnd), buttons = [...clock.matchAll(/<button\b([^>]*)>/g)];
  assert.match(clock, /aria-busy="true"/);
  assert.match(clock, /Working/);
  assert.equal(buttons.length, 5);
  assert.equal(buttons.every(button => button[1].includes('disabled=""')), true);
  const statusStart = html.indexOf('class="studio-status-line"'), inspectorStart = html.indexOf('<aside');
  assert.ok(statusStart > clockEnd && statusStart < inspectorStart);
  assert.match(html.slice(statusStart, inspectorStart), /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html.slice(statusStart, inspectorStart), /Settling Week 1…/);
  assert.match(html.slice(statusStart, inspectorStart), /class="error-message studio-operation-error" role="alert">The command could not be queued\./);
  // Focused task surfaces add their own footer before the persistent save bar.
  const footerStart = html.indexOf('<footer class="studio-footer studio-only"');
  assert.ok(footerStart >= 0);
  const footer = html.slice(footerStart, html.indexOf('</footer>', footerStart) + '</footer>'.length);
  assert.match(footer, /data-save-kind="waiting"/);
  assert.match(footer, /aria-label="Open save controls\. Saving the latest changes…"/);
  assert.match(footer, /role="status" aria-live="polite" aria-atomic="true">Saving the latest changes…/);
  assert.doesNotMatch(footer, /Saved in this browser/);
});

test('W29-U07: action buttons describe the unique accepted, blocked, incomplete and queued quote in one render', () => {
  const game = createInitialState();
  const payload: CommandPayload = { kind: 'prepare_data', packetId: CONTENT.starterData.id };
  const queued = submitCommand(game, payload);
  assert.equal(queued.accepted, true, queued.reason?.message);
  const before = [canonicalStateHash(game), canonicalStateHash(queued.state)];
  const html = renderToStaticMarkup(<>
    <ActionControl game={game} payload={payload} label="Accepted preparation" canAct onQueue={noCommand} />
    <ActionControl game={game} payload={{ kind: 'start_research', researchId: 'R16' }} label="Blocked discovery" canAct onQueue={noCommand} />
    <ActionControl game={game} payload={null} label="Incomplete draft" emptyReason="Choose a model first." canAct onQueue={noCommand} />
    <ActionControl game={queued.state} payload={payload} label="Queued preparation" canAct onQueue={noCommand} />
  </>);
  const controls = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(controls.length, 4);
  const ids = controls.map(button => button[1].match(/aria-describedby="([^"]+)"/)?.[1]);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) assert.equal(html.split('id="' + id + '"').length - 1, 1);
  assert.equal(controls[0][1].includes('disabled=""'), false);
  assert.equal(controls.slice(1).every(button => button[1].includes('disabled=""')), true);
  assert.match(html, /Choose a model first\./);
  assert.match(html, /Queued for Week 1\. Resume the game or advance one week to apply\./);
  assert.match(html, /action-quote/);
  assert.deepEqual([canonicalStateHash(game), canonicalStateHash(queued.state)], before);
});

test('W29-U08: memo policy skips hidden prop churn but allows active changes and epoch replacement', () => {
  // This verifies the gate policy only. Browser acceptance separately proves
  // mounted hook drafts, reopening freshness and import/new-company resets.
  const previousChild = <span>Previous snapshot</span>, nextChild = <span>Current snapshot</span>;
  const previous = { active: true, epoch: 4, children: previousChild };
  assert.equal(retainedWorkbenchPropsEqual(previous, { active: false, epoch: 4, children: nextChild }), true);
  assert.equal(retainedWorkbenchPropsEqual(previous, { active: true, epoch: 4, children: nextChild }), false);
  assert.equal(retainedWorkbenchPropsEqual(previous, { active: true, epoch: 4, children: previousChild }), true);
  assert.equal(retainedWorkbenchPropsEqual(previous, { active: false, epoch: 5, children: previousChild }), false);
  assert.equal(retainedWorkbenchPropsEqual({ active: false, epoch: 4, children: previousChild }, { active: true, epoch: 4, children: previousChild }), false);
});
