import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { FACILITY_SPECIALIZATION_RULES as RULES } from '../src/content/wave28-facilities';
import type { CommandPayload, GameState, ModuleContext, ResourceFrame, WorkRequest } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { mulDiv } from '../src/core/math';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { calculateComputeCostReport, computeCostFact } from '../src/modules/compute-costs';
import { facilityWorkClass, getComputePools, getHistoricalPoolTrainingMultiplier, getHistoricalPoolWorkCostRate,
  getPoolMultiplierBps, getPoolWorkCapacityCU, getPoolWorkCostRate, usesCrossRackTraining } from '../src/modules/compute-pools';
import { facilitySpecializationWorkId, getFacilitySpecializationAtWeek, getFacilitySpecializationView, validateFacilitySpecializationCommand } from '../src/modules/facility-specialization';
import { infrastructureRequests } from '../src/modules/infrastructure';
import { getFacilityFixture, getFacilityPublicServingFixture, getFacilityReadyFixture, getFacilityTrainingFixture } from './fixtures/wave28-facilities';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const step = (state: GameState) => { const result = advanceWeek(state); assert.equal(result.accepted, true, result.reason?.message); return result.state; };
const latestCost = (state: GameState) => state.slices.compute.costReports![state.playerCompanyId].at(-1)!;
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const command = (state: GameState, payload: CommandPayload) => ({ id: 'facility-admission-test', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload });

/** Isolated allocator tests use the paid fixture's actual racks and workforce.
 * Only the synthetic workload frame and its category ceilings are controlled;
 * both resource owners produce grants, with no injected staff or compute grant. */
function allocate(original: GameState, make: (poolId: string, owner: string) => WorkRequest[]) {
  const state = structuredClone(original), owner = state.playerCompanyId;
  state.slices.compute.fleets[owner].allocation = { serving: 64 * U, development: 64 * U, research: 48 * U };
  const site = Object.values(state.slices.compute.facilities).find(item => item.companyId === owner && item.status === 'active')!;
  const pool = getComputePools(state).find(item => item.location === site.id)!;
  const requests = make(pool.id, owner), resources: ResourceFrame = { requests: [...infrastructureRequests(state, CONTENT), ...requests], staffGrants: [], computeGrants: [] };
  const context: ModuleContext = { week: state.week, phase: 'reserve', content: CONTENT, facts: [], resources, random: { draw: () => 0 } };
  resources.staffGrants = createCompanyModule(CONTENT).grantResources!(state, context).staffGrants!;
  const result = createComputeModule(CONTENT).grantResources!(state, context);
  resources.computeGrants = result.computeGrants!;
  const actualPool = getComputePools(state, owner, CONTENT, resources.staffGrants).find(item => item.id === pool.id)!;
  return { pool: actualPool, resources, requests, grants: resources.computeGrants.filter(grant => requests.some(request => request.id === grant.requestId)) };
}
function pair(workloadKind: WorkRequest['workloadKind'], headroomBps = 0, splitCategories = false) {
  return (poolId: string, owner: string): WorkRequest[] => [0, 1].map(index => ({ id: `facility-load-${index}`, companyId: owner,
    taskId: `facility-load-${index}`, category: workloadKind === 'inference' && !splitCategories ? 'serving' : index && splitCategories ? 'research' : 'development',
    workloadKind, normalizedWorkCUw: 40 * U, memoryMU: U, priority: 30 + index, poolId, headroomBps }));
}

test('W28-F01: an ordinary published company pays S5 and two independent retrofits; benefit and tradeoff start only at the following boundary', () => {
  const f = getFacilityFixture();
  assert.equal(f.originalWeek, 579); assert.equal(f.originalChecksum, '0e2eb06a'); assert.ok(f.minimumCashCents > 0);
  assert.equal(f.beforeRetrofit.slices.compute.facilitySpecializations, undefined);
  assert.ok(Object.values(f.beforeRetrofit.slices.research.projects).some(item => item.researchId === 'S5' && item.status === 'complete'));
  const first = f.building.slices.compute.facilitySpecializations![f.servingId];
  assert.equal(first.purchaseCents, 1_800_000); assert.equal(first.elapsedWeeks, 1);
  assert.equal(first.requiredStaff, 3 * U); assert.equal(first.requiredWork, 6 * U); assert.equal(first.requiredMemory, 2 * U);
  assert.ok(first.completedStaff > 0 && first.physicalWork > 0); assert.equal(first.completedWork, 6 * U);
  const actual = latestCost(f.building), grant = actual.resources.computeGrants.find(item => item.requestId === facilitySpecializationWorkId(first.id))!;
  assert.equal(first.physicalWork, grant.physicalCUw); assert.equal(first.grants[0].grantedWork, grant.hardwareEffectiveCUw);
  assert.equal(getFacilitySpecializationAtWeek(f.ready, f.facilityId), null);
  const complete = f.ready.slices.compute.facilitySpecializations![f.servingId];
  assert.equal(complete.elapsedWeeks, 3); assert.equal(complete.completedStaff, 3 * U); assert.equal(complete.readyWeek, f.ready.week + 1);
  assert.equal(getFacilitySpecializationAtWeek(f.servingActive, f.facilityId)?.id, f.servingId);
  for (const state of [f.switching, f.trainingReady]) assert.equal(getFacilitySpecializationAtWeek(state, f.facilityId)?.id, f.servingId);
  const switched = f.trainingActive.slices.compute.facilitySpecializations!;
  assert.equal(switched[f.servingId].status, 'retired'); assert.equal(switched[f.servingId].retiredWeek, f.trainingActive.week);
  assert.equal(switched[f.trainingId].activatedWeek, f.trainingActive.week); assert.equal(switched[f.trainingId].previousProfileId, f.servingId);
  for (const [id, funded] of [[f.servingId, f.building], [f.trainingId, f.switching]] as const) {
    const paid = funded.slices.company.ledger.filter(entry => entry.id === switched[id].paymentId);
    assert.equal(paid.length, 1); assert.equal(paid[0].amountCents, RULES.purchaseCents); assert.equal(paid[0].paidCents, RULES.purchaseCents);
    assert.equal(f.trainingActive.slices.company.postedFacts[switched[id].paymentId], true, 'The durable posting proof survives bounded ledger pruning.');
  }
  assert.deepEqual(validateState(f.trainingActive), []);
});

test('W28-F02: a reviewed profile reserves one capital payment, preserves queued identity on reload and rejects duplicate, foreign and unearned work', () => {
  const f = getFacilityReadyFixture(), payload = { kind: 'start_facility_specialization', facilityId: f.facilityId, profile: 'serving' } as const;
  const beforeHash = canonicalStateHash(f.state), quote = previewCommand(f.state, payload), submitted = submitCommand(f.state, payload);
  assert.equal(quote.accepted, true, quote.reason?.message); assert.equal(quote.upfrontCostCents, RULES.purchaseCents); assert.equal(quote.weeklyCostDeltaCents, 0);
  assert.equal(submitted.accepted, true, submitted.reason?.message); assert.equal(company(submitted.state).cashCents, company(f.state).cashCents);
  assert.equal(submitted.state.queuedCommands.at(-1)!.reservedCents, RULES.purchaseCents); assert.equal(canonicalStateHash(f.state), beforeHash);
  for (const profile of ['serving', 'training'] as const) {
    const rejected = submitCommand(submitted.state, { ...payload, profile });
    assert.equal(rejected.accepted, false); assert.equal(rejected.reason?.code, 'ALREADY_ACTIVE'); assert.equal(rejected.state, submitted.state);
  }
  const loaded = deserializeState(serializeState(submitted.state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.deepEqual(step(loaded.state), step(submitted.state));
  assert.equal(previewCommand(f.state, { ...payload, facilityId: 'colocation' }).accepted, false);
  assert.equal(previewCommand(f.state, { ...payload, profile: 'free-upgrade' } as unknown as CommandPayload).accepted, false);
  assert.equal(previewCommand(f.state, { ...payload, bonus: 10000 } as unknown as CommandPayload).accepted, false);
  const unearned = structuredClone(f.state); unearned.slices.research.completedByCompany[unearned.playerCompanyId] = unearned.slices.research.completedByCompany[unearned.playerCompanyId].filter(id => id !== 'S5');
  assert.match(validateFacilitySpecializationCommand(unearned, command(unearned, payload))?.message ?? '', /paid.*S5/);
  const poor = structuredClone(f.state); company(poor).cashCents = RULES.purchaseCents - 1;
  assert.equal(submitCommand(poor, payload).reason?.code, 'INSUFFICIENT_FUNDS');
});

test('W28-F03: elapsed time cannot replace staff or GPU qualification; pause and real reassignment preserve paid progress', () => {
  const f = getFacilityReadyFixture(), run = new NaturalBusinessCampaign(f.state, 'wave28-facility-blockers');
  run.founder('commercial');
  for (const member of run.staff('infrastructure')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 0, research: 8 * U });
  const id = 'facility-specialization:' + run.queue({ kind: 'start_facility_specialization', facilityId: f.facilityId, profile: 'serving' });
  run.step();
  const paymentId = run.state.slices.compute.facilitySpecializations![id].paymentId;
  const paid = run.state.slices.company.ledger.filter(entry => entry.id === paymentId);
  assert.equal(paid.length, 1); assert.equal(paid[0].amountCents, RULES.purchaseCents);
  run.step(2);
  const blocked = run.state.slices.compute.facilitySpecializations![id];
  assert.equal(blocked.elapsedWeeks, 3); assert.equal(blocked.completedWork, 0); assert.equal(blocked.completedStaff, 0);
  assert.equal(blocked.status, 'building'); assert.equal(getFacilitySpecializationAtWeek(run.state, f.facilityId), null);
  run.queue({ kind: 'set_facility_specialization_paused', specializationId: id, paused: true }); run.step();
  const paused = structuredClone(run.state.slices.compute.facilitySpecializations![id]); run.step();
  assert.deepEqual(run.state.slices.compute.facilitySpecializations![id], paused);
  for (const member of run.staff('infrastructure')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: U });
  run.founder('infrastructure'); run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 8 * U, research: 8 * U });
  run.queue({ kind: 'set_facility_specialization_paused', specializationId: id, paused: false });
  run.until(state => state.slices.compute.facilitySpecializations![id].status === 'ready', 6, 'Real staff and compute restore progress');
  assert.equal(getFacilitySpecializationAtWeek(run.state, f.facilityId), null); run.step();
  assert.equal(getFacilitySpecializationAtWeek(run.state, f.facilityId)?.id, id);
  assert.equal(run.state.slices.company.postedFacts[paymentId], true);
  assert.equal(Object.keys(run.state.slices.company.postedFacts).filter(key => key === paymentId).length, 1);
  assert.equal(run.state.slices.company.ledger.filter(entry => entry.id === paymentId).length, 0, 'The bounded ledger prunes the old payment without charging it again.');
  assert.deepEqual(validateState(run.state), []);
});

test('W28-F04: serving specialization bills only actual eligible work once; live Chat, API and delivered enterprise support retain their ordinary obligations', () => {
  const f = getFacilityFixture(), state = f.servingActive, snapshot = latestCost(state), report = calculateComputeCostReport(snapshot);
  let raw = BigInt(snapshot.variableCostCarryIn), undiscounted = BigInt(snapshot.variableCostCarryIn), discountedWork = 0;
  for (const grant of snapshot.resources.computeGrants) {
    const pool = snapshot.pools.find(item => item.id === grant.poolId)!, request = snapshot.resources.requests.find(item => item.id === grant.requestId)!;
    if (pool.ownership !== 'owned') continue;
    raw += BigInt(grant.physicalCUw) * BigInt(getPoolWorkCostRate(pool, request));
    undiscounted += BigInt(grant.physicalCUw) * BigInt(pool.variableCentsPerCUw);
    if (pool.specialization && facilityWorkClass(request) === 'serving') discountedWork += grant.physicalCUw;
  }
  assert.ok(discountedWork > 0, 'Existing Documents work must actually use the specialized site.');
  assert.equal(report.totals.ownedVariableCents, Number(raw / BigInt(U)));
  assert.equal(snapshot.variableCostCarryOut, Number(raw % BigInt(U)));
  assert.ok(report.totals.ownedVariableCents < Number(undiscounted / BigInt(U)));
  const charges = state.slices.company.ledger.filter(entry => entry.week === state.week && entry.companyId === state.playerCompanyId && entry.sourceId === 'owned-gpu-work');
  assert.equal(charges.length, 1); assert.equal(charges[0].amountCents, report.totals.ownedVariableCents);
  assert.equal(computeCostFact(snapshot, 'cloud-rent')!.amountCents, computeCostFact(latestCost(f.beforeRetrofit), 'cloud-rent')!.amountCents);
  assert.equal(computeCostFact(snapshot, 'owned-fixed')!.amountCents, computeCostFact(latestCost(f.beforeRetrofit), 'owned-fixed')!.amountCents);
  for (const offer of Object.values(state.slices.products.offers).filter(item => item.companyId === state.playerCompanyId)) {
    const usage = state.slices.products.lastUsage[offer.id];
    assert.equal(usage.week, state.week); assert.equal(usage.fulfillmentBps, 10000); assert.ok(usage.billedCents > 0);
    assert.equal(state.slices.products.invoices.filter(invoice => invoice.productId === offer.id && invoice.week === state.week).length, 1);
  }
  for (const id of ['business:vector-studio', 'business:cedar-records']) {
    const contract = state.slices.products.commercialContracts[id];
    assert.equal(contract.status, 'active'); assert.equal(contract.lastUsage!.week, state.week);
    assert.equal(contract.lastUsage!.supportStaffGranted, U / 4); assert.equal(contract.lastUsage!.serviceBps, 10000);
    assert.equal(contract.lastUsage!.physicalWorkCUw, 0, 'Delivered customer-hosted weights must not invent hosted inference or its discount.');
    assert.equal(state.slices.products.commercialInvoices.filter(invoice => invoice.contractId === id && invoice.week === state.week).length, 1);
  }
});

test('W28-F05: training penalties aggregate across requests and categories; research/general, cloud and colocation retain original behavior', () => {
  const f = getFacilityFixture(), baseline = allocate(f.beforeRetrofit, pair('training', 0, true)), specialized = allocate(f.servingActive, pair('training', 0, true));
  const total = (value: typeof baseline) => value.grants.reduce((n, grant) => n + grant.physicalCUw, 0);
  assert.equal(total(baseline), baseline.pool.capacityCU); assert.equal(total(specialized), mulDiv(specialized.pool.capacityCU, 9000, 10000));
  assert.ok(specialized.grants.every(grant => grant.physicalCUw > 0));
  const general = allocate(f.servingActive, pair('general', 0, true));
  assert.equal(total(general), baseline.pool.capacityCU);
  assert.equal(getPoolWorkCostRate(specialized.pool, specialized.requests[0]), specialized.pool.variableCentsPerCUw);
  for (const pool of getComputePools(f.servingActive).filter(item => item.ownership === 'cloud' || item.location === 'colocation')) {
    const old = getComputePools(f.beforeRetrofit).find(item => item.id === pool.id)!;
    assert.deepEqual(pool, old); assert.equal(pool.specialization, undefined);
  }
  assert.equal(facilityWorkClass({ category: 'research', workloadKind: 'inference' }), 'serving');
  assert.equal(facilityWorkClass({ category: 'research', workloadKind: 'general' }), 'general');
});

test('W28-F06: the training profile improves compatible cross-rack updates only and its shared serving ceiling includes headroom', () => {
  const f = getFacilityFixture(), baseline = allocate(f.beforeRetrofit, pair('training', 0, true)), specialized = allocate(f.trainingActive, pair('training', 0, true));
  assert.equal(getPoolMultiplierBps(specialized.pool, 'development', true, CONTENT, 'training'), mulDiv(getPoolMultiplierBps(baseline.pool, 'development', true, CONTENT, 'training'), 11000, 10000));
  assert.equal(getPoolMultiplierBps(specialized.pool, 'development', false, CONTENT, 'training'), getPoolMultiplierBps(baseline.pool, 'development', false, CONTENT, 'training'));
  for (const kind of ['general', 'inference'] as const) assert.equal(getPoolMultiplierBps(specialized.pool, 'research', true, CONTENT, kind), getPoolMultiplierBps(baseline.pool, 'research', true, CONTENT, kind));
  const ordinaryGeneral = allocate(f.beforeRetrofit, pair('general', 0, true)), currentGeneral = allocate(f.trainingActive, pair('general', 0, true));
  assert.deepEqual(currentGeneral.grants, ordinaryGeneral.grants);
  const serving = allocate(f.trainingActive, pair('inference', 1000)), mixed = allocate(f.trainingActive, pair('inference', 1000, true));
  for (const result of [serving, mixed]) {
    const reserved = result.grants.reduce((sum, grant, index) => sum + mulDiv(grant.physicalCUw, 10000 + result.requests[index].headroomBps!, 10000, 'ceil'), 0);
    const ceiling = getPoolWorkCapacityCU(result.pool, { category: 'serving', workloadKind: 'inference' });
    assert.equal(ceiling, mulDiv(result.pool.capacityCU, 9000, 10000)); assert.ok(reserved <= ceiling && ceiling - reserved < 3);
    assert.ok(result.grants.every(grant => grant.physicalCUw > 0));
  }
});

test('W28-F07: a separately paid real foundation receives the exact training gain while public service and enterprise support continue', () => {
  const serving = getFacilityTrainingFixture('serving'), training = getFacilityTrainingFixture('training');
  const evidence = (f: typeof training) => {
    const state = f.working, snapshot = latestCost(state), run = state.slices.models.trainingRuns[f.runId];
    const request = snapshot.resources.requests.find(item => item.taskId === run.id)!;
    const grant = snapshot.resources.computeGrants.find(item => item.requestId === request.id)!;
    const pool = snapshot.pools.find(item => item.id === grant.poolId)!;
    assert.equal(run.recipeId, 'medium-foundation'); assert.equal(run.plan!.profile, 'ambitious'); assert.equal(run.requiredMemory, 24 * U);
    assert.equal(run.preparationCompleted, run.plan!.preparationRequired); assert.ok(run.preparationCompleted! > 0);
    assert.equal(pool.location, f.facilityId); assert.equal(request.workloadKind, 'training');
    assert.equal(usesCrossRackTraining(pool, request.category, grant.physicalCUw, grant.memoryMU), true);
    assert.ok(snapshot.resources.staffGrants.find(item => item.requestId === request.id)!.grants.some(item => item.role === 'ml' && item.staffWeeks > 0));
    assert.equal(run.completedWork, grant.hardwareEffectiveCUw); assert.equal(grant.memoryMU, 24 * U);
    for (const offer of Object.values(state.slices.products.offers).filter(item => item.companyId === state.playerCompanyId)) assert.equal(state.slices.products.lastUsage[offer.id].fulfillmentBps, 10000);
    assert.equal(state.slices.products.commercialContracts['business:vector-studio'].lastUsage!.serviceBps, 10000);
    assert.deepEqual(validateState(state), []); return { grant, pool };
  };
  const old = evidence(serving), improved = evidence(training);
  assert.equal(improved.grant.physicalCUw, old.grant.physicalCUw);
  assert.equal(improved.grant.hardwareEffectiveCUw, mulDiv(old.grant.hardwareEffectiveCUw, 11000, 10000));
  assert.equal(improved.pool.memoryMU, old.pool.memoryMU);
});

test('W28-F08: historical profile receipts and rates survive a paid switch, exact reload and a following ordinary week', () => {
  const f = getFacilityFixture(), current = f.trainingActive;
  const oldReport = latestCost(f.servingActive), retained = current.slices.compute.costReports![current.playerCompanyId].find(item => item.week === oldReport.week)!;
  assert.deepEqual(retained, oldReport);
  const pool = oldReport.pools.find(item => item.location === f.facilityId)!;
  const serving = { category: 'serving' as const, workloadKind: 'inference' as const }, training = { category: 'development' as const, workloadKind: 'training' as const };
  assert.equal(getHistoricalPoolWorkCostRate(current, pool.id, pool.hardwareId, f.servingActive.week, pool.variableCentsPerCUw, serving), 6750);
  assert.equal(getHistoricalPoolWorkCostRate(current, pool.id, pool.hardwareId, current.week, pool.variableCentsPerCUw, serving), 7500);
  assert.equal(getHistoricalPoolTrainingMultiplier(current, pool.id, pool.hardwareId, f.servingActive.week, 12600, true, training), 12600);
  assert.equal(getHistoricalPoolTrainingMultiplier(current, pool.id, pool.hardwareId, current.week, 12600, true, training), 13860);
  const loaded = deserializeState(serializeState(current)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.deepEqual(loaded.state, current); assert.deepEqual(step(loaded.state), step(current));
});

test('W28-F09: state validation rejects forged price, work, future activation, overlapping or erased profiles; the Campus selector stays pure', () => {
  const f = getFacilityFixture(), valid = f.trainingActive, hash = canonicalStateHash(valid);
  const first = getFacilitySpecializationView(valid), second = getFacilitySpecializationView(valid);
  assert.deepEqual(second, first); assert.equal(canonicalStateHash(valid), hash); assert.equal(first.sites[0].active?.id, f.trainingId);
  const oldView = getFacilitySpecializationView(f.beforeRetrofit).sites.find(item => item.id === f.facilityId)!;
  const currentView = first.sites.find(item => item.id === f.facilityId)!;
  assert.equal(currentView.fixedWeeklyCents, oldView.fixedWeeklyCents); assert.equal(currentView.requiredOperatingStaff, oldView.requiredOperatingStaff);
  assert.equal(currentView.powerLimit, oldView.powerLimit); assert.equal(currentView.coolingLimit, oldView.coolingLimit);
  const attempts: ((state: GameState) => void)[] = [
    state => { state.slices.compute.facilitySpecializations![f.trainingId].purchaseCents--; },
    state => { state.slices.compute.facilitySpecializations![f.trainingId].completedWork++; },
    state => { state.slices.compute.facilitySpecializations![f.trainingId].activatedWeek = state.week + 1; },
    state => { state.slices.compute.facilitySpecializations![f.servingId].status = 'active'; state.slices.compute.facilitySpecializations![f.servingId].retiredWeek = null; },
    state => { delete state.slices.company.postedFacts[state.slices.compute.facilitySpecializations![f.trainingId].paymentId]; },
    state => { const project = state.slices.compute.facilitySpecializations![f.trainingId]; (project as unknown as Record<string, unknown>).freeCapacity = U; },
    state => { state.slices.compute.facilitySpecializations![f.trainingId].grants[0].grantedStaff++; },
    state => { delete latestCost(state).pools.find(item => item.location === f.facilityId)!.specialization; },
    state => { latestCost(state).pools.find(item => item.location === f.facilityId)!.specialization!.servingCapacityBps = 10000; },
    state => { const request = latestCost(state).resources.requests.find(item => item.id.startsWith('serve:'))!;
      (request as unknown as { workloadKind: string }).workloadKind = 'unknown'; },
  ];
  for (const mutate of attempts) { const broken = structuredClone(valid); mutate(broken); assert.ok(validateState(broken).length > 0, mutate.toString()); }
  assert.equal(canonicalStateHash(valid), hash);
});

test('W28-F10: reduced cloud exposes real placement limits; a paid existing-rack move lets Chat use the serving profile without starving API', () => {
  const f = getFacilityPublicServingFixture();
  const chatId = Object.values(f.beforeChange.slices.products.offers).find(item => item.companyId === f.beforeChange.playerCompanyId && item.kind === 'basic-chat')!.id;
  const apiId = Object.values(f.beforeChange.slices.products.offers).find(item => item.companyId === f.beforeChange.playerCompanyId && item.kind === 'developer-api')!.id;
  assert.ok(f.constrained.slices.products.lastUsage[chatId].fulfillmentBps < 10000, 'The seven-rack pool must expose its actual connected placement limit.');
  assert.equal(f.constrained.slices.products.lastUsage[apiId].fulfillmentBps, 10000);
  const state = f.efficient, snapshot = latestCost(state), move = state.slices.compute.rackRelocations![f.relocationId];
  assert.equal(move.status, 'complete'); assert.equal(move.paidCents, 150000); assert.equal(state.slices.company.postedFacts[move.paymentId], true);
  assert.equal(state.slices.compute.racks[f.rackId].location, f.facilityId);
  assert.equal(Object.keys(state.slices.compute.racks).length, Object.keys(f.beforeChange.slices.compute.racks).length, 'The branch moves paid existing equipment; it creates no rack.');
  const fleet = state.slices.compute.fleets[state.playerCompanyId]; assert.equal(fleet.cloudCU, 64 * U); assert.equal(fleet.allocation.serving, 128 * U);
  const chat = state.slices.products.lastUsage[chatId], api = state.slices.products.lastUsage[apiId];
  assert.equal(chat.fulfillmentBps, 10000); assert.equal(api.fulfillmentBps, 10000); assert.ok(chat.billedCents > 0 && api.billedCents > 0);
  const request = snapshot.resources.requests.find(item => item.id === 'serve:' + chatId)!;
  const grant = snapshot.resources.computeGrants.find(item => item.requestId === request.id)!;
  const pool = snapshot.pools.find(item => item.id === grant.poolId)!;
  assert.equal(pool.location, f.facilityId); assert.equal(pool.capacityCU, 64 * U); assert.equal(pool.specialization!.profile, 'serving');
  assert.equal(getPoolWorkCostRate(pool, request), 6750); assert.ok(chat.tokens!.ownedVariableCostCents > 0);
  assert.equal(chat.tokens!.ownedVariableCostCents, mulDiv(grant.physicalCUw, 6750, U));
  assert.equal(snapshot.resources.computeGrants.find(item => item.requestId === 'serve:' + apiId)!.poolId, 'general-cloud');
  for (const id of [chatId, apiId]) assert.equal(state.slices.products.invoices.filter(invoice => invoice.productId === id && invoice.week === state.week).length, 1);
  assert.equal(snapshot.ledgerFacts.filter(fact => fact.sourceId === 'owned-gpu-work').length, 1);
  assert.deepEqual(validateState(state), []);
});
