import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { CAMPUS_CONTENT_VERSION } from '../src/content/wave28';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../src/content/wave29';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameContent, GameState, ResourceFrame, RoleAllocation, StaffMember, StaffRole, WorkRequest } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createStudioPlanDraft, previewStudioPlan, submitStudioPlan } from '../src/core/studio-planning';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { emptyRoleAllocation, getPayrollCents, getWorkforce, STAFF_ROLES } from '../src/modules/workforce';
import {
  WORK_POINT_LABELS, WORK_POINTS_PER_UNIT, formatWorkPoints, getEmployeeWorkOutput,
  getFounderPointOutput, getStaffPointProfile, getStaffPotentialOutput, workUnitsToPoints,
} from '../src/modules/workforce-points';
import { hasResearch } from '../src/modules/research';
import { readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';
import { createPlayerOnlyState } from './fixtures/player-only';

// Isolated engine scenarios use the established player-only fixture. All hires,
// assignments and project work below use real paid commands and weekly grants.
const FIXTURES = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const EXPECTED: Record<StaffRole, RoleAllocation> = {
  research: { research: 30, ml: 10, data: 5, infrastructure: 0, commercial: 0, hardware: 0 },
  ml: { research: 10, ml: 30, data: 5, infrastructure: 0, commercial: 0, hardware: 0 },
  data: { research: 5, ml: 10, data: 30, infrastructure: 0, commercial: 0, hardware: 0 },
  infrastructure: { research: 0, ml: 10, data: 5, infrastructure: 30, commercial: 0, hardware: 0 },
  commercial: { research: 5, ml: 10, data: 0, infrastructure: 0, commercial: 30, hardware: 0 },
  hardware: { research: 5, ml: 10, data: 0, infrastructure: 0, commercial: 0, hardware: 30 },
};
const displayed = (allocation: RoleAllocation) => Object.fromEntries(STAFF_ROLES.map(role => [role, workUnitsToPoints(allocation[role])])) as RoleAllocation;
const founderAllocation = (role?: StaffRole, units = U): RoleAllocation => ({ ...emptyRoleAllocation(), ...(role ? { [role]: units } : {}) });
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const member = (role: StaffRole, assignedFte = U): StaffMember => ({ id: 'point-member', companyId: 'point-company', role, hiredWeek: 1, readyWeek: 3, assignedFte });

function queue(state: GameState, payload: CommandPayload, id?: string, content: GameContent = CONTENT): GameState {
  const result = submitCommand(state, payload, content, id);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}
function step(state: GameState, content: GameContent = CONTENT, modules?: readonly DomainModule[]): GameState {
  const result = advanceWeek(state, content, modules);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}
function weeks(state: GameState, count: number, content: GameContent = CONTENT): GameState {
  for (let index = 0; index < count; index++) state = step(state, content);
  return state;
}
function readyEmployee(role: Exclude<StaffRole, 'hardware'>): GameState {
  let state = queue(createPlayerOnlyState(), { kind: 'assign_founder', allocations: emptyRoleAllocation() }, 'points-founder-idle');
  state = queue(state, { kind: 'hire_staff', role }, 'points-hire');
  return weeks(state, 3);
}
function founderOnly(role: StaffRole): GameState {
  return weeks(queue(createPlayerOnlyState(), { kind: 'assign_founder', allocations: founderAllocation(role) }, 'points-founder-role'), 3);
}
function startPreparation(state: GameState): GameState {
  return step(queue(state, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'points-preparation'));
}
function preparedTrainingSource(specialist: boolean): GameState {
  let state = queue(createPlayerOnlyState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'points-training-data');
  if (specialist) state = queue(state, { kind: 'hire_staff', role: 'ml' }, 'points-training-ml');
  state = weeks(state, 3);
  assert.equal(state.slices.data.packets[CONTENT.starterData.id].prepared, true);
  return step(queue(state, { kind: 'set_cloud_capacity', cu: 8 * U }, 'points-training-cloud'));
}
function trainOneWeek(specialist: boolean, development = 8 * U): GameState {
  let state = preparedTrainingSource(specialist);
  state = queue(state, { kind: 'assign_founder', allocations: founderAllocation(specialist ? undefined : 'ml') }, 'points-training-founder');
  state = queue(state, { kind: 'allocate_compute', serving: 0, development, research: 0 }, 'points-training-allocation');
  state = queue(state, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, 'points-training');
  return step(state);
}
function demand(state: Readonly<GameState>, id: string, role: StaffRole, units: number, priority: number): WorkRequest {
  return { id, companyId: state.playerCompanyId, taskId: id, category: 'development', normalizedWorkCUw: 0,
    memoryMU: 0, priority, poolId: 'auto', staffDemand: [{ role, staffWeeks: units }] };
}
function requester(requests: (state: Readonly<GameState>) => WorkRequest[], observed: { frame?: ResourceFrame }): DomainModule {
  return { id: 'points-resource-observer', owns: [], handlers: {
    reserve: state => ({ workRequests: requests(state) }),
    execute: (_state, context) => { observed.frame = structuredClone(context.resources); return {}; },
  } };
}

test('W32-P01: the six specialist profiles and displayed labels match the authored point contract', () => {
  assert.equal(createInitialState().contentVersion, CONTENT.version);
  assert.equal(createInitialState().buildVersion, CONTENT.buildVersion);
  assert.equal(WORK_POINTS_PER_UNIT, 20);
  assert.deepEqual(WORK_POINT_LABELS, { research: 'Research', ml: 'Design', data: 'Data', infrastructure: 'Operations', commercial: 'Business', hardware: 'Hardware' });
  for (const role of STAFF_ROLES) {
    assert.deepEqual(displayed(getStaffPointProfile(role)), EXPECTED[role]);
    assert.equal(Object.values(displayed(getStaffPointProfile(role))).reduce((sum, value) => sum + value, 0), 45);
  }
  assert.equal(workUnitsToPoints(U), 20);
  assert.equal(formatWorkPoints(U / 2), '10');
  assert.equal(formatWorkPoints(3 * U / 8), '7.5');
  assert.equal(formatWorkPoints(U / 80), '0.25');
});

test('W32-P02: readiness and saved employee fractions scale every profile component exactly', () => {
  for (const role of STAFF_ROLES) {
    for (const fraction of [0, U / 4, U / 2, 3 * U / 4, U]) {
      const employee = member(role, fraction), before = structuredClone(employee);
      assert.deepEqual(getEmployeeWorkOutput(employee, 2), emptyRoleAllocation(), 'Onboarding supplies no category');
      const output = displayed(getEmployeeWorkOutput(employee, 3));
      for (const category of STAFF_ROLES) assert.equal(output[category], EXPECTED[role][category] * fraction / U);
      assert.deepEqual(employee, before);
    }
  }
  assert.throws(() => getStaffPotentialOutput('ml', U + 1));
  assert.throws(() => getStaffPotentialOutput('ml', -1));
});

test('W32-P03: the founder still shares twenty points and cannot create Hardware output', () => {
  const assignments = { ...emptyRoleAllocation(), ml: U / 2, data: U / 2 }, before = structuredClone(assignments);
  const output = getFounderPointOutput(assignments);
  assert.deepEqual(displayed(output), { ...emptyRoleAllocation(), ml: 10, data: 10 });
  assert.notEqual(output, assignments);
  assert.deepEqual(assignments, before);
  const state = createPlayerOnlyState(), hash = canonicalStateHash(state);
  const over = submitCommand(state, { kind: 'assign_founder', allocations: { ...assignments, research: U / 4 } });
  assert.equal(over.accepted, false);
  const hardware = submitCommand(state, { kind: 'assign_founder', allocations: founderAllocation('hardware') });
  assert.equal(hardware.accepted, false);
  assert.equal(canonicalStateHash(state), hash);
  for (const role of STAFF_ROLES.filter(role => role !== 'hardware')) assert.equal(getStaffPointProfile(role).hardware, 0);
});

test('W32-P04: workforce totals include owned secondary output and exclude foreign employees', () => {
  const state = readyEmployee('research'), owner = state.playerCompanyId;
  const expected = getWorkforce(state, owner);
  assert.deepEqual(displayed(expected.capacity), EXPECTED.research);
  const isolated = structuredClone(state);
  isolated.slices.company.staff['foreign-points'] = { ...member('hardware'), id: 'foreign-points', companyId: 'another-company' };
  assert.deepEqual(getWorkforce(isolated, owner), expected);
  assert.equal(expected.ready, 1); assert.equal(expected.onboarding, 0);
});

test('W32-P05: paid onboarding, assignment changes and dismissal affect actual weekly output at their boundaries', () => {
  let state = queue(createPlayerOnlyState(), { kind: 'assign_founder', allocations: emptyRoleAllocation() }, 'points-idle');
  state = queue(state, { kind: 'hire_staff', role: 'ml' }, 'points-onboarding');
  const salary = CONTENT.staff.find(role => role.id === 'ml')!.weeklyCents;
  for (const week of [1, 2]) {
    state = step(state); assert.equal(state.week, week);
    assert.deepEqual(getWorkforce(state, state.playerCompanyId).capacity, emptyRoleAllocation());
    assert.equal(getPayrollCents(state, state.playerCompanyId, CONTENT), salary);
  }
  state = step(state);
  assert.deepEqual(displayed(getWorkforce(state, state.playerCompanyId).capacity), EXPECTED.ml);
  const queued = queue(state, { kind: 'set_staff_allocation', staffId: 'staff:points-onboarding', fte: U / 2 }, 'points-half');
  assert.deepEqual(getWorkforce(queued, queued.playerCompanyId).capacity, getWorkforce(state, state.playerCompanyId).capacity);
  state = step(queued);
  assert.deepEqual(displayed(getWorkforce(state, state.playerCompanyId).capacity), { ...emptyRoleAllocation(), ml: 15, research: 5, data: 2.5 });
  assert.equal(getPayrollCents(state, state.playerCompanyId, CONTENT), salary);
  state = step(queue(state, { kind: 'dismiss_staff', staffId: 'staff:points-onboarding' }, 'points-dismiss'));
  assert.deepEqual(getWorkforce(state, state.playerCompanyId).capacity, emptyRoleAllocation());
  assert.equal(getPayrollCents(state, state.playerCompanyId, CONTENT), 0);
  assert.equal(state.slices.company.ledger.filter(fact => fact.id === 'dismiss:points-dismiss').length, 1);
});

test('W32-P06: actual preparation gains thirty specialist points versus twenty founder points and does not bank idle output', () => {
  const founder = startPreparation(founderOnly('data'));
  const specialist = startPreparation(readyEmployee('data'));
  const idleFirst = startPreparation(weeks(readyEmployee('data'), 4));
  const job = (state: GameState) => state.slices.data.preparationJobs['preparation-points-preparation'];
  assert.equal(job(founder).completedStaff, U);
  assert.equal(job(specialist).completedStaff, 3 * U / 2);
  assert.equal(workUnitsToPoints(job(specialist).lastProgress), 30);
  assert.equal(job(idleFirst).completedStaff, job(specialist).completedStaff, 'Unused weeks do not accumulate a spendable bank');
  assert.equal(job(specialist).requiredStaff, 2 * U, 'Existing saved project requirements remain normalized units');
  assert.equal(specialist.slices.data.packets[CONTENT.starterData.id].prepared, false);
  const complete = step(specialist);
  assert.equal(job(complete).completedStaff, 2 * U);
  assert.equal(workUnitsToPoints(job(complete).lastProgress), 10, 'The final grant is capped by remaining work');
  assert.equal(complete.slices.data.packets[CONTENT.starterData.id].prepared, true);
});

test('W32-P07: a researcher’s secondary Data points advance the real preparation job', () => {
  const state = startPreparation(readyEmployee('research'));
  const job = state.slices.data.preparationJobs['preparation-points-preparation'];
  assert.equal(job.completedStaff, U / 4);
  assert.equal(workUnitsToPoints(job.lastProgress), 5);
  assert.equal(state.slices.compute.fleets[state.playerCompanyId].lastWork.development, 0);
});

test('W32-P08: real research consumes specialist points independently of its compute meter and following-week unlock', () => {
  function researchWeek(state: GameState, researchCompute: number) {
    state = queue(state, { kind: 'allocate_compute', serving: 0, development: 0, research: researchCompute }, 'points-research-compute');
    return step(queue(state, { kind: 'start_research', researchId: 'R1' }, 'points-research'));
  }
  const founder = researchWeek(founderOnly('research'), 2 * U);
  let specialist = researchWeek(readyEmployee('research'), 2 * U);
  const noCompute = researchWeek(readyEmployee('research'), 0);
  const project = (state: GameState) => state.slices.research.projects['research-points-research'];
  assert.equal(project(founder).completedStaff, U);
  assert.equal(project(specialist).completedStaff, 3 * U / 2);
  assert.equal(project(specialist).completedWork, 2 * U);
  assert.equal(project(noCompute).completedStaff, 3 * U / 2);
  assert.equal(project(noCompute).completedWork, 0);
  assert.equal(project(noCompute).status, 'running');
  specialist = step(specialist);
  assert.equal(project(specialist).status, 'complete');
  assert.equal(hasResearch(specialist, specialist.playerCompanyId, 'R1'), false);
  specialist = step(specialist);
  assert.equal(hasResearch(specialist, specialist.playerCompanyId, 'R1'), true);
});

test('W32-P09: specialist Design points increase actual training supervision once while GPUs remain an independent limit', () => {
  const founder = trainOneWeek(false), specialist = trainOneWeek(true);
  const gpuLimited = trainOneWeek(true, 4 * U), starved = trainOneWeek(true, 0);
  const run = (state: GameState) => state.slices.models.trainingRuns['training-points-training'];
  assert.equal(run(founder).completedWork, 4 * U);
  assert.equal(run(specialist).completedWork, 6 * U);
  assert.equal(run(gpuLimited).completedWork, 4 * U);
  assert.equal(run(starved).completedWork, 0);
  assert.equal(run(starved).lastProgress, 0);
  assert.ok(getWorkforce(starved, starved.playerCompanyId).granted.ml > 0,
    'Allocated supervision is not itself completed GPU work');
  assert.equal(starved.slices.compute.fleets[starved.playerCompanyId].lastWork.development, 0);
  assert.equal(run(specialist).requiredWork, run(founder).requiredWork);
});

test('W32-P10: simultaneous requests share each specialty budget without cross-role borrowing or double grants', () => {
  const state = readyEmployee('research'), observed: { frame?: ResourceFrame } = {};
  const probe = requester(snapshot => [
    demand(snapshot, 'research-first', 'research', U, 10), demand(snapshot, 'research-second', 'research', U, 20),
    demand(snapshot, 'research-third', 'research', U, 30), demand(snapshot, 'design-secondary', 'ml', U, 10),
    demand(snapshot, 'data-secondary', 'data', U, 10), demand(snapshot, 'hardware-unavailable', 'hardware', U, 10),
  ], observed);
  const after = step(state, CONTENT, [createCompanyModule(CONTENT), createComputeModule(CONTENT), probe]);
  const granted = (id: string) => observed.frame!.staffGrants.find(grant => grant.requestId === id)!.grants[0].staffWeeks;
  assert.equal(granted('research-first'), U); assert.equal(granted('research-second'), U / 2); assert.equal(granted('research-third'), 0);
  assert.equal(granted('design-secondary'), U / 2); assert.equal(granted('data-secondary'), U / 4);
  assert.equal(granted('hardware-unavailable'), 0);
  assert.deepEqual(getWorkforce(after, after.playerCompanyId).granted, getWorkforce(after, after.playerCompanyId).capacity);
});

test('W32-P11: an owner that grants the same specialist output twice rolls back the entire week', () => {
  const state = readyEmployee('data'), before = serializeState(state), observed: { frame?: ResourceFrame } = {};
  const owner = createCompanyModule(CONTENT);
  const corrupt: DomainModule = { ...owner, grantResources: (_snapshot, context) => ({
    staffGrants: context.resources.requests.map(request => ({ requestId: request.id, grants: [{ role: 'data', staffWeeks: U }] })),
  }) };
  const probe = requester(snapshot => [demand(snapshot, 'overspend-a', 'data', U, 10), demand(snapshot, 'overspend-b', 'data', U, 20)], observed);
  const result = advanceWeek(state, CONTENT, [corrupt, createComputeModule(CONTENT), probe]);
  assert.equal(result.accepted, false);
  assert.match(result.reason!.message, /capacity/);
  assert.equal(serializeState(result.state), before);
  assert.equal(serializeState(state), before);
  assert.equal(observed.frame, undefined);
});

test('W32-P12: point-based planning previews stay pure and match the actual changed output after one boundary', () => {
  const state = readyEmployee('ml'), before = serializeState(state), draft = createStudioPlanDraft(state);
  draft.staff['staff:points-hire'] = U / 2;
  const preview = previewStudioPlan(state, draft);
  assert.equal(preview.valid, true, preview.reason ?? undefined);
  assert.deepEqual(previewStudioPlan(state, draft), preview);
  assert.equal(serializeState(state), before);
  assert.deepEqual(displayed(preview.proposed!.workforce.capacity), { ...emptyRoleAllocation(), ml: 15, research: 5, data: 2.5 });
  const queued = submitStudioPlan(state, draft, preview.sourceHash);
  assert.equal(queued.accepted, true, queued.reason?.message);
  assert.deepEqual(getWorkforce(queued.state, state.playerCompanyId).capacity, getWorkforce(state, state.playerCompanyId).capacity);
  const after = step(queued.state);
  assert.deepEqual(getWorkforce(after, after.playerCompanyId).capacity, preview.proposed!.workforce.capacity);
  assert.equal(company(after).cashCents, preview.proposed!.cashCents);
});

test('W32-P13: authentic 0.28 progress and queued assignments migrate without changing any saved economic field', () => {
  const oldContent: GameContent = { ...CONTENT, version: CAMPUS_CONTENT_VERSION, buildVersion: '0.31.1' };
  let old = createPlayerOnlyState(oldContent);
  old = queue(old, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'points-legacy-prep', oldContent);
  old = queue(old, { kind: 'hire_staff', role: 'ml' }, 'points-legacy-ml', oldContent);
  old = step(old, oldContent);
  old = queue(old, { kind: 'set_staff_allocation', staffId: 'staff:points-legacy-ml', fte: U / 2 }, 'points-legacy-half', oldContent);
  old = queue(old, { kind: 'assign_founder', allocations: founderAllocation('research') }, 'points-legacy-founder', oldContent);
  const text = serializeState(old, oldContent), before = structuredClone(old), loaded = deserializeState(text);
  if (!loaded.ok) throw new Error(loaded.error);
  assert.equal(loaded.migratedFrom, 29);
  assert.deepEqual(loaded.state, { ...before, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...before.slices, markets: { ...before.slices.markets, opportunityCalendar: { startedWeek: before.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(old, before);
  assert.equal(loaded.state.slices.data.preparationJobs['preparation-points-legacy-prep'].completedStaff, U);
  const week2 = step(loaded.state), week3 = step(week2);
  assert.equal(week2.slices.data.preparationJobs['preparation-points-legacy-prep'].completedStaff, U);
  assert.equal(week3.slices.data.preparationJobs['preparation-points-legacy-prep'].completedStaff, U + U / 8,
    'Only the newly ready half-time engineer’s 2.5 Data points add work after migration');
  assert.equal(week3.slices.company.staff['staff:points-legacy-ml'].assignedFte, U / 2);
  assert.equal(week3.commandReceipts['points-legacy-half'].status, 'accepted');
  const restored = deserializeState(serializeState(week3)); if (!restored.ok) throw new Error(restored.error);
  assert.equal(restored.migratedFrom, undefined);
  assert.deepEqual(restored.state, week3);
});

test('W32-P14: save/reload preserves future point grants and progress without replaying work or recruitment', () => {
  let uninterrupted = startPreparation(readyEmployee('data'));
  const serialized = serializeState(uninterrupted), loaded = deserializeState(serialized);
  if (!loaded.ok) throw new Error(loaded.error);
  let replay = loaded.state;
  for (let index = 0; index < 4; index++) {
    uninterrupted = step(uninterrupted);
    const restored = deserializeState(serializeState(replay)); if (!restored.ok) throw new Error(restored.error);
    replay = step(restored.state);
    assert.deepEqual(replay, uninterrupted);
  }
  assert.equal(replay.slices.company.ledger.filter(fact => fact.id === 'recruit:points-hire').length, 1);
  assert.equal(replay.slices.data.preparationJobs['preparation-points-preparation'].completedStaff, 2 * U);
});

test('W32-P15: a real mature company preserves paid history and continues deterministically with the new matrix', () => {
  const text = readFileSync(join(FIXTURES, 'wave27-appliance-published.json'), 'utf8');
  const original = JSON.parse(text).state as GameState, imported = deserializeState(text);
  if (!imported.ok) throw new Error(imported.error);
  assert.deepEqual(imported.state, { ...original, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...original.slices, markets: { ...original.slices.markets, opportunityCalendar: { startedWeek: original.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(imported.state), []);
  const worker = Object.values(imported.state.slices.company.staff).find(item => item.companyId === imported.state.playerCompanyId && item.role === 'hardware');
  assert.ok(worker, 'The mature paid fixture must contain an actual hardware specialist');
  let direct = queue(imported.state, { kind: 'set_staff_allocation', staffId: worker.id, fte: U / 2 }, 'points-mature-half');
  direct = queue(direct, { kind: 'hire_staff', role: 'data' }, 'points-mature-hire');
  const loaded = deserializeState(serializeState(direct)); if (!loaded.ok) throw new Error(loaded.error);
  let resumed = loaded.state;
  for (let index = 0; index < 5; index++) {
    direct = step(direct);
    const reloaded = deserializeState(serializeState(resumed)); if (!reloaded.ok) throw new Error(reloaded.error);
    resumed = step(reloaded.state);
    assert.equal(canonicalStateHash(resumed), canonicalStateHash(direct));
    assert.deepEqual(validateState(direct), []);
  }
  assert.equal(direct.slices.company.staff[worker.id].assignedFte, U / 2);
  assert.equal(direct.slices.company.staff['staff:points-mature-hire'].readyWeek, original.week + 3);
  assert.equal(direct.commandReceipts['points-mature-half'].status, 'accepted');
  assert.equal(direct.commandReceipts['points-mature-hire'].status, 'accepted');
});

test('W32-P16: the first point-version save archives exact 0.28 bytes and write failures preserve the old company', () => {
  const oldContent: GameContent = { ...CONTENT, version: CAMPUS_CONTENT_VERSION, buildVersion: '0.31.1' };
  const original = serializeState(createPlayerOnlyState(oldContent), oldContent) + '\n';
  const primary = 'frontier-lab.wave0.snapshot', archive = 'frontier-lab.content028.original';
  class MemoryStorage implements Storage {
    values = new Map<string, string>([[primary, original]]);
    writes: string[] = [];
    failKey: string | null = null;
    get length() { return this.values.size; }
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) {
      if (key === this.failKey) throw new Error('Storage is unavailable');
      this.writes.push(key); this.values.set(key, value);
    }
    removeItem(key: string) { this.values.delete(key); }
    clear() { this.values.clear(); }
    key(index: number) { return [...this.values.keys()][index] ?? null; }
  }
  function browser(storage: MemoryStorage, operation: () => void) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
    try { operation(); } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  }
  const storage = new MemoryStorage();
  browser(storage, () => {
    const loaded = readBrowserSnapshot(); assert.equal(loaded.kind, 'loaded');
    if (loaded.kind !== 'loaded') return;
    assert.equal(loaded.migratedFrom, 29);
    assert.deepEqual(storage.writes, []);
    assert.equal(writeBrowserSnapshot(loaded.state).ok, true);
    assert.deepEqual(storage.writes, [archive, primary]);
    assert.deepEqual(readBrowserRecovery('content028'), { text: original, filename: 'frontier-lab-content028-original.json' });
    assert.equal(writeBrowserSnapshot(loaded.state).ok, true);
    assert.equal(storage.getItem(archive), original);
    assert.equal(storage.writes.filter(key => key === archive).length, 1);
  });
  for (const failKey of [archive, primary]) {
    const blocked = new MemoryStorage(); blocked.failKey = failKey;
    browser(blocked, () => {
      const loaded = readBrowserSnapshot(); assert.equal(loaded.kind, 'loaded');
      if (loaded.kind !== 'loaded') return;
      assert.equal(writeBrowserSnapshot(loaded.state).ok, false);
      assert.equal(blocked.getItem(primary), original);
      assert.equal(blocked.getItem(archive), failKey === archive ? null : original);
    });
  }
});

test('W32-P17: two paid Design specialists can meet foundation Research admission through secondary output', () => {
  const loaded = deserializeState(readFileSync(join(FIXTURES, 'wave27-appliance-published.json'), 'utf8'));
  if (!loaded.ok) throw new Error(loaded.error);
  const original = loaded.state, owner = original.playerCompanyId;
  const staff = Object.values(original.slices.company.staff).filter(item => item.companyId === owner);
  const engineers = staff.filter(item => item.role === 'ml' && item.readyWeek <= original.week).slice(0, 2);
  assert.equal(engineers.length, 2, 'Use the two engineers already recruited by the paid campaign');
  const earlier = Object.values(original.slices.models.trainingRuns).find(run => run.companyId === owner && run.recipeId === 'medium-foundation');
  assert.ok(earlier?.plan);
  const packets = earlier.plan.corpus.packetIds;
  const payload = { kind: 'start_training', baseModelId: CONTENT.seedModel.id, recipeId: 'medium-foundation',
    packetId: packets[0], packetIds: packets, profile: 'ambitious' } as const;
  function capacityCase(secondAllocation: number) {
    let state = queue(original, { kind: 'assign_founder', allocations: founderAllocation('infrastructure') }, 'points-foundation-founder');
    for (const employee of staff) {
      const fte = employee.id === engineers[0].id ? U : employee.id === engineers[1].id ? secondAllocation : 0;
      state = queue(state, { kind: 'set_staff_allocation', staffId: employee.id, fte }, 'points-foundation-' + employee.id);
    }
    return step(state);
  }
  const enough = capacityCase(U), below = capacityCase(3 * U / 4);
  assert.equal(getWorkforce(enough, owner).capacity.research, U);
  assert.equal(getWorkforce(below, owner).capacity.research, 7 * U / 8);
  assert.equal(workUnitsToPoints(getWorkforce(below, owner).capacity.research), 17.5,
    'The next allowed employee output step below the threshold must remain blocked');
  assert.equal(enough.slices.company.founderAssignments[owner].research, 0);
  assert.ok(staff.filter(item => item.role === 'research').every(item => enough.slices.company.staff[item.id].assignedFte === 0));
  const accepted = previewCommand(enough, payload), rejected = previewCommand(below, payload);
  assert.equal(accepted.accepted, true, accepted.reason?.message);
  assert.equal(rejected.accepted, false); assert.equal(rejected.reason?.code, 'MISSING_STAFF');
  assert.match(rejected.reason!.message, /20 Research points/);
  const admitted = step(queue(enough, payload, 'points-foundation-admitted'));
  const run = admitted.slices.models.trainingRuns['training-points-foundation-admitted'];
  assert.equal(run.preparationCompleted, U, 'The same secondary points perform actual foundation design work');
  assert.equal(run.plan!.preparationRequired, 6 * U);
  assert.deepEqual(validateState(admitted), []);
});
