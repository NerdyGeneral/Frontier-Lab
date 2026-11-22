import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState } from '../src/core/engine';
import { createStudioPlanDraft, previewStudioPlan } from '../src/core/studio-planning';
import { serializeState } from '../src/core/snapshot';
import { formatMoney } from '../src/core/math';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { StudioPlanPreview, StudioRequestView } from '../src/contracts/wave25-studio';
import { StudioPlanner, StudioPlannerReview } from '../src/ui/studio-planner';

const noAction = () => assert.fail('Reading the resource plan must not apply any changes');
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const details = (html: string) => [...html.matchAll(/<details\b([^>]*)><summary>([\s\S]*?)<\/summary>/g)]
  .map(match => ({ open: /\bopen(?:=|\s|$)/.test(match[1]), summary: text(match[2]) }));
const applyButton = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .find(match => /Apply plan for Week|Plan queued/.test(text(match[2])));

function healthyPreview(): StudioPlanPreview {
  const game = createInitialState(), draft = createStudioPlanDraft(game);
  draft.hires.data = 1;
  const preview = previewStudioPlan(game, draft);
  assert.ok(preview.valid, preview.reason ?? '');
  return structuredClone(preview);
}

function request(overrides: Partial<StudioRequestView> = {}): StudioRequestView {
  return { id: 'test-request', taskId: 'test-task', label: 'Model service', category: 'serving',
    requestedWork: U, grantedWork: U, physicalWork: U, requestedMemory: U, grantedMemory: U,
    poolId: 'general-cloud', poolName: 'General cloud', largestCompatibleMemory: 8 * U,
    staff: [], reason: '', liveServing: true, ...overrides };
}

function render(preview: StudioPlanPreview, props: Partial<Parameters<typeof StudioPlannerReview>[0]> = {}) {
  return renderToStaticMarkup(<StudioPlannerReview preview={preview} canAct paused onApply={noAction} {...props} />);
}

test('resource editor uses a direct heading and keeps form inspection free of changes', () => {
  const game = createInitialState(), before = serializeState(game);
  const html = renderToStaticMarkup(<StudioPlanner game={game} canAct paused onApplyPlan={noAction} />);
  assert.match(html, /<h2>Plan resources<\/h2>/);
  assert.doesNotMatch(html, /Put your resources to work|PLAN THE NEXT WEEK/);
  assert.match(html, /id="studio-plan-cloud"/);
  assert.equal(serializeState(game), before);
});

test('healthy resource review shows its impact and one apply action before collapsed detail tables', () => {
  const preview = healthyPreview(), html = render(preview), button = applyButton(html)!;
  assert.ok(button);
  assert.doesNotMatch(button[1], /disabled/);
  assert.equal([...html.matchAll(/>Apply plan for Week /g)].length, 1);
  for (const label of ['Upfront cost', 'Weekly cost change', 'Cash after next week', 'Constrained jobs', 'Live service capacity']) {
    assert.ok(text(html).includes(label), label);
  }
  assert.ok(text(html).includes(formatMoney(preview.proposed!.cashCents)));
  assert.match(text(html), /Constrained jobs 0 of 0 scheduled requests/);
  assert.match(text(html), /Live service capacity None active/);
  assert.ok(html.indexOf('aria-label="Plan impact"') < html.indexOf('Apply plan for Week'));
  assert.ok(html.indexOf('Apply plan for Week') < html.indexOf('<details'));
  assert.ok(details(html).length >= 5);
  assert.ok(details(html).every(detail => !detail.open), 'Healthy cost, workforce, jobs and pool tables stay collapsed');
});

test('a constrained live service opens its staffing, job and contract details without expanding healthy cost or pool tables', () => {
  const preview = healthyPreview();
  preview.proposed!.requests = [request({ grantedWork: U / 2, staff: [{ role: 'commercial', requested: U, granted: 0 }], reason: 'Not enough business points.' })];
  preview.proposed!.workforce.granted.commercial = 0;
  preview.proposed!.commitments.assured = 1;
  const html = render(preview);
  assert.match(text(html), /Constrained jobs 1 of 1 scheduled requests/);
  assert.match(text(html), /Live service capacity 0 \/ 1 covered/);
  assert.deepEqual(details(html).filter(detail => detail.open).map(detail => detail.summary), [
    'Weekly points and planned work Staff shortage',
    'Customer contracts 1 signed · Service capacity constrained',
    'Resources by job 1 constrained · 1 request',
  ]);
});

test('a disconnected-memory constraint opens compute evidence, and unpaid bills open cost evidence', () => {
  const memory = healthyPreview();
  memory.proposed!.requests = [request({ label: 'Large model training', category: 'development', liveServing: false,
    requestedMemory: 10 * U, grantedMemory: 0, grantedWork: 0 })];
  const memoryHtml = render(memory);
  assert.deepEqual(details(memoryHtml).filter(detail => detail.open).map(detail => detail.summary), [
    'Resources by job 1 constrained · 1 request', 'Connected compute pools Capacity or memory constraint',
  ]);
  assert.match(text(memoryHtml), /separate pools cannot combine their memory/);
  const bills = healthyPreview();
  bills.proposed!.arrearsCents = 12345;
  const billsHtml = render(bills);
  assert.deepEqual(details(billsHtml).filter(detail => detail.open).map(detail => detail.summary), ['Cash & ongoing costs Unpaid bills forecast']);
  assert.ok(text(billsHtml).includes(formatMoney(12345) + ' unpaid bills'));
});

test('stale, blocked, running, busy, observer and already-applied reviews cannot use the apply action', () => {
  const preview = healthyPreview();
  for (const props of [{ stale: true }, { stale: true, companyChanged: true }, { paused: false }, { previewing: true }, { canAct: false }, { applied: true }]) {
    assert.match(applyButton(render(preview, props))![1], /disabled=""/, JSON.stringify(props));
  }
  assert.match(text(render(preview, { stale: true })), /Your inputs changed. Preview again/);
  assert.match(text(render(preview, { stale: true, companyChanged: true })), /The company changed. Preview again/);
  const blocked = { ...preview, valid: false, reason: 'The resource plan is no longer affordable.', proposed: null };
  const html = render(blocked);
  assert.match(applyButton(html)![1], /disabled=""/);
  assert.match(text(html), /Cash after next week Unavailable/);
  assert.match(text(html), /The resource plan is no longer affordable/);
});
