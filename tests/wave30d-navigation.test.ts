import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { createInitialState } from '../src/core/engine';
import { freezeDeep } from '../src/core/canonical';
import { serializeState } from '../src/core/snapshot';
import {
  STUDIO_DESTINATIONS, getStudioDestinationForPanel, getStudioScreenTarget, resolveStudioHash,
} from '../src/core/studio-navigation';
import {
  STUDIO_PANEL_TITLES, STUDIO_TASKS, createStudioTaskSession, getActiveStudioTask,
  getStudioSubmissionContext, getStudioTaskForPanel, resolveStudioIntent, studioTaskReducer,
} from '../src/core/studio-tasks';
import type { StudioPanelId, StudioReturnTarget } from '../src/core/studio-tasks';

const home: StudioReturnTarget = { screen: 'studio', panel: null };

test('30D-N01 destinations consolidate management while Save remains a named utility', () => {
  assert.equal(STUDIO_DESTINATIONS.length, 6);
  assert.equal(new Set(STUDIO_DESTINATIONS.map(item => item.id)).size, 6);
  assert.ok(STUDIO_DESTINATIONS.every(item => item.label && item.description));
  assert.equal(STUDIO_DESTINATIONS.some(item => String(item.id) === 'save'), false);
  assert.deepEqual(getStudioScreenTarget('products'), { screen: 'products', panel: 'product' });
  assert.deepEqual(getStudioScreenTarget('operations'), { screen: 'operations', panel: 'people' });
  assert.deepEqual(getStudioScreenTarget('company'), { screen: 'company', panel: 'business' });
  assert.deepEqual(resolveStudioHash('#save'), { screen: 'save', panel: 'save' });
});

test('30D-N02 historical links keep their exact workbench after consolidation', () => {
  const links = [
    ['#campus', 'operations', 'campus'],
    ['#release-desk', 'products', 'release-desk'],
    ['#developer-api', 'products', 'developer-api'],
    ['#business-commitments', 'products', 'business-commitments'],
    ['#infrastructure', 'operations', 'infrastructure'],
    ['#chips', 'operations', 'chips'],
    ['#model-corpus-compare', 'projects', 'model-corpus-compare'],
    ['#capacity-forecast', 'operations', 'capacity-forecast'],
    ['#compute-costs', 'operations', 'compute-costs'],
    ['#capacity', 'operations', 'capacity'],
    ['#research-programs', 'research', 'research-programs'],
    ['#company-log', 'company', 'company-log'],
  ];
  for (const [hash, screen, panel] of links) assert.deepEqual(resolveStudioHash(hash), { screen, panel }, hash);
  // These historical screen names were also stored in in-memory return targets.
  assert.deepEqual(getStudioScreenTarget('release'), resolveStudioHash('#release-desk'));
  assert.deepEqual(getStudioScreenTarget('campus'), resolveStudioHash('#campus'));
  assert.deepEqual(getStudioScreenTarget('finance'), resolveStudioHash('#business'));
});

test('30D-N03 research map and market screen defaults do not overwrite legacy catalog links', () => {
  assert.deepEqual(getStudioScreenTarget('research'), { screen: 'research', panel: null });
  assert.deepEqual(resolveStudioHash('#research'), { screen: 'research', panel: 'research' });
  assert.deepEqual(resolveStudioHash('#studio-research-tree'), { screen: 'research', panel: null });
  assert.deepEqual(getStudioScreenTarget('market'), { screen: 'products', panel: 'product' });
  assert.deepEqual(resolveStudioHash('#market'), { screen: 'products', panel: 'market' });
  assert.deepEqual(resolveStudioHash('#lab'), home);
});

test('30D-N04 every existing panel link remains addressable through its canonical workspace without a task side effect', () => {
  for (const panel of Object.keys(STUDIO_PANEL_TITLES) as StudioPanelId[]) {
    const route = resolveStudioHash('#' + panel);
    assert.ok(route, panel + ' must retain its direct link');
    assert.equal(route.panel, panel === 'development-plans' ? null : panel, panel + ' must select its canonical workbench');
    assert.equal(route.screen, getStudioDestinationForPanel(panel));
    assert.deepEqual(Object.keys(route).sort(), ['panel', 'screen'], 'Navigation must not encode a queued action');
  }
  for (const hash of ['#constructor', '#__proto__', '#unknown', '#research-tree-details', '#%zz', 'https://example.com/#campus', '']) {
    assert.equal(resolveStudioHash(hash), null, 'Unrecognized/internal detail anchor: ' + hash);
  }
  assert.deepEqual(resolveStudioHash('#release%2Ddesk'), resolveStudioHash('#release-desk'));
});

test('legacy planner and delegated-plan links resolve to Capacity and the shared work queue', () => {
  const game = createInitialState(), before = serializeState(game);
  for (const hash of ['#planner', 'planner', '#studio-plan-workbench', '#studio%2Dplan%2Dworkbench']) {
    assert.deepEqual(resolveStudioHash(hash), { screen: 'operations', panel: 'capacity' }, hash);
  }
  assert.deepEqual(resolveStudioHash('#development-plans'), { screen: 'projects', panel: null });
  assert.deepEqual(resolveStudioHash('#development%2Dplans'), resolveStudioHash('#studio-project-board'));
  for (const panel of ['capacity', 'compute', 'compute-costs', 'capacity-forecast'] as const) {
    assert.equal(getStudioDestinationForPanel(panel), 'operations', panel);
  }
  assert.equal(serializeState(game), before, 'Following a legacy route cannot queue work or change a company');
});

test('30D-N05 research intent preserves an exact locked catalog method without inventing eligibility', () => {
  const game = createInitialState(CONTENT, 'release');
  const before = serializeState(game);
  assert.ok(CONTENT.research.some(method => method.id === 'S6'));
  freezeDeep(game);
  assert.deepEqual(resolveStudioIntent(game, { kind: 'research-method', researchId: 'S6' }), {
    ok: true, panel: 'research', task: 'research-method', target: { kind: 'research-method', researchId: 'S6' },
  });
  assert.deepEqual(resolveStudioIntent(game, { kind: 'research-method', researchId: 'R1' }), {
    ok: true, panel: 'research', task: 'research-method', target: { kind: 'research-method', researchId: 'R1' },
  });
  assert.equal(serializeState(game), before, 'Inspecting an unlock cannot complete research or change the lab');
});

test('30D-N06 missing methods and project identities cannot silently target another discovery', () => {
  const game = createInitialState(CONTENT, 'release');
  for (const researchId of ['missing', 'research-rival-command-1', 'constructor', '']) {
    const target = resolveStudioIntent(game, { kind: 'research-method', researchId });
    assert.equal(target.ok, false);
    if (!target.ok) assert.match(target.reason, /unavailable. Choose a discovery from Research/);
  }
  let session = studioTaskReducer(createStudioTaskSession(), { type: 'open', task: 'train-model', returnTo: home });
  assert.equal(studioTaskReducer(session, { type: 'open', task: 'train-model', intent: { kind: 'research-method', researchId: 'R1' }, returnTo: home }), session,
    'An exact research target cannot be consumed by a training form');
});

test('30D-N07 selected research keeps the original training parent through a helper review', () => {
  let session = studioTaskReducer(createStudioTaskSession(2), {
    type: 'open', task: 'train-model', intent: { kind: 'training-data', packetId: 'retained-packet' }, returnTo: home,
  });
  const parent = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'detour', destination: { screen: 'research', panel: null } });
  session = studioTaskReducer(session, { type: 'open', task: 'research-method', intent: { kind: 'research-method', researchId: 'R4C' }, returnTo: { screen: 'research', panel: null } });
  session = studioTaskReducer(session, { type: 'review', sourceRevision: 4, payload: { kind: 'start_research', researchId: 'R4C' } });
  const research = getActiveStudioTask(session)!;
  assert.equal(research.owner, 'research');
  assert.equal(research.review!.payload.kind, 'start_research');
  session = studioTaskReducer(session, { type: 'return' });
  assert.equal(getActiveStudioTask(session)!.instanceId, parent.instanceId);
  assert.deepEqual(getActiveStudioTask(session)!.intent, { kind: 'training-data', packetId: 'retained-packet' });
  assert.equal(session.tasks.research!.review, null, 'Exposed helper fields need a fresh review before submission');
  assert.equal(session.tasks.research!.draftGeneration, research.draftGeneration);
  assert.equal(session.detour, null);
});

test('30D-N08 launch-to-management transition retains one product draft and retires the old receipt', () => {
  let session = studioTaskReducer(createStudioTaskSession(3), { type: 'open', task: 'launch-basic-chat',
    intent: { kind: 'first-launch', candidateId: 'older-candidate' }, returnTo: home });
  session = studioTaskReducer(session, { type: 'review', sourceRevision: 6,
    payload: { kind: 'deploy_product', productKind: 'basic-chat', modelId: 'older-candidate', priceCents: 1250, allowance: 125 } });
  const context = getStudioSubmissionContext(session)!;
  const launch = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'submit', context, payload: launch.review!.payload });
  session = studioTaskReducer(session, { type: 'acknowledge', context, acknowledgement: { status: 'accepted', commandId: 'launch-1', effectiveWeek: 7 } });
  session = studioTaskReducer(session, { type: 'open', task: 'manage-basic-chat', returnTo: { screen: 'products', panel: 'product' } });
  const manage = getActiveStudioTask(session)!;
  assert.equal(manage.task, 'manage-basic-chat');
  assert.equal(manage.owner, 'product');
  assert.equal(manage.draftGeneration, launch.draftGeneration);
  assert.ok(manage.instanceId > launch.instanceId);
  assert.equal(manage.phase, 'editing');
  assert.equal(manage.review, null);
  assert.equal(manage.acknowledgement, null);
  assert.deepEqual(manage.intent, { kind: 'task', task: 'manage-basic-chat' });
  assert.equal(Object.keys(session.tasks).length, 1);
  assert.equal(studioTaskReducer(session, { type: 'acknowledge', context, acknowledgement: { status: 'accepted', commandId: 'late-old-receipt', effectiveWeek: 7 } }), session);
});

test('30D-N09 management review survives ordinary close/reopen as an editable draft, without reverting to launch', () => {
  let session = studioTaskReducer(createStudioTaskSession(), { type: 'open', task: 'manage-basic-chat', returnTo: { screen: 'products', panel: 'product' } });
  const instance = getActiveStudioTask(session)!.instanceId;
  session = studioTaskReducer(session, { type: 'review', sourceRevision: 2, payload: { kind: 'set_product_terms', productId: 'exact-product', priceCents: 1300, allowance: 140 } });
  session = studioTaskReducer(session, { type: 'close' });
  session = studioTaskReducer(session, { type: 'open', task: 'manage-basic-chat', returnTo: { screen: 'products', panel: 'product' } });
  assert.equal(getActiveStudioTask(session)!.task, 'manage-basic-chat');
  assert.equal(getActiveStudioTask(session)!.instanceId, instance);
  assert.equal(getActiveStudioTask(session)!.review, null);
  assert.equal(getStudioSubmissionContext(session), null);
});

test('30D-N10 remaining command owners have retained tasks; read-only workspaces and system replacement do not', () => {
  const owners: StudioPanelId[] = ['research', 'research-programs', 'applied-research', 'synthetic-data', 'release-desk', 'compute',
    'infrastructure', 'chips', 'campus', 'developer-api', 'business-commitments', 'agents', 'business', 'compute-costs', 'capacity-forecast'];
  let session = createStudioTaskSession();
  for (const owner of owners) {
    const task = getStudioTaskForPanel(owner);
    assert.ok(task, owner + ' has an eligible command path');
    session = studioTaskReducer(session, { type: 'open', task, returnTo: { screen: getStudioDestinationForPanel(owner), panel: owner } });
    assert.equal(getActiveStudioTask(session)!.owner, owner);
    session = studioTaskReducer(session, { type: 'close' });
  }
  assert.equal(Object.keys(session.tasks).length, owners.length, 'Each form has a bounded retained owner');
  for (const panel of ['market', 'campaign', 'company-log', 'model-corpus-compare', 'save']) {
    assert.equal(getStudioTaskForPanel(panel), null, panel + ' remains a workspace or system utility');
  }
  const productTasks = Object.values(STUDIO_TASKS).filter(task => task.owner === 'product');
  assert.equal(productTasks.length, 2, 'Launch and management intentionally share one product form');
});
