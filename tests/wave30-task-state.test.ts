import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { createInitialState } from '../src/core/engine';
import { serializeState } from '../src/core/snapshot';
import { freezeDeep } from '../src/core/canonical';
import {
  STUDIO_PANEL_TITLES, STUDIO_TASKS, createStudioTaskSession, getActiveStudioTask, getStudioSubmissionContext,
  getStudioTaskForPanel, isStudioPanelId, isStudioTaskId, isStudioTaskReviewCurrent, resolveStudioIntent,
  studioPayloadSignature, studioTaskReducer,
} from '../src/core/studio-tasks';
import type { StudioIntent, StudioReturnTarget, StudioTaskId, StudioTaskSession } from '../src/core/studio-tasks';
import { fixtureState } from './fixtures/wave25-studio';

const home: StudioReturnTarget = { screen: 'studio', panel: null, focusId: 'studio-training-station' };
const resources: StudioReturnTarget = { screen: 'projects', panel: null, projectTab: 'plan', focusId: 'studio-plan-workbench' };
const preparation: CommandPayload = { kind: 'prepare_data', packetId: CONTENT.starterData.id };

function open(task: StudioTaskId = 'prepare-data', session = createStudioTaskSession(7)): StudioTaskSession {
  return studioTaskReducer(session, { type: 'open', task, returnTo: home });
}
function reviewed(session = open(), payload = preparation, revision = 10): StudioTaskSession {
  return studioTaskReducer(session, { type: 'review', sourceRevision: revision, payload });
}
function submitting(session = reviewed()) {
  const context = getStudioSubmissionContext(session);
  assert.ok(context);
  const payload = getActiveStudioTask(session)!.review!.payload;
  return { context, session: studioTaskReducer(session, { type: 'submit', context, payload }) };
}

let published: GameState | undefined;
function multipleCandidates(): GameState {
  published ??= fixtureState('wave16-snapshot.json');
  return structuredClone(published);
}

test('W30-T01: named task registry maps each task to one retained owner and rejects unknown anchors', () => {
  assert.equal(Object.keys(STUDIO_TASKS).length, 30);
  assert.equal(new Set(Object.values(STUDIO_TASKS).map(task => task.owner)).size, 24);
  assert.equal(getStudioTaskForPanel('customer-briefs'), 'customer-brief');
  assert.deepEqual(Object.entries(STUDIO_TASKS).filter(([, task]) => task.owner === 'product').map(([id]) => id), ['launch-basic-chat', 'manage-basic-chat']);
  assert.deepEqual(Object.entries(STUDIO_TASKS).filter(([, task]) => task.owner === 'research').map(([id]) => id), ['research-method']);
  assert.deepEqual(Object.entries(STUDIO_TASKS).filter(([, task]) => task.owner === 'research-programs').map(([id]) => id), ['research-program', 'architecture-research']);
  assert.deepEqual(STUDIO_TASKS['architecture-research'], { owner: 'research-programs', title: 'Architecture research', pauseOnEntry: true });
  assert.deepEqual(STUDIO_TASKS['development-plan'], { owner: 'development-plans', title: 'Develop a model · delegated', pauseOnEntry: true });
  assert.deepEqual(STUDIO_TASKS['model-challenge'], { owner: 'model-challenges', title: 'Run a research challenge', pauseOnEntry: true });
  for (const [id, task] of Object.entries(STUDIO_TASKS)) {
    assert.ok(task.title.trim());
    assert.equal(task.pauseOnEntry, true);
    const defaultTask = task.owner === 'product' ? 'launch-basic-chat' : task.owner === 'people' ? 'staffing' : task.owner === 'compute' ? 'compute-decision' : task.owner === 'research' ? 'research-method' : task.owner === 'research-programs' ? 'research-program' : id;
    assert.equal(getStudioTaskForPanel(task.owner), defaultTask);
    assert.equal(isStudioTaskId(id), true);
  }
  for (const panel of Object.keys(STUDIO_PANEL_TITLES)) assert.equal(isStudioPanelId(panel), true);
  for (const value of ['constructor', '__proto__', 'toString', 'unknown', '']) {
    assert.equal(isStudioPanelId(value), false);
    assert.equal(isStudioTaskId(value), false);
    assert.equal(getStudioTaskForPanel(value), null);
  }
  assert.equal(getStudioTaskForPanel('product'), 'launch-basic-chat', '30B registers the ordinary first Basic Chat launch form');
  const game = createInitialState(CONTENT, 'release');
  assert.deepEqual(resolveStudioIntent(game, { kind: 'task', task: 'architecture-research' }), {
    ok: true, panel: 'research-programs', task: 'architecture-research',
  });
  for (const [task, owner, payload] of [
    ['development-plan', 'development-plans', { kind: 'set_development_plan_paused', planId: 'development-owned', paused: true }],
    ['model-challenge', 'model-challenges', { kind: 'evaluate_model', modelId: 'model-owned', suiteId: 'challenge-applied-1' }],
  ] as const) {
    assert.deepEqual(resolveStudioIntent(game, { kind: 'task', task }), { ok: true, panel: owner, task });
    const session = reviewed(open(task), payload, game.revision);
    assert.equal(getActiveStudioTask(session)!.owner, owner);
    assert.deepEqual(getActiveStudioTask(session)!.review!.payload, payload);
    assert.equal(getStudioSubmissionContext(session)!.owner, owner);
  }
  const architecture = reviewed(open('architecture-research'), { kind: 'start_model_research' }, game.revision);
  assert.equal(getActiveStudioTask(architecture)!.owner, 'research-programs');
  assert.deepEqual(getActiveStudioTask(architecture)!.review!.payload, { kind: 'start_model_research' });
  assert.equal(getStudioSubmissionContext(architecture)!.owner, 'research-programs');
  const paused = reviewed(open('architecture-research'), { kind: 'set_model_research_paused', projectId: 'model-research-owned', paused: true }, game.revision);
  assert.deepEqual(getActiveStudioTask(paused)!.review!.payload, { kind: 'set_model_research_paused', projectId: 'model-research-owned', paused: true });
});

test('W30-T02: an older training result resolves its exact output while newer candidates exist', () => {
  const game = multipleCandidates();
  const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === game.playerCompanyId && run.status === 'complete')
    .sort((a, b) => a.completedWeek! - b.completedWeek!);
  assert.ok(runs.length > 1);
  assert.notEqual(runs[0].outputModelId, runs.at(-1)!.outputModelId);
  const before = serializeState(game);
  freezeDeep(game);
  assert.deepEqual(resolveStudioIntent(game, { kind: 'training-result', runId: runs[0].id }), {
    ok: true, panel: 'models', target: { kind: 'training-result', runId: runs[0].id, modelId: runs[0].outputModelId },
  });
  assert.equal(serializeState(game), before, 'resolving a result must not advance or rewrite the lab');
});

test('W30-T03: reports carry their actual model and suite; releases carry both selected entities', () => {
  const game = multipleCandidates();
  const report = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId && item.suiteId === 'expanded-capabilities-1')!;
  const product = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId)!;
  assert.ok(report);
  assert.ok(product);
  assert.deepEqual(resolveStudioIntent(game, { kind: 'report', reportId: report.id }), {
    ok: true, panel: 'models', target: { kind: 'report', reportId: report.id, modelId: report.modelId, suiteId: report.suiteId },
  });
  assert.deepEqual(resolveStudioIntent(game, { kind: 'product-candidate', productId: product.id, candidateId: report.modelId }), {
    ok: true, panel: 'release-desk', target: { kind: 'product-candidate', productId: product.id, candidateId: report.modelId },
  });
  assert.deepEqual(resolveStudioIntent(game, { kind: 'task', task: 'plan-week' }), { ok: true, panel: 'planner', task: 'plan-week' });
  assert.deepEqual(resolveStudioIntent(game, { kind: 'panel', panel: 'models' }), { ok: true, panel: 'models' });
});

test('W30-T04: missing, foreign and unfinished result targets never fall back to another model', () => {
  const base = multipleCandidates();
  const run = Object.values(base.slices.models.trainingRuns).find(item => item.companyId === base.playerCompanyId && item.status === 'complete')!;
  const report = Object.values(base.slices.models.reports).find(item => item.companyId === base.playerCompanyId && item.modelId === run.outputModelId)!;
  const product = Object.values(base.slices.products.offers).find(item => item.companyId === base.playerCompanyId)!;
  const intents: StudioIntent[] = [
    { kind: 'model', modelId: run.outputModelId }, { kind: 'report', reportId: report.id },
    { kind: 'training-result', runId: run.id },
    { kind: 'product-candidate', productId: product.id, candidateId: run.outputModelId },
  ];
  for (const disposition of ['missing', 'foreign'] as const) {
    const game = structuredClone(base);
    if (disposition === 'missing') delete game.slices.models.versions[run.outputModelId];
    else game.slices.models.versions[run.outputModelId].companyId = 'another-company';
    for (const intent of intents) {
      const resolved = resolveStudioIntent(game, intent);
      assert.equal(resolved.ok, false, disposition + ': ' + intent.kind);
      if (!resolved.ok) assert.match(resolved.reason, /unavailable/);
    }
  }
  const unfinished = structuredClone(base);
  unfinished.slices.models.trainingRuns[run.id].status = 'running';
  assert.deepEqual(resolveStudioIntent(unfinished, { kind: 'training-result', runId: run.id }), {
    ok: false, reason: 'This training run has not produced a completed output yet.',
  });
  const foreign = structuredClone(base);
  foreign.slices.models.trainingRuns[run.id].companyId = 'another-company';
  foreign.slices.models.reports[report.id].companyId = 'another-company';
  foreign.slices.products.offers[product.id].companyId = 'another-company';
  for (const intent of intents.slice(1)) assert.equal(resolveStudioIntent(foreign, intent).ok, false);
  for (const intent of [
    { kind: 'model', modelId: 'missing' }, { kind: 'report', reportId: 'missing' },
    { kind: 'training-result', runId: 'missing' }, { kind: 'product-candidate', productId: 'missing', candidateId: run.outputModelId },
  ] as StudioIntent[]) assert.equal(resolveStudioIntent(base, intent).ok, false);
});

test('W30-T05: close and reopen preserve the draft owner but require a fresh review before submission', () => {
  let session = open('train-model');
  const original = getActiveStudioTask(session)!;
  session = reviewed(session, { kind: 'start_training', baseModelId: 'model-a', packetId: 'packet-a' });
  const record = getActiveStudioTask(session)!;
  const oldContext = getStudioSubmissionContext(session)!;
  session = studioTaskReducer(session, { type: 'close' });
  assert.equal(getActiveStudioTask(session), null);
  assert.equal(session.tasks['lab-projects']!.instanceId, record.instanceId, 'close keeps the retained form owner');
  assert.equal(session.tasks['lab-projects']!.draftGeneration, record.draftGeneration, 'close does not remount the fields');
  assert.equal(session.tasks['lab-projects']!.phase, 'editing');
  assert.equal(session.tasks['lab-projects']!.review, null, 'inline edits after close cannot reuse the captured payload');
  assert.equal(getStudioSubmissionContext(session), null);
  session = open('train-model', session);
  assert.equal(getActiveStudioTask(session)!.instanceId, original.instanceId);
  assert.equal(getActiveStudioTask(session)!.phase, 'editing');
  assert.equal(getActiveStudioTask(session)!.draftGeneration, 0);
  assert.equal(getStudioSubmissionContext(session), null, 'reopening at the same game revision still requires a fresh review');
  assert.equal(studioTaskReducer(session, { type: 'submit', context: oldContext, payload: record.review!.payload }), session);
  session = reviewed(session, { kind: 'start_training', baseModelId: 'model-a', packetId: 'packet-b' });
  assert.ok(getStudioSubmissionContext(session));
  session = studioTaskReducer(session, { type: 'back' });
  assert.equal(getActiveStudioTask(session)!.phase, 'editing');
  assert.equal(getActiveStudioTask(session)!.review, null);
  assert.equal(getActiveStudioTask(session)!.instanceId, original.instanceId);
  assert.deepEqual(getActiveStudioTask(session)!.returnTo, home);
  assert.equal(getActiveStudioTask(session)!.draftGeneration, 0);
});

test('W30-T06: one active task retains other owners; reset remounts only the requested draft', () => {
  let session = open('train-model');
  const training = getActiveStudioTask(session)!;
  session = open('prepare-data', session);
  assert.equal(session.activeOwner, 'data');
  assert.equal(session.tasks['lab-projects'], training);
  session = studioTaskReducer(session, { type: 'resetDraft' });
  assert.equal(session.tasks.data!.draftGeneration, 1);
  assert.equal(session.tasks['lab-projects'], training);
  const data = session.tasks.data;
  session = studioTaskReducer(session, { type: 'resetDraft', owner: 'lab-projects' });
  assert.equal(session.tasks['lab-projects']!.draftGeneration, 1);
  assert.notEqual(session.tasks['lab-projects']!.instanceId, training.instanceId);
  assert.equal(session.tasks.data, data);
  assert.equal(session.activeOwner, 'data');
  assert.equal(Object.keys(session.tasks).length, 2);
});

test('W30-T07: an explicit entity intent invalidates review without remounting the form', () => {
  let session = reviewed(open('evaluate-model'), { kind: 'evaluate_model', modelId: 'candidate-a' });
  const before = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'open', task: 'evaluate-model', intent: { kind: 'model', modelId: 'candidate-b' }, returnTo: home });
  const next = getActiveStudioTask(session)!;
  assert.deepEqual(next.intent, { kind: 'model', modelId: 'candidate-b' });
  assert.equal(next.phase, 'editing');
  assert.equal(next.review, null);
  assert.equal(next.draftGeneration, before.draftGeneration);
  assert.notEqual(next.instanceId, before.instanceId);
  const incompatible = studioTaskReducer(session, { type: 'open', task: 'train-model', intent: { kind: 'report', reportId: 'report-a' }, returnTo: home });
  assert.equal(incompatible, session, 'an exact report cannot be quietly routed into the training owner');
});

test('W30-T08: review snapshots survive external edits and require both current revision and exact payload', () => {
  const payload: CommandPayload = { kind: 'start_training', baseModelId: 'base-a', packetId: 'data-a', packetIds: ['data-a', 'data-b'] };
  const session = reviewed(open('train-model'), payload, 42), task = getActiveStudioTask(session)!;
  assert.equal(isStudioTaskReviewCurrent(task, 42, payload), true);
  assert.equal(isStudioTaskReviewCurrent(task, 43, payload), false);
  assert.equal(isStudioTaskReviewCurrent(task, 42, { ...payload, baseModelId: 'base-b' }), false);
  assert.equal(studioPayloadSignature(payload), studioPayloadSignature({ packetIds: ['data-a', 'data-b'], packetId: 'data-a', baseModelId: 'base-a', kind: 'start_training' }));
  payload.packetIds!.push('unreviewed-data');
  assert.equal(isStudioTaskReviewCurrent(task, 42, payload), false);
  assert.deepEqual((task.review!.payload as Extract<CommandPayload, { kind: 'start_training' }>).packetIds, ['data-a', 'data-b']);
  assert.equal(isStudioTaskReviewCurrent(task, 42), true, 'the captured review still identifies its original payload');
});

test('W30-T09: rapid repeated submission admits one request and cannot close or replace it before acknowledgement', () => {
  const ready = reviewed(), context = getStudioSubmissionContext(ready)!;
  const pending = studioTaskReducer(ready, { type: 'submit', context, payload: preparation });
  assert.equal(getActiveStudioTask(pending)!.phase, 'submitting');
  assert.equal(pending.nextRequestId, ready.nextRequestId + 1);
  assert.equal(getStudioSubmissionContext(pending), null);
  for (const event of [
    { type: 'submit', context, payload: preparation }, { type: 'close' }, { type: 'back' },
    { type: 'edit' }, { type: 'resetDraft' }, { type: 'detour', destination: resources },
    { type: 'open', task: 'train-model', returnTo: home },
  ] as const) assert.equal(studioTaskReducer(pending, event), pending);
  const changed = { ...preparation, packetId: 'unreviewed' };
  assert.equal(studioTaskReducer(ready, { type: 'submit', context, payload: changed }), ready);
  assert.equal(studioTaskReducer(ready, { type: 'submit', context: { ...context, reviewedRevision: 9 }, payload: preparation }), ready);
});

test('W30-T10: acceptance records a queued receipt; wrong and duplicate acknowledgements cannot overwrite it', () => {
  const { session, context } = submitting();
  const accepted = { status: 'accepted', commandId: 'command-41', effectiveWeek: 8 } as const;
  for (const incorrect of [
    { ...context, companyEpoch: context.companyEpoch + 1 },
    { ...context, taskInstanceId: context.taskInstanceId + 1 },
    { ...context, requestId: context.requestId + 1 },
    { ...context, reviewedRevision: context.reviewedRevision + 1 },
  ]) assert.equal(studioTaskReducer(session, { type: 'acknowledge', context: incorrect, acknowledgement: accepted }), session);
  const queued = studioTaskReducer(session, { type: 'acknowledge', context, acknowledgement: accepted });
  const task = getActiveStudioTask(queued)!;
  assert.equal(task.phase, 'queued');
  assert.equal(task.requestId, null);
  assert.deepEqual(task.acknowledgement, accepted);
  assert.equal(task.draftGeneration, 0);
  assert.equal(studioTaskReducer(queued, { type: 'acknowledge', context, acknowledgement: { status: 'rejected', reason: 'late duplicate' } }), queued);
});

test('W30-T11: rejected and cancelled requests release busy state, retain owner and require fresh review', () => {
  for (const status of ['rejected', 'cancelled'] as const) {
    const { session, context } = submitting();
    const original = getActiveStudioTask(session)!;
    const outcome = { status, reason: status === 'cancelled' ? 'The page was hidden.' : 'The commitment changed.' };
    const finished = studioTaskReducer(session, { type: 'acknowledge', context, acknowledgement: outcome });
    const task = getActiveStudioTask(finished)!;
    assert.equal(task.phase, 'editing');
    assert.equal(task.review, null);
    assert.equal(task.requestId, null);
    assert.deepEqual(task.acknowledgement, outcome);
    assert.equal(task.instanceId, original.instanceId);
    assert.equal(task.draftGeneration, original.draftGeneration);
    assert.deepEqual(task.returnTo, original.returnTo);
    assert.equal(getStudioSubmissionContext(finished), null);
    assert.equal(getActiveStudioTask(studioTaskReducer(finished, { type: 'close' })), null);
    const next = reviewed(finished);
    assert.ok(getStudioSubmissionContext(next)!.requestId > context.requestId);
  }
});

test('W30-T12: resource detour retains the parent and returns after a helper without creating a modal stack', () => {
  let session = reviewed(open('train-model'), { kind: 'start_training', baseModelId: 'base-a', packetId: 'data-a' });
  const parent = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'detour', destination: resources });
  assert.equal(getActiveStudioTask(session), null);
  assert.deepEqual(session.detour, { owner: 'lab-projects', taskInstanceId: parent.instanceId, destination: resources });
  assert.equal(session.tasks['lab-projects']!.review, null, 'return requires refreshed commitment review');
  assert.equal(session.tasks['lab-projects']!.draftGeneration, parent.draftGeneration);
  session = studioTaskReducer(session, { type: 'open', task: 'plan-week', returnTo: resources });
  const planner = getActiveStudioTask(session)!;
  assert.equal(session.activeOwner, 'planner');
  assert.equal(studioTaskReducer(session, { type: 'detour', destination: home }), session, 'only one bounded parent link exists');
  session = studioTaskReducer(session, { type: 'return' });
  assert.equal(session.activeOwner, 'lab-projects');
  assert.equal(session.detour, null);
  assert.equal(getActiveStudioTask(session)!.instanceId, parent.instanceId);
  assert.deepEqual(getActiveStudioTask(session)!.returnTo, home);
  assert.equal(session.tasks.planner, planner, 'the helper also retains its existing owner');
});

test('W30-T13: accepted company replacement clears all task metadata even when deterministic IDs repeat', () => {
  const first = createInitialState(CONTENT, 'release'), second = createInitialState(CONTENT, 'release');
  assert.equal(first.playerCompanyId, second.playerCompanyId);
  assert.equal(first.nextId, second.nextId);
  let session = reviewed(open('train-model'), { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id });
  session = studioTaskReducer(session, { type: 'detour', destination: resources });
  session = open('prepare-data', session);
  const pending = submitting(reviewed(session));
  session = studioTaskReducer(pending.session, { type: 'resetCompany', companyEpoch: pending.session.companyEpoch + 1 });
  assert.deepEqual(session.tasks, {});
  assert.equal(session.activeOwner, null);
  assert.equal(session.detour, null);
  session = reviewed(open('prepare-data', session));
  const replacement = submitting(session);
  assert.notEqual(replacement.context.taskInstanceId, pending.context.taskInstanceId);
  assert.equal(studioTaskReducer(replacement.session, { type: 'acknowledge', context: pending.context,
    acknowledgement: { status: 'accepted', commandId: 'old-command', effectiveWeek: 1 } }), replacement.session);
});

test('W30-T14: explicit draft reset and reused epoch cannot revive an old asynchronous receipt', () => {
  const old = submitting();
  const cancelled = studioTaskReducer(old.session, { type: 'acknowledge', context: old.context,
    acknowledgement: { status: 'cancelled', reason: 'No work started.' } });
  const reset = studioTaskReducer(cancelled, { type: 'resetDraft' });
  const next = submitting(reviewed(reset));
  assert.notEqual(next.context.taskInstanceId, old.context.taskInstanceId);
  assert.equal(studioTaskReducer(next.session, { type: 'acknowledge', context: old.context,
    acknowledgement: { status: 'accepted', commandId: 'old-command', effectiveWeek: 1 } }), next.session);
  const resetEpoch = studioTaskReducer(next.session, { type: 'resetCompany', companyEpoch: next.session.companyEpoch });
  const reused = submitting(reviewed(open('prepare-data', resetEpoch)));
  assert.notEqual(reused.context.taskInstanceId, next.context.taskInstanceId);
  assert.ok(reused.context.requestId > next.context.requestId);
});

test('W30-T15: navigation, draft lifecycle and result review leave authoritative state byte-for-byte unchanged', () => {
  const game = createInitialState(CONTENT, 'release'), saved = serializeState(game);
  freezeDeep(game);
  let session = open('prepare-data');
  freezeDeep(session);
  for (const intent of [{ kind: 'panel', panel: 'data' }, { kind: 'task', task: 'train-model' },
    { kind: 'model', modelId: CONTENT.seedModel.id }] as const) assert.equal(resolveStudioIntent(game, intent).ok, true);
  session = reviewed(session, preparation, game.revision);
  session = studioTaskReducer(session, { type: 'back' });
  session = studioTaskReducer(session, { type: 'close' });
  session = open('prepare-data', session);
  session = studioTaskReducer(session, { type: 'detour', destination: resources });
  session = studioTaskReducer(session, { type: 'return' });
  session = studioTaskReducer(session, { type: 'resetDraft' });
  assert.equal(session.tasks.data!.draftGeneration, 1);
  assert.equal(serializeState(game), saved);
});

test('W30-T16: returning from a child task waits for its acknowledgement and preserves both retained owners', () => {
  let session = open('train-model');
  const parent = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'detour', destination: resources });
  session = open('plan-week', session);
  session = reviewed(session, { kind: 'apply_studio_plan', commands: [{ kind: 'set_cloud_capacity', cu: 8_000_000_000 }] });
  const child = submitting(session);
  assert.equal(studioTaskReducer(child.session, { type: 'return' }), child.session, 'return cannot strand the child request');
  session = studioTaskReducer(child.session, { type: 'acknowledge', context: child.context,
    acknowledgement: { status: 'cancelled', reason: 'The page was hidden before this plan started.' } });
  const retainedChild = session.tasks.planner;
  session = studioTaskReducer(session, { type: 'return' });
  assert.equal(session.activeOwner, parent.owner);
  assert.equal(session.tasks['lab-projects'], parent);
  assert.equal(session.tasks.planner, retainedChild);
  assert.equal(session.detour, null);
});


test('continuing from an older saved version opens that exact training draft without scheduling it', () => {
  const game = multipleCandidates();
  const completed = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === game.playerCompanyId && run.status === 'complete')
    .sort((a, b) => a.startedWeek - b.startedWeek);
  const older = completed[0].outputModelId, newer = completed.at(-1)!.outputModelId;
  assert.notEqual(older, newer);
  const intent = { kind: 'training-base', baseModelId: older } as const;
  const specialOutputs = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId
    && (model.runtimeVariant || model.trainingRunId && game.slices.models.trainingRuns[model.trainingRunId]?.plan?.adapter));
  assert.ok(specialOutputs.some(model => model.runtimeVariant));
  assert.ok(specialOutputs.some(model => model.trainingRunId && game.slices.models.trainingRuns[model.trainingRunId]?.plan?.adapter));
  for (const model of specialOutputs) {
    assert.equal(resolveStudioIntent(game, { kind: 'training-base', baseModelId: model.id }).ok, false);
  }
  const saved = serializeState(game);
  assert.deepEqual(resolveStudioIntent(game, intent), { ok: true, panel: 'lab-projects', task: 'train-model', target: intent });
  const session = studioTaskReducer(createStudioTaskSession(1), { type: 'open', task: 'train-model', intent, returnTo: home });
  assert.deepEqual(getActiveStudioTask(session)?.intent, intent);
  assert.equal(getActiveStudioTask(session)?.phase, 'editing');
  assert.equal(getStudioSubmissionContext(session), null);
  assert.equal(serializeState(game), saved);
  delete game.slices.models.versions[older];
  assert.equal(resolveStudioIntent(game, intent).ok, false);
  assert.ok(game.slices.models.versions[newer]);
  game.slices.models.versions[newer].companyId = 'other';
  assert.equal(resolveStudioIntent(game, { kind: 'training-base', baseModelId: newer }).ok, false);
});
