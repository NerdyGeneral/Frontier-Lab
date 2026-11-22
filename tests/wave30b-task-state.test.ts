import test from 'node:test';
import assert from 'node:assert/strict';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { createInitialState } from '../src/core/engine';
import { canonicalStringify, freezeDeep } from '../src/core/canonical';
import {
  createStudioTaskSession, getActiveStudioTask, getStudioSubmissionContext, isStudioTaskReviewCurrent,
  resolveStudioIntent, studioTaskReducer,
} from '../src/core/studio-tasks';
import type { StudioIntent, StudioReturnTarget, StudioTaskSession } from '../src/core/studio-tasks';
import { fixtureState } from './fixtures/wave25-studio';

const home: StudioReturnTarget = { screen: 'studio', panel: null, focusId: 'studio-training-station' };
const data: StudioReturnTarget = { screen: 'studio', panel: 'data' };
const resources: StudioReturnTarget = { screen: 'projects', panel: null, projectTab: 'plan', focusId: 'studio-plan-workbench' };
const training: CommandPayload = { kind: 'start_training', baseModelId: 'base-a', packetId: 'packet-b', recipeId: 'adapt-conversation', profile: 'balanced' };
const preparation: CommandPayload = { kind: 'prepare_data', packetId: 'packet-b' };
const launch: CommandPayload = { kind: 'deploy_product', productKind: 'basic-chat', modelId: 'candidate-older', priceCents: 1375, allowance: 175 };
const launchIntent: StudioIntent = { kind: 'first-launch', candidateId: 'candidate-older', reportId: 'report-older' };

function review(session: StudioTaskSession, payload: CommandPayload, revision = 31) {
  return studioTaskReducer(session, { type: 'review', sourceRevision: revision, payload });
}

function parentAndChild() {
  let session = studioTaskReducer(createStudioTaskSession(4), { type: 'open', task: 'train-model', intent: { kind: 'training-data', packetId: 'packet-b' }, returnTo: home });
  session = review(session, training);
  const parent = getActiveStudioTask(session)!;
  const priorContext = getStudioSubmissionContext(session)!;
  session = studioTaskReducer(session, { type: 'detour', destination: data });
  session = studioTaskReducer(session, { type: 'open', task: 'prepare-data', intent: { kind: 'data', packetId: 'packet-b' }, returnTo: data });
  return { session, parent, priorContext };
}

let published: GameState | undefined;
function multipleCandidates(): GameState {
  published ??= fixtureState('wave16-snapshot.json');
  return structuredClone(published);
}

function olderResult(game: GameState) {
  const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === game.playerCompanyId && run.status === 'complete')
    .sort((a, b) => (a.completedWeek ?? a.startedWeek) - (b.completedWeek ?? b.startedWeek));
  assert.ok(runs.length > 1);
  const run = runs[0];
  assert.notEqual(run.outputModelId, runs.at(-1)!.outputModelId);
  const report = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId && item.modelId === run.outputModelId);
  assert.ok(report);
  return { run, report };
}

test('W30B-T01: preparation and training-data intents resolve the exact owned dataset without selecting another packet', () => {
  const game = createInitialState();
  game.slices.data.packets['packet-b'] = { ...structuredClone(CONTENT.starterData), id: 'packet-b', name: 'Selected dataset B', companyId: game.playerCompanyId };
  const before = canonicalStringify(game);
  freezeDeep(game);
  for (const kind of ['data', 'training-data'] as const) {
    assert.deepEqual(resolveStudioIntent(game, { kind, packetId: 'packet-b' }), {
      ok: true, panel: kind === 'data' ? 'data' : 'lab-projects', task: kind === 'data' ? 'prepare-data' : 'train-model',
      target: { kind, packetId: 'packet-b' },
    });
    assert.equal(resolveStudioIntent(game, { kind, packetId: 'missing' }).ok, false);
  }
  assert.equal(canonicalStringify(game), before);
});

test('W30B-T02: data intents reject foreign and unowned nonstarter packets, retaining the authored starter exception', () => {
  for (const kind of ['data', 'training-data'] as const) {
    for (const disposition of ['foreign', 'unowned'] as const) {
      const game = createInitialState();
      const packet = { ...structuredClone(CONTENT.starterData), id: 'packet-b', companyId: disposition === 'foreign' ? 'another-company' : undefined };
      game.slices.data.packets[packet.id] = packet;
      const result = resolveStudioIntent(game, { kind, packetId: packet.id });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /Choose another dataset/);
    }
    const game = createInitialState();
    delete game.slices.data.packets[CONTENT.starterData.id].companyId;
    assert.equal(resolveStudioIntent(game, { kind, packetId: CONTENT.starterData.id }).ok, true);
    game.slices.data.packets[CONTENT.starterData.id].companyId = 'another-company';
    assert.equal(resolveStudioIntent(game, { kind, packetId: CONTENT.starterData.id }).ok, false);
  }
});

test('W30B-T03: the older training output and its report remain the exact first-launch target', () => {
  const game = multipleCandidates(), { run, report } = olderResult(game);
  for (const product of Object.values(game.slices.products.offers)) if (product.companyId === game.playerCompanyId && product.kind === 'basic-chat') delete game.slices.products.offers[product.id];
  const before = canonicalStringify(game);
  freezeDeep(game);
  assert.deepEqual(resolveStudioIntent(game, { kind: 'first-launch', candidateId: run.outputModelId, reportId: report.id }), {
    ok: true, panel: 'product', task: 'launch-basic-chat', target: { kind: 'first-launch', modelId: run.outputModelId, reportId: report.id },
  });
  assert.equal(canonicalStringify(game), before);
});

test('W30B-T04: missing or foreign candidates and missing, foreign or mismatched launch reports are explicit failures', () => {
  const base = multipleCandidates(), { run, report } = olderResult(base);
  for (const disposition of ['missing-model', 'foreign-model', 'missing-report', 'foreign-report', 'mismatched-report']) {
    const game = structuredClone(base);
    if (disposition === 'missing-model') delete game.slices.models.versions[run.outputModelId];
    if (disposition === 'foreign-model') game.slices.models.versions[run.outputModelId].companyId = 'another-company';
    if (disposition === 'missing-report') delete game.slices.models.reports[report.id];
    if (disposition === 'foreign-report') game.slices.models.reports[report.id].companyId = 'another-company';
    if (disposition === 'mismatched-report') game.slices.models.reports[report.id].modelId = CONTENT.seedModel.id;
    const result = resolveStudioIntent(game, { kind: 'first-launch', candidateId: run.outputModelId, reportId: report.id });
    assert.equal(result.ok, false, disposition);
    if (!result.ok) assert.match(result.reason, /unavailable/);
  }
});

test('W30B-T05: an existing Basic Chat returns its product identity while retaining the intended candidate and report', () => {
  const game = multipleCandidates(), { run, report } = olderResult(game);
  const product = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId && item.kind === 'basic-chat');
  assert.ok(product);
  assert.deepEqual(resolveStudioIntent(game, { kind: 'first-launch', candidateId: run.outputModelId, reportId: report.id }), {
    ok: true, panel: 'product', task: 'launch-basic-chat', target: { kind: 'first-launch', modelId: run.outputModelId, reportId: report.id, existingProductId: product.id },
  });
});

test('W30B-T06: exact data, training-data and first-launch intents cannot be assigned to another retained owner', () => {
  const cases = [
    { task: 'prepare-data', intent: { kind: 'data', packetId: 'packet-b' } },
    { task: 'train-model', intent: { kind: 'training-data', packetId: 'packet-b' } },
    { task: 'launch-basic-chat', intent: launchIntent },
  ] as const;
  for (const item of cases) {
    const session = studioTaskReducer(createStudioTaskSession(), { type: 'open', ...item, returnTo: home });
    assert.deepEqual(getActiveStudioTask(session)!.intent, item.intent);
    assert.equal(getActiveStudioTask(session)!.task, item.task);
    assert.equal(studioTaskReducer(session, { type: 'open', task: 'evaluate-model', intent: item.intent, returnTo: home }), session);
  }
});

test('W30B-T07: the data helper can visit resources without replacing the training parent or its selected dataset', () => {
  const { parent, priorContext, session: initial } = parentAndChild();
  let session = review(initial, preparation);
  const child = getActiveStudioTask(session)!;
  assert.equal(session.detour!.owner, 'lab-projects');
  assert.equal(session.detour!.taskInstanceId, parent.instanceId);
  assert.equal(session.tasks['lab-projects']!.review, null, 'Leaving parent review requires a fresh commitment');
  // The shell closes the helper before showing resources; a second detour may
  // never replace the single original return target.
  assert.equal(studioTaskReducer(session, { type: 'detour', destination: resources }), session);
  session = studioTaskReducer(session, { type: 'close' });
  assert.equal(session.activeOwner, null);
  assert.equal(session.detour!.owner, 'lab-projects');
  assert.equal(session.tasks.data!.draftGeneration, child.draftGeneration);
  assert.equal(session.tasks.data!.review, null);
  session = studioTaskReducer(session, { type: 'return' });
  const returned = getActiveStudioTask(session)!;
  assert.equal(returned.owner, 'lab-projects');
  assert.equal(returned.instanceId, parent.instanceId);
  assert.equal(returned.draftGeneration, parent.draftGeneration);
  assert.deepEqual(returned.intent, { kind: 'training-data', packetId: 'packet-b' });
  assert.deepEqual(returned.returnTo, home);
  assert.equal(returned.phase, 'editing');
  assert.equal(session.detour, null);
  assert.equal(getStudioSubmissionContext(session), null);
  assert.equal(studioTaskReducer(session, { type: 'submit', context: priorContext, payload: training }), session);
  session = review(session, training, 32);
  assert.equal(isStudioTaskReviewCurrent(getActiveStudioTask(session), 32, training), true);
  assert.equal(studioTaskReducer(session, { type: 'submit', context: priorContext, payload: training }), session);
});

test('W30B-T08: returning directly from child review invalidates that review without resetting either form', () => {
  let { session } = parentAndChild();
  session = review(session, preparation);
  const child = getActiveStudioTask(session)!;
  const oldContext = getStudioSubmissionContext(session)!;
  session = studioTaskReducer(session, { type: 'return' });
  assert.equal(session.activeOwner, 'lab-projects');
  assert.equal(session.tasks.data!.phase, 'editing', 'Returning can expose this child inline later; stale captured payload must be discarded');
  assert.equal(session.tasks.data!.review, null);
  assert.equal(session.tasks.data!.draftGeneration, child.draftGeneration);
  assert.equal(session.tasks.data!.instanceId, child.instanceId);
  session = studioTaskReducer(session, { type: 'close' });
  session = studioTaskReducer(session, { type: 'open', task: 'prepare-data', returnTo: home });
  assert.equal(getStudioSubmissionContext(session), null);
  assert.equal(studioTaskReducer(session, { type: 'submit', context: oldContext, payload: preparation }), session);
});

test('W30B-T09: rejected and cancelled launch submissions preserve candidate identity and the retained terms form', () => {
  for (const status of ['rejected', 'cancelled'] as const) {
    let session = studioTaskReducer(createStudioTaskSession(9), { type: 'open', task: 'launch-basic-chat', intent: launchIntent, returnTo: home });
    session = review(session, launch);
    const reviewed = getActiveStudioTask(session)!, context = getStudioSubmissionContext(session)!;
    session = studioTaskReducer(session, { type: 'submit', context, payload: launch });
    const pending = session;
    assert.equal(studioTaskReducer(pending, { type: 'submit', context, payload: launch }), pending);
    session = studioTaskReducer(session, { type: 'acknowledge', context, acknowledgement: { status, reason: 'The current commitment needs review.' } });
    const retained = getActiveStudioTask(session)!;
    assert.equal(retained.phase, 'editing');
    assert.equal(retained.instanceId, reviewed.instanceId);
    assert.equal(retained.draftGeneration, reviewed.draftGeneration, 'Terms fields remain owned by the same mounted form');
    assert.deepEqual(retained.intent, launchIntent);
    assert.deepEqual(retained.acknowledgement, { status, reason: 'The current commitment needs review.' });
    assert.equal(retained.review, null);
    assert.equal(getStudioSubmissionContext(session), null);
    assert.deepEqual(reviewed.review!.payload, launch, 'The captured terms were not rewritten by rejection');
    assert.equal(studioTaskReducer(session, { type: 'acknowledge', context, acknowledgement: { status: 'accepted', commandId: 'late-duplicate', effectiveWeek: 20 } }), session);
  }
});
