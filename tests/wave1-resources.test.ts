import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameCommand, GameState, ResourceFrame, ResourceGrant, StaffGrant, WorkRequest } from '../src/contracts/types';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { createPlayerOnlyState as createInitialState } from './fixtures/player-only';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { collectResourceResult } from '../src/core/resources';
import { createCompanyModule, getPayrollCents, getWorkforce } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { emptyRoleAllocation } from '../src/modules/workforce';

const U = RESOURCE_SCALE;
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];
const owners = (): DomainModule[] => [createCompanyModule(CONTENT), createComputeModule(CONTENT)];

function queue(state: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(state, payload, CONTENT, id);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}
function step(state: GameState, extra: DomainModule[] = []): GameState {
  const result = advanceWeek(state, CONTENT, [...owners(), ...extra]);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}
function requester(
  requests: (state: Readonly<GameState>, week: number) => WorkRequest[],
  observed?: { frame?: ResourceFrame },
): DomainModule {
  return { id: 'resource-fixture', owns: [], handlers: {
    reserve: (state, context) => ({ workRequests: requests(state, context.week) }),
    execute: (_state, context) => {
      if (observed) observed.frame = structuredClone(context.resources);
      return {};
    },
  } };
}
function work(state: Readonly<GameState>, id: string, overrides: Partial<WorkRequest> = {}): WorkRequest {
  return { id, companyId: state.playerCompanyId, taskId: id, category: 'development',
    normalizedWorkCUw: 2 * U, memoryMU: 4 * U, poolId: 'general-cloud', priority: 30, ...overrides };
}

test('W1-RESOURCE-01: isolated ten-week recruitment, preparation, and payroll ledger leaves $32,500', () => {
  let state = queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }, 'first-ml');
  const preparationFee: DomainModule = { id: 'preparation-fee-fixture', owns: [], handlers: {
    execute: (snapshot, context) => context.week === 1 ? { facts: [{ id: 'isolated-preparation-fee',
      companyId: snapshot.playerCompanyId, sourceId: 'isolated-ledger-fixture', week: 1, amountCents: 100_000,
      category: 'operating', label: 'Starter preparation fee', kind: 'expense' }] } : {},
  } };
  for (let week = 0; week < 10; week++) state = step(state, [preparationFee]);
  assert.equal(company(state).cashCents, 3_250_000);
  assert.equal(company(state).earnedRevenueCents, 0);
  assert.equal(getPayrollCents(state, state.playerCompanyId, CONTENT), 30_000);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === 'recruit:first-ml').length, 1);
  assert.equal(state.slices.company.ledger.filter(entry => entry.sourceId === 'staff:first-ml').length, 10);
});

test('W1-RESOURCE-02: onboarding is paid in weeks 1 and 2 and supplies capacity only from week 3', () => {
  let state = queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }, 'onboarding');
  const observed: { frame?: ResourceFrame } = {};
  const demand = requester(snapshot => [work(snapshot, 'staff-observation', {
    normalizedWorkCUw: 0, memoryMU: 0, staffDemand: [{ role: 'ml', staffWeeks: U }],
  })], observed);
  state = step(state, [demand]);
  assert.equal(company(state).activeStaff, 0);
  assert.equal(getWorkforce(state, state.playerCompanyId).onboarding, 1);
  assert.equal(observed.frame!.staffGrants[0].grants[0].staffWeeks, 0);
  assert.equal(company(state).cashCents, 4_520_000);
  state = step(state, [demand]);
  assert.equal(observed.frame!.staffGrants[0].grants[0].staffWeeks, 0);
  assert.equal(company(state).cashCents, 4_390_000);
  state = step(state, [demand]);
  assert.equal(company(state).activeStaff, 1);
  assert.equal(getWorkforce(state, state.playerCompanyId).onboarding, 0);
  assert.equal(observed.frame!.staffGrants[0].grants[0].staffWeeks, U);
  assert.equal(company(state).cashCents, 4_260_000);
});

test('W1-RESOURCE-03: founder roles share one quarter-FTE budget and invalid changes are atomic', () => {
  const original = createInitialState();
  const allocations = { ...emptyRoleAllocation(), data: U / 2, ml: U / 2 };
  let state = step(queue(original, { kind: 'assign_founder', allocations }));
  const workforce = getWorkforce(state, state.playerCompanyId);
  assert.equal(workforce.capacity.data, U / 2);
  assert.equal(workforce.capacity.ml, U / 2);
  const hash = canonicalStateHash(state);
  const over = submitCommand(state, { kind: 'assign_founder', allocations: { ...allocations, research: U / 4 } });
  assert.equal(over.accepted, false);
  assert.equal(over.reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(canonicalStateHash(over.state), hash);
  const nonQuarter = submitCommand(state, { kind: 'assign_founder', allocations: { ...allocations, data: U / 3 } });
  assert.equal(nonQuarter.accepted, false);
  assert.equal(canonicalStateHash(state), hash);
  state = step(queue(state, { kind: 'assign_founder', allocations: emptyRoleAllocation() }));
  assert.equal(Object.values(getWorkforce(state, state.playerCompanyId).capacity).reduce((a, b) => a + b, 0), 0);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 100_000);
});

test('W1-RESOURCE-04: employee assignment changes capacity while keeping full salary', () => {
  let state = step(queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }, 'idle-ml'));
  state = step(state);
  state = step(queue(state, { kind: 'set_staff_allocation', staffId: 'staff:idle-ml', fte: U / 4 }));
  assert.equal(company(state).activeStaff, 1);
  assert.equal(getWorkforce(state, state.playerCompanyId).capacity.ml, 3 * U / 8, 'A quarter of the specialist’s 30 Design points supplies 7.5 points.');
  assert.equal(getPayrollCents(state, state.playerCompanyId, CONTENT), 30_000);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 130_000);
  state = step(queue(state, { kind: 'set_staff_allocation', staffId: 'staff:idle-ml', fte: 0 }));
  assert.equal(getWorkforce(state, state.playerCompanyId).capacity.ml, 0);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 130_000);
});

test('W1-RESOURCE-05: dismissal charges two wages and removes current-week payroll and capacity', () => {
  let state = step(queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }, 'dismiss-me'));
  const before = company(state).cashCents;
  state = step(queue(state, { kind: 'dismiss_staff', staffId: 'staff:dismiss-me' }, 'dismiss-once'));
  assert.equal(Object.keys(state.slices.company.staff).length, 0);
  assert.equal(company(state).activeStaff, 0);
  assert.equal(getPayrollCents(state, state.playerCompanyId, CONTENT), 0);
  assert.equal(before - company(state).cashCents, 160_000);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === 'dismiss:dismiss-once').length, 1);
  assert.equal(state.slices.company.ledger.filter(entry => entry.week === 2 && entry.sourceId === 'staff:dismiss-me').length, 0);
});

test('W1-RESOURCE-06: operational priority receives shared staff before an optional request', () => {
  const observed: { frame?: ResourceFrame } = {};
  const state = step(createInitialState(), [requester(snapshot => [
    work(snapshot, 'optional', { priority: 50, normalizedWorkCUw: 0, memoryMU: 0, staffDemand: [{ role: 'data', staffWeeks: U }] }),
    work(snapshot, 'operational', { priority: 0, normalizedWorkCUw: 0, memoryMU: 0, staffDemand: [{ role: 'data', staffWeeks: U }] }),
  ], observed)]);
  assert.equal(observed.frame!.staffGrants.find(grant => grant.requestId === 'operational')!.grants[0].staffWeeks, U);
  assert.equal(observed.frame!.staffGrants.find(grant => grant.requestId === 'optional')!.grants[0].staffWeeks, 0);
  assert.equal(getWorkforce(state, state.playerCompanyId).granted.data, U);
  assert.deepEqual(fleet(state).lastWork, { serving: 0, development: 0, research: 0 });
});

test('W1-RESOURCE-07: full utilization and idle cloud cost the same $800 without an energy surcharge', () => {
  const idle = step(createInitialState());
  const queued = queue(createInitialState(), { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  const full = step(queued, [requester(snapshot => [work(snapshot, 'full-fleet', { normalizedWorkCUw: 4 * U })])]);
  assert.equal(fleet(full).lastWork.development, 4 * U);
  assert.equal(fleet(full).occupiedMemoryMU, 4 * U);
  assert.equal(company(idle).lastWeek.operatingExpenseCents, 100_000);
  assert.equal(company(full).lastWeek.operatingExpenseCents, 100_000);
  assert.equal(full.slices.company.ledger.filter(entry => entry.category === 'rent')[0].amountCents, 80_000);
  assert.equal(full.slices.company.ledger.length, 2);
});

test('W1-RESOURCE-08: 10% serving headroom reserves 2.2 CU while executing only 2 CUw', () => {
  const state = step(queue(createInitialState(), { kind: 'allocate_compute', serving: 2_200_000_000, development: 1_800_000_000, research: 0 }), [requester(snapshot => [
    work(snapshot, 'serving', { category: 'serving', priority: 0, memoryMU: 2 * U, normalizedWorkCUw: 2 * U, headroomBps: 1000 }),
  ])]);
  assert.equal(fleet(state).lastWork.serving, 2 * U);
  assert.equal(fleet(state).reservedCU, 2_200_000_000);
  assert.equal(fleet(state).lastGrants[0].grantedWork, 2 * U);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 100_000);
});

test('W1-RESOURCE-09: memory failure grants no compute despite idle physical capacity', () => {
  const observed: { frame?: ResourceFrame } = {};
  const state = step(createInitialState(), [requester(snapshot => [work(snapshot, 'medium-workspace', { memoryMU: 16 * U })], observed)]);
  const grant = observed.frame!.computeGrants[0];
  assert.equal(grant.physicalCUw, 0);
  assert.equal(grant.hardwareEffectiveCUw, 0);
  assert.equal(grant.memoryMU, 0);
  assert.equal(fleet(state).occupiedMemoryMU, 0);
  assert.match(fleet(state).lastBottleneck, /memory/i);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 100_000);
});

test('W1-RESOURCE-10: earlier serving placement prevents a later workspace from overbooking memory', () => {
  const state = step(queue(createInitialState(), { kind: 'allocate_compute', serving: 2 * U, development: 2 * U, research: 0 }), [requester(snapshot => [
    work(snapshot, 'training', { priority: 40, memoryMU: 4 * U }),
    work(snapshot, 'serving', { priority: 0, category: 'serving', memoryMU: 5 * U, normalizedWorkCUw: U, headroomBps: 1000 }),
  ])]);
  assert.equal(fleet(state).occupiedMemoryMU, 5 * U);
  assert.equal(fleet(state).lastWork.serving, U);
  assert.equal(fleet(state).lastWork.development, 0);
  assert.match(fleet(state).lastGrants.find(grant => grant.requestId === 'training')!.reason, /memory/i);
});

test('W1-RESOURCE-11: quarter-FTE supervision supplies exactly one CUw with no second progress multiplier', () => {
  const allocations = { ...emptyRoleAllocation(), ml: U / 4 };
  const state = step(queue(createInitialState(), { kind: 'assign_founder', allocations }), [requester(snapshot => [work(snapshot, 'supervised', {
    staffDemand: [{ role: 'ml', staffWeeks: U / 2 }], supervision: { role: 'ml', workPerStaffWeek: 4 * U },
  })])]);
  assert.equal(getWorkforce(state, state.playerCompanyId).granted.ml, U / 4);
  assert.equal(fleet(state).lastWork.development, U);
  assert.equal(fleet(state).lastGrants[0].grantedWork, U);
  assert.equal(fleet(state).lastGrants[0].reason, 'Design points limit supervised progress.');
});

test('W1-RESOURCE-12: cloud capacity changes at the boundary with matching memory and recurring rent', () => {
  const initial = createInitialState();
  let state = queue(initial, { kind: 'set_cloud_capacity', cu: 6 * U });
  assert.equal(fleet(state).cloudCU, 4 * U);
  state = step(state);
  assert.equal(fleet(state).cloudCU, 6 * U);
  assert.equal(fleet(state).memoryMU, 12 * U);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 140_000);
  const rejected = submitCommand(state, { kind: 'set_cloud_capacity', cu: U });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(canonicalStateHash(rejected.state), canonicalStateHash(state));
  const fraction = submitCommand(state, { kind: 'set_cloud_capacity', cu: 5_500_000_000 });
  assert.equal(fraction.accepted, false);
  state = step(queue(state, { kind: 'set_cloud_capacity', cu: 2 * U }));
  assert.equal(fleet(state).memoryMU, 4 * U);
  assert.equal(company(state).lastWeek.operatingExpenseCents, 60_000);
});

test('W1-RESOURCE-13: downsizing preserves memory required by an active model', () => {
  const state = createInitialState(), companyId = state.playerCompanyId;
  fleet(state).allocation = { serving: 0, development: 0, research: 0 };
  state.slices.products.offers.chat = { id: 'chat', companyId, name: 'Basic Chat', kind: 'basic-chat', deploymentId: 'deployment', contractId: 'contract', status: 'active', createdWeek: 0 };
  state.slices.products.deployments.deployment = { id: 'deployment', companyId, productId: 'chat', modelId: CONTENT.seedModel.id, status: 'active', startedWeek: 0,
    requiredStaff: U, completedStaff: U, readyWeek: 0, lastBottleneck: '' };
  const command: GameCommand = { id: 'smaller-cloud', companyId, issuedForWeek: 1, payload: { kind: 'set_cloud_capacity', cu: 0 } };
  const computeOwner = createComputeModule(CONTENT);
  assert.equal(computeOwner.validateCommand!(state, command, CONTENT)?.code, 'MISSING_MEMORY');
  state.slices.products.offers.chat.status = 'paused';
  assert.equal(computeOwner.validateCommand!(state, command, CONTENT), undefined);
});

test('W1-RESOURCE-14: pending recruitment fees cannot spend the same money twice', () => {
  let state = createInitialState(); company(state).cashCents = 200_000;
  state = queue(state, { kind: 'hire_staff', role: 'ml' }, 'reserved-first');
  const result = submitCommand(state, { kind: 'hire_staff', role: 'data' }, CONTENT, 'reserved-second');
  assert.equal(result.accepted, false);
  assert.equal(result.reason?.code, 'INSUFFICIENT_FUNDS');
  assert.equal(canonicalStateHash(result.state), canonicalStateHash(state));
  assert.equal(Object.keys(state.slices.company.staff).length, 0);
});

test('W1-RESOURCE-15: saved onboarding and assignment state reproduce exact future payroll', () => {
  let state = step(queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }, 'saved-employee'));
  state = queue(state, { kind: 'set_staff_allocation', staffId: 'staff:saved-employee', fte: U / 2 });
  const saved = deserializeState(serializeState(state));
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error('Snapshot did not restore.');
  let restored = saved.state;
  for (let week = 0; week < 4; week++) { state = step(state); restored = step(restored); }
  assert.equal(canonicalStateHash(restored), canonicalStateHash(state));
  assert.equal(getWorkforce(restored, restored.playerCompanyId).capacity.ml, 3 * U / 4, 'Half-time output remains 15 Design points after reload.');
  assert.equal(getPayrollCents(restored, restored.playerCompanyId, CONTENT), 30_000);
});

test('W1-RESOURCE-16: malformed optional reservations are rejected before entering the resource frame', () => {
  const state = createInitialState();
  const malformed: Record<string, unknown>[] = [
    { headroomBps: -1 },
    { headroomBps: 10_001 },
    { supervision: null },
    { supervision: { role: 'ml', workPerStaffWeek: 4 * U } },
    { staffDemand: [{ role: 'data', staffWeeks: U }], supervision: { role: 'data', workPerStaffWeek: 0 } },
  ];
  for (const fields of malformed) {
    const frame: ResourceFrame = { requests: [], staffGrants: [], computeGrants: [] };
    const request = { ...work(state, 'invalid-reservation'), ...fields } as WorkRequest;
    assert.throws(() => collectResourceResult(frame, requester(() => []), { workRequests: [request] }, 'request', state));
    assert.deepEqual(frame, { requests: [], staffGrants: [], computeGrants: [] });
  }
});

test('W1-RESOURCE-17: a granting owner cannot bypass headroom, workspace, hardware, or supervision conservation', () => {
  const state = createInitialState();
  state.slices.company.founderAssignments[state.playerCompanyId] = { ...emptyRoleAllocation(), ml: U / 4 };
  function reject(requests: WorkRequest[], grants: ResourceGrant[], expected: RegExp, staffGrants: StaffGrant[] = []) {
    const frame: ResourceFrame = { requests: [], staffGrants: [], computeGrants: [] };
    collectResourceResult(frame, requester(() => []), { workRequests: requests }, 'request', state);
    collectResourceResult(frame, createCompanyModule(CONTENT), { staffGrants }, 'grant', state);
    const before = structuredClone(frame);
    assert.throws(() => collectResourceResult(frame, createComputeModule(CONTENT), { computeGrants: grants }, 'grant', state), expected);
    assert.deepEqual(frame, before);
  }
  const grant = (id: string, overrides: Partial<ResourceGrant> = {}): ResourceGrant => ({
    requestId: id, physicalCUw: 2 * U, hardwareEffectiveCUw: 2 * U, memoryMU: 4 * U, poolId: 'general-cloud', ...overrides,
  });
  reject([work(state, 'headroom', { headroomBps: 1000 })], [grant('headroom')], /allocation/);
  reject([work(state, 'no-workspace')], [grant('no-workspace', { memoryMU: 0 })], /full memory workspace/);
  reject([work(state, 'partial-workspace')], [grant('partial-workspace', { memoryMU: 2 * U })], /partial memory workspace/);
  reject([work(state, 'free-hardware')], [grant('free-hardware', { physicalCUw: U })], /one-to-one hardware/);
  reject(['memory-a', 'memory-b'].map(id => work(state, id, { normalizedWorkCUw: U, memoryMU: 5 * U })),
    ['memory-a', 'memory-b'].map(id => grant(id, { physicalCUw: U, hardwareEffectiveCUw: U, memoryMU: 5 * U })), /total memory capacity/);
  reject([work(state, 'supervision', { staffDemand: [{ role: 'ml', staffWeeks: U / 2 }], supervision: { role: 'ml', workPerStaffWeek: 4 * U } })],
    [grant('supervision')], /staff supervision/, [{ requestId: 'supervision', grants: [{ role: 'ml', staffWeeks: U / 4 }] }]);
});

test('W1-RESOURCE-18: malicious double grants of the same founder capacity abort the entire week', () => {
  const initial = createInitialState(), before = canonicalStateHash(initial);
  const companyOwner = createCompanyModule(CONTENT);
  const maliciousCompany: DomainModule = { ...companyOwner, grantResources: (_state, context) => ({
    staffGrants: context.resources.requests.map(request => ({ requestId: request.id, grants: [{ role: 'data', staffWeeks: U }] })),
  }) };
  const result = advanceWeek(initial, CONTENT, [maliciousCompany, createComputeModule(CONTENT), requester(state =>
    ['double-staff-a', 'double-staff-b'].map(id => work(state, id, { normalizedWorkCUw: 0, memoryMU: 0, staffDemand: [{ role: 'data', staffWeeks: U }] }))),
  ]);
  assert.equal(result.accepted, false);
  assert.match(result.reason!.message, /assigned ready data staff capacity/);
  assert.equal(canonicalStateHash(result.state), before);
  assert.equal(canonicalStateHash(initial), before);
  assert.equal(company(result.state).cashCents, CONTENT.opening.cashCents);
});
