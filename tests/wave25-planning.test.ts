import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, createInitialState, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createStudioPlanDraft, previewStudioPlan, submitStudioPlan } from '../src/core/studio-planning';
import { getStudioView } from '../src/core/studio';
import { disconnectedMemoryScenario, fixtureState, founder, mlShortageScenario, queue, step } from './fixtures/wave25-studio';

function exportEvidence(name: string, state: ReturnType<typeof createInitialState>) {
  const directory = process.env.FRONTIER_WAVE25_EVIDENCE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, name), serializeState(state)); }
}

test('W25-P01: a real first-sale company fixes assigned ML capacity while preserving live service', () => {
  const source = mlShortageScenario(), hash = canonicalStateHash(source), owner = source.playerCompanyId;
  exportEvidence('wave25-ml-shortage.json', source);
  const draft = createStudioPlanDraft(source);
  const ml = Object.values(source.slices.company.staff).find(member => member.companyId === owner && member.role === 'ml')!;
  draft.staff[ml.id] = U;
  const preview = previewStudioPlan(source, draft);
  assert.equal(preview.valid, true, preview.reason ?? '');
  const before = preview.baseline!.requests.find(request => request.taskId === 'training-wave25-training')!;
  const after = preview.proposed!.requests.find(request => request.id === before.id)!;
  assert.equal(before.grantedWork, 0); assert.match(before.reason, /ML|ml/);
  assert.equal(after.grantedWork, 4 * U);
  assert.equal(after.staff.find(item => item.role === 'ml')!.granted, 3 * U / 2, 'The restored specialist supplies 30 Design points; compute still caps actual training at four CUw.');
  const live = preview.baseline!.requests.filter(request => request.liveServing);
  assert.ok(live.length > 0);
  for (const request of live) assert.equal(preview.proposed!.requests.find(item => item.id === request.id)!.grantedWork, request.grantedWork);
  assert.equal(preview.warnings.some(warning => /reduces live service/.test(warning)), false);
  assert.ok(preview.changes.includes('Assign ML engineer 1 to 100% output.'));
  assert.equal(getStudioView(source).roomTier, 'studio');
  assert.equal(canonicalStateHash(source), hash);
  const accepted = submitStudioPlan(source, draft, preview.sourceHash);
  assert.equal(accepted.accepted, true, accepted.reason?.message);
  assert.equal(accepted.state.week, source.week);
  assert.equal(accepted.state.slices.company.staff[ml.id].assignedFte, 0, 'Apply queues; assignments change only at the boundary.');
  const settled = step(accepted.state);
  assert.equal(settled.slices.models.trainingRuns['training-wave25-training'].lastProgress, after.grantedWork);
  assert.equal(settled.slices.company.companies[owner].cashCents, preview.proposed!.cashCents);
  exportEvidence('wave25-ml-restored.json', settled);
});

test('W25-P02: disconnected pools explain a memory-stranded job despite enough aggregate memory', () => {
  const source = disconnectedMemoryScenario();
  exportEvidence('wave25-memory-stranded.json', source);
  const draft = createStudioPlanDraft(source); draft.allocation.development = 15 * U;
  const preview = previewStudioPlan(source, draft); assert.equal(preview.valid, true, preview.reason ?? '');
  const request = preview.proposed!.requests.find(item => item.taskId === 'training-wave25-memory-training')!;
  assert.equal(request.requestedMemory, 24 * U);
  assert.ok(preview.proposed!.pools.reduce((sum, pool) => sum + pool.memoryMU, 0) >= request.requestedMemory);
  assert.equal(request.largestCompatibleMemory, 16 * U);
  assert.equal(request.grantedWork, 0); assert.equal(request.poolId, null);
  assert.match(request.reason, /memory|MU/i);
  assert.ok(preview.proposed!.compute.allocation.development > 0);
  assert.ok(preview.proposed!.commitments.customerHosted > 0, 'Captured signed terms remain visible even when public products are paused.');
  assert.ok(preview.proposed!.requests.some(item => item.label === 'Infrastructure operations'));
  assert.ok(preview.proposed!.requests.some(item => item.label === 'Vector Studio support'));
});

test('W25-P03: repeated previews are pure and exact boundary cash, grants and reload continuation agree', () => {
  const source = fixtureState('wave24-browser.json'), hash = canonicalStateHash(source), encoded = serializeState(source);
  const draft = createStudioPlanDraft(source); draft.cloudCU = 8 * U; draft.allocation.development = 4 * U; draft.hires.data = 1;
  const preview = previewStudioPlan(source, draft); assert.equal(preview.valid, true, preview.reason ?? '');
  assert.deepEqual(previewStudioPlan(source, draft), preview);
  assert.equal(canonicalStateHash(source), hash); assert.equal(serializeState(source), encoded);
  assert.equal(Object.isFrozen(preview.proposed!.requests), true);
  assert.equal(preview.upfrontCostCents, CONTENT.staff.find(item => item.id === 'data')!.recruitmentCents);
  assert.equal(preview.proposed!.workforce.onboarding, 1);
  assert.equal(preview.baseline!.workforce.capacity.data, U / 4, 'The existing ML engineer already supplies five secondary Data points.');
  assert.equal(preview.proposed!.workforce.capacity.data, preview.baseline!.workforce.capacity.data, 'A new employee is paid but contributes no points during onboarding.');
  const queued = submitStudioPlan(source, draft, preview.sourceHash); assert.equal(queued.accepted, true, queued.reason?.message);
  assert.equal(queued.state.queuedCommands.length, source.queuedCommands.length + 1);
  const restored = deserializeState(serializeState(queued.state)); if (!restored.ok) throw new Error(restored.error);
  const actual = step(queued.state), replay = step(restored.state), company = actual.slices.company.companies[source.playerCompanyId];
  assert.equal(canonicalStateHash(actual), canonicalStateHash(replay));
  assert.equal(company.cashCents, preview.proposed!.cashCents);
  assert.equal(company.lastWeek.revenueCents, preview.proposed!.revenueCents);
  assert.equal(company.lastWeek.operatingExpenseCents, preview.proposed!.operatingExpenseCents);
  assert.deepEqual(actual.slices.compute.fleets[source.playerCompanyId].lastWork, preview.proposed!.compute.lastWork);
  assert.equal(submitCommand(actual, { kind: 'apply_studio_plan', commands: [{ kind: 'hire_staff', role: 'data' }] }, CONTENT, queued.commandId).accepted, false, 'A paid transaction cannot be replayed.');
});

test('W25-P04: invalid combined plans never leave partial hires, assignments, cash or queue changes', () => {
  const source = createInitialState(CONTENT, 'release'), encoded = serializeState(source), draft = createStudioPlanDraft(source);
  draft.founder = founder('research'); draft.hires.ml = 1; draft.cloudCU = U;
  const preview = previewStudioPlan(source, draft);
  assert.equal(preview.valid, false); assert.match(preview.reason!, /No part|allocation|shrinking/);
  const result = submitStudioPlan(source, draft, canonicalStateHash(source));
  assert.equal(result.accepted, false); assert.strictEqual(result.state, source);
  assert.equal(serializeState(source), encoded);
  const direct = submitCommand(source, { kind: 'apply_studio_plan', commands: [
    { kind: 'hire_staff', role: 'ml' }, { kind: 'assign_founder', allocations: founder('research') },
    { kind: 'allocate_compute', serving: 20 * U, development: 0, research: 0 },
  ] });
  assert.equal(direct.accepted, false); assert.strictEqual(direct.state, source);
  assert.equal(serializeState(source), encoded);
});

test('W25-P05: commit revalidation rolls the complete group back when an earlier queued product resume changes memory needs', () => {
  let source = fixtureState('wave24-browser.json');
  const product = Object.values(source.slices.products.offers).find(item => item.companyId === source.playerCompanyId)!;
  source = step(queue(source, { kind: 'set_product_paused', productId: product.id, paused: true }));
  source = queue(source, { kind: 'set_product_paused', productId: product.id, paused: false });
  const payload: CommandPayload = { kind: 'apply_studio_plan', commands: [
    { kind: 'hire_staff', role: 'data' }, { kind: 'assign_founder', allocations: founder('commercial') },
    { kind: 'allocate_compute', serving: 0, development: 0, research: 0 }, { kind: 'set_cloud_capacity', cu: 0 },
  ] };
  const queued = submitCommand(source, payload); assert.equal(queued.accepted, true, queued.reason?.message);
  const tick = advanceWeek(queued.state); assert.equal(tick.accepted, true, tick.reason?.message);
  assert.equal(tick.state.commandReceipts[queued.commandId!].status, 'rejected');
  assert.match(tick.state.commandReceipts[queued.commandId!].reason!.message, /memory|MU/);
  const baseline = step(source), owner = source.playerCompanyId;
  assert.deepEqual(tick.state.slices.company.staff, baseline.slices.company.staff);
  assert.deepEqual(tick.state.slices.company.founderAssignments[owner], source.slices.company.founderAssignments[owner]);
  assert.equal(tick.state.slices.company.companies[owner].cashCents, baseline.slices.company.companies[owner].cashCents);
  assert.deepEqual(tick.state.slices.compute.fleets[owner].allocation, baseline.slices.compute.fleets[owner].allocation);
  assert.equal(tick.state.slices.compute.fleets[owner].cloudCU, 4 * U);
  const draft = createStudioPlanDraft(source); draft.hires.data = 1; draft.founder = founder('commercial'); draft.cloudCU = 0;
  draft.allocation = { serving: 0, development: 0, research: 0 };
  const checked = submitStudioPlan(source, draft, canonicalStateHash(source));
  assert.equal(checked.accepted, false, 'The UI-facing Apply detects this future rejection before even queueing.');
  assert.strictEqual(checked.state, source);
});

test('W25-P06: capacity growth and shrink use existing validators in a valid atomic order', () => {
  let state = createInitialState(), draft = createStudioPlanDraft(state);
  draft.cloudCU = 8 * U; draft.allocation = { serving: 4 * U, development: 4 * U, research: 0 };
  let result = submitStudioPlan(state, draft, canonicalStateHash(state)); assert.equal(result.accepted, true, result.reason?.message);
  state = step(result.state); draft = createStudioPlanDraft(state);
  draft.cloudCU = 2 * U; draft.allocation = { serving: U, development: U, research: 0 };
  const preview = previewStudioPlan(state, draft); assert.equal(preview.valid, true, preview.reason ?? '');
  assert.equal(preview.weeklyCostDeltaCents, -6 * CONTENT.opening.rentCentsPerCUWeek);
  result = submitStudioPlan(state, draft, preview.sourceHash); assert.equal(result.accepted, true, result.reason?.message);
  state = step(result.state);
  assert.equal(state.slices.compute.fleets[state.playerCompanyId].cloudCU, 2 * U);
  assert.deepEqual(state.slices.compute.fleets[state.playerCompanyId].allocation, draft.allocation);
});

test('W25-P07: queued staffing decisions and stale reviews cannot be overwritten or duplicated', () => {
  const source = fixtureState('wave24-browser.json'), draft = createStudioPlanDraft(source); draft.hires.data = 1;
  const preview = previewStudioPlan(source, draft), changed = queue(source, { kind: 'rename_company', name: 'Reviewed later' });
  const stale = submitStudioPlan(changed, draft, preview.sourceHash);
  assert.equal(stale.accepted, false); assert.equal(stale.reason!.code, 'NOT_READY'); assert.strictEqual(stale.state, changed);
  const staffed = queue(source, { kind: 'hire_staff', role: 'data' });
  assert.equal(previewStudioPlan(staffed, draft).valid, false);
  const plan = submitStudioPlan(source, draft, preview.sourceHash); assert.equal(plan.accepted, true, plan.reason?.message);
  for (const payload of [{ kind: 'hire_staff', role: 'data' }, { kind: 'set_cloud_capacity', cu: 8 * U }] as CommandPayload[]) {
    const conflict = submitCommand(plan.state, payload); assert.equal(conflict.accepted, false); assert.equal(conflict.reason!.code, 'ALREADY_ACTIVE');
  }
  const malformedQueue = structuredClone(plan.state); malformedQueue.queuedCommands.push({ id: 'foreign-queue', companyId: source.playerCompanyId,
    issuedForWeek: source.week + 1, reservedCents: 0, payload: { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 } });
  assert.match(validateState(malformedQueue)[0].message, /conflicts/);
});

test('W25-P08: shape bounds, complete fee reservations and omitted employee assignments stay authoritative', () => {
  const source = fixtureState('wave24-browser.json'), hash = canonicalStateHash(source), draft = createStudioPlanDraft(source);
  draft.staff = {}; draft.hires.data = 1;
  const valid = submitStudioPlan(source, draft, hash); assert.equal(valid.accepted, true, valid.reason?.message);
  assert.equal(valid.state.queuedCommands.at(-1)!.reservedCents, CONTENT.staff.find(item => item.id === 'data')!.recruitmentCents);
  const unknown = { ...draft, staff: { 'no-longer-employed': U } };
  assert.equal(previewStudioPlan(source, unknown).valid, false);
  for (const payload of [
    { kind: 'apply_studio_plan', commands: [{ kind: 'apply_studio_plan', commands: [] }] },
    { kind: 'apply_studio_plan', commands: [{ kind: 'hire_staff', role: 'ml', feeCents: 0 }] },
    { kind: 'apply_studio_plan', commands: Array.from({ length: 9 }, () => ({ kind: 'hire_staff', role: 'ml' })) },
  ]) {
    const invalid = submitCommand(source, payload as CommandPayload); assert.equal(invalid.accepted, false); assert.strictEqual(invalid.state, source);
  }
  const poor = createInitialState(); poor.slices.company.companies[poor.playerCompanyId].cashCents = CONTENT.staff.find(item => item.id === 'ml')!.recruitmentCents;
  const twoHires = submitCommand(poor, { kind: 'apply_studio_plan', commands: [{ kind: 'hire_staff', role: 'ml' }, { kind: 'hire_staff', role: 'ml' }] });
  assert.equal(twoHires.accepted, false); assert.equal(twoHires.reason!.code, 'INSUFFICIENT_FUNDS'); assert.strictEqual(twoHires.state, poor);
  assert.equal(canonicalStateHash(source), hash);
});

test('W25-P09: actual onboarding boundaries and unpaid next-week bills remain visible', () => {
  let state = step(queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }));
  state = step(state);
  const draft = createStudioPlanDraft(state); draft.founder = founder('research');
  const preview = previewStudioPlan(state, draft); assert.equal(preview.valid, true, preview.reason ?? '');
  assert.equal(preview.proposed!.workforce.capacity.ml, 3 * U / 2, 'The already hired engineer becomes ready at the next boundary and supplies 30 Design points.');
  const poor = createInitialState(), role = CONTENT.staff.find(item => item.id === 'ml')!;
  poor.slices.company.companies[poor.playerCompanyId].cashCents = role.recruitmentCents;
  const poorDraft = createStudioPlanDraft(poor); poorDraft.hires.ml = 1;
  const risk = previewStudioPlan(poor, poorDraft); assert.equal(risk.valid, true, risk.reason ?? '');
  assert.equal(risk.proposed!.cashCents, 0); assert.ok(risk.proposed!.arrearsCents > 0);
  assert.ok(risk.warnings.some(warning => /unpaid bills/.test(warning)));
});

test('W25-P10: old snapshots retain their schema and selector purity while planning remains available', () => {
  // The paid Wave16 company already owns a commissioned site; Campus now
  // represents that existing facility when this historical save is opened.
  for (const [file, expectedRoom] of [['wave0-snapshot.json', 'garage'], ['wave1-inflight-snapshot.json', 'garage'], ['wave16-snapshot.json', 'campus']] as const) {
    const state = fixtureState(file), before = serializeState(state), draft = createStudioPlanDraft(state);
    const view = getStudioView(state);
    assert.equal(view.roomTier, expectedRoom);
    const preview = previewStudioPlan(state, draft);
    assert.equal(preview.valid, false, 'An unchanged draft is not a new transaction.');
    assert.equal(serializeState(state), before);
    const restored = deserializeState(before); if (!restored.ok) throw new Error(restored.error);
    assert.equal(canonicalStateHash(restored.state), canonicalStateHash(state));
  }
});
