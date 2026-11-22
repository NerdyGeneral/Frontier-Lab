import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash, createInitialState, deserializeState, getGameView } from '../src/core/index';
import { resolveStudioIntent, STUDIO_TASKS } from '../src/core/studio-tasks';
import { ActionControl, actionCostLabel } from '../src/ui/components';
import { getUiCommandPreview } from '../src/ui/command-preview';
import { ModelsPanel } from '../src/ui/lab-panels';
import { StudioShell } from '../src/ui/studio-shell';
import { queue, step } from './fixtures/wave25-studio';
import { StudioCommandReview } from '../src/ui/studio-command-review';
import { StudioCommandReviewProvider, StudioModelSelectionProvider } from '../src/ui/studio-interaction-context';
import { StudioContextMenu, StudioInspector, StudioResultCard, StudioTaskSurface } from '../src/ui/studio-surfaces';
import { StudioWorkbenchPanel } from '../src/ui/studio-workbench-context';

// These checks cover rendered semantics and integration boundaries. Focus,
// inert behavior, hook retention and user interaction require mounted acceptance.
const noAction = () => assert.fail('A static render must not invoke a player action');
const shellProps = (game: GameState) => ({
  game, paused: true, speed: 1 as const, canAct: true, isController: true,
  notice: 'The lab is paused.', saveMessage: 'Saved in this browser.', forceSaveOpen: false,
  plannerEpoch: 0, onToggleRunning: noAction, onStep: noAction, onSpeed: noAction,
  onPause: noAction, onQueue: noAction, onApplyPlan: () => ({ accepted: false }),
});
const legacyIds = ['business', 'people', 'market', 'campaign', 'agents', 'data', 'lab-projects', 'development-plans', 'model-challenges',
  'models', 'synthetic-data', 'model-corpus-compare', 'research', 'applied-research', 'compute',
  'compute-costs', 'capacity-forecast', 'product', 'developer-api', 'business-commitments',
  'infrastructure', 'chips'];

function advancedCompany(): GameState {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/wave27-canary-published.json', import.meta.url), 'utf8'));
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.state;
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp('\\b' + name + '="([^"]*)"'))?.[1];
}

function buttonNamed(html: string, label: string): string {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find(match => match[2].replace(/<[^>]*>/g, '').trim() === label || attribute(match[1], 'aria-label') === label);
  assert.ok(button, 'Missing named button: ' + label);
  return button[1];
}

function selectedValue(html: string, id: string): string | undefined {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
    .find(match => attribute(match[1], 'id') === id);
  assert.ok(select, 'Missing select: ' + id);
  const selected = [...select[2].matchAll(/<option\b([^>]*)>/g)]
    .find(match => /\bselected=""/.test(match[1]));
  return selected ? attribute(selected[1], 'value') : undefined;
}

test('W30-U01: opening and advanced cold shells keep every unvisited workbench lazy and leave the company intact', () => {
  for (const game of [createInitialState(), advancedCompany()]) {
    const before = canonicalStateHash(game), originalClone = globalThis.structuredClone;
    let executions = 0, stateClones = 0;
    function HiddenPanel({ id }: { id: string }): never {
      executions += 1;
      throw new Error('Unvisited workbench executed: ' + id);
    }
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      if (value && typeof value === 'object' && 'slices' in value && 'playerCompanyId' in value) stateClones += 1;
      return originalClone(value, options);
    }) as typeof structuredClone;
    let html: string;
    try {
      html = renderToStaticMarkup(<StudioShell {...shellProps(game)}>
        <div className="main-columns"><div className="lab-column">
          {legacyIds.map(id => <StudioWorkbenchPanel key={id} panelId={id}><HiddenPanel id={id} /></StudioWorkbenchPanel>)}
        </div></div>
      </StudioShell>);
    } finally { globalThis.structuredClone = originalClone; }
    assert.equal(executions, 0, 'All ordinary workbench bodies remain unvisited');
    assert.equal(stateClones, 0, 'The task foundation must not activate hidden quote/planner previews');
    assert.doesNotMatch(html, /studio-planner-heading|research-tree-search/);
    assert.equal((html.match(/data-studio-surface="task"/g) ?? []).length, 1, 'All task owners share one shell surface');
    assert.equal((html.match(/id="studio-decision"/g) ?? []).length, 1, 'No duplicate retained form host is introduced');
    assert.equal((html.match(/role="dialog"/g) ?? []).length, 0, 'Cold navigation does not open a task');
    assert.equal(canonicalStateHash(game), before, 'Rendering changes no economic or random state');
  }
});

test('W30-U02: a read-only cold shell exposes its status while disabling all clock commitments', () => {
  const game = createInitialState();
  const html = renderToStaticMarkup(<StudioShell {...shellProps(game)} canAct={false} isController={false}
    saveKind="memory" saveMessage="Read-only copy. Another tab owns this local lab."><p>Inspection remains available.</p></StudioShell>);
  const clockStart = html.indexOf('class="studio-clock"'), clockEnd = html.indexOf('</header>', clockStart);
  assert.ok(clockStart >= 0 && clockEnd > clockStart);
  const buttons = [...html.slice(clockStart, clockEnd).matchAll(/<button\b([^>]*)>/g)];
  assert.equal(buttons.length, 5);
  assert.equal(buttons.every(button => button[1].includes('disabled=""')), true);
  assert.match(html, /Read-only copy\. Another tab owns this local lab\./);
  assert.match(html, /Inspection remains available\./);
  assert.equal((html.match(/role="dialog"/g) ?? []).length, 0);
});

test('W30-U03: registered task titles name their dialog and only a concise introduction describes it', () => {
  for (const definition of Object.values(STUDIO_TASKS)) {
    const html = renderToStaticMarkup(<StudioTaskSurface mode="dialog" title={definition.title}
      description="Review this decision before committing." onClose={noAction}>
      <form><label htmlFor="draft-name">Draft name</label><input id="draft-name" defaultValue="Retained draft" /></form>
    </StudioTaskSurface>);
    const dialog = html.match(/<div\b[^>]*role="dialog"[^>]*>/)?.[0];
    assert.ok(dialog);
    assert.equal(attribute(dialog, 'aria-modal'), 'true');
    const titleId = attribute(dialog, 'aria-labelledby'), descriptionId = attribute(dialog, 'aria-describedby');
    assert.ok(titleId && descriptionId && titleId !== descriptionId);
    assert.ok(html.includes('id="' + titleId + '"'));
    assert.ok(html.includes('>' + definition.title + '</h2>'));
    assert.ok(html.includes('id="' + descriptionId + '"'));
    assert.match(html, /Review this decision before committing\./);
    assert.equal((html.match(/<form\b/g) ?? []).length, 1);
    assert.equal((html.match(/id="draft-name"/g) ?? []).length, 1);
    assert.doesNotMatch(buttonNamed(html, 'Close and keep draft'), /disabled/);
    assert.equal((html.match(/role="dialog"/g) ?? []).length, 1);
  }
  const withoutDescription = renderToStaticMarkup(<StudioTaskSurface mode="dialog" title="A concise task" onClose={noAction}>
    <p>Long structured body content does not become the modal description.</p>
  </StudioTaskSurface>);
  assert.doesNotMatch(withoutDescription.match(/<div\b[^>]*role="dialog"[^>]*>/)![0], /aria-describedby/);
});

test('W30-U04: hidden and inline surfaces keep one child tree without exposing another modal', () => {
  let bodies = 0;
  function Body({ id }: { id: string }) { bodies += 1; return <input id={id} defaultValue="Unsent input" />; }
  const html = renderToStaticMarkup(<>
    <StudioTaskSurface id="hidden-task" mode="hidden" title="Retained task" onClose={noAction}><Body id="hidden-field" /></StudioTaskSurface>
    <StudioTaskSurface id="inline-task" mode="inline" title="Inline workbench" onClose={noAction}><Body id="inline-field" /></StudioTaskSurface>
    <StudioTaskSurface id="active-task" mode="dialog" title="Active task" onClose={noAction}><Body id="active-field" /></StudioTaskSurface>
  </>);
  assert.equal(bodies, 3, 'Each supplied child tree executes once; the workbench gate owns lazy rendering');
  const host = html.match(/<div\b[^>]*id="hidden-task"[^>]*>/)?.[0];
  assert.ok(host);
  assert.match(host, /hidden=""/);
  assert.match(host, /inert=""/);
  assert.equal((html.match(/role="dialog"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-modal="true"/g) ?? []).length, 1);
  assert.equal((html.match(/role="region"/g) ?? []).length, 2);
  for (const id of ['hidden-field', 'inline-field', 'active-field']) assert.equal(html.split('id="' + id + '"').length - 1, 1);
  const titleIds = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(titleIds).size, 3);
  // Separate static renders cannot establish preservation of mounted React hooks.
});

test('W30-U05: busy task status stays outside its busy body and unsafe Close and Back are disabled', () => {
  const html = renderToStaticMarkup(<StudioTaskSurface mode="dialog" title="Review commitment" busy closeDisabled
    onClose={noAction} onBack={noAction} footer={<button type="button" disabled>Confirm decision</button>}>
    <p>The reviewed command is being checked.</p>
  </StudioTaskSurface>);
  assert.match(buttonNamed(html, 'Close and keep draft'), /disabled=""/);
  assert.match(buttonNamed(html, 'Back'), /disabled=""/);
  assert.match(buttonNamed(html, 'Confirm decision'), /disabled=""/);
  assert.match(html, /class="studio-surface-body" aria-busy="true"/);
  const status = html.indexOf('role="status"'), body = html.indexOf('class="studio-surface-body"');
  assert.ok(status >= 0 && status < body);
  assert.match(html.slice(status, body), /Working…/);
});

test('W30-U06: a read-only commitment keeps its current quote and never calls the review dispatcher during rendering', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<StudioCommandReviewProvider value={noAction}>
    <StudioTaskSurface mode="dialog" title="Prepare data" onClose={noAction}
      status={<span>Read-only copy. Another tab controls this lab.</span>}>
      <ActionControl game={game} payload={{ kind: 'prepare_data', packetId: CONTENT.starterData.id }}
        label="Review preparation" canAct={false} onQueue={noAction} />
    </StudioTaskSurface>
  </StudioCommandReviewProvider>);
  const quote = getUiCommandPreview(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT);
  const cost = actionCostLabel(quote);
  const action = buttonNamed(html, 'Prepare training data' + (cost ? ' · ' + cost : '')), quoteId = attribute(action, 'aria-describedby');
  assert.match(action, /disabled=""/);
  assert.ok(quoteId && html.includes('id="' + quoteId + '"'));
  assert.match(html, /action-quote/);
  assert.match(html, /Read-only copy\. Another tab controls this lab\./);
  assert.equal(canonicalStateHash(game), before);
});

test('W30-U07: contextual menu reuses one named native trigger and exposes its current expansion state', () => {
  for (const open of [false, true]) {
    const html = renderToStaticMarkup(<StudioContextMenu label="Training actions" open={open}
      trigger={<button type="button">Training actions</button>} items={[
        { id: 'train', label: STUDIO_TASKS['train-model'].title, onSelect: noAction },
        { id: 'blocked', label: 'Unavailable action', disabled: true, onSelect: noAction },
      ]} />);
    const trigger = buttonNamed(html, 'Training actions');
    assert.equal((html.match(/<button\b/g) ?? []).length, 1, 'asChild must not create nested buttons');
    assert.equal(attribute(trigger, 'aria-haspopup'), 'menu');
    assert.equal(attribute(trigger, 'aria-expanded'), String(open));
  }
  // Radix menu content is portalled after mounting. Item activation, disabled
  // selection and focus restoration are intentionally left to browser acceptance.
});

test('W30-U08: inspector and result primitives remain named nonmodal context with exact supplied identity', () => {
  const html = renderToStaticMarkup(<>
    <StudioInspector title="Candidate details" description="Inspect the selected candidate." onClose={noAction}
      actions={<button type="button">Evaluate this candidate</button>}><p>Model: candidate-older</p></StudioInspector>
    <StudioResultCard title="Training complete" identity="candidate-older / training-older" status={<span>Complete</span>}
      summary="This candidate still needs evaluation."
      action={{ label: 'Evaluate candidate-older', onClick: noAction, disabled: true }} />
  </>);
  assert.match(html, /<section\b[^>]*aria-labelledby="[^"]+"/);
  assert.match(html, /<article\b[^>]*aria-labelledby="[^"]+"/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal/);
  assert.ok(buttonNamed(html, 'Close Candidate details inspector'));
  assert.match(buttonNamed(html, 'Evaluate candidate-older'), /disabled=""/);
  assert.match(html, /candidate-older \/ training-older/);
  assert.match(html, /This candidate still needs evaluation\./);
});

test('W30-U09: a resolved older training result selects its actual output in the real Models panel', () => {
  const game = advancedCompany(), before = canonicalStateHash(game);
  const owned = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId);
  const latest = owned[owned.length - 1];
  const run = Object.values(game.slices.models.trainingRuns).find(item => item.companyId === game.playerCompanyId
    && item.status === 'complete' && item.outputModelId !== latest.id);
  assert.ok(run, 'The fixture must contain an older completed output alongside newer models');
  const resolved = resolveStudioIntent(game, { kind: 'training-result', runId: run.id });
  assert.ok(resolved.ok && resolved.target?.kind === 'training-result');
  const html = renderToStaticMarkup(<StudioModelSelectionProvider value={{ intentId: 7, modelId: resolved.target.modelId }}>
    <ModelsPanel game={game} view={getGameView(game)} canAct={false} onQueue={noAction} />
  </StudioModelSelectionProvider>);
  assert.equal(selectedValue(html, 'inspect-model'), run.outputModelId);
  assert.notEqual(selectedValue(html, 'inspect-model'), latest.id);
  assert.equal((html.match(/id="models"/g) ?? []).length, 1);
  assert.equal(canonicalStateHash(game), before);
});

test('W30-U10: an exact report intent selects both its model and its real evaluation suite', () => {
  const game = advancedCompany();
  const report = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId
    && item.suiteId === 'expanded-capabilities-1');
  assert.ok(report, 'The fixture must include a non-default report');
  const resolved = resolveStudioIntent(game, { kind: 'report', reportId: report.id });
  assert.ok(resolved.ok && resolved.target?.kind === 'report');
  const html = renderToStaticMarkup(<StudioModelSelectionProvider value={{ intentId: 8,
    modelId: resolved.target.modelId, reportId: resolved.target.reportId }}>
    <ModelsPanel game={game} view={getGameView(game)} canAct={false} onQueue={noAction} />
  </StudioModelSelectionProvider>);
  assert.equal(selectedValue(html, 'inspect-model'), report.modelId);
  assert.equal(selectedValue(html, 'evaluation-suite'), report.suiteId);
  assert.match(html, new RegExp('Held-out report · Week ' + report.week + '<'));
});

test('W30-U11: explicit missing or foreign candidates show a recovery choice without selecting the newest model', () => {
  const game = advancedCompany();
  const foreign = Object.values(game.slices.models.versions).find(model => model.companyId !== game.playerCompanyId);
  assert.ok(foreign);
  for (const modelId of ['missing-output', foreign.id, null]) {
    const html = renderToStaticMarkup(<StudioModelSelectionProvider value={{ intentId: 9, modelId,
      unavailableReason: modelId === null ? 'The original result is unavailable in this lab.' : undefined }}>
      <ModelsPanel game={game} view={getGameView(game)} canAct={false} onQueue={noAction} />
    </StudioModelSelectionProvider>);
    assert.equal(selectedValue(html, 'inspect-model'), '');
    assert.match(html, /role="status"/);
    assert.match(html, /Choose a model|Select an available model/);
    assert.doesNotMatch(html, /class="model-name"|>Evaluate model<\/button>/);
    if (modelId === null) assert.match(html, /The original result is unavailable in this lab\./);
  }
});

test('W30-U12: a mismatched report keeps the requested candidate and does not display a different report as its result', () => {
  const game = advancedCompany();
  const reports = Object.values(game.slices.models.reports).filter(report => report.companyId === game.playerCompanyId);
  const requested = reports[0], wrongReport = reports.find(report => report.modelId !== requested.modelId);
  assert.ok(wrongReport);
  const html = renderToStaticMarkup(<StudioModelSelectionProvider value={{ intentId: 10,
    modelId: requested.modelId, reportId: wrongReport.id }}>
    <ModelsPanel game={game} view={getGameView(game)} canAct={false} onQueue={noAction} />
  </StudioModelSelectionProvider>);
  assert.equal(selectedValue(html, 'inspect-model'), requested.modelId);
  assert.match(html, /This model’s report is unavailable/);
  assert.doesNotMatch(html, /Held-out report · Week/);
});

test('W30-U13: commitment review names the captured setup and describes acceptance timing without claiming it was queued', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const data = renderToStaticMarkup(<StudioCommandReview game={game}
    payload={{ kind: 'prepare_data', packetId: CONTENT.starterData.id }} label="Prepare selected data"
    stale={false} onRefresh={noAction} canRefresh busy={false} />);
  assert.match(data, /Dataset/);
  assert.ok(data.includes(CONTENT.starterData.name));
  assert.match(data, /action-quote/);
  assert.match(data, new RegExp('Scheduled for Week ' + (game.week + 1) + ' when you confirm\\.'));
  assert.doesNotMatch(data, /Queued for Week|Refresh review/);
  const training = renderToStaticMarkup(<StudioCommandReview game={game}
    payload={{ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }}
    label="Start this training run" stale={false} onRefresh={noAction} canRefresh busy={false} />);
  assert.match(training, /Base model|Reference model/);
  assert.ok(training.includes(CONTENT.seedModel.name));
  assert.ok(training.includes(CONTENT.starterData.name));
  assert.match(training, /Primary dataset/);
  assert.match(training, new RegExp('Scheduled for Week ' + (game.week + 1) + ' when you confirm\\.'));
  assert.doesNotMatch(training, /Queued for Week/);
  assert.equal(canonicalStateHash(game), before);
});

test('W30-U14: stale commitment review preserves the setup and only enables refresh when it is safe', () => {
  const game = createInitialState();
  for (const flags of [{ canRefresh: true, busy: false }, { canRefresh: false, busy: false }, { canRefresh: true, busy: true }]) {
    const html = renderToStaticMarkup(<StudioCommandReview game={game}
      payload={{ kind: 'prepare_data', packetId: CONTENT.starterData.id }} label="Prepare selected data"
      stale onRefresh={noAction} {...flags} />);
    assert.match(html, /role="status"/);
    assert.match(html, /Your lab has changed/);
    assert.match(html, /Your choices are still here/);
    assert.equal(/disabled=""/.test(buttonNamed(html, 'Refresh review')), !flags.canRefresh || flags.busy);
    if (flags.busy) assert.match(html, /aria-busy="true"/);
    assert.ok(html.includes(CONTENT.starterData.name));
    assert.doesNotMatch(html, /Queued for Week/);
  }
});

test('training confirmation shows the actual parent and forecast for a prepared plan with a zero training fee', () => {
  const game = step(queue(createInitialState(CONTENT, 'release'), { kind: 'prepare_data', packetId: CONTENT.starterData.id }), 2);
  const before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<StudioCommandReview game={game}
    payload={{ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }}
    label="Review training" stale={false} canRefresh busy={false} onRefresh={noAction} />);
  const text = html.replace(/<[^>]+>/g, ' ');
  assert.ok(text.includes(CONTENT.seedModel.name));
  assert.ok(text.includes(CONTENT.starterData.name));
  assert.match(text, /Projected improvement\s+Reliability 70 → 86/);
  assert.match(text, /Training fee\s+\$0/);
  assert.match(text, /open the new version/);
  assert.equal(canonicalStateHash(game), before);
});
