import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { HARDWARE_BUYERS, chipProductionTerms } from '../src/content/silicon-market';
import { hardwareCostFactId, hardwareRevenueFactId } from '../src/modules/hardware-sales';
import { CONTENT } from '../src/content/catalog';
import { CHIP_RULES, chipSpecificationValues } from '../src/content/wave4-hardware';
import type { ChipSpecification } from '../src/contracts/wave4-hardware';
import type { CommandPayload, DomainModule, GameContent, GameState, ResourceFrame, WorkRequest } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { collectResourceResult } from '../src/core/resources';
import { assertWave4HardwareState } from '../src/core/wave4-hardware-validation';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { getComputePools, getInfrastructureBaseCost, getInfrastructureOperatingStaff, getPoolMultiplierBps, getRackCapacity, poolSupportsWorkload } from '../src/modules/compute-pools';
import { chipDesignId, chipPaybackForecast, getChipView, getServingHistoryWeeks, qualifiedChipYieldBps } from '../src/modules/chips';
import { createProductsModule } from '../src/modules/products';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const spec: ChipSpecification = { architecture: 'dense', target: 'inference', memory: 'balanced' };
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];
const design = (state: GameState, selected: ChipSpecification = spec) => state.slices.compute.chipDesigns[chipDesignId(state.playerCompanyId, selected)];
const baseModules = (content: GameContent = CONTENT) => [createCompanyModule(content), createComputeModule(content)];
const contentFor = (state: GameState): GameContent => state.contentVersion === CONTENT.version ? CONTENT
  : { ...CONTENT, version: state.contentVersion, buildVersion: state.buildVersion };

function step(state: GameState, extra: DomainModule[] = []): GameState {
  const content = contentFor(state);
  const result = advanceWeek(state, content, [...baseModules(content), ...extra]);
  assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function queue(state: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(state, payload, contentFor(state), id); assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function initial(content: GameContent = CONTENT): GameState {
  let state = createPlayerOnlyState(content);
  for (let n = 0; n < 10; n++) state = step(state);
  const companyId = state.playerCompanyId; company(state).cashCents = 500_000_000;
  state.slices.company.founderAssignments[companyId] = { ...emptyRoleAllocation() };
  const roles = ['hardware', 'hardware', 'ml', 'infrastructure', 'infrastructure', 'commercial'] as const;
  roles.forEach((role, index) => {
    const id = `chip-fixture-staff-${index}`;
    state.slices.company.staff[id] = { id, companyId, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  });
  company(state).activeStaff = roles.length;
  state.slices.research.completed = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R9', 'R10', 'R11', 'R12', 'R14', 'R16'];
  state.slices.research.completedByCompany[companyId] = [...state.slices.research.completed];
  for (const researchId of state.slices.research.completed) {
    const definition = CONTENT.research.find(item => item.id === researchId)!, id = `chip-fixture-${researchId}`;
    state.slices.research.projects[id] = { id, companyId, researchId, startedWeek: 0, completedWeek: 1, availableWeek: 2,
      requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U,
      completedStaff: definition.staffWeeks * U, role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
    state.slices.company.postedFacts[id + ':fee'] = true;
  }
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.capabilityBps = { conversation: 7000, documents: 7000, coding: 7000, tools: 6500 }; model.reliabilityBps = 9600;
  model.status = 'evaluated'; model.evaluationReportId = 'chip-fixture-evaluation';
  state.slices.models.reports[model.evaluationReportId] = { id: model.evaluationReportId, companyId, modelId: model.id,
    week: 9, heldOut: true, scenarioStart: true, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, basicChatEligible: true,
    cases: Array.from({ length: 20 }, (_, index) => ({ id: `chip-case-${index}`, domain: 'conversation', difficultyBps: 0, passed: true })), passedCases: 20 };
  fleet(state).cloudCU = 16 * U; fleet(state).memoryMU = 32 * U; fleet(state).allocation = { serving: 0, development: 8 * U, research: 8 * U };
  assert.deepEqual(validateState(state, content), []);
  return state;
}
function qualified(state = initial(), selected: ChipSpecification = spec): GameState {
  state = queue(state, { kind: 'start_chip_design', name: 'Copper One', spec: selected }, 'design');
  for (let guard = 0; design(state, selected)?.status !== 'design-ready' && guard < 12; guard++) state = step(state);
  assert.equal(design(state, selected).status, 'design-ready');
  state = queue(state, { kind: 'start_chip_prototype', designId: design(state, selected).id, modelId: CONTENT.seedModel.id }, 'prototype-stage');
  for (let guard = 0; design(state, selected).status !== 'validated' && guard < 12; guard++) state = step(state);
  assert.equal(design(state, selected).status, 'validated'); return state;
}
function installed(state = qualified(), racks: 1 | 2 | 4 = 1, selected: ChipSpecification = spec): GameState {
  state = queue(state, { kind: 'order_chip_batch', designId: design(state, selected).id, racks, location: 'colocation' }, 'production');
  for (let guard = 0; state.slices.compute.chipBatches['chip-batch-production']?.status !== 'delivered' && guard < 12; guard++) state = step(state);
  for (const rack of Object.values(state.slices.compute.racks)) state = queue(state, { kind: 'install_rack', rackId: rack.id });
  for (let guard = 0; Object.values(state.slices.compute.racks).some(rack => rack.status !== 'installed') && guard < 12; guard++) state = step(state);
  assert.ok(Object.values(state.slices.compute.racks).every(rack => rack.status === 'installed')); return state;
}
function requester(build: (state: Readonly<GameState>) => WorkRequest[], observed?: { frame?: ResourceFrame }): DomainModule {
  return { id: 'chip-fixture-requests', owns: [], handlers: { reserve: state => ({ workRequests: build(state) }),
    execute: (_state, context) => { if (observed) observed.frame = structuredClone(context.resources); return {}; } } };
}
function request(state: Readonly<GameState>, id: string, fields: Partial<WorkRequest> = {}): WorkRequest {
  return { id, companyId: state.playerCompanyId, taskId: id, category: 'serving', normalizedWorkCUw: 4 * U, memoryMU: 2 * U,
    priority: 0, poolId: 'auto', modelArchitecture: 'dense', workloadKind: 'inference', ...fields };
}

test('W4-H01: paid specification and prototype require separate staff/work meters and next-boundary qualification; duplicate specifications cannot reroll', () => {
  let state = initial();
  for (const member of Object.values(state.slices.company.staff)) if (member.role === 'hardware') member.assignedFte = 0;
  const cash = company(state).cashCents;
  state = step(queue(state, { kind: 'start_chip_design', name: 'Copper One', spec }, 'design'));
  const id = design(state).id;
  assert.equal(design(state).design.completedWorkCUw, CHIP_RULES.designWorkCUw);
  assert.equal(design(state).design.completedHardwareStaff, 0);
  assert.equal(design(state).status, 'designing'); assert.equal(fleet(state).ownedCU, 0);
  assert.ok(company(state).cashCents < cash - CHIP_RULES.baseDesignFeeCents);
  assert.equal(previewCommand(state, { kind: 'start_chip_design', name: 'Different label', spec }, CONTENT).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(previewCommand(state, { kind: 'order_chip_batch', designId: id, racks: 1, location: 'colocation' }, CONTENT).accepted, false);
  state = step(queue(state, { kind: 'set_chip_project_paused', designId: id, paused: true }));
  const before = canonicalStateHash(design(state).design);
  state = step(state); assert.equal(canonicalStateHash(design(state).design), before);
  for (const member of Object.values(state.slices.company.staff)) if (member.role === 'hardware') member.assignedFte = U;
  state = step(queue(state, { kind: 'set_chip_project_paused', designId: id, paused: false }));
  state = step(state); assert.equal(design(state).design.completedHardwareStaff, 4 * U);
  assert.equal(design(state).status, 'designing'); state = step(state); assert.equal(design(state).status, 'design-ready');
  const absentReport = structuredClone(state); delete absentReport.slices.models.reports['chip-fixture-evaluation'];
  assert.equal(previewCommand(absentReport, { kind: 'start_chip_prototype', designId: id, modelId: CONTENT.seedModel.id }, CONTENT).accepted, false);
  state = step(queue(state, { kind: 'start_chip_prototype', designId: id, modelId: CONTENT.seedModel.id }, 'prototype-stage'));
  assert.equal(design(state).prototypeRun!.completedWorkCUw, 4 * U);
  assert.equal(design(state).prototypeRun!.completedHardwareStaff, 2 * U); assert.equal(design(state).prototypeRun!.completedMlStaff, U);
  assert.equal(design(state).qualifiedYieldBps, null); assert.equal(fleet(state).ownedCU, 0);
  state = step(state); assert.equal(design(state).status, 'validated');
  assert.equal(design(state).qualifiedYieldBps, qualifiedChipYieldBps(state, state.playerCompanyId, spec));
  assert.equal(company(state).earnedRevenueCents, 0);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === `chip-design-fee:${id}`).length, 1);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === `chip-prototype-fee:${id}`).length, 1);
});

test('W4-H02: manufacturing payment yields finite inventory after lead time; installation is the only path to staffed capacity', () => {
  let state = qualified();
  const candidate = design(state), values = chipSpecificationValues(candidate.spec), usable = 8 * U * candidate.qualifiedYieldBps! / 10_000;
  const revenue = company(state).earnedRevenueCents;
  state = step(queue(state, { kind: 'order_chip_batch', designId: candidate.id, racks: 1, location: 'colocation' }, 'production'));
  const batch = state.slices.compute.chipBatches['chip-batch-production'], rackId = batch.rackIds[0];
  assert.equal(batch.purchaseCents, 8 * values.purchaseCentsPerCU); assert.equal(batch.arrivalWeek, state.week + values.deliveryWeeks);
  assert.equal(batch.usableCU, usable); assert.equal(batch.attemptedCU, 8 * U); assert.equal(fleet(state).ownedCU, 0);
  assert.equal(previewCommand(state, { kind: 'install_rack', rackId }, CONTENT).accepted, false);
  while (state.week < batch.arrivalWeek - 1) state = step(state);
  assert.equal(state.slices.compute.racks[rackId].status, 'ordered'); assert.equal(fleet(state).ownedCU, 0);
  state = step(state); assert.equal(state.slices.compute.chipBatches[batch.id].status, 'delivered');
  assert.equal(fleet(state).inventory[rackId].cu, usable); assert.equal(fleet(state).ownedCU, 0);
  state = step(queue(state, { kind: 'install_rack', rackId }));
  assert.equal(state.slices.compute.racks[rackId].completedInstallStaff, U); assert.equal(fleet(state).ownedCU, 0);
  state = step(state); assert.equal(fleet(state).ownedCU, usable);
  const pool = getComputePools(state).find(item => item.hardwareId === candidate.id)!;
  assert.equal(pool.capacityCU, usable); assert.equal(pool.memoryMU, usable * 2); assert.equal(pool.servingBps, 20000);
  assert.deepEqual(pool.architectures, ['dense']); assert.deepEqual(pool.workloads, ['inference']);
  assert.equal(getInfrastructureBaseCost(state), 16000); assert.equal(getInfrastructureOperatingStaff(state), U / 4);
  assert.equal(company(state).earnedRevenueCents, revenue);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === batch.paymentId).length, 1);
  assert.equal(fleet(state).deliveredEquipmentIds.filter(id => id === rackId).length, 1);
});

test('W4-H03: compatible custom silicon accelerates actual work, bills physical usage, and cannot execute training or sparse work on its inference compiler', () => {
  let state = installed(); const observed: { frame?: ResourceFrame } = {};
  state = step(queue(state, { kind: 'allocate_compute', serving: fleet(state).ownedCU, development: 0, research: 0 }));
  state = queue(state, { kind: 'set_cloud_capacity', cu: 0 });
  state = step(state, [requester(snapshot => [request(snapshot, 'inference-proof')], observed)]);
  const grant = observed.frame!.computeGrants.find(item => item.requestId === 'inference-proof')!;
  assert.equal(grant.hardwareEffectiveCUw, 4 * U); assert.equal(grant.physicalCUw, 2 * U);
  assert.equal(fleet(state).lastWork.serving, 2 * U);
  assert.equal(state.slices.company.ledger.find(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work')!.amountCents, 5000);
  state = step(queue(state, { kind: 'allocate_compute', serving: 0, development: fleet(state).ownedCU, research: 0 }), [requester(snapshot => [request(snapshot, 'training-proof', { category: 'development', workloadKind: 'training' })], observed)]);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'training-proof')!.hardwareEffectiveCUw, 0);
  assert.equal(fleet(state).occupiedMemoryMU, 0);
  state = step(state, [requester(snapshot => [request(snapshot, 'evaluation-proof', { category: 'development', workloadKind: 'inference' })], observed)]);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'evaluation-proof')!.hardwareEffectiveCUw, 4 * U);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'evaluation-proof')!.physicalCUw, 2 * U);
  state = step(state, [requester(snapshot => [request(snapshot, 'sparse-proof', { category: 'development', modelArchitecture: 'sparse', requiresFastFabric: true })], observed)]);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'sparse-proof')!.hardwareEffectiveCUw, 0);
  const rack = Object.values(state.slices.compute.racks)[0];
  state = step(queue(state, { kind: 'set_rack_parked', rackId: rack.id, parked: true }));
  assert.equal(getComputePools(state).find(item => item.ownership === 'owned')!.capacityCU, 0);
  assert.equal(getInfrastructureBaseCost(state), 16000, 'Parking releases work and power, not installed upkeep.');
});

function generalPair(): GameState {
  let state = initial();
  state = queue(state, { kind: 'order_rack', hardwareId: 'general', location: 'colocation' }, 'general-a');
  state = queue(state, { kind: 'order_rack', hardwareId: 'general', location: 'colocation' }, 'general-b');
  for (let n = 0; n < 7; n++) state = step(state);
  for (const rack of Object.values(state.slices.compute.racks)) state = queue(state, { kind: 'install_rack', rackId: rack.id });
  state = step(state); state = step(state); return state;
}

test('W4-H04: sparse work is rejected without fabric, then admitted only after a paid three-meter installation; the independent resource boundary rejects forged grants', () => {
  let state = generalPair(); const observed: { frame?: ResourceFrame } = {};
  const build = (snapshot: Readonly<GameState>) => [request(snapshot, 'sparse-training', { category: 'development', normalizedWorkCUw: 8 * U,
    memoryMU: 24 * U, modelArchitecture: 'sparse', workloadKind: 'training', requiresFastFabric: true })];
  state = step(queue(state, { kind: 'allocate_compute', serving: 0, development: 16 * U, research: 0 }), [requester(build, observed)]);
  assert.equal(observed.frame!.computeGrants.find(item => item.requestId === 'sparse-training')!.hardwareEffectiveCUw, 0);
  const noFabric = structuredClone(state), source = requester(build), compute = createComputeModule(CONTENT), frame: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
  collectResourceResult(frame, source, { workRequests: build(noFabric) }, 'request', noFabric, CONTENT);
  const pool = getComputePools(noFabric).find(item => item.ownership === 'owned')!;
  assert.throws(() => collectResourceResult(frame, compute, { computeGrants: [{ requestId: 'sparse-training', poolId: pool.id,
    physicalCUw: 8 * U, hardwareEffectiveCUw: 8 * U, memoryMU: 24 * U }] }, 'grant', noFabric, CONTENT), /compatibility|fabric/);
  state = step(queue(state, { kind: 'install_fast_fabric', location: 'colocation' }, 'fabric'));
  assert.equal(state.slices.compute.fabricProjects['fabric-fabric'].elapsedWeeks, 1);
  assert.equal(hasActiveFabric(state), false);
  assert.equal(previewCommand(state, { kind: 'install_fast_fabric', location: 'colocation' }, CONTENT).reason?.code, 'ALREADY_ACTIVE');
  state = step(state); state = step(state);
  assert.equal(state.slices.compute.fabricProjects['fabric-fabric'].status, 'ready');
  assert.equal(hasActiveFabric(state), false);
  state = step(state, [requester(build, observed)]);
  const active = state.slices.compute.fabricProjects['fabric-fabric'];
  assert.equal(active.status, 'active'); assert.equal(active.completedStaff, 2 * U); assert.equal(active.completedWorkCUw, 4 * U);
  const grant = observed.frame!.computeGrants.find(item => item.requestId === 'sparse-training')!;
  assert.equal(grant.hardwareEffectiveCUw, 8 * U); assert.equal(grant.physicalCUw, Math.ceil(8 * U * 10000 / 9500));
  assert.equal(grant.memoryMU, 24 * U); assert.equal(getInfrastructureBaseCost(state), 40000);
  const livePool = getComputePools(state).find(item => item.ownership === 'owned')!;
  assert.equal(poolSupportsWorkload(livePool, build(state)[0]), true); assert.equal(getPoolMultiplierBps(livePool, 'development', true), 9500);
  const independent: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
  collectResourceResult(independent, source, { workRequests: observed.frame!.requests }, 'request', state, CONTENT);
  collectResourceResult(independent, createCompanyModule(CONTENT), { staffGrants: observed.frame!.staffGrants }, 'grant', state, CONTENT);
  assert.doesNotThrow(() => collectResourceResult(independent, compute, { computeGrants: observed.frame!.computeGrants }, 'grant', state, CONTENT));
});

function hasActiveFabric(state: GameState): boolean { return getComputePools(state).some(pool => pool.ownership === 'owned' && pool.fastFabric); }

test('W4-H05: fabric pause preserves paid work and elapsed time; staffing and parking still constrain a wired pool', () => {
  let state = generalPair();
  state = step(queue(state, { kind: 'install_fast_fabric', location: 'colocation' }, 'fabric'));
  state = step(queue(state, { kind: 'set_fabric_paused', fabricId: 'fabric-fabric', paused: true }));
  const before = structuredClone(state.slices.compute.fabricProjects['fabric-fabric']); state = step(state);
  assert.deepEqual(state.slices.compute.fabricProjects['fabric-fabric'], before);
  state = step(queue(state, { kind: 'set_fabric_paused', fabricId: 'fabric-fabric', paused: false }));
  state = step(state); state = step(state); assert.equal(hasActiveFabric(state), true);
  for (const member of Object.values(state.slices.company.staff)) if (member.role === 'infrastructure') member.assignedFte = 0;
  state = step(state); assert.equal(getComputePools(state).find(pool => pool.ownership === 'owned')!.capacityCU, 0);
  assert.equal(getComputePools(state).find(pool => pool.ownership === 'owned')!.memoryMU, 0);
  assert.equal(getInfrastructureOperatingStaff(state), U / 2 + U / 20);
});

function withConsumers(state: GameState): GameState {
  const companyId = state.playerCompanyId, model = state.slices.models.versions[CONTENT.seedModel.id]; model.status = 'released';
  state.slices.products.offers.chat = { id: 'chat', companyId, name: 'Chip proving chat', kind: 'basic-chat', features: { memory: false, extendedContext: false, deepReasoning: false },
    deploymentId: 'chat-deploy', contractId: 'chat-contract', publicModelId: model.id, status: 'active', createdWeek: 8 };
  state.slices.products.deployments['chat-deploy'] = { id: 'chat-deploy', companyId, productId: 'chat', modelId: model.id,
    status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  state.slices.products.contracts['chat-contract'] = { id: 'chat-contract', companyId, productId: 'chat', weeklyPriceCents: 1200, allowance: 100, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['chat'];
  state.slices.markets.cohorts = [{ id: 'chip-consumers', companyId, productId: 'chat', contractId: 'chat-contract', segmentId: 'regular', count: 10, activeWeek: 9 }];
  state.slices.markets.payingConsumers = 10;
  fleet(state).allocation = { serving: 4 * U, development: 8 * U, research: 4 * U };
  return state;
}

test('W4-H06: eight distinct real customer-serving weeks establish feasibility; idle allocations and internal assistant/teacher calls do not', () => {
  let state = initial(); fleet(state).allocation = { serving: 4 * U, development: 8 * U, research: 4 * U };
  for (let n = 0; n < 3; n++) state = step(state, [requester(snapshot => [request(snapshot, 'research-assistant:company-player'), request(snapshot, 'teacher-work:fixture')])]);
  assert.equal(getServingHistoryWeeks(state), 0);
  state = withConsumers(state);
  for (let n = 0; n < 20; n++) state = step(state, [createProductsModule(CONTENT)]);
  assert.equal(getServingHistoryWeeks(state), 8);
  const history = state.slices.compute.servingHistory[state.playerCompanyId];
  assert.equal(new Set(history.map(row => row.week)).size, 8);
  assert.ok(history.every(row => row.publicPhysicalCUw > 0 && row.privatePhysicalCUw === 0 && row.agentPhysicalCUw === 0));
  assert.equal(history.at(-1)!.week, state.week);
  const before = canonicalStateHash(history);
  state = step(queue(state, { kind: 'set_product_paused', productId: 'chat', paused: true }), [createProductsModule(CONTENT)]);
  assert.equal(canonicalStateHash(state.slices.compute.servingHistory[state.playerCompanyId]), before);
});

test('W4-H07: qualified yield, fabrication payment, inventory capacity and prototype evidence reject checksum-independent tampering', () => {
  const state = installed(); assert.doesNotThrow(() => assertWave4HardwareState(state, CONTENT));
  const mutations: ((copy: GameState) => void)[] = [
    copy => { design(copy).qualifiedYieldBps = design(copy).qualifiedYieldBps === 10000 ? 8750 : 10000; },
    copy => { design(copy).prototypeRun!.completedHardwareStaff = 0; },
    copy => { design(copy).prototypeRun!.modelMemoryMU += U; },
    copy => { copy.slices.compute.chipBatches['chip-batch-production'].purchaseCents = 0; },
    copy => { copy.slices.compute.chipBatches['chip-batch-production'].arrivalWeek--; },
    copy => { Object.values(copy.slices.compute.racks)[0].usableCU! += U; },
    copy => { delete copy.slices.company.postedFacts[copy.slices.compute.chipBatches['chip-batch-production'].paymentId]; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(state); mutate(copy); assert.throws(() => assertWave4HardwareState(copy, CONTENT)); }
  const duplicate = structuredClone(state); duplicate.slices.compute.chipDesigns['another-design'] = structuredClone(design(state)); duplicate.slices.compute.chipDesigns['another-design'].id = 'another-design';
  assert.throws(() => assertWave4HardwareState(duplicate, CONTENT));
});

test('W4-H08: save/reload preserves production lead time and hardware availability; repeated stepping stays deterministic', () => {
  let state = qualified(); state = step(queue(state, { kind: 'order_chip_batch', designId: design(state).id, racks: 2, location: 'colocation' }, 'production'));
  const loaded = deserializeState(serializeState(state), CONTENT); assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  let a = state, b = loaded.state;
  for (let n = 0; n < 12; n++) { a = step(a); b = step(b); assert.equal(canonicalStateHash(a), canonicalStateHash(b)); }
  assert.equal(a.slices.compute.chipBatches['chip-batch-production'].status, 'delivered');
  assert.equal(Object.keys(fleet(a).inventory).length, 2); assert.equal(fleet(a).ownedCU, 0);
  const wrong = structuredClone(a); wrong.slices.compute.servingHistory[a.playerCompanyId] = [{ week: a.week, publicPhysicalCUw: 0, privatePhysicalCUw: 0, agentPhysicalCUw: 0 }];
  assert.throws(() => assertWave4HardwareState(wrong, CONTENT), /Idle/);
});

test('W4-H09: payback uses explicit utilization and fixed operating costs; low utilization cannot manufacture positive savings', () => {
  const state = qualified(), candidate = design(state);
  const idle = chipPaybackForecast(state, candidate, 1, 'colocation', 0), busy = chipPaybackForecast(state, candidate, 1, 'colocation', 7500);
  assert.equal(idle.weeklyEffectiveWorkCUw, 0); assert.ok(idle.weeklySavingsCents < 0); assert.equal(idle.simplePaybackWeeks, null);
  assert.ok(busy.entryAndProductionCents > candidate.designFeeCents + CHIP_RULES.prototypeFeeCents);
  const productionCents = chipProductionTerms(candidate, 1, CONTENT.infrastructure.rackCU).costCents;
  const feesAndProduction = candidate.designFeeCents + CHIP_RULES.prototypeFeeCents + productionCents;
  // 120 Hardware points / 30 per week × $600 + 20 Design points / 30 × $300.
  assert.equal(busy.entryAndProductionCents - feesAndProduction, 260_000);
  // Five Operations points / 30 per week × $350, rounded down to cents, plus $160 rack rent.
  assert.equal(busy.ownedFixedAndStaffCentsPerWeek, 21_833);
  const historical = chipPaybackForecast({ ...state, contentVersion: '0.28.0' }, candidate, 1, 'colocation', 7500);
  assert.equal(historical.entryAndProductionCents - feesAndProduction, 390_000, 'Historical rules keep their original one-unit weekly output.');
  assert.equal(historical.ownedFixedAndStaffCentsPerWeek, 24_750);
  assert.ok(busy.weeklySavingsCents > 0); assert.ok(busy.simplePaybackWeeks! > 0);
  assert.ok(busy.assumptions.some(item => /Actual employees receive their full weekly salary; secondary points are not credited/.test(item)));
  assert.ok(busy.assumptions.some(item => /Excludes onboarding, research fees, cloud rent for simulations, installation pay, and costs while waiting for delivery/.test(item)));
  assert.equal(getChipView(state).designs[0].forecast.simplePaybackWeeks, busy.simplePaybackWeeks);
  const pool = getComputePools(installed()).find(item => item.ownership === 'owned')!;
  assert.equal(poolSupportsWorkload(pool, { modelArchitecture: 'dense', workloadKind: 'inference' }), true);
  assert.equal(poolSupportsWorkload(pool, { modelArchitecture: 'dense', workloadKind: 'training' }), false);
  assert.equal(poolSupportsWorkload(pool, { modelArchitecture: 'sparse', workloadKind: 'inference' }), false);
  assert.ok(getRackCapacity(Object.values(installed().slices.compute.racks)[0]) <= 8 * U);
});

test('W4-H10: incoming custom batches share the same finite site slots as ordinary GPU orders and wait for commissioning', () => {
  let state = qualified();
  state = step(queue(state, { kind: 'start_facility' }, 'site'));
  const location = 'facility-site';
  state = queue(state, { kind: 'order_chip_batch', designId: design(state).id, racks: 4, location }, 'site-chips');
  for (let index = 0; index < 4; index++) state = queue(state, { kind: 'order_rack', hardwareId: 'general', location }, `site-general-${index}`);
  assert.equal(previewCommand(state, { kind: 'order_rack', hardwareId: 'general', location }, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(previewCommand(state, { kind: 'order_chip_batch', designId: design(state).id, racks: 1, location }, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
  state = step(state);
  for (let n = 0; n < 7; n++) state = step(state);
  const racks = Object.values(state.slices.compute.racks).filter(rack => rack.location === location);
  assert.equal(racks.length, 8);
  for (const rack of racks) state = queue(state, { kind: 'install_rack', rackId: rack.id });
  for (let n = 0; n < 6; n++) state = step(state);
  assert.ok(Object.values(state.slices.compute.racks).every(rack => rack.status === 'installed'));
  assert.equal(state.slices.compute.facilities[location].status, 'building');
  assert.ok(fleet(state).ownedCU > 0);
  assert.equal(getComputePools(state).filter(pool => pool.location === location).reduce((sum, pool) => sum + pool.capacityCU, 0), 0);
  assert.deepEqual(validateState(state, CONTENT), []);
});

test('W4-H11: cloud shrink cannot replace active inference memory with a training-only custom pool', () => {
  const trainingSpec: ChipSpecification = { ...spec, target: 'training' };
  let state = withConsumers(installed(qualified(initial(), trainingSpec), 1, trainingSpec));
  state = step(queue(state, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 }), [createProductsModule(CONTENT)]);
  const pool = getComputePools(state).find(item => item.ownership === 'owned')!;
  assert.ok(pool.memoryMU >= state.slices.models.versions[CONTENT.seedModel.id].residentMU);
  assert.ok(state.slices.products.lastUsage.chat.executedWork > 0, 'The active product is currently served by cloud capacity.');
  const refused = previewCommand(state, { kind: 'set_cloud_capacity', cu: 0 }, CONTENT);
  assert.equal(refused.accepted, false); assert.equal(refused.reason?.code, 'MISSING_MEMORY');
  assert.match(refused.reason?.message ?? '', /compatible inference pool/);
  assert.equal(previewCommand(state, { kind: 'set_cloud_capacity', cu: 2 * U }, CONTENT).accepted, true);
  const compatible = withConsumers(installed());
  fleet(compatible).allocation = { serving: 4 * U, development: 0, research: 0 };
  assert.equal(previewCommand(compatible, { kind: 'set_cloud_capacity', cu: 0 }, CONTENT).accepted, true,
    'A staffed compatible inference pool can replace the cloud model memory.');
});

test('W22-F01: alternate foundries freeze price, delivery and useful output on real rack orders', () => {
  let state = qualified();
  const candidate = design(state), ordinary = chipProductionTerms(candidate, 1, 8 * U);
  const express = chipProductionTerms(candidate, 1, 8 * U, 'express');
  const highYield = chipProductionTerms(candidate, 1, 8 * U, 'high-yield');
  assert.equal(express.leadWeeks, ordinary.leadWeeks - 2);
  assert.equal(express.usableCU, ordinary.usableCU);
  assert.equal(express.costCents, ordinary.costCents * 1.25);
  assert.equal(highYield.leadWeeks, ordinary.leadWeeks + 2);
  assert.equal(highYield.usableCU, Math.min(8 * U, ordinary.usableCU + U));
  assert.equal(highYield.costCents, Math.round(ordinary.costCents * 1.15));
  const payload = { kind: 'order_chip_batch', designId: candidate.id, location: 'colocation', racks: 1, foundry: 'high-yield' } as const;
  state = step(queue(state, payload, 'high-yield-production'));
  const batch = state.slices.compute.chipBatches['chip-batch-high-yield-production'];
  assert.equal(batch.arrivalWeek, state.week + highYield.leadWeeks);
  assert.equal(batch.purchaseCents, highYield.costCents);
  assert.equal(batch.usableCU, highYield.usableCU);
  assert.equal(candidate.qualifiedYieldBps, design(state).qualifiedYieldBps);
  while (state.week < batch.arrivalWeek) state = step(state);
  assert.equal(state.slices.compute.chipBatches[batch.id].status, 'delivered');
  assert.equal(state.slices.compute.racks[batch.rackIds[0]].status, 'inventory');
  assert.equal(fleet(state).ownedCU, 0);
});

test('W23-S01: qualified orders compete with internal fabrication, then pay once on direct shipment', () => {
  const previous = { ...CONTENT, version: '0.22.0', buildVersion: '0.22.0' };
  const legacyState = qualified(initial(previous));
  const migrated = deserializeState(serializeState(legacyState, previous));
  assert.ok(migrated.ok);
  assert.equal(migrated.migratedFrom, 22);
  assert.deepEqual(migrated.state.slices, { ...legacyState.slices, markets: { ...legacyState.slices.markets, opportunityCalendar: { startedWeek: legacyState.week, sequenceVersion: 2 as const } } });
  let state = migrated.state;
  const designId = design(state).id, buyerId = 'relay-edge';
  if (process.env.SILICON_PREVIEW_SAVE) writeFileSync(process.env.SILICON_PREVIEW_SAVE, serializeState(legacyState, previous));
  const payload = { kind: 'accept_hardware_order', buyerId, designId, foundry: 'express' } as const;
  const late = submitCommand(state, { ...payload, foundry: 'standard' });
  assert.equal(late.accepted, false);
  assert.match(late.reason!.message, /deadline/);
  const occupied = queue(state, { kind: 'order_chip_batch', designId, racks: 4, location: 'colocation', foundry: 'express' });
  assert.equal(submitCommand(occupied, payload).reason?.code, 'CAPACITY_EXCEEDED');
  state = queue(state, payload);
  assert.equal(submitCommand(state, payload).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(submitCommand(state, { kind: 'order_chip_batch', designId, racks: 4, location: 'colocation', foundry: 'express' }).reason?.code, 'CAPACITY_EXCEEDED');
  state = step(state);
  const sale = state.slices.compute.hardwareSales![buyerId]!;
  assert.equal(sale.shippedWeek, null);
  assert.equal(company(state).lastWeek.revenueCents, 0);
  assert.equal(state.slices.company.ledger.find(fact => fact.id === hardwareCostFactId(buyerId))?.amountCents, 1_100_000);
  const premature = structuredClone(state);
  premature.slices.compute.hardwareSales![buyerId]!.shippedWeek = premature.week;
  assert.throws(() => assertWave4HardwareState(premature, CONTENT), /premature/);
  const invalidDowngrade = { ...structuredClone(state), contentVersion: previous.version, buildVersion: previous.buildVersion };
  delete invalidDowngrade.slices.markets.opportunityCalendar;
  assert.throws(() => serializeState(invalidDowngrade, previous), /unavailable/);
  const saved = deserializeState(serializeState(state));
  assert.ok(saved.ok);
  state = saved.state;
  while (state.week < sale.arrivalWeek) state = step(state);
  assert.equal(company(state).lastWeek.revenueCents, HARDWARE_BUYERS[buyerId].priceCents);
  assert.equal(state.slices.compute.hardwareSales![buyerId]!.shippedWeek, sale.arrivalWeek);
  assert.equal(Object.keys(state.slices.compute.racks).length, 0);
  assert.equal(fleet(state).ownedCU, 0);
  state = step(state);
  assert.equal(company(state).lastWeek.revenueCents, 0);
  assert.equal(state.slices.company.ledger.filter(fact => fact.id === hardwareRevenueFactId(buyerId)).length, 1);
  assert.equal(submitCommand(state, payload).reason?.code, 'ALREADY_ACTIVE');
  const missing = structuredClone(state);
  delete missing.slices.compute.hardwareSales![buyerId];
  assert.throws(() => assertWave4HardwareState(missing, CONTENT), /matching order/);
});

test('W23-S02: memory-heavy inference and training buyers accept different qualified designs', () => {
  const wide = { ...spec, memory: 'wide' } as const;
  let state = qualified(initial(), wide);
  state = queue(state, { kind: 'accept_hardware_order', buyerId: 'vesper-systems', designId: design(state, wide).id, foundry: 'high-yield' });
  state = step(state);
  const training = { architecture: 'dense', target: 'training', memory: 'balanced' } as const;
  state = qualified(initial(), training);
  const payload = { kind: 'accept_hardware_order', buyerId: 'summit-research', designId: design(state, training).id, foundry: 'express' } as const;
  assert.equal(submitCommand(state, { ...payload, buyerId: 'vesper-systems' }).accepted, false);
  state = step(queue(state, payload));
  const shipment = state.slices.compute.hardwareSales!['summit-research']!;
  while (state.week < shipment.arrivalWeek) state = step(state);
  assert.equal(company(state).lastWeek.revenueCents, HARDWARE_BUYERS['summit-research'].priceCents);
});
