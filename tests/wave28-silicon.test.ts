import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTENT } from '../src/content/catalog';
import { CHIP_RULES, chipDesignValues, chipPrototypeValues, chipSpecificationValues } from '../src/content/wave4-hardware';
import { GEN2_SILICON_RULES as RULES } from '../src/content/wave28-silicon';
import { chipProductionTerms } from '../src/content/silicon-market';
import type { CommandPayload, GameContent, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ChipDesign } from '../src/contracts/wave4-hardware';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { chipParentFingerprint, chipSuccessorId, getChipView, hasShippedChipBuyerOrder, validateChipCommand } from '../src/modules/chips';
import { availableFoundrySlots, hardwareRevenueFactId } from '../src/modules/hardware-sales';
import { getComputePools, getRackHardware, poolSupportsWorkload } from '../src/modules/compute-pools';
import { getGen2SiliconFixture, getGen2SiliconReadyFixture } from './fixtures/wave28-silicon';

const queue = (state: GameState, payload: CommandPayload) => { const result = submitCommand(state, payload); assert.equal(result.accepted, true, result.reason?.message); return result.state; };
const step = (state: GameState) => { const result = advanceWeek(state); assert.equal(result.accepted, true, result.reason?.message); return result.state; };
const command = (state: GameState, payload: CommandPayload) => ({ id: 'test-chip-admission', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload });

test('W28-S01: published-company continuation pays research, ships a buyer order, independently qualifies Gen2, fabricates and installs real memory', () => {
  const f = getGen2SiliconFixture(), design = f.installed.slices.compute.chipDesigns[f.designId];
  const parent = f.beforeSuccessor.slices.compute.chipDesigns[f.parentDesignId], batch = f.installed.slices.compute.chipBatches[f.batchId];
  assert.equal(f.originalWeek, 579); assert.equal(f.originalChecksum, '0e2eb06a'); assert.ok(f.minimumCashCents > 0);
  assert.ok(hasShippedChipBuyerOrder(f.beforeSuccessor));
  assert.equal(f.beforeSuccessor.slices.company.postedFacts[hardwareRevenueFactId('vesper-systems')], true);
  for (const researchId of ['S5', 'S6']) assert.ok(Object.values(f.beforeSuccessor.slices.research.projects).some(project => project.researchId === researchId && project.status === 'complete'));
  assert.equal(design.successor!.parentFingerprint, chipParentFingerprint(parent));
  assert.deepEqual(design.spec, parent.spec); assert.equal(design.qualifiedYieldBps, parent.qualifiedYieldBps);
  assert.deepEqual(f.installed.slices.compute.chipDesigns[f.parentDesignId], parent);
  const funded = f.designing.slices.compute.chipDesigns[f.designId], prototype = f.prototyping.slices.compute.chipDesigns[f.designId].prototypeRun!;
  assert.equal(funded.designFeeCents, RULES.designFeeCents); assert.equal(funded.prototypeRun, null);
  assert.equal(funded.design.requiredWorkCUw, RULES.designWorkCUw); assert.equal(funded.design.requiredHardwareStaff, RULES.designHardwareStaff);
  assert.ok(funded.design.grantProof!.physicalWorkCUw > 0); assert.ok(funded.design.grantProof!.hardwareGrantWeeks > 0);
  assert.equal(prototype.feeCents, RULES.prototypeFeeCents); assert.equal(prototype.requiredWorkCUw, RULES.prototypeWorkCUw);
  assert.equal(prototype.requiredHardwareStaff, RULES.prototypeHardwareStaff); assert.equal(prototype.requiredMlStaff, RULES.prototypeMlStaff);
  assert.ok(prototype.grantProof!.physicalWorkCUw > 0); assert.ok(prototype.grantProof!.mlGrantWeeks > 0);
  assert.notEqual(prototype.grantProof, funded.design.grantProof); assert.ok(prototype.startedWeek > design.design.readyWeek!);
  assert.equal(design.prototypeRun!.completedWeek! + 1, design.prototypeRun!.readyWeek);
  assert.equal(design.prototypeRun!.readyWeek, f.qualified.week);
  for (const [state, id, cost] of [[f.designing, design.designPaymentId, RULES.designFeeCents], [f.prototyping, design.prototypeRun!.paymentId, RULES.prototypeFeeCents]] as const) {
    const rows = state.slices.company.ledger.filter(entry => entry.id === id); assert.equal(rows.length, 1); assert.equal(rows[0].amountCents, cost);
  }
  assert.equal(batch.attemptedCU, CONTENT.infrastructure.rackCU); assert.equal(batch.usableCU, chipProductionTerms(parent, 1, CONTENT.infrastructure.rackCU).usableCU);
  assert.equal(batch.purchaseCents, chipProductionTerms(parent, 1, CONTENT.infrastructure.rackCU).costCents * 1.1);
  assert.equal(batch.arrivalWeek - batch.orderedWeek, chipDesignValues(parent).deliveryWeeks);
  assert.equal(f.ordered.slices.compute.fleets[f.ordered.playerCompanyId].ownedCU, f.beforeSuccessor.slices.compute.fleets[f.beforeSuccessor.playerCompanyId].ownedCU);
  assert.equal(f.delivered.slices.compute.racks[f.rackId].status, 'inventory');
  assert.equal(f.installing.slices.compute.racks[f.rackId].status, 'installing');
  const pool = getComputePools(f.installed).find(item => item.hardwareId === design.id)!;
  assert.equal(pool.capacityCU, batch.usableCU); assert.equal(pool.memoryMU, batch.usableCU * 5);
  assert.equal(pool.servingBps, chipDesignValues(parent).servingBps); assert.equal(pool.trainingBps, 0);
  assert.equal(poolSupportsWorkload(pool, { modelArchitecture: 'dense', workloadKind: 'training' }), false);
  assert.equal(poolSupportsWorkload(pool, { modelArchitecture: 'sparse', workloadKind: 'inference' }), false);
  assert.deepEqual(validateState(f.installed), []);
  const restored = deserializeState(serializeState(f.installed)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.deepEqual(restored.state, f.installed);
});

test('W28-S02: the other paid target raises only compatible throughput, preserving memory, footprint, yield and operating tariff', () => {
  const f = getGen2SiliconFixture('throughput'), design = f.installed.slices.compute.chipDesigns[f.designId], parent = f.installed.slices.compute.chipDesigns[f.parentDesignId];
  const current = chipDesignValues(design), baseline = chipDesignValues(parent), rack = f.installed.slices.compute.racks[f.rackId];
  assert.equal(current.memoryMUPerCU, baseline.memoryMUPerCU);
  assert.equal(current.servingBps, baseline.servingBps * 1.1); assert.equal(current.trainingBps, 0);
  assert.equal(current.powerPerCU, baseline.powerPerCU); assert.equal(current.variableCentsPerCUw, baseline.variableCentsPerCUw);
  assert.equal(current.deliveryWeeks, baseline.deliveryWeeks); assert.equal(design.qualifiedYieldBps, parent.qualifiedYieldBps);
  assert.equal(getRackHardware(f.installed, rack).servingMultiplier, current.servingBps / 10000);
  assert.ok(design.design.grantProof!.grantWeeks > 0 && design.prototypeRun!.grantProof!.grantWeeks > 0);
  assert.deepEqual(validateState(f.installed), []);
});

test('W28-S03: quote, queue, reload and commit agree on one frozen target and reject renamed, alternate and recursive successors', () => {
  const f = getGen2SiliconReadyFixture(), payload = { kind: 'start_chip_successor', parentDesignId: f.parentDesignId, name: 'Frozen target', improvement: 'memory' } as const;
  const hash = canonicalStateHash(f.state), quoted = previewCommand(f.state, payload), submitted = submitCommand(f.state, payload);
  assert.equal(quoted.accepted, true, quoted.reason?.message); assert.equal(quoted.upfrontCostCents, RULES.designFeeCents);
  assert.equal(submitted.accepted, true, submitted.reason?.message); assert.equal(canonicalStateHash(f.state), hash);
  assert.deepEqual(submitted.state.queuedCommands.at(-1)!.payload, payload); assert.equal(submitted.state.queuedCommands.at(-1)!.reservedCents, RULES.designFeeCents);
  for (const replacement of [{ ...payload, name: 'Renamed' }, { ...payload, improvement: 'throughput' as const }]) {
    const rejected = submitCommand(submitted.state, replacement); assert.equal(rejected.accepted, false); assert.equal(rejected.reason?.code, 'ALREADY_ACTIVE'); assert.equal(rejected.state, submitted.state);
  }
  const restored = deserializeState(serializeState(submitted.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.deepEqual(step(restored.state), step(submitted.state));
  const complete = getGen2SiliconFixture();
  assert.equal(previewCommand(complete.qualified, { ...payload, parentDesignId: complete.designId }).accepted, false);
  assert.equal(previewCommand(complete.qualified, payload).reason?.code, 'ALREADY_ACTIVE');
});

test('W28-S04: a paid redesign cannot borrow parent staff; pause/resume preserves its own work and charges the fee once', () => {
  const f = getGen2SiliconReadyFixture(); let state = f.state;
  for (const member of Object.values(state.slices.company.staff).filter(item => item.companyId === state.playerCompanyId && item.role === 'hardware')) state = queue(state, { kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  const payload = { kind: 'start_chip_successor', parentDesignId: f.parentDesignId, name: 'Staffed separately', improvement: 'memory' } as const;
  state = step(queue(state, payload));
  const designId = chipSuccessorId(state.playerCompanyId, f.parentDesignId, 'memory');
  assert.equal(state.slices.compute.chipDesigns[designId].design.completedHardwareStaff, 0);
  assert.ok(state.slices.compute.chipDesigns[designId].design.completedWorkCUw > 0);
  assert.equal(previewCommand(state, { kind: 'start_chip_prototype', designId, modelId: f.modelId }).accepted, false);
  state = step(queue(state, { kind: 'set_chip_project_paused', designId, paused: true }));
  const paused = canonicalStateHash(state.slices.compute.chipDesigns[designId].design); state = step(state);
  assert.equal(canonicalStateHash(state.slices.compute.chipDesigns[designId].design), paused);
  for (const member of Object.values(state.slices.company.staff).filter(item => item.companyId === state.playerCompanyId && item.role === 'hardware')) state = queue(state, { kind: 'set_staff_allocation', staffId: member.id, fte: U });
  state = step(queue(state, { kind: 'set_chip_project_paused', designId, paused: false }));
  assert.ok(state.slices.compute.chipDesigns[designId].design.completedHardwareStaff > 0);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === `chip-design-fee:${designId}`).length, 1);
  assert.deepEqual(validateState(state), []);
});

test('W28-S05: source, fee, work, evaluated-runtime and original-parent tampering cannot create qualification', () => {
  const f = getGen2SiliconFixture();
  const mutate: Array<(design: ChipDesign, state: GameState) => void> = [
    design => { design.successor!.parentFingerprint = '00000000'; },
    design => { design.successor!.parentDesignId = design.id; },
    design => { design.successor!.improvement = 'throughput'; },
    design => { design.spec.memory = 'balanced'; },
    design => { design.design.requiredWorkCUw = 0; },
    design => { design.design.completedHardwareStaff -= 1; },
    design => { design.design.grantProof!.physicalWorkCUw += 1; },
    design => { Object.values(design.design.grantProof!.workReceipts)[0].effectiveCUw += 1; },
    design => { design.prototypeRun!.grantProof!.latest!.remainingMlStaff += 1; },
    design => { design.prototypeRun!.modelFingerprint = '00000000'; },
    design => { design.prototypeRun!.reportId = 'invented-paid-report'; },
    design => { design.prototypeRun!.feeCents = CHIP_RULES.prototypeFeeCents; },
    (design, state) => { delete state.slices.company.postedFacts[design.designPaymentId]; },
    (design, state) => { delete state.slices.company.postedFacts[design.prototypeRun!.paymentId]; },
    (_design, state) => { delete state.slices.compute.hardwareSales!['vesper-systems']; },
  ];
  for (const change of mutate) { const bad = structuredClone(f.qualified); change(bad.slices.compute.chipDesigns[f.designId], bad); assert.ok(validateState(bad).length > 0, change.toString()); }
  const unpaid = structuredClone(f.designReady);
  for (const [id, run] of Object.entries(unpaid.slices.models.evaluationRuns)) if (run.modelId === f.modelId) delete unpaid.slices.models.evaluationRuns[id];
  assert.match(validateChipCommand(unpaid, command(unpaid, { kind: 'start_chip_prototype', designId: f.designId, modelId: f.modelId }), CONTENT)!.message, /paid/);
});

test('W28-S06: completed engineering survives ordinary staff dismissal; history does not require today’s roster', () => {
  const f = getGen2SiliconFixture(); let state = f.qualified;
  for (const member of Object.values(state.slices.company.staff).filter(item => item.companyId === state.playerCompanyId && item.role === 'hardware')) state = queue(state, { kind: 'dismiss_staff', staffId: member.id });
  state = step(state); assert.deepEqual(validateState(state), []);
  assert.deepEqual(state.slices.compute.chipDesigns[f.designId], f.qualified.slices.compute.chipDesigns[f.designId]);
  assert.equal(previewCommand(state, { kind: 'order_chip_batch', designId: f.designId, racks: 1, location: 'colocation' }).accepted, true);
});

test('W28-S07: both generations reserve the same foundry capacity and Gen1 state/values remain byte-identical', () => {
  const f = getGen2SiliconFixture(), before = canonicalStateHash(f.qualified);
  const queued = queue(f.qualified, { kind: 'order_chip_batch', designId: f.designId, racks: 4, location: 'colocation', foundry: 'express' });
  assert.equal(availableFoundrySlots(queued, 'express'), 0);
  const blocked = submitCommand(queued, { kind: 'order_chip_batch', designId: f.parentDesignId, racks: 1, location: 'colocation', foundry: 'express' });
  assert.equal(blocked.accepted, false); assert.equal(blocked.reason?.code, 'CAPACITY_EXCEEDED');
  getChipView(f.qualified); assert.equal(canonicalStateHash(f.qualified), before);
  const original = JSON.parse(readFileSync('tests/fixtures/wave27-appliance-published.json', 'utf8')).state.slices.compute.chipDesigns[f.parentDesignId];
  assert.equal(JSON.stringify(original), JSON.stringify(f.installed.slices.compute.chipDesigns[f.parentDesignId]));
  for (const architecture of ['dense', 'sparse'] as const) for (const target of ['training', 'inference'] as const) for (const memory of ['balanced', 'wide'] as const) {
    const spec = { architecture, target, memory };
    assert.equal(JSON.stringify(chipDesignValues({ spec })), JSON.stringify(chipSpecificationValues(spec)));
    assert.deepEqual(chipPrototypeValues({}), { feeCents: CHIP_RULES.prototypeFeeCents, workCUw: CHIP_RULES.prototypeWorkCUw, hardwareStaff: CHIP_RULES.prototypeHardwareStaff, mlStaff: CHIP_RULES.prototypeMlStaff });
  }
});

test('W28-S08: old headers and malformed payloads cannot admit Gen2, while rejected funding leaves the source unchanged', () => {
  const f = getGen2SiliconReadyFixture(), payload = { kind: 'start_chip_successor', parentDesignId: f.parentDesignId, name: 'Rejected target', improvement: 'memory' } as const;
  for (const altered of [{ ...payload, improvement: 'both' }, { ...payload, parentDesignId: '__proto__' }, { ...payload, name: '' }, { ...payload, grantReady: true }]) assert.equal(previewCommand(f.state, altered as CommandPayload).accepted, false);
  const oldContent = { ...CONTENT, version: '0.27.0', buildVersion: '0.27.0' } as GameContent;
  assert.equal(validateChipCommand(f.state, command(f.state, payload), oldContent)?.code, 'INVALID_COMMAND');
  const poor = structuredClone(f.state); poor.slices.company.companies[poor.playerCompanyId].cashCents = RULES.designFeeCents - 1;
  const hash = canonicalStateHash(poor), rejected = submitCommand(poor, payload); assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason?.code, 'INSUFFICIENT_FUNDS'); assert.equal(rejected.state, poor); assert.equal(canonicalStateHash(poor), hash);
  const old = getGen2SiliconFixture().qualified; old.contentVersion = '0.27.0'; old.buildVersion = '0.27.0';
  const restored = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: old.schemaVersion, contentVersion: old.contentVersion, checksum: canonicalStateHash(old), state: old }));
  assert.equal(restored.ok, false);
});
