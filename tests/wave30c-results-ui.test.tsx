import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StudioResult } from '../src/core/studio-results';
import { StudioResultDetail, StudioResultsPanel } from '../src/ui/studio-results';

const noAction = () => assert.fail('Rendering the inbox must not acknowledge, navigate or commit');
const actions = { onReview: noAction, onDismiss: noAction, onRestore: noAction, onAction: noAction };
const candidate: StudioResult = {
  key: 'training-exact-key', kind: 'training', week: 7, sourceId: 'training-older', title: 'Training complete', summary: 'Older candidate',
  details: [{ label: 'Output candidate', value: 'Older candidate' }, { label: 'Work performed', value: '13.2 CUw' }],
  action: { label: 'Evaluate this candidate', target: { kind: 'intent', intent: { kind: 'training-result', runId: 'training-older' } } },
};

test('W30C-UI01: the empty inbox is a body for one host, with no automatic acknowledgement or invented completion', () => {
  const html = renderToStaticMarkup(<StudioResultsPanel results={[]} flags={{}} attention={[]} {...actions} />);
  assert.match(html, /No results yet/);
  assert.match(html, /Recent results/);
  assert.match(html, /Needs attention/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal="true"|Training complete/);
});

test('W30C-UI02: a quiet reviewed baseline remains visible and offers type, actual-week and review filters', () => {
  const html = renderToStaticMarkup(<StudioResultsPanel results={[candidate]} flags={{ [candidate.key]: { reviewed: true, dismissed: false } }} attention={[]} {...actions} />);
  assert.match(html, /Older candidate/);
  assert.match(html, /Week 7/);
  assert.match(html, /Result type/);
  assert.match(html, /Completion week/);
  assert.match(html, /value="dismissed">Dismissed/);
  assert.match(html, /value="reviewed">Reviewed/);
  assert.match(html, /Mark week reviewed/);
  assert.doesNotMatch(html, /is-unreviewed/);
});

test('W30C-UI03: the exact result detail presents one contextual next action and retained evidence', () => {
  const html = renderToStaticMarkup(<StudioResultDetail result={candidate} flags={{}} {...actions} onBack={noAction} />);
  assert.match(html, /Output candidate/);
  assert.match(html, /13\.2 CUw/);
  assert.equal((html.match(/Evaluate this candidate/g) ?? []).length, 1);
  assert.match(html, /Hide from recent results/);
  assert.doesNotMatch(html, /role="dialog"|latest candidate/i);
});

test('W30C-UI04: an unavailable exact output keeps its evidence and never exposes a substituted next action', () => {
  const result = { ...candidate, summary: 'Output candidate is unavailable', action: null,
    unavailableReason: 'The exact output candidate is unavailable. Choose another candidate explicitly.' };
  const html = renderToStaticMarkup(<StudioResultDetail result={result} flags={{}} {...actions} onBack={noAction} />);
  assert.match(html, /13\.2 CUw/);
  assert.match(html, /role="status"/);
  assert.match(html, /Choose another candidate explicitly/);
  assert.doesNotMatch(html, /Evaluate this candidate/);
});

test('W30C-UI05: dismissed outcomes have explicit recovery and stay out of the default recent list', () => {
  const flags = { [candidate.key]: { reviewed: true, dismissed: true } };
  const list = renderToStaticMarkup(<StudioResultsPanel results={[candidate]} flags={flags} attention={[]} {...actions} />);
  assert.doesNotMatch(list, /Older candidate/);
  assert.match(list, /Use Show to find hidden cards/);
  const detail = renderToStaticMarkup(<StudioResultDetail result={candidate} flags={flags} {...actions} onBack={noAction} />);
  assert.match(detail, /Show in recent results/);
  assert.doesNotMatch(detail, /Hide from recent results/);
});

test('W30C-UI06: loading and local storage notices remain visible without adding a second dialog', () => {
  const html = renderToStaticMarkup(<StudioResultsPanel results={[candidate]} flags={{}} attention={[]} ready={false}
    persistenceNotice="Review flags are local to this tab because browser storage is unavailable." {...actions} />);
  assert.match(html, /Loading your results/);
  assert.match(html, /Review flags are local to this tab/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal="true"/);
});
