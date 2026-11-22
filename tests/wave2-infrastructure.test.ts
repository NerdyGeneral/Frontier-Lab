import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { validateContent } from '../src/content/validate';
import { RESOURCE_SCALE } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameContent, GameState, ResourceFrame, WorkRequest } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { collectResourceResult } from '../src/core/resources';
import { assertWave2InfrastructureState } from '../src/core/wave2-infrastructure-validation';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { getComputePools, getInfrastructureBaseCost, getInfrastructureOperatingStaff, infrastructureOperationsId } from '../src/modules/compute-pools';
import { getInfrastructureView } from '../src/modules/infrastructure';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const U = RESOURCE_SCALE;
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];
function initial(): GameState {
  const state = createPlayerOnlyState();
  state.slices.company.companies[state.playerCompanyId].cashCents = 100_000_000;
  state.slices.company.founderAssignments[state.playerCompanyId] = { ...emptyRoleAllocation(), infrastructure: U };
  fleet(state).cloudCU = 0; fleet(state).memoryMU = 0; fleet(state).allocation = { serving: 0, development: 0, research: 0 };
  return state;
}
function queue(state: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(state, payload, CONTENT, id);
  assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function step(state: GameState, extra: DomainModule[] = []): GameState {
  const result = advanceWeek(state, CONTENT, [createCompanyModule(CONTENT), createComputeModule(CONTENT), ...extra]);
  assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function requester(demand: (state: Readonly<GameState>) => WorkRequest[], observed?: { frame?: ResourceFrame }): DomainModule {
  return { id: 'infrastructure-fixture', owns: [], handlers: {
    reserve: state => ({ workRequests: demand(state) }),
    execute: (_state, context) => { if (observed) observed.frame = structuredClone(context.resources); return {}; },
  } };
}
function work(state: Readonly<GameState>, id: string, fields: Partial<WorkRequest> = {}): WorkRequest {
  return { id, companyId: state.playerCompanyId, taskId: id, category: 'serving', normalizedWorkCUw: 2 * U, memoryMU: 2 * U,
    priority: 0, poolId: 'auto', ...fields };
}
function installedRacks(classes: string[] = ['general']): GameState {
  let state = initial();
  classes.forEach((hardwareId, index) => { state = queue(state, { kind: 'order_rack', hardwareId, location: 'colocation' }, `purchase-${index}`); });
  while (state.week < 7) state = step(state);
  for (const rack of Object.values(state.slices.compute.racks)) state = queue(state, { kind: 'install_rack', rackId: rack.id });
  for (let guard = 0; Object.values(state.slices.compute.racks).some(rack => rack.status !== 'installed') && guard < 20; guard++) state = step(state);
  assert.ok(Object.values(state.slices.compute.racks).every(rack => rack.status === 'installed'));
  return state;
}
function completedSite(): { state: GameState; capitalPaid: number } {
  let state = step(queue(initial(), { kind: 'start_facility' }, 'site'));
  let capitalPaid = 400_000;
  state = queue(state, { kind: 'order_rack', hardwareId: 'general', location: 'facility-site' }, 'site-rack');
  while (state.week < 21) {
    const site = state.slices.compute.facilities['facility-site'];
    if (site.status === 'building' && !site.stages[site.stageIndex].paidCents) state = queue(state, { kind: 'fund_facility_stage', facilityId: site.id });
    const rack = state.slices.compute.racks['rack-site-rack'];
    if (rack?.status === 'inventory') state = queue(state, { kind: 'install_rack', rackId: rack.id });
    state = step(state);
    capitalPaid += state.slices.company.ledger.filter(entry => entry.companyId === state.playerCompanyId && entry.week === state.week && entry.category === 'capital').reduce((sum, entry) => sum + entry.amountCents, 0);
    if (state.week <= 20) assert.equal(getComputePools(state).filter(pool => pool.ownership === 'owned').reduce((sum, pool) => sum + pool.capacityCU, 0), 0);
  }
  return { state, capitalPaid };
}

test('W2-INFRA-01: an eight-CU purchase waits six weeks, installs with one actual staff-week, and activates at the following boundary', () => {
  let state = step(queue(initial(), { kind: 'order_rack', hardwareId: 'general', location: 'colocation' }, 'rack-order'));
  const id = 'rack-rack-order';
  assert.equal(state.slices.compute.racks[id].purchaseCents, 1_800_000);
  assert.equal(state.slices.compute.racks[id].arrivalWeek, 7);
  assert.equal(fleet(state).ownedCU, 0);
  while (state.week < 6) state = step(state);
  assert.equal(state.slices.compute.racks[id].status, 'ordered');
  assert.equal(getInfrastructureBaseCost(state), 0);
  state = step(state);
  assert.equal(state.slices.compute.racks[id].status, 'inventory');
  assert.equal(fleet(state).inventory[id].memoryMU, 16 * U);
  assert.equal(fleet(state).ownedCU, 0);
  state = step(queue(state, { kind: 'install_rack', rackId: id }));
  assert.equal(state.slices.compute.racks[id].completedInstallStaff, U);
  assert.equal(state.slices.compute.racks[id].readyWeek, 9);
  assert.equal(fleet(state).ownedCU, 0);
  state = step(state);
  assert.equal(fleet(state).ownedCU, 8 * U);
  assert.equal(fleet(state).memoryMU, 16 * U);
  assert.equal(getInfrastructureBaseCost(state), 16_000);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === 'capital:rack-order').length, 1);
  assert.equal(state.slices.compute.racks[id].installedWeek, 9);
});

test('W2-INFRA-02 / M07-T05: two general colocation racks executing fourteen physical CUw cost $320 fixed plus $700 variable', () => {
  let state = installedRacks(['general', 'general']);
  state = queue(state, { kind: 'allocate_compute', serving: 16 * U, development: 0, research: 0 });
  state = step(state, [requester(snapshot => [work(snapshot, 'fourteen', { normalizedWorkCUw: 14 * U })])]);
  assert.equal(fleet(state).lastWork.serving, 14 * U);
  const costs = state.slices.company.ledger.filter(entry => entry.companyId === state.playerCompanyId && entry.week === state.week && ['owned-infrastructure', 'owned-gpu-work'].includes(entry.sourceId));
  assert.equal(costs.find(entry => entry.sourceId === 'owned-infrastructure')!.amountCents, 32_000);
  assert.equal(costs.find(entry => entry.sourceId === 'owned-gpu-work')!.amountCents, 70_000);
  assert.equal(costs.reduce((sum, entry) => sum + entry.amountCents, 0), 102_000);
  assert.equal(getInfrastructureOperatingStaff(state), U / 2);
  assert.equal(state.slices.company.companies[state.playerCompanyId].lastWeek.operatingExpenseCents, 122_000);
});

test('W2-INFRA-03 / M07-T04: six separately paid stages take twenty weeks and four staff-weeks; early hardware waits for commissioning', () => {
  const { state, capitalPaid } = completedSite();
  const site = state.slices.compute.facilities['facility-site'];
  assert.equal(capitalPaid, 5_800_000, 'The site costs $40,000 and its separate rack costs $18,000.');
  assert.deepEqual(site.stages.map(stage => stage.completedWeek), [2, 4, 10, 16, 18, 20]);
  assert.equal(site.stages.reduce((sum, stage) => sum + stage.paidCents, 0), 4_000_000);
  assert.equal(site.stages.reduce((sum, stage) => sum + stage.completedStaff, 0), 4 * U);
  assert.equal(site.status, 'active'); assert.equal(site.readyWeek, 21);
  assert.equal(state.slices.compute.racks['rack-site-rack'].installedWeek, 10);
  assert.equal(getInfrastructureBaseCost(state), 28_000);
  assert.equal(getComputePools(state).find(pool => pool.ownership === 'owned')!.capacityCU, 8 * U);
  assert.equal(getInfrastructureOperatingStaff(state), 375_000_000);
  assert.deepEqual(validateState(state), []);
});

test('W2-INFRA-04: elapsed time cannot replace construction staff; pause and partial-build saves replay exactly', () => {
  let state = initial(); state.slices.company.founderAssignments[state.playerCompanyId] = emptyRoleAllocation();
  state = step(queue(state, { kind: 'start_facility' }, 'paused-site'));
  state = step(state);
  const id = 'facility-paused-site';
  assert.equal(state.slices.compute.facilities[id].stageIndex, 0);
  assert.equal(state.slices.compute.facilities[id].stages[0].elapsedWeeks, 2);
  assert.equal(state.slices.compute.facilities[id].stages[0].completedStaff, 0);
  state = step(queue(state, { kind: 'set_facility_paused', facilityId: id, paused: true }));
  const saved = deserializeState(serializeState(state)); assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error('Construction snapshot could not restore.');
  let restored = saved.state;
  for (const payload of [
    { kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), infrastructure: U } },
    { kind: 'set_facility_paused', facilityId: id, paused: false },
  ] as CommandPayload[]) { state = queue(state, payload); restored = queue(restored, payload); }
  state = step(state); restored = step(restored);
  assert.equal(canonicalStateHash(state), canonicalStateHash(restored));
  assert.equal(state.slices.compute.facilities[id].stageIndex, 1);
  assert.equal(state.slices.compute.facilities[id].stages[0].completedStaff, U / 4);
  assert.equal(state.slices.compute.facilities[id].stages[1].paidCents, 0, 'No later stage is autocharged.');
});

test('W2-INFRA-05: missing operations staff derates usable hardware; parking frees capacity while upkeep remains', () => {
  let state = installedRacks(['general', 'general']);
  state = step(queue(state, { kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), infrastructure: U / 4 } }));
  const pool = getComputePools(state).find(item => item.ownership === 'owned')!;
  assert.equal(pool.capacityCU, 8 * U); assert.equal(pool.memoryMU, 16 * U); assert.equal(pool.staffCoverageBps, 5000);
  assert.equal(fleet(state).ownedCU, 16 * U);
  const rackId = Object.keys(state.slices.compute.racks)[0];
  state = step(queue(state, { kind: 'set_rack_parked', rackId, parked: true }));
  assert.equal(getInfrastructureBaseCost(state), 32_000);
  assert.equal(getComputePools(state).find(item => item.ownership === 'owned')!.capacityCU, 4 * U);
  assert.equal(fleet(state).ownedCU, 16 * U, 'Installed nominal capacity retains the parked rack.');
  assert.match(getInfrastructureView(state).racks.find(rack => rack.id === rackId)!.lastBottleneck, /parked/i);
});

test('W2-INFRA-06: a training rack converts physical work once, while owned usage bills physical work and headroom stays unbilled', () => {
  let state = installedRacks(['training']);
  const observed: { frame?: ResourceFrame } = {};
  state = step(queue(state, { kind: 'allocate_compute', serving: 0, development: 8 * U, research: 0 }), [requester(snapshot => [
    work(snapshot, 'training-throughput', { category: 'development', normalizedWorkCUw: 18 * U, memoryMU: 4 * U }),
  ], observed)]);
  const grant = observed.frame!.computeGrants.find(item => item.requestId === 'training-throughput')!;
  assert.equal(grant.physicalCUw, 8 * U); assert.equal(grant.hardwareEffectiveCUw, 14_400_000_000);
  assert.equal(state.slices.company.ledger.find(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work')!.amountCents, 60_000);
  state = step(queue(state, { kind: 'allocate_compute', serving: 8 * U, development: 0, research: 0 }), [requester(snapshot => [
    work(snapshot, 'serving-headroom', { normalizedWorkCUw: 2_200_000_000, headroomBps: 1000 }),
  ], observed)]);
  const serving = observed.frame!.computeGrants.find(item => item.requestId === 'serving-headroom')!;
  assert.equal(serving.physicalCUw, 2 * U); assert.equal(serving.hardwareEffectiveCUw, 2_200_000_000);
  assert.equal(fleet(state).reservedCU, 2_200_000_000);
  assert.equal(state.slices.company.ledger.find(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work')!.amountCents, 15_000);
});

test('W2-INFRA-07: connected training racks apply ordinary fabric once; separate classes cannot lend memory', () => {
  let state = installedRacks(['training', 'training']);
  const observed: { frame?: ResourceFrame } = {};
  state = step(queue(state, { kind: 'allocate_compute', serving: 0, development: 16 * U, research: 0 }), [requester(snapshot => [
    work(snapshot, 'cross-rack', { category: 'development', normalizedWorkCUw: 30 * U, memoryMU: 24 * U }),
  ], observed)]);
  const grant = observed.frame!.computeGrants.find(item => item.requestId === 'cross-rack')!;
  assert.equal(grant.physicalCUw, 16 * U); assert.equal(grant.hardwareEffectiveCUw, 20_160_000_000);
  assert.equal(fleet(state).lastWork.development, grant.physicalCUw);
  let mixed = installedRacks(['general', 'memory-rich']);
  mixed = step(queue(mixed, { kind: 'allocate_compute', serving: 0, development: 16 * U, research: 0 }), [requester(snapshot => [
    work(snapshot, 'cannot-borrow-memory', { category: 'development', normalizedWorkCUw: 4 * U, memoryMU: 40 * U }),
  ], observed)]);
  assert.equal(fleet(mixed).memoryMU, 48 * U);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'cannot-borrow-memory')!.physicalCUw, 0);
  assert.match(fleet(mixed).lastBottleneck, /one compatible pool/);
});

test('W2-INFRA-08: standard-site power/cooling envelopes derate training hardware independently of slots', () => {
  const { state } = completedSite();
  const site = state.slices.compute.facilities['facility-site'], template = state.slices.compute.racks['rack-site-rack'];
  delete state.slices.compute.racks[template.id];
  for (let i = 0; i < 8; i++) state.slices.compute.racks[`fixture-${i}`] = { ...template, id: `fixture-${i}`, hardwareId: 'training' };
  const required = getInfrastructureOperatingStaff(state);
  const pool = getComputePools(state, state.playerCompanyId, CONTENT, [{ requestId: infrastructureOperationsId(state.playerCompanyId), grants: [{ role: 'infrastructure', staffWeeks: required }] }]).find(item => item.ownership === 'owned')!;
  assert.equal(required, 1_250_000_000);
  assert.equal(pool.nominalCU, 64 * U); assert.equal(pool.capacityCU, 40 * U); assert.equal(pool.memoryMU, 80 * U);
  assert.equal(pool.powerCoverageBps, 6250); assert.equal(pool.coolingCoverageBps, 6250);
  assert.match(pool.bottleneck, /power/); assert.equal(site.status, 'active');
});

test('W2-INFRA-09: collector rejects a fabricated hardware multiplier and cross-pool memory; snapshots reject free capacity and unpaid stages', () => {
  const state = installedRacks(['training']); fleet(state).allocation.development = 8 * U;
  const owner = createComputeModule(CONTENT), requesterModule = requester(() => []);
  const pool = getComputePools(state).find(item => item.ownership === 'owned')!;
  const frame: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
  const ops: WorkRequest = { ...work(state, infrastructureOperationsId(state.playerCompanyId)), normalizedWorkCUw: 0, memoryMU: 0,
    staffDemand: [{ role: 'infrastructure', staffWeeks: U / 4 }] };
  const demand = work(state, 'fabricated', { category: 'development', normalizedWorkCUw: 20 * U, memoryMU: 4 * U });
  collectResourceResult(frame, requesterModule, { workRequests: [ops, demand] }, 'request', state);
  collectResourceResult(frame, createCompanyModule(CONTENT), { staffGrants: [{ requestId: ops.id, grants: [{ role: 'infrastructure', staffWeeks: U / 4 }] }] }, 'grant', state);
  assert.throws(() => collectResourceResult(frame, owner, { computeGrants: [{ requestId: demand.id, poolId: pool.id, physicalCUw: 8 * U, hardwareEffectiveCUw: 18 * U, memoryMU: 4 * U }] }, 'grant', state), /hardware and fabric conversion/);
  const mixed = installedRacks(['general', 'memory-rich']); fleet(mixed).allocation.development = 16 * U;
  const general = getComputePools(mixed).find(item => item.ownership === 'owned' && item.hardwareId === 'general')!;
  const mixedFrame: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
  const mixedOps = { ...ops, staffDemand: [{ role: 'infrastructure' as const, staffWeeks: U / 2 }] };
  const tooLarge = work(mixed, 'borrowed-memory', { category: 'development', normalizedWorkCUw: U, memoryMU: 24 * U });
  collectResourceResult(mixedFrame, requesterModule, { workRequests: [mixedOps, tooLarge] }, 'request', mixed);
  collectResourceResult(mixedFrame, createCompanyModule(CONTENT), { staffGrants: [{ requestId: mixedOps.id, grants: [{ role: 'infrastructure', staffWeeks: U / 2 }] }] }, 'grant', mixed);
  assert.throws(() => collectResourceResult(mixedFrame, owner, { computeGrants: [{ requestId: tooLarge.id, poolId: general.id, physicalCUw: U, hardwareEffectiveCUw: U, memoryMU: 24 * U }] }, 'grant', mixed), /compatible pool memory/);
  const badFleet = structuredClone(state); fleet(badFleet).ownedCU += U;
  assert.throws(() => assertWave2InfrastructureState(badFleet, CONTENT), /reconcile/);
  const { state: siteState } = completedSite();
  siteState.slices.compute.facilities['facility-site'].stages[3].paidCents = 0;
  assert.throws(() => assertWave2InfrastructureState(siteState, CONTENT), /unfunded|payment/i);
});

test('W2-INFRA-10: sparse requests without installed fabric stay blocked and insolvent companies receive no further physical work', () => {
  let state = installedRacks(['general']); const observed: { frame?: ResourceFrame } = {};
  state = step(queue(state, { kind: 'allocate_compute', serving: 8 * U, development: 0, research: 0 }), [requester(snapshot => [
    work(snapshot, 'future-fabric', { requiresFastFabric: true }),
  ], observed)]);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'future-fabric')!.physicalCUw, 0);
  assert.match(fleet(state).lastBottleneck, /fast fabric/);
  state.slices.company.companies[state.playerCompanyId].arrearsCents = 100;
  const computeOwner = createComputeModule(CONTENT), request = work(state, 'unpaid-work');
  const result = computeOwner.grantResources!(state, { week: state.week, phase: 'reserve', content: CONTENT, facts: [], resources: { requests: [request], computeGrants: [], staffGrants: [] }, random: { draw: () => 0 } });
  assert.equal(result.computeGrants![0].physicalCUw, 0); assert.equal(result.computeGrants![0].memoryMU, 0);
  assert.match(result.updates!.compute!.fleets[state.playerCompanyId].lastBottleneck, /unpaid bills/i);
});

test('W2-INFRA-11 / M07-T06: twelve serving CUw plus headroom and two research CUw leave 0.8 for training', () => {
  let state = installedRacks(['general', 'general']);
  const observed: { frame?: ResourceFrame } = {};
  state = step(queue(state, { kind: 'allocate_compute', serving: 13_200_000_000, research: 2 * U, development: 800_000_000 }), [requester(snapshot => [
    work(snapshot, 'existing-service', { normalizedWorkCUw: 12 * U, headroomBps: 1000 }),
    work(snapshot, 'research-commitment', { category: 'research', normalizedWorkCUw: 2 * U, priority: 20 }),
    work(snapshot, 'new-training', { category: 'development', normalizedWorkCUw: 24 * U, priority: 30, memoryMU: 4 * U }),
  ], observed)]);
  const training = observed.frame!.computeGrants.find(grant => grant.requestId === 'new-training')!;
  assert.equal(fleet(state).reservedCU, 16 * U);
  assert.equal(fleet(state).lastWork.serving, 12 * U);
  assert.equal(training.hardwareEffectiveCUw, 800_000_000);
  assert.equal(Math.ceil(24 * U / training.hardwareEffectiveCUw), 30);
  assert.equal(Math.ceil(24 * U / (4 * U)), 6);
});

test('W2-INFRA-12: sub-cent actual GPU costs carry through saves rather than disappearing each week', () => {
  let state = installedRacks();
  const demand = requester(snapshot => [work(snapshot, 'small-owned-usage', { normalizedWorkCUw: 100_000, memoryMU: 0 })]);
  state = step(queue(state, { kind: 'allocate_compute', serving: U, development: 0, research: 0 }), [demand]);
  assert.equal(fleet(state).variableCostCarry, U / 2);
  assert.equal(state.slices.company.ledger.filter(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work').length, 0);
  const restored = deserializeState(serializeState(state)); assert.equal(restored.ok, true);
  if (!restored.ok) throw new Error('Cost-carry snapshot could not restore.');
  state = step(restored.state, [demand]);
  assert.equal(fleet(state).variableCostCarry, 0);
  assert.equal(state.slices.company.ledger.find(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work')!.amountCents, 1);
});

test('W2-INFRA-13: content rejects malformed fixed-point quantities, unsupported rack/site bounds, and invalid fabric precision', () => {
  assert.deepEqual(validateContent(CONTENT), []);
  const cases: [string, (content: GameContent) => void][] = [
    ['infrastructure', content => { content.infrastructure = null as unknown as GameContent['infrastructure']; }],
    ['infrastructure.rackCU', content => { content.infrastructure.rackCU = 4 * U; }],
    ['infrastructure.deliveryWeeks', content => { content.infrastructure.deliveryWeeks = 0; }],
    ['infrastructure.installationStaffWeeks', content => { content.infrastructure.installationStaffWeeks = 0.5; }],
    ['infrastructure.maxRacksPerCompany', content => { content.infrastructure.maxRacksPerCompany = 65; }],
    ['infrastructure.maxFacilitiesPerCompany', content => { content.infrastructure.maxFacilitiesPerCompany = 5; }],
    ['infrastructure.siteSlotsCU', content => { content.infrastructure.siteSlotsCU = 63 * U; }],
    ['infrastructure.sitePowerUnits', content => { content.infrastructure.sitePowerUnits = 0; }],
    ['infrastructure.siteCoolingUnits', content => { content.infrastructure.siteCoolingUnits = Number.MAX_SAFE_INTEGER; }],
    ['infrastructure.colocationStaffPerRack', content => { content.infrastructure.colocationStaffPerRack = -1; }],
    ['infrastructure.siteFixedCentsPerWeek', content => { content.infrastructure.siteFixedCentsPerWeek = 0; }],
    ['infrastructure.crossRackTrainingBps', content => { content.infrastructure.crossRackTrainingBps = 10_001; }],
    ['hardware[0].trainingMultiplier', content => { content.hardware[0].trainingMultiplier = 1.000001; }],
    ['hardware[0].trainingMultiplier', content => { content.hardware[0].trainingMultiplier = 0.0001; content.infrastructure.crossRackTrainingBps = 1; }],
  ];
  for (const [expected, change] of cases) {
    const content = structuredClone(CONTENT); change(content);
    assert.ok(validateContent(content).some(error => error.startsWith(expected)), `Expected a readable error for ${expected}`);
  }
});

test('W2-INFRA-14: content requires six ordered stages with positive fees and independent elapsed/staff requirements', () => {
  const cases: [string, (content: GameContent) => void][] = [
    ['infrastructure.stages', content => { content.infrastructure.stages.pop(); }],
    ['infrastructure.stages', content => { content.infrastructure.stages = null as unknown as GameContent['infrastructure']['stages']; }],
    ['infrastructure.stages[1].id', content => { content.infrastructure.stages[1].id = 'reservation'; }],
    ['infrastructure.stages[2].id', content => { [content.infrastructure.stages[2], content.infrastructure.stages[3]] = [content.infrastructure.stages[3], content.infrastructure.stages[2]]; }],
    ['infrastructure.stages[3].costCents', content => { content.infrastructure.stages[3].costCents = -1; }],
    ['infrastructure.stages[4].elapsedWeeks', content => { content.infrastructure.stages[4].elapsedWeeks = 0; }],
    ['infrastructure.stages[5].staffWeeks', content => { content.infrastructure.stages[5].staffWeeks = 0.25; }],
    ['infrastructure.stages[0].elapsedWeeks', content => { content.infrastructure.stages[0].elapsedWeeks = 105; }],
  ];
  for (const [expected, change] of cases) {
    const content = structuredClone(CONTENT); change(content);
    assert.ok(validateContent(content).some(error => error.startsWith(expected)), `Expected a readable error for ${expected}`);
  }
});
