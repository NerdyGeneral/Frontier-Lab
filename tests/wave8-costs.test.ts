import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { GameCommand, GameState, LedgerFact, ModuleContext, ResourceFrame, WorkRequest } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { assertWave8ComputeCosts } from '../src/core/wave8-costs-validation';
import { mulDiv } from '../src/core/math';
import { advanceSystemRollouts, applySystemApplication, commitSystemRollouts, resolveSystemRollouts, systemApplicationRequests, validateSystemApplication } from '../src/modules/applied-research';
import { applyBusinessCommand } from '../src/modules/business';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { calculateComputeCostReport, computeCostAvailability, getComputeCostView, recordComputeCosts } from '../src/modules/compute-costs';
import { getInfrastructureBaseCost } from '../src/modules/compute-pools';
import { infrastructureRequests } from '../src/modules/infrastructure';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

// Authored isolated accounting fixtures. Ordinary adoption is covered by the integrated campaign.
function fixture(cloudCU = 4): GameState {
  const state = createPlayerOnlyState(), companyId = state.playerCompanyId;
  state.week = 10;
  state.slices.company.founderAssignments[companyId] = { ...emptyRoleAllocation(), infrastructure: U };
  state.slices.research.completedByCompany[companyId] = ['R12A'];
  state.slices.research.projects['cost-research'] = { id: 'cost-research', companyId, researchId: 'R12A', startedWeek: 5,
    requiredWork: U, completedWork: U, requiredStaff: U, completedStaff: U, role: 'research', status: 'complete',
    lastProgress: U, lastBottleneck: '', completedWeek: 6, availableWeek: 7 };
  state.slices.research.systemRollouts['cost-rollout'] = { id: 'cost-rollout', companyId, method: 'cost-accounting', startedWeek: 8,
    requiredWork: U, completedWork: U, requiredStaff: U, completedStaff: U, status: 'active', readyWeek: 10, lastBottleneck: '' };
  const fleet = state.slices.compute.fleets[companyId];
  fleet.cloudCU = cloudCU * U; fleet.memoryMU = cloudCU * 2 * U;
  fleet.allocation = { serving: cloudCU * U, development: 0, research: 0 };
  return state;
}

function rack(state: GameState, hardwareId = 'general', id = 'cost-rack', parked = false) {
  state.slices.compute.racks[id] = { id, companyId: state.playerCompanyId, hardwareId, location: 'colocation', status: parked ? 'parked' : 'installed',
    orderedWeek: 0, arrivalWeek: 6, installationStartedWeek: 6, completedInstallStaff: U, readyWeek: 8, installedWeek: 8,
    purchaseCents: 8 * CONTENT.hardware.find(item => item.id === hardwareId)!.purchaseCentsPerCU, lastBottleneck: '' };
  state.slices.compute.fleets[state.playerCompanyId].ownedCU += 8 * U;
}

function product(state: GameState, id = 'chat') {
  const companyId = state.playerCompanyId, modelId = CONTENT.seedModel.id;
  state.slices.products.offers[id] = { id, companyId, name: id === 'chat' ? 'Basic Chat' : 'Developer API', kind: id === 'chat' ? 'basic-chat' : 'developer-api',
    deploymentId: 'deployment-' + id, contractId: 'contract-' + id, status: 'active', createdWeek: 8, publicModelId: modelId };
  state.slices.products.deployments['deployment-' + id] = { id: 'deployment-' + id, companyId, productId: id, modelId, status: 'active', startedWeek: 8,
    requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  state.slices.products.contracts['contract-' + id] = { id: 'contract-' + id, companyId, productId: id, weeklyPriceCents: 1200, allowance: 100, creditBps: 10000, effectiveWeek: 9 };
  return id;
}

function work(state: GameState, id: string, amount: number, poolId = 'general-cloud', category: WorkRequest['category'] = 'serving', headroomBps = 0): WorkRequest {
  return { id, companyId: state.playerCompanyId, taskId: id.startsWith('serve:') ? id.slice('serve:'.length) : id,
    category, normalizedWorkCUw: amount, memoryMU: amount ? U : 0, priority: 0, poolId, ...(headroomBps ? { headroomBps } : {}) };
}

function revenue(state: GameState, productId: string, cents: number): LedgerFact {
  return { id: `invoice:${productId}:${state.week}`, companyId: state.playerCompanyId, week: state.week,
    sourceId: 'contract-' + productId, kind: 'receipt', category: 'revenue', amountCents: cents, label: productId + ' earned revenue' };
}

function context(state: GameState, resources: ResourceFrame, facts: LedgerFact[] = [], phase: ModuleContext['phase'] = 'reserve'): ModuleContext {
  return { week: state.week, phase, content: CONTENT, resources, facts, random: { draw: () => { throw new Error('Accounting must not draw randomness.'); } } };
}

function settle(input: GameState, requested: WorkRequest[], extraFacts: LedgerFact[] = []) {
  const state = structuredClone(input);
  const resources: ResourceFrame = { requests: [...infrastructureRequests(state, CONTENT), ...requested], computeGrants: [], staffGrants: [] };
  const company = createCompanyModule(CONTENT), compute = createComputeModule(CONTENT);
  const staff = company.grantResources!(state, context(state, resources));
  state.slices.company = staff.updates!.company!; resources.staffGrants = staff.staffGrants!;
  const granted = compute.grantResources!(state, context(state, resources));
  state.slices.compute = granted.updates!.compute!; resources.computeGrants = granted.computeGrants!;
  const payroll = company.handlers.execute!(state, context(state, resources, [], 'execute'));
  const executed = compute.handlers.execute!(state, context(state, resources, [], 'execute'));
  state.slices.compute = executed.updates!.compute!;
  const facts = [...extraFacts, ...(payroll.facts ?? []), ...(executed.facts ?? [])];
  state.slices.company = company.handlers.settle!(state, context(state, resources, facts, 'settle')).updates!.company!;
  const settled = structuredClone(state), ctx = context(state, resources, facts, 'plan');
  const result = recordComputeCosts(state, ctx);
  if (result.updates?.compute) state.slices.compute = result.updates.compute;
  assertWave8ComputeCosts(state, CONTENT);
  return { state, settled, ctx, report: getComputeCostView(state).latest };
}

test('W8-C01: cost accounting needs discovery, both paid rollout meters, and next-boundary activation', () => {
  let state = fixture(); state.slices.research.systemRollouts = {}; state.slices.research.completedByCompany[state.playerCompanyId] = [];
  const command: GameCommand = { id: 'install-costs', companyId: state.playerCompanyId, issuedForWeek: 11, payload: { kind: 'start_system_rollout', method: 'cost-accounting' } };
  assert.ok(validateSystemApplication(state, command));
  state.slices.research.completedByCompany[state.playerCompanyId] = ['R12A'];
  assert.equal(validateSystemApplication(state, command), undefined);
  state.slices.research = applySystemApplication(state, command).updates!.research!;
  const rollout = Object.values(state.slices.research.systemRollouts)[0];
  const requests = systemApplicationRequests(state), request = requests.find(item => item.taskId === rollout.id)!;
  const resources: ResourceFrame = { requests, computeGrants: [{ requestId: request.id, physicalCUw: U / 2, hardwareEffectiveCUw: U / 2, memoryMU: 0, poolId: 'general-cloud' }], staffGrants: [{ requestId: request.id, grants: [{ role: 'ml', staffWeeks: U }] }] };
  advanceSystemRollouts(state.slices.research, context(state, resources)); resolveSystemRollouts(state.slices.research, state.week);
  assert.equal(rollout.status, 'building'); assert.equal(computeCostAvailability(state).available, false);
  assert.deepEqual(recordComputeCosts(state, context(state, { requests: [], computeGrants: [], staffGrants: [] }, [], 'plan')), {});
  resources.staffGrants = []; advanceSystemRollouts(state.slices.research, context(state, resources)); resolveSystemRollouts(state.slices.research, state.week);
  assert.equal(rollout.status, 'ready'); assert.equal(computeCostAvailability(state).available, false);
  state.week += 1; commitSystemRollouts(state.slices.research, state.week);
  assert.equal(computeCostAvailability(state).available, true);
  const captured = settle(state, []).report!; assert.equal(captured.week, state.week); assert.equal(captured.workloads.length, 0);
  const forged = structuredClone(state); Object.values(forged.slices.research.systemRollouts)[0].startedWeek = 6;
  assert.throws(() => assertWave8ComputeCosts(forged, CONTENT), /before.*available/);
});

test('W8-C02: cloud attribution includes serving headroom, retains idle rent, and changes no charge or resource', () => {
  const state = fixture(); product(state);
  state.slices.compute.fleets[state.playerCompanyId].allocation = { serving: 5 * U / 2, development: U, research: 0 };
  const { state: result, settled, report } = settle(state, [work(state, 'serve:chat', 2 * U, 'general-cloud', 'serving', 2500), work(state, 'train', U, 'general-cloud', 'development')], [revenue(state, 'chat', 100_000)]);
  const rent = CONTENT.opening.rentCentsPerCUWeek;
  assert.equal(report!.totals.cloudRentCents, 4 * rent);
  assert.equal(report!.workloads.find(item => item.requestId === 'serve:chat')!.cloudRentCents, 5 * rent / 2);
  assert.equal(report!.totals.unallocatedCloudCents, rent / 2);
  assert.equal(report!.poolUsage[0].headroomCUw, U / 2);
  assert.equal(report!.activities.find(item => item.targetId === 'product:chat')!.contributionCents, 100_000 - 5 * rent / 2);
  const unchanged = structuredClone(result); delete unchanged.slices.compute.costReports;
  assert.equal(canonicalStateHash(unchanged), canonicalStateHash(settled), 'Metering only appends the frozen report.');
  assert.equal(report!.totals.attributedComputeCents + report!.totals.sharedComputeCents, report!.totals.totalComputeCents);
  assert.equal(report!.totals.otherOperatingCents, CONTENT.opening.overheadCentsPerWeek);
});

test('W8-C03: partial and denied work attribute the actual grant rather than requested demand', () => {
  const state = fixture(); product(state);
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 2 * U;
  const denied = work(state, 'too-wide', U); denied.memoryMU = 20 * U; denied.priority = 1;
  const { report } = settle(state, [work(state, 'serve:chat', 6 * U, 'general-cloud', 'serving', 2000), denied], [revenue(state, 'chat', 2000)]);
  const row = report!.workloads.find(item => item.requestId === 'serve:chat')!;
  assert.ok(row.effectiveWorkCUw > 0 && row.effectiveWorkCUw < row.requestedWorkCUw);
  assert.equal(row.cloudRentCents, mulDiv(report!.totals.cloudRentCents, row.reservedCUw, 4 * U));
  assert.equal(report!.workloads.find(item => item.requestId === 'too-wide')!.attributedComputeCents, 0);
  assert.equal(report!.totals.companyRevenueCents, 2000, 'Use the actual invoice, never the unserved demand.');
});

test('W8-C04: owned cost uses physical work, pools fractional cents, and keeps prior carry explicitly shared', () => {
  const state = fixture(0); rack(state);
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 8 * U;
  state.slices.compute.fleets[state.playerCompanyId].variableCostCarry = 900_000_000;
  const pool = 'owned:colocation:general';
  const { report } = settle(state, [work(state, 'alpha', 120_000, pool), work(state, 'beta', 120_000, pool)]);
  assert.equal(report!.totals.ownedVariableCents, 2);
  assert.equal(report!.totals.attributedOwnedVariableCents, 1);
  assert.equal(report!.totals.sharedCarryCents, 1);
  assert.equal(report!.variableCostCarryIn, 900_000_000); assert.equal(report!.variableCostCarryOut, 100_000_000);
  assert.equal(report!.workloads.find(item => item.requestId === 'alpha')!.ownedVariableCents, 1, 'Stable request identity breaks a fractional tie.');
  assert.equal(report!.workloads.find(item => item.requestId === 'beta')!.ownedVariableCents, 0);
  assert.equal(report!.totals.ownedFixedCents, CONTENT.infrastructure.colocationCentsPerRackWeek);
  assert.equal(report!.totals.sharedComputeCents, report!.totals.ownedFixedCents + 1);
});

test('W8-C05: mixed pools preserve distinct tariffs and hardware efficiency; headroom does not become owned energy', () => {
  const state = fixture(4); rack(state, 'training'); product(state);
  state.slices.compute.fleets[state.playerCompanyId].allocation = { serving: 2 * U, development: 3 * U, research: 0 };
  const { report } = settle(state, [work(state, 'serve:chat', U, 'general-cloud', 'serving', 1000), work(state, 'training-update', 3 * U, 'owned:colocation:training', 'development')], [revenue(state, 'chat', 80_000)]);
  const trained = report!.workloads.find(item => item.requestId === 'training-update')!;
  assert.ok(trained.physicalWorkCUw < trained.effectiveWorkCUw);
  assert.equal(trained.ownedVariableCents, mulDiv(trained.physicalWorkCUw, 7500, U));
  assert.equal(report!.totals.totalComputeCents, report!.totals.cloudRentCents + report!.totals.ownedVariableCents + report!.totals.ownedFixedCents);
  assert.equal(report!.totals.attributedComputeCents + report!.totals.sharedComputeCents, report!.totals.totalComputeCents);
  assert.equal(report!.pools.find(pool => pool.ownership === 'owned')!.variableCentsPerCUw, 7500);
  const headroom = fixture(0); rack(headroom); headroom.slices.compute.fleets[headroom.playerCompanyId].allocation.serving = 8 * U;
  const owned = settle(headroom, [work(headroom, 'owned-serving', U, 'owned:colocation:general', 'serving', 5000)]).report!;
  assert.equal(owned.totals.ownedVariableCents, 5000); assert.equal(owned.poolUsage.find(pool => pool.poolId.startsWith('owned:'))!.headroomCUw, U / 2);
});

test('W8-C06: idle cloud, parked racks, and missing operating staff retain costs without inventing useful capacity', () => {
  const state = fixture(4); rack(state, 'general', 'parked', true); rack(state, 'training', 'understaffed');
  state.slices.company.founderAssignments[state.playerCompanyId] = emptyRoleAllocation();
  state.slices.compute.fleets[state.playerCompanyId].allocation = { serving: 12 * U, development: 0, research: 0 };
  const { report } = settle(state, [work(state, 'owned-blocked', U, 'owned:colocation:training')]);
  assert.equal(report!.totals.attributedComputeCents, 0);
  assert.equal(report!.totals.unallocatedCloudCents, report!.totals.cloudRentCents);
  assert.equal(report!.totals.ownedVariableCents, 0);
  assert.equal(report!.totals.ownedFixedCents, 2 * CONTENT.infrastructure.colocationCentsPerRackWeek);
  assert.ok(report!.pools.filter(pool => pool.ownership === 'owned').every(pool => pool.capacityCU === 0));
  assert.equal(report!.poolUsage.find(pool => pool.poolId === 'owned:colocation:general')!.unavailableCapacityCU, 8 * U);
});

test('W8-C07: private service, buyer-hosted licenses and agent revenue reconcile without invented buyer compute', () => {
  const state = fixture(8), companyId = state.playerCompanyId;
  const packet = state.slices.data.packets[CONTENT.starterData.id]; packet.prepared = true; packet.readyUnits = packet.rawUnits;
  for (const [customerId, kind] of [['aster-services', 'private-hosted'], ['vector-studio', 'customer-hosted']] as const) {
    state.slices.products = applyBusinessCommand(state, { id: 'cost-' + customerId, companyId, issuedForWeek: 11,
      payload: { kind: 'sign_business_contract', customerId, contractKind: kind, modelId: CONTENT.seedModel.id,
        ...(kind === 'private-hosted' ? { packetId: CONTENT.starterData.id } : {}) } }, CONTENT).updates!.products!;
  }
  const [privateContract, license] = Object.values(state.slices.products.commercialContracts).sort((a, b) => a.customerId.localeCompare(b.customerId));
  const privateWork = { ...work(state, 'business-serve:' + privateContract.id, U), taskId: privateContract.id };
  const licenseSupport = { ...work(state, 'business-support:' + license.id, 0, 'general-cloud', 'development'), taskId: license.id };
  const facts: LedgerFact[] = [privateContract, license].map(contract => ({ id: `business-invoice:${contract.id}:1:10`, companyId, week: 10,
    sourceId: contract.id, kind: 'receipt', category: 'revenue', amountCents: contract.weeklyPriceCents, label: contract.customerId + ' bill' }));
  facts.push({ id: 'invoice:agent:agent:root:10', companyId, week: 10, sourceId: 'agent:root', kind: 'receipt', category: 'revenue', amountCents: 35_000, label: 'Verified support outcome' });
  const agentWork = { ...work(state, 'agent:completed:work', U / 2), taskId: 'agent:completed' };
  const { state: settled, report } = settle(state, [privateWork, licenseSupport, agentWork], facts);
  const licensed = report!.activities.find(item => item.targetId === 'business:' + license.id)!;
  assert.equal(licensed.attributedComputeCents, 0); assert.equal(licensed.revenueCents, license.weeklyPriceCents);
  assert.equal(report!.activities.find(item => item.targetId === 'agents:' + companyId)!.revenueCents, 35_000);
  assert.equal(report!.activities.find(item => item.targetId === 'agents:' + companyId)!.physicalWorkCUw, U / 2,
    'Completed agent work keeps its commercial attribution after its job is pruned.');
  assert.equal(report!.activities.reduce((total, item) => total + item.revenueCents, 0), report!.totals.companyRevenueCents);
  const historical = canonicalStateHash(report!);
  settled.week += 1;
  settled.slices.products = applyBusinessCommand(settled, { id: 'cost-resign', companyId, issuedForWeek: 12,
    payload: { kind: 'sign_business_contract', customerId: privateContract.customerId, contractKind: 'customer-hosted', modelId: CONTENT.seedModel.id } }, CONTENT).updates!.products!;
  const nextContract = settled.slices.products.commercialContracts[privateContract.id];
  assert.equal(nextContract.generation, 2);
  const resigned = settle(settled, [], [{ id: `business-invoice:${nextContract.id}:2:11`, companyId, week: 11,
    sourceId: nextContract.id, kind: 'receipt', category: 'revenue', amountCents: nextContract.weeklyPriceCents, label: 'New weight-license generation' }]);
  assert.equal(canonicalStateHash(resigned.state.slices.compute.costReports![companyId][0]), historical,
    'A new commercial generation cannot rewrite a previous private-service receipt.');
  assert.equal(resigned.report!.targets.find(target => target.sourceId === nextContract.id)!.kind, 'weight-license');
});

test('W8-C08: retained history survives relocation and rent changes, remains bounded, and replays without new charges', () => {
  let state = fixture(4); rack(state); product(state);
  let outcome = settle(state, [work(state, 'serve:chat', U, 'owned:colocation:general')], [revenue(state, 'chat', 50_000)]);
  state = outcome.state;
  const old = canonicalStateHash(outcome.report!), oldLocation = outcome.report!.pools.find(pool => pool.ownership === 'owned')!.location;
  const siteId = 'cost-site';
  state.slices.compute.facilities[siteId] = { id: siteId, companyId: state.playerCompanyId, name: 'Owned test site', status: 'active', paused: false,
    stageIndex: CONTENT.infrastructure.stages.length - 1, startedWeek: 0, readyWeek: 9, lastBottleneck: '', stages: [] };
  state.slices.compute.racks['cost-rack'].location = siteId;
  state.slices.compute.fleets[state.playerCompanyId].cloudCU = 0;
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 8 * U;
  state.week += 1;
  outcome = settle(state, [work(state, 'serve:chat', U, `owned:${siteId}:general`)], [revenue(state, 'chat', 50_000)]);
  state = outcome.state;
  assert.equal(oldLocation, 'colocation'); assert.equal(canonicalStateHash(state.slices.compute.costReports![state.playerCompanyId][0]), old);
  assert.equal(outcome.report!.totals.cloudRentCents, 0); assert.equal(outcome.report!.totals.ownedFixedCents, getInfrastructureBaseCost(state));
  const repeated = recordComputeCosts(state, outcome.ctx);
  assert.equal(canonicalStateHash(repeated.updates!.compute!), canonicalStateHash(state.slices.compute));
  const decoded = JSON.parse(JSON.stringify(state)) as GameState; assertWave8ComputeCosts(decoded, CONTENT);
  decoded.week += 1; state.week += 1;
  const a = settle(state, [work(state, 'serve:chat', U, `owned:${siteId}:general`)], [revenue(state, 'chat', 50_000)]).state;
  const b = settle(decoded, [work(decoded, 'serve:chat', U, `owned:${siteId}:general`)], [revenue(decoded, 'chat', 50_000)]).state;
  assert.equal(canonicalStateHash(a), canonicalStateHash(b)); state = a;
  for (let index = 0; index < 8; index += 1) { state.week += 1; state = settle(state, []).state; }
  const reports = state.slices.compute.costReports![state.playerCompanyId];
  assert.equal(reports.length, 8); assert.equal(reports[0].week, state.week - 7); assert.equal(reports.at(-1)!.week, state.week);
});

test('W8-C09: receipt validation rejects forged charges, duplicate revenue, foreign work, and changed derived totals', () => {
  const state = fixture(); product(state);
  const good = settle(state, [work(state, 'serve:chat', U)], [revenue(state, 'chat', 50_000)]).state;
  const alter = (fn: (report: NonNullable<ReturnType<typeof getComputeCostView>['latest']>) => void) => {
    const bad = structuredClone(good); fn(bad.slices.compute.costReports![bad.playerCompanyId][0]); assert.throws(() => assertWave8ComputeCosts(bad, CONTENT));
  };
  alter(report => { report.totals.attributedComputeCents += 1; });
  alter(report => { report.ledgerFacts.find(fact => fact.id.includes(':cloud-rent:'))!.amountCents += 1; });
  alter(report => { report.targets.find(target => target.kind === 'public-product')!.revenueFactIds.push(`invoice:chat:${state.week}`); });
  alter(report => { report.resources.requests[0].companyId = 'foreign'; });
  alter(report => { report.resources.computeGrants[0].physicalCUw += 1; });
  alter(report => { report.variableCostCarryIn = U; });
  alter(report => { report.pools[0].nominalCU += U; });
  alter(report => { report.ledgerFacts.push(structuredClone(report.ledgerFacts[0])); });
  const beforeActivation = structuredClone(good); beforeActivation.slices.research.systemRollouts['cost-rollout'].readyWeek = state.week + 1;
  assert.throws(() => assertWave8ComputeCosts(beforeActivation, CONTENT));
  const wrongPhase = context(good, { requests: [], computeGrants: [], staffGrants: [] }, [], 'execute');
  assert.throws(() => recordComputeCosts(good, wrongPhase), /after settlement/);
});

test('W8-C10: current-week ledger truncation and unpaid expenses preserve incurred costs without double charging', () => {
  const state = fixture(), companyId = state.playerCompanyId;
  state.slices.company.companies[companyId].cashCents = 100;
  const extras: LedgerFact[] = Array.from({ length: 225 }, (_, index) => ({ id: `test-charge:${String(index).padStart(3, '0')}`, companyId, week: state.week,
    sourceId: 'test-activity', category: 'operating', kind: 'expense', amountCents: 1, label: 'One cent of independently settled work' }));
  const { state: result, report, ctx } = settle(state, [], extras);
  assert.equal(result.slices.company.ledger.length, 200);
  assert.ok(report!.ledgerFacts.length > 200);
  assert.equal(report!.totals.otherOperatingCents, CONTENT.opening.overheadCentsPerWeek + 225);
  assert.equal(report!.totals.cloudRentCents, 4 * CONTENT.opening.rentCentsPerCUWeek);
  const company = result.slices.company.companies[companyId]; assert.ok(company.arrearsCents > 0);
  const before = canonicalStateHash(result.slices.company); recordComputeCosts(result, ctx);
  assert.equal(canonicalStateHash(result.slices.company), before);
  const recalculated = calculateComputeCostReport(report!);
  assert.equal(canonicalStateHash(recalculated), canonicalStateHash(report!));
});

test('W8-C11: recalculated imports cannot change useful grants, fabricate settled revenue, or hide a product invoice', () => {
  let state = fixture(); product(state);
  state = settle(state, [work(state, 'serve:chat', U)], [revenue(state, 'chat', 50_000)]).state;
  state.week += 1;
  state = settle(state, [work(state, 'serve:chat', U)], [revenue(state, 'chat', 50_000)]).state;
  const companyId = state.playerCompanyId, originalCompany = canonicalStateHash(state.slices.company);
  const badGrant = structuredClone(state), latest = badGrant.slices.compute.costReports![companyId].at(-1)!;
  latest.resources.computeGrants.find(grant => grant.requestId === 'serve:chat')!.hardwareEffectiveCUw -= 1;
  Object.assign(latest, calculateComputeCostReport(latest));
  assert.throws(() => assertWave8ComputeCosts(badGrant, CONTENT), /actual requested or granted useful work/);

  const invented = structuredClone(state), old = invented.slices.compute.costReports![companyId][0];
  const inventedId = 'invented-historical-invoice';
  old.ledgerFacts.push({ id: inventedId, companyId, week: old.week, sourceId: 'invented-customer', kind: 'receipt', category: 'revenue', amountCents: 1_000_000_000, label: 'Invented earned revenue' });
  old.targets.push({ id: 'other:' + companyId, kind: 'other-revenue', sourceId: companyId, name: 'Other earned revenue', requestIds: [], revenueFactIds: [inventedId] });
  Object.assign(old, calculateComputeCostReport(old));
  assert.throws(() => assertWave8ComputeCosts(invented, CONTENT), /settlement proof/);

  const hidden = structuredClone(state), hiddenReport = hidden.slices.compute.costReports![companyId][0];
  const target = hiddenReport.targets.find(item => item.kind === 'public-product')!;
  const invoiceId = target.revenueFactIds.pop()!;
  hiddenReport.targets.push({ id: 'other:' + companyId, kind: 'other-revenue', sourceId: companyId, name: 'Other earned revenue', requestIds: [], revenueFactIds: [invoiceId] });
  Object.assign(hiddenReport, calculateComputeCostReport(hiddenReport));
  assert.throws(() => assertWave8ComputeCosts(hidden, CONTENT), /conceal an identified customer invoice/);
  for (const candidate of [badGrant, invented, hidden]) assert.equal(canonicalStateHash(candidate.slices.company), originalCompany,
    'The import check must reject false displayed evidence even when the company ledger was left unchanged.');
});

test('W8-C12: bounded settlement proofs survive ledger pruning and retained invoices corroborate historical amounts', () => {
  let state = fixture(); product(state);
  const companyId = state.playerCompanyId, firstWeek = state.week;
  state.slices.company.companies[companyId].cashCents = 100_000_000;
  state.slices.products.invoices.push({ id: `invoice:chat:${firstWeek}`, companyId, productId: 'chat', contractId: 'contract-chat', week: firstWeek,
    accounts: 1, grossCents: 50_000, creditsCents: 0, amountCents: 50_000 });
  state = settle(state, [work(state, 'serve:chat', U)], [revenue(state, 'chat', 50_000)]).state;
  const oldCloudId = `${companyId}:cloud-rent:${firstWeek}`;
  const noisyWeek = (input: GameState) => {
    input.week += 1;
    const extras: LedgerFact[] = Array.from({ length: 225 }, (_, index) => ({ id: `zz-accounting-test:${input.week}:${index}`, companyId, week: input.week,
      sourceId: 'test-activity', category: 'operating', kind: 'expense', amountCents: 1, label: 'Settled current-week work' }));
    return settle(input, [], extras).state;
  };
  state = noisyWeek(state);
  assert.equal(state.slices.company.ledger.some(entry => entry.id === oldCloudId), false, 'The global ledger has genuinely pruned the old bill.');
  assert.equal(state.slices.company.postedFacts[oldCloudId], true, 'An eight-week accounting receipt keeps its actual settlement proof.');
  const forged = structuredClone(state), report = forged.slices.compute.costReports![companyId][0];
  report.ledgerFacts.find(fact => fact.id === `invoice:chat:${firstWeek}`)!.amountCents += 1;
  Object.assign(report, calculateComputeCostReport(report));
  assert.throws(() => assertWave8ComputeCosts(forged, CONTENT), /retained customer invoice/);
  for (let index = 0; index < 8; index += 1) state = noisyWeek(state);
  assert.equal(state.slices.compute.costReports![companyId].length, 8);
  assert.equal(Object.hasOwn(state.slices.company.postedFacts, oldCloudId), false,
    'A periodic proof expires after its accounting receipt and the one settlement-boundary grace week retire.');
  assertWave8ComputeCosts(JSON.parse(JSON.stringify(state)) as GameState, CONTENT);
});
