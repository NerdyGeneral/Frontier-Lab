import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { FACILITY_RETROFITS } from '../src/content/wave8-retrofits';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameCommand, GameState, ModuleContext, ResourceFrame, WorkRequest } from '../src/contracts/types';
import type { FacilityRetrofitKind } from '../src/contracts/wave8-retrofits';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { collectResourceResult } from '../src/core/resources';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave8RetrofitsState } from '../src/core/wave8-retrofits-validation';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { chipPaybackForecast } from '../src/modules/chips';
import { mulDiv } from '../src/core/math';
import { getComputePools, getInfrastructureBaseCost, getInfrastructureOperatingStaff, getSiteEnvelope, infrastructureOperationsId } from '../src/modules/compute-pools';
import { advanceFacilityRetrofits, getActiveFacilityRetrofitEffects, getFacilityRetrofitsView, validateFacilityRetrofitCommand } from '../src/modules/facility-retrofits';
import { emptyRoleAllocation } from '../src/modules/workforce';

const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];

/** Infrastructure acceptance continues a real paid company; no resource or unlock grants. */
class RetrofitCampaign {
  constructor(public state: GameState) {}
  queue(payload: CommandPayload): string {
    const result = submitCommand(this.state, payload);
    assert.equal(result.accepted, true, result.reason?.message);
    this.state = result.state; return result.commandId!;
  }
  step(): void {
    const queued = this.state.queuedCommands.filter(item => item.companyId === this.state.playerCompanyId).map(item => item.id);
    const next = advanceWeek(this.state); assert.equal(next.accepted, true, next.reason?.message); this.state = next.state;
    for (const id of queued) assert.equal(this.state.commandReceipts[id].status, 'accepted', this.state.commandReceipts[id].reason?.message);
    assert.equal(company(this.state).arrearsCents, 0);
  }
  until(done: () => boolean, limit = 45): void {
    for (let i = 0; i < limit && !done(); i++) this.step();
    assert.ok(done(), 'A funded retrofit should complete with sufficient staff and elapsed weeks.');
  }
  start(facilityId: string, retrofitKind: FacilityRetrofitKind): string {
    return 'facility-retrofit-' + this.queue({ kind: 'start_facility_retrofit', facilityId, retrofitKind });
  }
}

let loadedSite: { state: GameState; siteId: string } | undefined;
function fundedSite(): { run: RetrofitCampaign; siteId: string } {
  if (!loadedSite) {
    const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave6-snapshot.json'), 'utf8'));
    assert.ok(imported.ok, imported.ok ? '' : imported.error);
    const run = new RetrofitCampaign(imported.state);
    run.queue({ kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), infrastructure: U } });
    const siteId = 'facility-' + run.queue({ kind: 'start_facility' }); run.step();
    for (let rack = 0; rack < 8; rack++) run.queue({ kind: 'order_rack', hardwareId: 'training', location: siteId });
    for (let i = 0; i < 45; i++) {
      const site = run.state.slices.compute.facilities[siteId];
      const racks = Object.values(run.state.slices.compute.racks).filter(item => item.location === siteId);
      if (site.status === 'active' && racks.length === 8 && racks.every(item => item.status === 'installed')) break;
      if (site.status === 'building' && !site.stages[site.stageIndex].paidCents) run.queue({ kind: 'fund_facility_stage', facilityId: siteId });
      for (const rack of racks) if (rack.status === 'inventory') run.queue({ kind: 'install_rack', rackId: rack.id });
      run.step();
    }
    assert.equal(run.state.slices.compute.facilities[siteId].status, 'active');
    assert.equal(Object.values(run.state.slices.compute.racks).filter(item => item.location === siteId && item.status === 'installed').length, 8);
    assert.equal(getComputePools(run.state).find(item => item.location === siteId)!.capacityCU, 40 * U);
    assert.equal(run.state.slices.compute.facilityRetrofits, undefined);
    loadedSite = { state: structuredClone(run.state), siteId };
  }
  return { run: new RetrofitCampaign(structuredClone(loadedSite.state)), siteId: loadedSite.siteId };
}

let activeSite: { state: GameState; siteId: string; powerId: string; coolingId: string } | undefined;
function bothActive() {
  if (!activeSite) {
    const { run, siteId } = fundedSite();
    const powerId = run.start(siteId, 'power-feed'), coolingId = run.start(siteId, 'cooling-loop');
    run.until(() => run.state.slices.compute.facilityRetrofits?.[powerId]?.status === 'active'
      && run.state.slices.compute.facilityRetrofits?.[coolingId]?.status === 'active');
    activeSite = { state: structuredClone(run.state), siteId, powerId, coolingId };
  }
  return { ...activeSite, state: structuredClone(activeSite.state) };
}

test('W8-F01: paid independent extensions preserve the site until staff and calendar finish, then activate at the next boundary', () => {
  const { run, siteId } = fundedSite(), startWeek = run.state.week, before = getInfrastructureBaseCost(run.state);
  const quote = previewCommand(run.state, { kind: 'start_facility_retrofit', facilityId: siteId, retrofitKind: 'power-feed' });
  assert.equal(quote.accepted, true); assert.equal(quote.upfrontCostCents, 1_800_000); assert.equal(quote.weeklyCostDeltaCents, 0);
  const id = run.start(siteId, 'power-feed');
  run.until(() => run.state.slices.compute.facilityRetrofits?.[id]?.status === 'ready');
  const project = run.state.slices.compute.facilityRetrofits![id];
  assert.equal(project.startedWeek, startWeek + 1);
  assert.equal(project.elapsedWeeks, 4); assert.equal(project.completedStaff, 2 * U);
  assert.equal(project.completedWeek, startWeek + 4); assert.equal(project.readyWeek, startWeek + 5);
  assert.equal(getSiteEnvelope(run.state, siteId).powerLimit, 64 * U);
  assert.equal(getInfrastructureBaseCost(run.state), before);
  assert.equal(run.state.slices.company.ledger.filter(item => item.id === project.paymentId).length, 1);
  assert.equal(run.state.slices.company.ledger.find(item => item.id === project.paymentId)!.amountCents, 1_800_000);
  run.step();
  assert.equal(run.state.slices.compute.facilityRetrofits![id].status, 'active');
  const envelope = getSiteEnvelope(run.state, siteId);
  assert.equal(envelope.powerLimit, 112 * U); assert.equal(envelope.coolingLimit, 64 * U);
  assert.equal(getInfrastructureBaseCost(run.state), before + 6_000);
  assert.equal(getInfrastructureOperatingStaff(run.state), 1_300_000_000);
  const pool = getComputePools(run.state).find(item => item.location === siteId)!;
  assert.equal(pool.capacityCU, 40 * U); assert.equal(pool.powerCoverageBps, 10000); assert.equal(pool.coolingCoverageBps, 6250);
  assert.match(pool.bottleneck, /cooling/i);
});

test('W8-F02: cooling alone cannot cure a power bottleneck; both paid limits unlock only the existing rack capacity', () => {
  const { run, siteId } = fundedSite(), rackProof = canonicalStateHash(run.state.slices.compute.racks);
  const cool = run.start(siteId, 'cooling-loop'); run.until(() => run.state.slices.compute.facilityRetrofits?.[cool]?.status === 'active');
  let pool = getComputePools(run.state).find(item => item.location === siteId)!;
  assert.equal(pool.capacityCU, 40 * U); assert.equal(pool.powerCoverageBps, 6250); assert.equal(pool.coolingCoverageBps, 10000);
  assert.match(pool.bottleneck, /power/i);
  const power = run.start(siteId, 'power-feed'); run.until(() => run.state.slices.compute.facilityRetrofits?.[power]?.status === 'active');
  pool = getComputePools(run.state).find(item => item.location === siteId)!;
  assert.equal(pool.nominalCU, 64 * U); assert.equal(pool.capacityCU, 64 * U); assert.equal(pool.memoryMU, 128 * U);
  assert.equal(getSiteEnvelope(run.state, siteId).powerDemand, 102_400_000_000);
  assert.equal(getInfrastructureOperatingStaff(run.state), 1_350_000_000);
  assert.equal(getInfrastructureBaseCost(run.state), 66_000);
  assert.equal(canonicalStateHash(run.state.slices.compute.racks), rackProof, 'Retrofits do not rewrite purchased hardware or its yield.');
  const ninth = submitCommand(run.state, { kind: 'order_rack', hardwareId: 'general', location: siteId });
  assert.equal(ninth.accepted, false); assert.equal(ninth.reason?.code, 'CAPACITY_EXCEEDED');
  assert.match(ninth.reason?.message ?? '', /slots/i);
  assert.deepEqual(validateState(run.state), []);
});

test('W8-F03: queued duplicates reserve one capital payment, while independent extension types can coexist', () => {
  const { run, siteId } = fundedSite();
  run.start(siteId, 'power-feed');
  const duplicate = submitCommand(run.state, { kind: 'start_facility_retrofit', facilityId: siteId, retrofitKind: 'power-feed' });
  assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason?.code, 'ALREADY_ACTIVE');
  run.start(siteId, 'cooling-loop');
  assert.equal(run.state.queuedCommands.filter(item => item.companyId === run.state.playerCompanyId && item.payload.kind === 'start_facility_retrofit')
    .reduce((sum, item) => sum + (item.reservedCents ?? 0), 0), 3_200_000);
  run.step();
  assert.equal(Object.keys(run.state.slices.compute.facilityRetrofits!).length, 2);
  assert.equal(run.state.slices.company.ledger.filter(item => item.week === run.state.week && item.id.startsWith('facility-retrofit-capital:'))
    .reduce((sum, item) => sum + item.amountCents, 0), 3_200_000);
  assert.equal(getActiveFacilityRetrofitEffects(run.state, run.state.playerCompanyId, siteId).weeklyCents, 0);
});

test('W8-F04: elapsed time cannot replace infrastructure effort; pause/reload retains both meters and exact continuation', () => {
  const { run, siteId } = fundedSite();
  const infrastructureStaff = Object.values(run.state.slices.company.staff).filter(item => item.companyId === run.state.playerCompanyId && item.role === 'infrastructure');
  run.queue({ kind: 'assign_founder', allocations: emptyRoleAllocation() });
  for (const staff of infrastructureStaff) run.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: 0 });
  const id = run.start(siteId, 'power-feed');
  for (let i = 0; i < 4; i++) run.step();
  let project = run.state.slices.compute.facilityRetrofits![id];
  assert.equal(project.elapsedWeeks, 4); assert.equal(project.completedStaff, 0); assert.equal(project.status, 'building');
  assert.match(project.lastBottleneck, /Operations points/);
  run.queue({ kind: 'set_facility_retrofit_paused', retrofitId: id, paused: true }); run.step();
  const stopped = canonicalStateHash(run.state.slices.compute.facilityRetrofits![id]); run.step();
  assert.equal(canonicalStateHash(run.state.slices.compute.facilityRetrofits![id]), stopped);
  const imported = deserializeState(serializeState(run.state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const restored = new RetrofitCampaign(imported.state);
  for (const companyRun of [run, restored]) {
    companyRun.queue({ kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), infrastructure: U } });
    for (const staff of infrastructureStaff) companyRun.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: U });
    companyRun.queue({ kind: 'set_facility_retrofit_paused', retrofitId: id, paused: false });
  }
  for (let i = 0; i < 5; i++) { run.step(); restored.step(); assert.equal(canonicalStateHash(run.state), canonicalStateHash(restored.state)); }
  project = run.state.slices.compute.facilityRetrofits![id];
  assert.equal(project.status, 'active'); assert.equal(project.completedStaff, 2 * U);
});

test('W8-F05: ownership, availability, research chronology, cash and arrears constrain retrofit admission', () => {
  const { run, siteId } = fundedSite();
  const command = (companyId = run.state.playerCompanyId): GameCommand => ({ id: 'retrofit-admission', companyId, issuedForWeek: run.state.week + 1,
    payload: { kind: 'start_facility_retrofit', facilityId: siteId, retrofitKind: 'power-feed' } });
  assert.equal(validateFacilityRetrofitCommand(run.state, command()), undefined);
  const foreignRequester = structuredClone(run.state);
  // This isolated command check reaches ownership even if the historical rival has withdrawn.
  foreignRequester.slices.company.companies['rival-harbor'].arrearsCents = 0;
  assert.equal(validateFacilityRetrofitCommand(foreignRequester, command('rival-harbor'))?.code, 'NOT_READY');
  assert.equal(previewCommand(run.state, { kind: 'start_facility_retrofit', facilityId: 'colocation', retrofitKind: 'power-feed' }).accepted, false);
  const unfinished = structuredClone(run.state); unfinished.slices.compute.facilities[siteId].status = 'commissioning';
  assert.match(validateFacilityRetrofitCommand(unfinished, command())?.message ?? '', /operational/i);
  const unresearched = structuredClone(run.state);
  const project = Object.values(unresearched.slices.research.projects).find(item => item.companyId === run.state.playerCompanyId && item.researchId === 'R12')!;
  project.availableWeek = run.state.week + 1;
  assert.match(validateFacilityRetrofitCommand(unresearched, command())?.message ?? '', /research/i);
  const poor = structuredClone(run.state); company(poor).cashCents = 1_799_999;
  assert.equal(submitCommand(poor, command().payload).reason?.code, 'INSUFFICIENT_FUNDS');
  const indebted = structuredClone(run.state); company(indebted).arrearsCents = 1;
  assert.equal(validateFacilityRetrofitCommand(indebted, command())?.code, 'ARREARS');
});

test('W8-F06: resource allocation honors the upgraded physical envelope without changing hardware efficiency or variable rates', () => {
  const baseline = fundedSite(), upgraded = bothActive();
  const requester: DomainModule = { id: 'retrofit-resource-fixture', owns: [], handlers: {} };
  const placement = (original: GameState, siteId: string) => {
    const state = structuredClone(original); fleet(state).allocation = { serving: 0, development: 64 * U, research: 0 };
    const pool = getComputePools(state).find(item => item.location === siteId)!;
    const ops: WorkRequest = { id: infrastructureOperationsId(state.playerCompanyId), companyId: state.playerCompanyId, taskId: 'infrastructure-operations',
      category: 'development', poolId: 'auto', priority: 0, normalizedWorkCUw: 0, memoryMU: 0,
      staffDemand: [{ role: 'infrastructure', staffWeeks: getInfrastructureOperatingStaff(state) }] };
    const request: WorkRequest = { id: 'wide-training', companyId: state.playerCompanyId, taskId: 'wide-training', category: 'development',
      poolId: pool.id, priority: 20, normalizedWorkCUw: 100 * U, memoryMU: 110 * U };
    const frame: ResourceFrame = { requests: [], staffGrants: [], computeGrants: [] };
    collectResourceResult(frame, requester, { workRequests: [ops, request] }, 'request', state);
    collectResourceResult(frame, createCompanyModule(CONTENT), { staffGrants: [{ requestId: ops.id, grants: ops.staffDemand! }] }, 'grant', state);
    const owner = createComputeModule(CONTENT);
    const context: ModuleContext = { week: state.week, phase: 'reserve', content: CONTENT, facts: [], resources: frame, random: { draw: () => 0 } };
    const grants = owner.grantResources!(state, context);
    collectResourceResult(frame, owner, grants, 'grant', state);
    return { pool, grant: frame.computeGrants.find(item => item.requestId === request.id)! };
  };
  const before = placement(baseline.run.state, baseline.siteId), after = placement(upgraded.state, upgraded.siteId);
  assert.equal(before.grant.physicalCUw, 0, 'The 110-MU workload cannot fit the derated 80-MU site pool.');
  assert.equal(after.grant.physicalCUw, 64 * U); assert.equal(after.grant.hardwareEffectiveCUw, 80_640_000_000);
  assert.equal(after.grant.memoryMU, 110 * U);
  assert.equal(after.pool.trainingBps, before.pool.trainingBps); assert.equal(after.pool.variableCentsPerCUw, before.pool.variableCentsPerCUw);
});

test('W8-F07: active extension costs and operating staff follow the site even while every rack is parked', () => {
  const upgraded = bothActive(), run = new RetrofitCampaign(upgraded.state);
  for (const rack of Object.values(run.state.slices.compute.racks).filter(item => item.location === upgraded.siteId)) run.queue({ kind: 'set_rack_parked', rackId: rack.id, parked: true });
  run.step();
  const pool = getComputePools(run.state).find(item => item.location === upgraded.siteId)!;
  assert.equal(pool.capacityCU, 0); assert.equal(pool.memoryMU, 0);
  assert.equal(getInfrastructureBaseCost(run.state), 66_000);
  assert.equal(getInfrastructureOperatingStaff(run.state), 1_350_000_000);
  const fixed = run.state.slices.company.ledger.find(item => item.companyId === run.state.playerCompanyId && item.week === run.state.week && item.sourceId === 'owned-infrastructure')!;
  assert.equal(fixed.amountCents, 66_000);
  assert.equal(getFacilityRetrofitsView(run.state, upgraded.siteId).effects.weeklyCents, 10_000);
});

test('W8-F08: import validation rejects free, duplicate, backdated and prematurely active envelopes', () => {
  const { state, powerId } = bothActive();
  const attacks: Array<[RegExp, (copy: GameState) => void]> = [
    [/capital payment/i, copy => { delete copy.slices.company.postedFacts[copy.slices.compute.facilityRetrofits![powerId].paymentId]; }],
    [/requirements or price/i, copy => { copy.slices.compute.facilityRetrofits![powerId].purchaseCents = 1; }],
    [/progress exceeds/i, copy => { copy.slices.compute.facilityRetrofits![powerId].completedStaff += 1; }],
    [/same extension/i, copy => { const p = copy.slices.compute.facilityRetrofits![powerId]; copy.slices.compute.facilityRetrofits!['facility-retrofit-duplicate'] = { ...p, id: 'facility-retrofit-duplicate' }; }],
    [/operational owned site/i, copy => { copy.slices.compute.facilityRetrofits![powerId].facilityId = 'colocation'; }],
    [/research was available/i, copy => { const p = copy.slices.compute.facilityRetrofits![powerId]; const r = Object.values(copy.slices.research.projects).find(item => item.companyId === copy.playerCompanyId && item.researchId === 'R12')!; r.completedWeek = p.startedWeek; r.availableWeek = p.startedWeek + 1; }],
  ];
  for (const [message, attack] of attacks) {
    const corrupt = structuredClone(state); attack(corrupt);
    assert.throws(() => assertWave8RetrofitsState(corrupt, CONTENT), message);
    assert.ok(validateState(corrupt).length > 0, 'The ordinary import boundary must reject an invalid extension.');
  }
  const { run, siteId } = fundedSite(), id = run.start(siteId, 'power-feed');
  run.until(() => run.state.slices.compute.facilityRetrofits?.[id]?.status === 'ready');
  const early = structuredClone(run.state); early.slices.compute.facilityRetrofits![id].status = 'active';
  assert.throws(() => assertWave8RetrofitsState(early, CONTENT), /activation boundary/i);
});

test('W8-F09: insolvent work cannot advance and completed projects cannot be paused or purchased twice', () => {
  const { run, siteId } = fundedSite(), id = run.start(siteId, 'power-feed'); run.step();
  const indebted = structuredClone(run.state); company(indebted).arrearsCents = 1;
  const compute = structuredClone(indebted.slices.compute), before = { ...compute.facilityRetrofits![id] };
  advanceFacilityRetrofits(indebted, { week: indebted.week + 1, phase: 'execute', content: CONTENT, facts: [],
    resources: { requests: [], computeGrants: [], staffGrants: [] }, random: { draw: () => 0 } }, compute);
  assert.equal(compute.facilityRetrofits![id].elapsedWeeks, before.elapsedWeeks);
  assert.equal(compute.facilityRetrofits![id].completedStaff, before.completedStaff);
  assert.match(compute.facilityRetrofits![id].lastBottleneck, /unpaid/i);
  const upgraded = bothActive();
  for (const kind of FACILITY_RETROFITS.map(item => item.kind)) {
    assert.equal(submitCommand(upgraded.state, { kind: 'start_facility_retrofit', facilityId: upgraded.siteId, retrofitKind: kind }).reason?.code, 'ALREADY_ACTIVE');
  }
  assert.equal(submitCommand(upgraded.state, { kind: 'set_facility_retrofit_paused', retrofitId: upgraded.powerId, paused: true }).reason?.code, 'NO_IMPROVEMENT');
});

test('W8-F10: an owned-site chip forecast includes active retrofit upkeep and wages without charging its capital twice', () => {
  const baseline = fundedSite(), upgraded = bothActive();
  // Use an authentic measured specification for the hypothetical comparison; grant no chip asset to either company.
  const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave4-snapshot.json'), 'utf8'));
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const design = Object.values(imported.state.slices.compute.chipDesigns).find(item => item.companyId === imported.state.playerCompanyId)!;
  const before = chipPaybackForecast(baseline.run.state, design, 1, baseline.siteId);
  const after = chipPaybackForecast(upgraded.state, design, 1, upgraded.siteId);
  const effects = getActiveFacilityRetrofitEffects(upgraded.state, upgraded.state.playerCompanyId, upgraded.siteId);
  const infraWage = CONTENT.staff.find(role => role.id === 'infrastructure')!.weeklyCents;
  // A ready operations specialist supplies 30 points (1.5 normalized work units).
  const additionalWeeklyCents = effects.weeklyCents + mulDiv(effects.operatingStaff, infraWage, 3 * U / 2);
  assert.equal(effects.weeklyCents, 10_000); assert.equal(effects.operatingStaff, U / 10);
  assert.equal(after.ownedFixedAndStaffCentsPerWeek, before.ownedFixedAndStaffCentsPerWeek + additionalWeeklyCents);
  assert.equal(after.weeklySavingsCents, before.weeklySavingsCents - additionalWeeklyCents);
  assert.equal(after.entryAndProductionCents, before.entryAndProductionCents, 'Previously paid retrofit capital is a sunk cost, not a new chip purchase.');
  assert.equal(after.weeklyEffectiveWorkCUw, before.weeklyEffectiveWorkCUw);
  assert.deepEqual(chipPaybackForecast(upgraded.state, design), chipPaybackForecast(baseline.run.state, design), 'Owned-site extensions do not alter a colocation forecast.');
});
