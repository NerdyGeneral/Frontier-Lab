import test from 'node:test';
import assert from 'node:assert/strict';
import type { CommandPayload } from '../src/contracts/types';
import {
  createStudioEditorSubmission, createStudioTaskSession, getActiveStudioTask, studioTaskReducer,
} from '../src/core/studio-tasks';
import type { StudioTaskSession } from '../src/core/studio-tasks';

const returnTo = { screen: 'studio', panel: null } as const;
const payload: CommandPayload = { kind: 'prepare_data', packetId: 'data-a' };
const open = (session = createStudioTaskSession(3)) => studioTaskReducer(session, { type: 'open', task: 'prepare-data', returnTo });
const capture = (session: StudioTaskSession, choice = payload) => {
  const event = createStudioEditorSubmission(session, { task: 'prepare-data', returnTo, sourceRevision: 6, payload: choice });
  assert.ok(event);
  return event;
};

test('quoted editor captures and submits once without a separately presented review', () => {
  const session = createStudioTaskSession(3);
  const choice = { kind: 'prepare_data', packetId: 'data-a' } as const;
  const event = capture(session, choice);
  assert.notEqual(event.payload, choice, 'Submitted choices are an independent snapshot');
  const pending = studioTaskReducer(session, event);
  const task = getActiveStudioTask(pending)!;
  assert.equal(task.phase, 'submitting');
  assert.equal(task.requestId, event.context.requestId);
  assert.equal(task.review!.sourceRevision, 6);
  assert.deepEqual(task.review!.payload, choice);
  assert.equal(pending.nextRequestId, session.nextRequestId + 1);
  assert.equal(createStudioEditorSubmission(pending, event), null);
  assert.equal(studioTaskReducer(pending, event), pending, 'A rapid second click cannot admit another request');
});

test('retained form and bounded return link survive direct acceptance', () => {
  let session = studioTaskReducer(createStudioTaskSession(3), { type: 'open', task: 'train-model', returnTo });
  session = studioTaskReducer(session, { type: 'detour', destination: { screen: 'studio', panel: 'data' } });
  session = open(session);
  const original = getActiveStudioTask(session)!;
  const event = capture(session);
  const accepted = studioTaskReducer(studioTaskReducer(session, event), {
    type: 'acknowledge', context: event.context, acknowledgement: { status: 'accepted', commandId: 'command-1', effectiveWeek: 4 },
  });
  const task = getActiveStudioTask(accepted)!;
  assert.equal(task.phase, 'queued');
  assert.equal(task.instanceId, original.instanceId);
  assert.equal(task.draftGeneration, original.draftGeneration);
  assert.equal(accepted.detour, session.detour);
  assert.equal(accepted.tasks['lab-projects'], session.tasks['lab-projects']);
  assert.deepEqual(task.review!.payload, payload, 'Inline acknowledgement identifies the submitted choice');
});

test('closing, reopening or retargeting retires a captured editor action', () => {
  const session = open(), event = capture(session);
  const closed = studioTaskReducer(session, { type: 'close' });
  const reopened = open(closed);
  const switched = studioTaskReducer(session, { type: 'open', task: 'hire-staff', returnTo });
  const reset = studioTaskReducer(session, { type: 'resetDraft' });
  const anotherCompany = studioTaskReducer(session, { type: 'resetCompany', companyEpoch: 4 });
  for (const changed of [closed, reopened, switched, reset, anotherCompany]) {
    assert.equal(studioTaskReducer(changed, event), changed, 'Stale events must not recreate an old review or change the active task');
  }
});

test('submission context guards remain enforced for a fresh editor snapshot', () => {
  const session = open(), event = capture(session);
  for (const field of ['companyEpoch', 'taskInstanceId', 'requestId', 'reviewedRevision'] as const) {
    const invalid = { ...event, context: { ...event.context, [field]: event.context[field] + 1 } };
    assert.equal(studioTaskReducer(session, invalid), session);
  }
  assert.equal(studioTaskReducer(session, { ...event, context: { ...event.context, owner: 'people' } }), session);
});

test('a queued editor can schedule another choice without a receipt acknowledgement', () => {
  const session = open(), first = capture(session);
  const accepted = studioTaskReducer(studioTaskReducer(session, first), {
    type: 'acknowledge', context: first.context, acknowledgement: { status: 'accepted', commandId: 'command-1', effectiveWeek: 4 },
  });
  const nextChoice: CommandPayload = { kind: 'prepare_data', packetId: 'data-b' };
  const second = capture(accepted, nextChoice);
  const pending = studioTaskReducer(accepted, second);
  assert.equal(getActiveStudioTask(pending)!.phase, 'submitting');
  assert.equal(second.context.requestId, first.context.requestId + 1);
  assert.deepEqual(getActiveStudioTask(pending)!.review!.payload, nextChoice);
  assert.equal(studioTaskReducer(pending, {
    type: 'acknowledge', context: first.context, acknowledgement: { status: 'accepted', commandId: 'old', effectiveWeek: 4 },
  }), pending, 'An older acknowledgement cannot overwrite the new request');
});

test('rejection returns to the same editor with its reason and no accepted receipt', () => {
  const session = open(), before = getActiveStudioTask(session)!, event = capture(session);
  const rejected = studioTaskReducer(studioTaskReducer(session, event), {
    type: 'acknowledge', context: event.context, acknowledgement: { status: 'rejected', reason: 'Cash changed before scheduling.' },
  });
  const after = getActiveStudioTask(rejected)!;
  assert.equal(after.phase, 'editing');
  assert.equal(after.instanceId, before.instanceId);
  assert.equal(after.draftGeneration, before.draftGeneration);
  assert.equal(after.review, null);
  assert.deepEqual(after.acknowledgement, { status: 'rejected', reason: 'Cash changed before scheduling.' });
});
