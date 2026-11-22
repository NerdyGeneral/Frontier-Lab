import test from 'node:test';
import assert from 'node:assert/strict';
import type { CommandPayload } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState } from '../src/core/engine';
import { serializeState } from '../src/core/snapshot';
import {
  STUDIO_TASKS, createStudioTaskSession, getActiveStudioTask, getStudioSubmissionContext,
  resolveStudioIntent, studioTaskReducer,
} from '../src/core/studio-tasks';
import type { StudioReturnTarget, StudioTaskId, StudioTaskSession } from '../src/core/studio-tasks';

// These reducer checks protect the retained owner's key and command identity.
// Actual edited React fields surviving mounted navigation are a browser gate.
const home: StudioReturnTarget = { screen: 'studio', panel: null, focusId: 'studio-compute-station' };
const resources: StudioReturnTarget = { screen: 'operations', panel: 'compute' };
const allocation: CommandPayload = { kind: 'allocate_compute', serving: U, development: 3 * U, research: 0 };
const rental: CommandPayload = { kind: 'set_cloud_capacity', cu: 8 * U };

function open(session: StudioTaskSession, task: StudioTaskId, returnTo = home) {
  return studioTaskReducer(session, { type: 'open', task, returnTo });
}
function review(session: StudioTaskSession, payload: CommandPayload, sourceRevision = 12) {
  return studioTaskReducer(session, { type: 'review', payload, sourceRevision });
}
function submit(session: StudioTaskSession) {
  const context = getStudioSubmissionContext(session);
  const payload = getActiveStudioTask(session)?.review?.payload;
  assert.ok(context && payload);
  return { context, payload, session: studioTaskReducer(session, { type: 'submit', context, payload }) };
}

test('W31B-N01: each named people or compute entry resolves its own task with the existing owner and no game mutation', () => {
  const game = createInitialState(), before = serializeState(game);
  const entries = [
    ['hire-staff', 'people'], ['assign-staff', 'people'],
    ['allocate-compute', 'compute'], ['rent-compute', 'compute'],
  ] as const;
  for (const [task, owner] of entries) {
    assert.equal(STUDIO_TASKS[task].owner, owner);
    assert.equal(STUDIO_TASKS[task].pauseOnEntry, true);
    assert.deepEqual(resolveStudioIntent(game, { kind: 'task', task }), { ok: true, panel: owner, task });
    const session = open(createStudioTaskSession(4), task);
    assert.equal(getActiveStudioTask(session)?.task, task);
    assert.equal(getActiveStudioTask(session)?.owner, owner);
    assert.deepEqual(getActiveStudioTask(session)?.intent, { kind: 'task', task });
  }
  assert.equal(serializeState(game), before, 'Opening a named choice cannot queue a command or advance the week');
});

test('W31B-N02: allocate to rent to allocate retains one draft generation but retires each previous review', () => {
  let session = review(open(createStudioTaskSession(4), 'allocate-compute'), allocation);
  const original = getActiveStudioTask(session)!;
  const oldContext = getStudioSubmissionContext(session)!;
  session = open(session, 'rent-compute');
  const rented = getActiveStudioTask(session)!;
  assert.equal(rented.owner, 'compute');
  assert.equal(rented.draftGeneration, original.draftGeneration);
  assert.ok(rented.instanceId > original.instanceId);
  assert.equal(rented.review, null);
  assert.equal(rented.phase, 'editing');
  assert.equal(getStudioSubmissionContext(session), null);
  assert.deepEqual(rented.intent, { kind: 'task', task: 'rent-compute' });
  session = review(session, rental);
  assert.equal(studioTaskReducer(session, { type: 'submit', context: oldContext, payload: allocation }), session,
    'An earlier allocation review cannot submit through the rental task');
  session = open(session, 'allocate-compute');
  const returned = getActiveStudioTask(session)!;
  assert.equal(returned.draftGeneration, original.draftGeneration);
  assert.ok(returned.instanceId > rented.instanceId);
  assert.equal(returned.review, null);
  assert.equal(returned.acknowledgement, null);
  assert.deepEqual(Object.keys(session.tasks), ['compute'], 'Named choices do not create competing form owners');
});

test('W31B-N03: hire and exact employee assignment share the people draft while retiring the old intent and review', () => {
  let session = studioTaskReducer(createStudioTaskSession(8), {
    type: 'open', task: 'hire-staff', intent: { kind: 'staffing', mode: 'hire', role: 'ml' }, returnTo: home,
  });
  session = review(session, { kind: 'hire_staff', role: 'ml' });
  const hire = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, {
    type: 'open', task: 'assign-staff', intent: { kind: 'staffing', mode: 'assign', staffId: 'staff:older' }, returnTo: home,
  });
  const assignment = getActiveStudioTask(session)!;
  assert.equal(assignment.owner, 'people');
  assert.equal(assignment.draftGeneration, hire.draftGeneration);
  assert.ok(assignment.instanceId > hire.instanceId);
  assert.equal(assignment.review, null);
  assert.deepEqual(assignment.intent, { kind: 'staffing', mode: 'assign', staffId: 'staff:older' });
  session = review(session, { kind: 'set_staff_allocation', staffId: 'staff:older', fte: U / 2 });
  session = open(session, 'hire-staff');
  assert.equal(getActiveStudioTask(session)?.draftGeneration, hire.draftGeneration);
  assert.deepEqual(getActiveStudioTask(session)?.intent, { kind: 'task', task: 'hire-staff' });
  assert.equal(getActiveStudioTask(session)?.review, null);
  assert.deepEqual(Object.keys(session.tasks), ['people']);
});

test('W31B-N04: a pending named command blocks a sibling switch and a late old receipt cannot overwrite the new task', () => {
  const first = submit(review(open(createStudioTaskSession(2), 'allocate-compute'), allocation));
  assert.equal(open(first.session, 'rent-compute'), first.session, 'Do not strand an in-flight allocation request');
  assert.equal(studioTaskReducer(first.session, { type: 'submit', context: first.context, payload: first.payload }), first.session,
    'Rapid confirmation is admitted once');
  let session = studioTaskReducer(first.session, { type: 'acknowledge', context: first.context,
    acknowledgement: { status: 'accepted', commandId: 'allocation-accepted', effectiveWeek: 13 } });
  session = open(session, 'rent-compute');
  assert.equal(getActiveStudioTask(session)?.acknowledgement, null, 'The rental task cannot inherit the allocation receipt');
  const next = submit(review(session, rental));
  assert.ok(next.context.requestId > first.context.requestId);
  for (const acknowledgement of [
    { status: 'accepted', commandId: 'late-allocation', effectiveWeek: 13 },
    { status: 'rejected', reason: 'Late allocation rejection' },
  ] as const) {
    assert.equal(studioTaskReducer(next.session, { type: 'acknowledge', context: first.context, acknowledgement }), next.session);
  }
  session = studioTaskReducer(next.session, { type: 'acknowledge', context: next.context,
    acknowledgement: { status: 'accepted', commandId: 'rental-accepted', effectiveWeek: 13 } });
  assert.equal(getActiveStudioTask(session)?.task, 'rent-compute');
  assert.deepEqual(getActiveStudioTask(session)?.review?.payload, rental);
  assert.deepEqual(getActiveStudioTask(session)?.acknowledgement,
    { status: 'accepted', commandId: 'rental-accepted', effectiveWeek: 13 });
});

test('W31B-N05: a training detour can switch compute choices and return without resetting either retained owner', () => {
  let session = studioTaskReducer(createStudioTaskSession(3), {
    type: 'open', task: 'train-model', intent: { kind: 'training-data', packetId: 'chosen-packet' }, returnTo: home,
  });
  const parent = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'detour', destination: resources });
  session = review(open(session, 'allocate-compute', resources), allocation);
  const allocationDraft = getActiveStudioTask(session)!;
  session = review(open(session, 'rent-compute', resources), rental);
  const oldContext = getStudioSubmissionContext(session)!;
  const rentalDraft = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'return' });
  assert.equal(getActiveStudioTask(session)?.task, 'train-model');
  assert.equal(getActiveStudioTask(session)?.instanceId, parent.instanceId);
  assert.equal(getActiveStudioTask(session)?.draftGeneration, parent.draftGeneration);
  assert.deepEqual(getActiveStudioTask(session)?.intent, { kind: 'training-data', packetId: 'chosen-packet' });
  assert.equal(session.tasks.compute?.draftGeneration, allocationDraft.draftGeneration);
  assert.equal(session.tasks.compute?.instanceId, rentalDraft.instanceId);
  assert.equal(session.tasks.compute?.review, null, 'Returning exposes helper fields, so their prior review is retired');
  assert.equal(session.detour, null);
  session = open(session, 'rent-compute', resources);
  assert.equal(getActiveStudioTask(session)?.instanceId, rentalDraft.instanceId);
  assert.equal(getActiveStudioTask(session)?.draftGeneration, rentalDraft.draftGeneration);
  assert.equal(studioTaskReducer(session, { type: 'submit', context: oldContext, payload: rental }), session);
});

test('W31B-N06: close and reopen preserve the selected named task and owner key without keeping a submit-ready review', () => {
  for (const task of ['allocate-compute', 'rent-compute', 'hire-staff', 'assign-staff'] as const) {
    const payload = task === 'allocate-compute' ? allocation : task === 'rent-compute' ? rental
      : task === 'hire-staff' ? { kind: 'hire_staff', role: 'ml' } as const
        : { kind: 'set_staff_allocation', staffId: 'staff:older', fte: U / 2 } as const;
    let session = review(open(createStudioTaskSession(9), task), payload);
    const original = getActiveStudioTask(session)!;
    session = studioTaskReducer(session, { type: 'close' });
    assert.equal(session.activeOwner, null);
    session = open(session, task);
    const reopened = getActiveStudioTask(session)!;
    assert.equal(reopened.task, task);
    assert.equal(reopened.instanceId, original.instanceId);
    assert.equal(reopened.draftGeneration, original.draftGeneration);
    assert.equal(session.companyEpoch, 9);
    assert.equal(reopened.review, null);
    assert.equal(getStudioSubmissionContext(session), null);
  }
});

test('W31B-N07: an explicit compute draft reset affects both compute choices and leaves the people owner intact', () => {
  let session = open(createStudioTaskSession(5), 'hire-staff');
  const people = getActiveStudioTask(session)!;
  session = review(open(session, 'allocate-compute'), allocation);
  const compute = getActiveStudioTask(session)!;
  const oldContext = getStudioSubmissionContext(session)!;
  session = open(session, 'rent-compute');
  session = studioTaskReducer(session, { type: 'resetDraft' });
  session = review(open(session, 'allocate-compute'), allocation);
  assert.equal(getActiveStudioTask(session)?.draftGeneration, compute.draftGeneration + 1);
  assert.equal(session.tasks.people, people);
  assert.equal(studioTaskReducer(session, { type: 'submit', context: oldContext, payload: allocation }), session);
  assert.equal(Object.keys(session.tasks).length, 2);
});

test('W31B-N08: replacing the company prevents an old named-owner acknowledgement from attaching to a fresh review', () => {
  const old = submit(review(open(createStudioTaskSession(10), 'rent-compute'), rental));
  let session = studioTaskReducer(old.session, { type: 'resetCompany', companyEpoch: 11 });
  const current = submit(review(open(session, 'rent-compute'), rental));
  assert.notEqual(current.context.companyEpoch, old.context.companyEpoch);
  assert.ok(current.context.taskInstanceId > old.context.taskInstanceId);
  session = studioTaskReducer(current.session, { type: 'acknowledge', context: old.context,
    acknowledgement: { status: 'accepted', commandId: 'other-company-rental', effectiveWeek: 13 } });
  assert.equal(session, current.session);
  assert.equal(getActiveStudioTask(session)?.phase, 'submitting');
  assert.equal(getActiveStudioTask(session)?.acknowledgement, null);
});
