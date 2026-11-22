import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { SEGMENT_BY_ID } from '../src/content/wave2-market';
import { CAPACITY_FORECAST_RULES } from '../src/content/wave6-forecast';
import type { GameCommand, GameState, ModuleContext, ProductKind, StaffGrant, WorkRequest } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceSystemRollouts, applySystemApplication, commitSystemRollouts, resolveSystemRollouts, systemApplicationRequests, validateSystemApplication } from '../src/modules/applied-research';
import { applyBusinessCommand, businessRequests, commercialCapacityRequests } from '../src/modules/business';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { getComputePools, infrastructureOperationsId } from '../src/modules/compute-pools';
import { infrastructureRequests } from '../src/modules/infrastructure';
import { productDemand, standardServingRequests } from '../src/modules/products';
import { capacityForecastAvailability, getCapacityForecast } from '../src/modules/capacity-forecast';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

// These isolated capacity fixtures are deliberately authored service snapshots.
// Campaign acceptance remains in the separate command-driven acceptance suites.
function service(kind: ProductKind = 'basic-chat', accounts = 100, cloud = 4, serving = cloud): GameState {
  const state = createPlayerOnlyState(), companyId = state.playerCompanyId; state.week = 10;
  state.slices.company.founderAssignments[companyId] = emptyRoleAllocation();
  state.slices.research.completedByCompany[companyId] = ['R1', 'R2', 'R6', 'R9', 'R10', 'R11', 'R12', 'R12A'];
  const rolloutId = 'forecast-fixture-rollout';
  state.slices.research.systemRollouts[rolloutId] = { id: rolloutId, companyId, method: 'capacity-forecast', startedWeek: 3,
    requiredWork: U, completedWork: U, requiredStaff: U, completedStaff: U, status: 'active', readyWeek: 5, lastBottleneck: '' };
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.capabilityBps = { conversation: 6500, documents: 7000, coding: 6500, tools: 6000 }; model.reliabilityBps = 9500;
  model.status = 'released'; model.scenarioStart = true; model.evaluationReportId = 'forecast-report';
  state.slices.models.reports['forecast-report'] = { id: 'forecast-report', companyId, modelId: model.id, week: 8,
    heldOut: true, scenarioStart: true, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps,
    basicChatEligible: true, passedCases: 20, cases: Array.from({ length: 20 }, (_, index) => ({ id: 'forecast-case-' + index, domain: 'conversation', difficultyBps: 0, passed: true })) };
  state.slices.products.offers.service = { id: 'service', companyId, name: 'Forecast service', kind, publicModelId: model.id,
    features: { memory: false, extendedContext: false, deepReasoning: false }, deploymentId: 'deployment', contractId: 'contract', status: 'active', createdWeek: 8 };
  state.slices.products.deployments.deployment = { id: 'deployment', companyId, productId: 'service', modelId: model.id,
    status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  const segmentId = kind === 'basic-chat' ? 'regular' : kind === 'developer-api' ? 'developers' : 'business';
  state.slices.products.contracts.contract = { id: 'contract', companyId, productId: 'service', weeklyPriceCents: SEGMENT_BY_ID[segmentId].referencePriceCents,
    allowance: SEGMENT_BY_ID[segmentId].exchanges, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['service']; state.slices.markets.waitlistRemaining = 0;
  state.slices.markets.cohorts = accounts ? [{ id: 'forecast-accounts', companyId, productId: 'service', contractId: 'contract', segmentId, count: accounts, activeWeek: 9 }] : [];
  state.slices.markets.payingConsumers = kind === 'basic-chat' ? accounts : 0;
  const fleet = state.slices.compute.fleets[companyId]; fleet.cloudCU = cloud * U; fleet.memoryMU = 2 * cloud * U;
  fleet.allocation = { serving: serving * U, development: 0, research: 0 };
  return state;
}

function context(state: GameState, requests: WorkRequest[], staffGrants: StaffGrant[] = []): ModuleContext {
  return { week: state.week, phase: 'reserve', content: CONTENT, facts: [], resources: { requests, staffGrants, computeGrants: [] }, random: { draw: () => { throw new Error('The forecast must not draw randomness.'); } } };
}

function first(state: GameState) { return getCapacityForecast(state, { baseGrowthBps: 0, stressGrowthBps: 0 }).scenarios[0].rows[0]; }

function rack(state: GameState, id = 'forecast-rack', status: 'installed' | 'ordered' = 'installed') {
  state.slices.compute.racks[id] = { id, companyId: state.playerCompanyId, hardwareId: 'general', location: 'colocation', status,
    orderedWeek: 0, arrivalWeek: status === 'installed' ? 6 : 11, installationStartedWeek: status === 'installed' ? 6 : null,
    completedInstallStaff: status === 'installed' ? U : 0, readyWeek: status === 'installed' ? 8 : null, installedWeek: status === 'installed' ? 8 : null,
    purchaseCents: 8 * CONTENT.hardware[0].purchaseCentsPerCU, lastBottleneck: '' };
  if (status === 'installed') state.slices.compute.fleets[state.playerCompanyId].ownedCU += 8 * U;
}

function business(state: GameState, kind: 'private-hosted' | 'customer-hosted') {
  const packet = state.slices.data.packets[CONTENT.starterData.id]; packet.prepared = true; packet.readyUnits = packet.rawUnits;
  const command: GameCommand = { id: 'forecast-' + kind, companyId: state.playerCompanyId, issuedForWeek: state.week + 1,
    payload: { kind: 'sign_business_contract', customerId: kind === 'private-hosted' ? 'aster-services' : 'vector-studio', modelId: CONTENT.seedModel.id,
      contractKind: kind, ...(kind === 'private-hosted' ? { packetId: packet.id } : {}) } };
  state.slices.products = applyBusinessCommand(state, command, CONTENT).updates!.products!;
}

test('W6-C01: the forecast requires research, paid rollout work, staff and next-boundary activation', () => {
  let state = service(); state.slices.research.systemRollouts = {};
  state.slices.research.completedByCompany[state.playerCompanyId] = [];
  const command: GameCommand = { id: 'forecast-rollout', companyId: state.playerCompanyId, issuedForWeek: 11,
    payload: { kind: 'start_system_rollout', method: 'capacity-forecast' } };
  assert.equal(getCapacityForecast(state).scenarios.length, 0);
  assert.ok(validateSystemApplication(state, command));
  state.slices.research.completedByCompany[state.playerCompanyId] = ['R12A'];
  assert.equal(capacityForecastAvailability(state).available, false);
  assert.equal(validateSystemApplication(state, command), undefined);
  const research = applySystemApplication(state, command).updates!.research!;
  state = { ...state, slices: { ...state.slices, research } };
  const rollout = Object.values(research.systemRollouts)[0];
  const requests = systemApplicationRequests(state), ctx = context(state, requests);
  const resourceId = requests.find(request => request.taskId === rollout.id)!.id;
  ctx.resources.computeGrants.push({ requestId: resourceId, physicalCUw: U / 2, hardwareEffectiveCUw: U / 2, memoryMU: 0, poolId: 'general-cloud' });
  ctx.resources.staffGrants.push({ requestId: resourceId, grants: [{ role: 'ml', staffWeeks: U }] });
  advanceSystemRollouts(research, ctx); resolveSystemRollouts(research, state.week);
  assert.equal(rollout.completedWork, U / 2); assert.equal(rollout.completedStaff, U);
  assert.equal(rollout.status, 'building');
  assert.equal(capacityForecastAvailability(state).available, false);
  const remaining = context(state, systemApplicationRequests(state));
  remaining.resources.computeGrants.push({ requestId: resourceId, physicalCUw: U / 2, hardwareEffectiveCUw: U / 2, memoryMU: 0, poolId: 'general-cloud' });
  advanceSystemRollouts(research, remaining); resolveSystemRollouts(research, state.week);
  assert.equal(rollout.status, 'ready'); assert.equal(capacityForecastAvailability(state).available, false);
  commitSystemRollouts(research, state.week); assert.equal(rollout.status, 'ready');
  state.week++; commitSystemRollouts(research, state.week);
  assert.equal(capacityForecastAvailability(state).available, true); assert.equal(getCapacityForecast(state).scenarios.length, 2);
});

test('W6-C02: the first forecast week matches ordinary paid-service staffing and compute grants exactly', () => {
  const state = service('basic-chat', 140, 4, 3), before = JSON.stringify(state);
  state.slices.compute.fleets[state.playerCompanyId].allocation.development = U;
  const publicRequests = standardServingRequests(state, CONTENT, state.week + 1);
  const requests = [...publicRequests, ...commercialCapacityRequests(state, state.playerCompanyId)];
  const staffing = [...requests, ...businessRequests(state, state.week + 1).filter(request => request.id.startsWith('retrieval-upkeep:')),
    ...infrastructureRequests(state, CONTENT).filter(request => request.id === infrastructureOperationsId(state.playerCompanyId))];
  const staffGrants = createCompanyModule(CONTENT).grantResources!(state, context(state, staffing)).staffGrants ?? [];
  const expected = createComputeModule(CONTENT).grantResources!(state, context(state, requests, staffGrants));
  const row = first(state), grant = expected.computeGrants![0];
  assert.equal(row.requestedWorkCUw, requests[0].normalizedWorkCUw);
  assert.equal(row.grantedWorkCUw, grant.hardwareEffectiveCUw);
  assert.equal(row.physicalWorkCUw, grant.physicalCUw);
  assert.equal(row.reservedPhysicalCU, expected.updates!.compute!.fleets[state.playerCompanyId].reservedCU);
  assert.equal(row.headroomCU, row.reservedPhysicalCU - grant.physicalCUw);
  assert.ok(row.headroomCU > 0);
  assert.equal(row.computeFits, false);
  assert.ok(row.weakestCapacityBps > 0 && row.weakestCapacityBps < 10000, 'A partially served load stays partial rather than collapsing to a binary score.');
  assert.equal(row.cloudPlan.additionalCU, U, 'The retained development allocation cannot be silently reassigned.');
  assert.equal(row.cloudPlan.additionalRentCents, CONTENT.opening.rentCentsPerCUWeek);
  // The single setup allocation above is the only intended fixture change.
  const original = JSON.parse(before) as GameState; original.slices.compute.fleets[original.playerCompanyId].allocation.development = U;
  assert.equal(JSON.stringify(state), JSON.stringify(original));
});

test('W6-C03: editable growth produces bounded load cases without changing customers, history, cash or RNG', () => {
  const state = service('basic-chat', 200, 12), before = JSON.stringify(state), fingerprint = canonicalStateHash(state);
  const forecast = getCapacityForecast(state, { baseGrowthBps: 0, stressGrowthBps: 1000 });
  assert.equal(forecast.scenarios.length, 2); assert.equal(forecast.scenarios[0].rows.length, CAPACITY_FORECAST_RULES.horizonWeeks);
  assert.ok(forecast.scenarios[0].rows.every(row => row.paidAccounts === 200));
  assert.ok(forecast.scenarios[1].rows[11].requestedWorkCUw > forecast.scenarios[0].rows[11].requestedWorkCUw);
  assert.ok(forecast.scenarios[1].rows.every(row => row.paidAccounts <= SEGMENT_BY_ID.regular.population));
  assert.deepEqual(getCapacityForecast(state, { baseGrowthBps: 0, stressGrowthBps: 1000 }), forecast);
  assert.equal(JSON.stringify(state), before); assert.equal(canonicalStateHash(state), fingerprint);
  const crowded = service('basic-chat', 1399, 128);
  assert.ok(getCapacityForecast(crowded, { baseGrowthBps: 1000, stressGrowthBps: 1000 }).scenarios[0].rows.every(row => row.paidAccounts <= 1400));
  const empty = service('basic-chat', 0, 4);
  assert.ok(getCapacityForecast(empty).scenarios.every(scenario => scenario.rows.every(row => row.paidAccounts === 0 && row.requestedWorkCUw === 0)));
});

test('W6-C04: spare allocations precede extra rent, and memory must fit one connected pool', () => {
  const spare = first(service('basic-chat', 100, 4, 1));
  assert.equal(spare.computeFits, false); assert.equal(spare.cloudPlan.additionalCU, 0); assert.equal(spare.cloudPlan.additionalRentCents, 0);
  assert.equal(spare.cloudPlan.usesSpareAllocation, true); assert.equal(spare.cloudPlan.servingAllocationCU, 4 * U);
  const low = first(service('basic-chat', 100, 2));
  assert.equal(low.cloudPlan.additionalCU, U); assert.equal(low.cloudPlan.totalCloudCU, 3 * U);
  assert.equal(low.cloudPlan.additionalRentCents, CONTENT.opening.rentCentsPerCUWeek);

  const memory = service('basic-chat', 10, 8); rack(memory);
  memory.slices.company.founderAssignments[memory.playerCompanyId].infrastructure = U / 4;
  memory.slices.compute.fleets[memory.playerCompanyId].allocation.serving = 16 * U;
  const model = memory.slices.models.versions[CONTENT.seedModel.id]; model.family = 'large'; model.residentMU = 24 * U;
  const row = first(memory), pools = getComputePools(memory);
  assert.ok(pools.reduce((sum, pool) => sum + pool.memoryMU, 0) > row.requestedMemoryMU);
  assert.ok(pools.every(pool => pool.memoryMU < row.requestedMemoryMU));
  assert.equal(row.computeFits, false); assert.match(row.bottlenecks.join(' '), /one compatible pool/);
  assert.equal(row.cloudPlan.additionalCU, 5 * U, 'Thirteen cloud CU fit 24 MU of weights plus the live sessions.');
  assert.equal(row.cloudPlan.additionalRentCents, 5 * CONTENT.opening.rentCentsPerCUWeek);
});

test('W6-C05: a general-cloud quote cannot fabricate sparse compatibility or fast fabric', () => {
  const state = service('basic-chat', 10, 64), model = state.slices.models.versions[CONTENT.seedModel.id];
  model.architecture = 'sparse'; model.residentMU = 3 * U;
  const before = JSON.stringify(state), row = first(state);
  assert.equal(row.computeFits, false); assert.equal(row.grantedWorkCUw, 0); assert.equal(row.weakestCapacityBps, 0);
  assert.equal(row.cloudPlan.additionalCU, null); assert.equal(row.cloudPlan.additionalRentCents, null);
  assert.match(row.bottlenecks.join(' '), /sparse.*fast fabric/);
  assert.equal(JSON.stringify(state), before);
});

test('W6-C06: fixed deliveries, buyer-hosted support and retrieval upkeep remain visible throughout the window', () => {
  const state = service('business-docs', 2, 16);
  business(state, 'private-hosted'); business(state, 'customer-hosted');
  state.slices.products = applyBusinessCommand(state, { id: 'forecast-index', companyId: state.playerCompanyId, issuedForWeek: 11,
    payload: { kind: 'install_retrieval', productId: 'service', packetId: CONTENT.starterData.id } }, CONTENT).updates!.products!;
  const index = state.slices.products.retrievalInstalls.service; index.status = 'active'; index.readyWeek = 9;
  state.slices.company.founderAssignments[state.playerCompanyId] = { ...emptyRoleAllocation(), data: U / 4, commercial: U / 4 };
  state.slices.company.staff['future-data'] = { id: 'future-data', companyId: state.playerCompanyId, role: 'data', hiredWeek: 9, readyWeek: 11, assignedFte: U };
  const forecast = getCapacityForecast(state, { baseGrowthBps: 0, stressGrowthBps: 0 }), row = forecast.scenarios[0].rows[0];
  assert.equal(row.privateCommitments, 1); assert.equal(row.licenseCommitments, 1);
  assert.equal(row.privateWorkCUw, state.slices.products.commercialContracts['business:aster-services'].reservedWorkCUw);
  assert.ok(row.computeFits); assert.equal(row.staffFits, false); assert.equal(row.fits, false);
  assert.equal(row.staff.find(item => item.role === 'data')!.requiredFte, 3 * U / 10);
  assert.equal(row.staff.find(item => item.role === 'commercial')!.requiredFte, U / 2);
  assert.equal(row.staff.find(item => item.role === 'data')!.shortfallFte, U / 20);
  assert.ok(forecast.scenarios[0].rows.every(item => item.privateWorkCUw === row.privateWorkCUw && item.licenseCommitments === 1 && item.staffFits === false));
  assert.equal(row.cloudPlan.additionalCU, 0, 'Adequate GPUs do not make a data/support shortage disappear.');
  assert.ok(forecast.assumptions.some(line => /delivery is unfinished/.test(line)));
});

test('W6-C07: current operations coverage limits owned pools; future equipment and onboarding grant no capacity', () => {
  const state = service('basic-chat', 10, 0); rack(state); rack(state, 'arriving-next-week', 'ordered');
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 8 * U;
  state.slices.company.staff['future-ops'] = { id: 'future-ops', companyId: state.playerCompanyId, role: 'infrastructure', hiredWeek: 9, readyWeek: 11, assignedFte: U };
  const before = JSON.stringify(state), forecast = getCapacityForecast(state, { baseGrowthBps: 0, stressGrowthBps: 0 });
  assert.ok(forecast.scenarios[0].rows.every(row => !row.computeFits && !row.staffFits));
  const row = forecast.scenarios[0].rows[0];
  assert.equal(row.staff.find(item => item.role === 'infrastructure')!.shortfallFte, U / 4);
  assert.ok(row.cloudPlan.additionalCU! > 0); assert.match(row.bottlenecks.join(' '), /Infrastructure staff/);
  assert.equal(JSON.stringify(state), before);
  state.slices.company.founderAssignments[state.playerCompanyId].infrastructure = U / 4;
  assert.equal(first(state).fits, true); assert.equal(first(state).cloudPlan.additionalCU, 0);
});

test('W6-C08: suspended service still exposes owed demand, and invalid assumptions never alter the company', () => {
  const state = service('basic-chat', 100, 4); state.slices.company.companies[state.playerCompanyId].arrearsCents = 100;
  const before = JSON.stringify(state), row = first(state);
  assert.equal(row.requestedWorkCUw, productDemand(state, state.slices.products.offers.service, CONTENT, state.week + 1).paidWork);
  assert.ok(row.requestedWorkCUw > 0); assert.equal(row.grantedWorkCUw, 0); assert.equal(row.computeFits, false);
  assert.equal(row.cloudPlan.additionalCU, null); assert.match(row.cloudPlan.reason, /Pay overdue bills/i);
  for (const options of [{ baseGrowthBps: -1 }, { stressGrowthBps: 1001 }, { baseGrowthBps: NaN }, { baseGrowthBps: 500, stressGrowthBps: 200 }]) {
    assert.throws(() => getCapacityForecast(state, options));
  }
  assert.equal(JSON.stringify(state), before);
});
