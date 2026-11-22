import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { ADAPTER_BANK_RULES } from '../src/content/wave7-adapters';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameState, ModuleContext, ResourceFrame, ResourceGrant, StaffRole, WorkRequest } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { collectResourceResult } from '../src/core/resources';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { adapterBankRollout, adapterSharingSpec, assertAdapterTrainingPlan, getAdapterBankView, modelAdapterReceipt, validateAdapterTrainingOption } from '../src/modules/adapter-bank';
import { buildTrainingPlan } from '../src/modules/lab-planner';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { createComputeModule } from '../src/modules/compute';
import { productDemand, requestMeter, standardServingRequests } from '../src/modules/products';
import { getComputePools, infrastructureOperationsId } from '../src/modules/compute-pools';
import { hasResearch } from '../src/modules/research';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createMarketsModule } from '../src/modules/markets';

const player = (state: GameState) => state.playerCompanyId;
const fleet = (state: GameState) => state.slices.compute.fleets[player(state)];
const company = (state: GameState) => state.slices.company.companies[player(state)];
const baseId = CONTENT.seedModel.id;
function businessCheckpoint(): GameState {
  const result = deserializeState(readFileSync(join(__dirname, 'fixtures/wave5-snapshot.json'), 'utf8'));
  assert.ok(result.ok, result.ok ? '' : result.error); return result.state;
}

/** Continue a published ordinary company with accepted commands and paid weeks. */
class AdapterCampaign {
  constructor(public state = businessCheckpoint()) {}
  get id() { return player(this.state); }
  queue(payload: CommandPayload): string {
    const result = submitCommand(this.state, payload); assert.equal(result.accepted, true, result.reason?.message);
    this.state = result.state; return result.commandId!;
  }
  step(): void {
    const queued = this.state.queuedCommands.filter(command => command.companyId === this.id).map(command => command.id);
    const result = advanceWeek(this.state); assert.equal(result.accepted, true, result.reason?.message); this.state = result.state;
    for (const id of queued) assert.equal(this.state.commandReceipts[id].status, 'accepted', this.state.commandReceipts[id].reason?.message);
    assert.equal(company(this.state).arrearsCents, 0);
  }
  until(done: () => boolean, limit = 50): void {
    for (let week = 0; week < limit && !done(); week++) this.step();
    assert.ok(done(), 'The paid adapter project must finish with sufficient assigned resources.');
  }
  founder(role: StaffRole): void { this.queue({ kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), [role]: U } }); }
  allocation(development: number, research = 0): void { this.queue({ kind: 'allocate_compute', serving: 81 * U, development, research }); }
  learn(id: string): void {
    if (hasResearch(this.state, this.id, id)) return;
    const definition = CONTENT.research.find(item => item.id === id)!;
    for (const required of definition.requires) this.learn(required);
    this.founder(definition.role); this.allocation(0, 4 * U); this.queue({ kind: 'start_research', researchId: id });
    this.until(() => hasResearch(this.state, this.id, id));
  }
  train(kind: 'conversation' | 'coding'): string {
    this.founder('ml'); this.allocation(16 * U);
    const commandId = this.queue({ kind: 'start_training', ...trainingOptions(this.state, kind), asAdapter: true });
    const runId = 'training-' + commandId; this.until(() => this.state.slices.models.trainingRuns[runId]?.status === 'complete');
    return this.state.slices.models.trainingRuns[runId].outputModelId;
  }
  evaluate(modelId: string): void {
    this.queue({ kind: 'evaluate_model', modelId, suiteId: 'expanded-capabilities-1' });
    this.until(() => Object.values(this.state.slices.models.reports).some(report => report.modelId === modelId && report.suiteId === 'expanded-capabilities-1'));
  }
}
function trainingOptions(state: GameState, kind: 'conversation' | 'coding' = 'conversation') {
  const coding = Object.values(state.slices.data.packets).filter(packet => packet.companyId === player(state)
    && packet.sourceIds?.includes('specialist-coding-1') && packet.prepared).sort((a, b) => b.qualityBps - a.qualityBps)[0];
  assert.ok(coding);
  return kind === 'conversation'
    ? { baseModelId: baseId, packetId: CONTENT.starterData.id, packetIds: [CONTENT.starterData.id, coding.id], recipeId: CONTENT.firstTraining.id }
    : { baseModelId: baseId, packetId: coding.id, recipeId: 'coding-tools-adaptation' };
}
let researched: GameState | undefined, installed: GameState | undefined;
let served: { state: GameState; chatModelId: string; apiModelId: string; chatProductId: string; apiProductId: string } | undefined;
function researchedCompany(): AdapterCampaign {
  if (!researched) {
    const run = new AdapterCampaign(); run.queue({ kind: 'set_cloud_capacity', cu: 100 * U }); run.step(); run.learn('R4B');
    researched = structuredClone(run.state);
  }
  return new AdapterCampaign(structuredClone(researched));
}
function installedCompany(): AdapterCampaign {
  if (!installed) {
    const run = researchedCompany(); run.founder('ml'); run.allocation(16 * U);
    run.queue({ kind: 'start_system_rollout', method: 'adapter-bank' }); run.until(() => adapterBankRollout(run.state)?.status === 'active');
    installed = structuredClone(run.state);
  }
  return new AdapterCampaign(structuredClone(installed));
}
function servingCompany() {
  if (!served) {
    const run = installedCompany(), chatModelId = run.train('conversation'), apiModelId = run.train('coding');
    run.evaluate(chatModelId); run.evaluate(apiModelId);
    const offers = Object.values(run.state.slices.products.offers).filter(offer => offer.companyId === run.id);
    const chatProductId = offers.find(offer => offer.kind === 'basic-chat')!.id, apiProductId = offers.find(offer => offer.kind === 'developer-api')!.id;
    run.queue({ kind: 'upgrade_product', productId: chatProductId, modelId: chatModelId });
    run.queue({ kind: 'upgrade_product', productId: apiProductId, modelId: apiModelId });
    run.until(() => !!adapterSharingSpec(run.state, chatProductId) && !!adapterSharingSpec(run.state, apiProductId));
    run.step();
    assert.deepEqual(validateState(run.state), []);
    served = { state: structuredClone(run.state), chatModelId, apiModelId, chatProductId, apiProductId };
  }
  return structuredClone(served);
}
const requester: DomainModule = { id: 'adapter-resource-fixture', owns: [], handlers: {} };
function allocate(state: GameState, requests: WorkRequest[], staffGrants: ResourceFrame['staffGrants'] = []) {
  const frame: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] }, compute = createComputeModule(CONTENT);
  collectResourceResult(frame, requester, { workRequests: requests }, 'request', state);
  if (staffGrants.length) collectResourceResult(frame, { id: 'staff-fixture', owns: ['company'], handlers: {} }, { staffGrants }, 'grant', state);
  const context: ModuleContext = { week: state.week + 1, phase: 'reserve', content: CONTENT, facts: [], resources: frame,
    random: { draw: () => { throw new Error('Adapter placement must not draw randomness.'); } } };
  const result = compute.grantResources!(state, context);
  collectResourceResult(frame, compute, result, 'grant', state);
  return { frame, result };
}
function adapterRequests(state: GameState) {
  return standardServingRequests(state, CONTENT, state.week + 1).filter(request => request.companyId === player(state) && request.sharedAdapterMemory);
}

test('W7-A01: research and separate staff/compute installation precede any adapter training', () => {
  const opening = createInitialState();
  assert.equal(previewCommand(opening, { kind: 'start_training', baseModelId: baseId, packetId: CONTENT.starterData.id, asAdapter: true }).accepted, false);
  const run = researchedCompany(), options = trainingOptions(run.state);
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options, asAdapter: true }).accepted, false);
  for (const member of staffContributors(run.state, 'ml'))
    run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('data'); run.allocation(4 * U); run.queue({ kind: 'start_system_rollout', method: 'adapter-bank' }); run.step();
  assert.equal(adapterBankRollout(run.state)!.completedWork, U); assert.equal(adapterBankRollout(run.state)!.completedStaff, 0);
  run.founder('ml'); run.allocation(0); run.step();
  assert.equal(adapterBankRollout(run.state)!.completedStaff, U); assert.equal(adapterBankRollout(run.state)!.status, 'ready');
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options, asAdapter: true }).accepted, false);
  run.step(); assert.equal(adapterBankRollout(run.state)!.status, 'active');
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options, asAdapter: true }).accepted, true);
  assert.deepEqual(validateState(run.state), []);
});

test('W7-A02: adapters preserve paid updates, finite outcomes, evidence and identity while adding explicit residency', () => {
  const run = installedCompany(), options = trainingOptions(run.state), original = structuredClone(run.state.slices.models.versions[baseId]);
  const full = buildTrainingPlan(run.state, run.id, options, CONTENT, true);
  const adapter = buildTrainingPlan(run.state, run.id, { ...options, asAdapter: true }, CONTENT, true);
  assert.equal(full.plan.adapter, undefined); assert.equal(adapter.plan.identity, full.plan.identity);
  assert.equal(adapter.requiredWork, full.requiredWork); assert.equal(adapter.requiredWork, 9 * U);
  assert.deepEqual(adapter.plan.corpus, full.plan.corpus); assert.deepEqual(adapter.plan.targets, full.plan.targets);
  assert.deepEqual(adapter.plan.savedAdjustments, full.plan.savedAdjustments);
  assert.equal(adapter.plan.residentMU, original.residentMU + U / 4); assert.equal(adapter.requiredMemory, 2 * adapter.plan.residentMU);
  const commandId = run.queue({ kind: 'start_training', ...options, asAdapter: true });
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options }).reason?.code, 'ALREADY_ACTIVE');
  run.until(() => run.state.slices.models.trainingRuns['training-' + commandId]?.status === 'complete');
  const training = run.state.slices.models.trainingRuns['training-' + commandId], model = run.state.slices.models.versions[training.outputModelId];
  assert.equal(training.physicalWork, adapter.requiredWork); assert.equal(model.residentMU, adapter.plan.residentMU);
  assert.deepEqual(modelAdapterReceipt(run.state, model.id), adapter.plan.adapter);
  const midpointId = training.checkpointModelIds!.find(id => id !== training.outputModelId)!;
  assert.ok(midpointId); assert.equal(modelAdapterReceipt(run.state, midpointId), null, 'A midpoint checkpoint does not join the completed serving bank.');
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(run.state.slices.models.versions[baseId], original);
  assert.equal(previewCommand(run.state, { kind: 'upgrade_product', productId: Object.values(run.state.slices.products.offers).find(offer => offer.companyId === run.id && offer.kind === 'basic-chat')!.id, modelId: model.id }).accepted, false, 'The source report cannot evaluate the new candidate.');
  assert.deepEqual(inheritedModelRights(run.state, model.id, CONTENT), { hosted: true, weights: true });
  assert.deepEqual(validateState(run.state), []);
});

test('W7-A03: bank rejects incompatible bases, recipes, metadata edits and adapter-on-adapter training', () => {
  const { state, chatModelId } = servingCompany(), id = player(state);
  for (const kind of ['foundation', 'behavior', 'calibration', 'distillation', 'planning'] as const)
    assert.ok(validateAdapterTrainingOption(state, id, baseId, kind, true));
  assert.ok(validateAdapterTrainingOption(state, id, baseId, 'adaptation', 'yes' as unknown as boolean));
  assert.equal(validateAdapterTrainingOption(state, id, chatModelId, 'adaptation', false)?.code, 'NO_IMPROVEMENT');
  assert.equal(validateAdapterTrainingOption(state, id, chatModelId, 'adaptation', true)?.code, 'NO_IMPROVEMENT');
  for (const change of [
    (s: GameState) => { s.slices.models.versions[baseId].architecture = 'sparse'; },
    (s: GameState) => { s.slices.models.versions[baseId].runtimeVariant = { kind: 'compression', applicationId: 'fixture', sourceModelId: 'fixture', servingWorkBps: 8000 }; },
    (s: GameState) => { s.slices.models.versions[baseId].companyId = 'foreign-company'; },
  ]) { const copy = structuredClone(state); change(copy); assert.ok(validateAdapterTrainingOption(copy, id, baseId, 'adaptation', true)); }
  const runId = state.slices.models.versions[chatModelId].trainingRunId!;
  for (const change of [
    (s: GameState) => { s.slices.models.trainingRuns[runId].plan!.adapter!.baseResidentMU--; },
    (s: GameState) => { s.slices.models.trainingRuns[runId].plan!.adapter!.adapterMemoryMU = 0; },
    (s: GameState) => { s.slices.models.trainingRuns[runId].plan!.adapter!.baseModelId = chatModelId; },
    (s: GameState) => { s.slices.models.trainingRuns[runId].plan!.adapter!.rolloutId = 'unpaid-rollout'; },
    (s: GameState) => { s.slices.models.trainingRuns[runId].startedWeek = 0; },
  ]) { const copy = structuredClone(state); change(copy); assert.throws(() => assertAdapterTrainingPlan(copy, copy.slices.models.trainingRuns[runId])); }
});

test('W7-A04: two evaluated public specializations share only resident weights and keep request work and billing meters', () => {
  const { state, chatModelId, apiModelId, chatProductId, apiProductId } = servingCompany(), requests = adapterRequests(state);
  assert.equal(requests.length, 2); assert.deepEqual(new Set(requests.map(request => request.sharedAdapterMemory!.modelId)), new Set([chatModelId, apiModelId]));
  const allocated = allocate(state, requests), grants = allocated.frame.computeGrants;
  assert.equal(grants.reduce((sum, grant) => sum + grant.sharedMemoryMU!, 0), state.slices.models.versions[baseId].residentMU);
  assert.equal(allocated.result.updates!.compute!.fleets[player(state)].occupiedMemoryMU,
    requests.reduce((sum, request) => sum + request.memoryMU, 0) - state.slices.models.versions[baseId].residentMU);
  for (const request of requests) {
    const grant = grants.find(grant => grant.requestId === request.id)!;
    assert.equal(grant.memoryMU, request.memoryMU); assert.equal(grant.hardwareEffectiveCUw, request.normalizedWorkCUw);
    const model = state.slices.models.versions[request.sharedAdapterMemory!.modelId], full = { ...model, residentMU: model.residentMU - U / 4 };
    assert.deepEqual(requestMeter(model, { memory: true, extendedContext: true, deepReasoning: true }), requestMeter(full, { memory: true, extendedContext: true, deepReasoning: true }));
    const product = state.slices.products.offers[request.taskId], demand = productDemand(state, product, CONTENT, state.week + 1);
    assert.equal(request.memoryMU, demand.memory); assert.ok(demand.memory > model.residentMU);
  }
  const view = getAdapterBankView(state); assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].independentMemoryMU, 4.5 * U); assert.equal(view.groups[0].sharedMemoryMU, 2.5 * U);
  assert.ok(state.slices.products.lastUsage[chatProductId].billedCents > 0); assert.ok(state.slices.products.lastUsage[apiProductId].tokens!.inputTokens > 0);
  const unshared = requests.map(request => { const copy = { ...request }; delete copy.sharedAdapterMemory; return copy; });
  const control = allocate(state, unshared);
  assert.deepEqual(control.frame.computeGrants.map(grant => grant.physicalCUw), grants.map(grant => grant.physicalCUw));
  assert.ok(control.frame.computeGrants.every(grant => !Object.hasOwn(grant, 'sharedMemoryMU')));
});

test('W7-A05: ordinary session/cache memory, duplicate adapter weights, idle residency and failed placements stay conserved', () => {
  const { state, chatProductId, apiProductId } = servingCompany();
  fleet(state).cloudCU = 2 * U; fleet(state).memoryMU = 4 * U; fleet(state).allocation = { serving: 0, development: 0, research: 0 };
  const distinct = adapterRequests(state).map(request => ({ ...request, normalizedWorkCUw: 0, memoryMU: 2.75 * U }));
  const tight = allocate(state, distinct);
  assert.ok(tight.frame.computeGrants.every(grant => grant.memoryMU === 2.75 * U));
  assert.equal(tight.result.updates!.compute!.fleets[player(state)].occupiedMemoryMU, 3.5 * U, 'Both adapter deltas and both session reservations remain charged.');
  // Resource-boundary fixture: both offers select the same completed candidate;
  // request memory adds distinct tenant/cache reservations, never free weight copies.
  const chat = state.slices.products.offers[chatProductId], api = state.slices.products.offers[apiProductId];
  state.slices.products.deployments[api.deploymentId].modelId = state.slices.products.deployments[chat.deploymentId].modelId;
  const requests = adapterRequests(state).map((request, index) => ({ ...request, normalizedWorkCUw: 0, memoryMU: 2.25 * U + (index + 1) * U }));
  fleet(state).cloudCU = 3 * U; fleet(state).memoryMU = 6 * U; fleet(state).allocation = { serving: 0, development: 0, research: 0 };
  const result = allocate(state, requests), grants = result.frame.computeGrants;
  assert.equal(grants.reduce((sum, grant) => sum + (grant.sharedMemoryMU ?? 0), 0), 2.25 * U);
  assert.equal(result.result.updates!.compute!.fleets[player(state)].occupiedMemoryMU, 5.25 * U);
  assert.ok(grants.every(grant => grant.physicalCUw === 0 && grant.memoryMU > 0));
  fleet(state).cloudCU = U; fleet(state).memoryMU = 2 * U;
  const blocked = allocate(state, requests); assert.ok(blocked.frame.computeGrants.every(grant => grant.memoryMU === 0 && grant.sharedMemoryMU === 0));
  assert.equal(blocked.result.updates!.compute!.fleets[player(state)].occupiedMemoryMU, 0);
  company(state).arrearsCents = 1;
  assert.ok(allocate(state, requests).frame.computeGrants.every(grant => grant.memoryMU === 0 && grant.sharedMemoryMU === 0));
});

test('W7-A06: the same frozen base is loaded again in another physical pool', () => {
  const { state } = servingCompany(), id = player(state);
  // A bounded allocator fixture supplies one ordinary installed general rack.
  state.slices.compute.racks['adapter-test-rack'] = { id: 'adapter-test-rack', companyId: id, hardwareId: 'general', location: 'colocation',
    status: 'installed', orderedWeek: 1, arrivalWeek: 2, installationStartedWeek: 2, completedInstallStaff: U,
    readyWeek: 3, installedWeek: 3, purchaseCents: 0, lastBottleneck: '' };
  fleet(state).ownedCU = 8 * U;
  const operationId = infrastructureOperationsId(id);
  const operation: WorkRequest = { id: operationId, companyId: id, taskId: 'operations', category: 'development', normalizedWorkCUw: 0, memoryMU: 0,
    priority: 0, poolId: 'auto', staffDemand: [{ role: 'infrastructure', staffWeeks: CONTENT.infrastructure.colocationStaffPerRack }] };
  const staff = [{ requestId: operationId, grants: operation.staffDemand! }];
  const requests = adapterRequests(state).map((request, index) => ({ ...request, normalizedWorkCUw: U, memoryMU: 3 * U,
    poolId: index === 0 ? 'general-cloud' : 'owned:colocation:general' }));
  const pools = getComputePools(state, id, CONTENT, staff); assert.ok(pools.some(pool => pool.id === 'owned:colocation:general' && pool.memoryMU > 0));
  const result = allocate(state, [...requests, operation], staff), grants = result.frame.computeGrants.filter(grant => grant.requestId.startsWith('serve:'));
  assert.ok(grants.every(grant => grant.sharedMemoryMU === 0)); assert.equal(result.result.updates!.compute!.fleets[id].occupiedMemoryMU, 6 * U);
});

test('W7-A07: independent resource checks reject forged source, owner, workspace, extra fields and recycled memory', () => {
  const { state } = servingCompany(), requests = adapterRequests(state), legitimate = allocate(state, requests).frame.computeGrants;
  const mutateRequests: ((request: WorkRequest) => void)[] = [
    request => { request.companyId = 'rival-aurora'; },
    request => { request.sharedAdapterMemory!.baseModelId = request.sharedAdapterMemory!.modelId; },
    request => { request.sharedAdapterMemory!.baseMemoryMU--; },
    request => { request.sharedAdapterMemory!.adapterMemoryMU = 0; },
    request => { request.sharedAdapterMemory = { ...request.sharedAdapterMemory!, bonus: 1 } as WorkRequest['sharedAdapterMemory']; },
    request => { request.memoryMU = 2 * U; },
    request => { request.id = 'internal-teacher'; },
    request => { request.workloadKind = 'training'; },
    request => { request.modelFamily = 'large'; },
  ];
  for (const mutate of mutateRequests) {
    const bad = structuredClone(requests); mutate(bad[0]);
    assert.throws(() => collectResourceResult({ requests: [], computeGrants: [], staffGrants: [] }, requester, { workRequests: bad }, 'request', state));
  }
  const badGrants: ((grants: ResourceGrant[]) => void)[] = [
    grants => { grants[0].sharedMemoryMU = U; },
    grants => { grants[1].sharedMemoryMU!++; },
    grants => { delete grants[0].sharedMemoryMU; },
    grants => { grants[1].memoryMU--; },
    grants => { grants[1].poolId = 'unavailable-pool'; },
    grants => { grants[0].physicalCUw = 0; grants[0].hardwareEffectiveCUw = 0; grants[0].memoryMU = 0; grants[0].sharedMemoryMU = U; },
    grants => { grants[0].physicalCUw = 0; grants[0].hardwareEffectiveCUw = 0; grants[0].memoryMU = 0; grants[0].sharedMemoryMU = 0; },
  ];
  for (const mutate of badGrants) {
    const grants = structuredClone(legitimate); mutate(grants);
    const frame: ResourceFrame = { requests: structuredClone(requests), computeGrants: [], staffGrants: [] }, hash = canonicalStateHash(frame);
    assert.throws(() => collectResourceResult(frame, createComputeModule(CONTENT), { computeGrants: grants }, 'grant', state));
    assert.equal(canonicalStateHash(frame), hash, 'A rejected memory claim must leave the resource frame unchanged.');
  }
  const plain = structuredClone(requests); for (const request of plain) delete request.sharedAdapterMemory;
  assert.throws(() => collectResourceResult({ requests: plain, computeGrants: [], staffGrants: [] }, createComputeModule(CONTENT),
    { computeGrants: legitimate }, 'grant', state), 'An ordinary model request cannot borrow adapter discounts.');
});

test('W7-A08: reports, rights and exact deployments decide bank eligibility without changing stored candidates', () => {
  const { state, chatModelId, chatProductId } = servingCompany(), runId = state.slices.models.versions[chatModelId].trainingRunId!;
  const diagnosticOnly = structuredClone(state);
  for (const report of Object.values(diagnosticOnly.slices.models.reports)) if (report.modelId === chatModelId) report.suiteId = 'independent-holdouts-1';
  assert.equal(adapterSharingSpec(diagnosticOnly, chatProductId), undefined);
  const restricted = structuredClone(state); restricted.slices.models.trainingRuns[runId].plan!.corpus.rights.weights = false;
  assert.deepEqual(inheritedModelRights(restricted, chatModelId, CONTENT), { hosted: true, weights: false });
  assert.ok(adapterSharingSpec(restricted, chatProductId));
  restricted.slices.models.trainingRuns[runId].plan!.corpus.rights.hosted = false;
  assert.equal(adapterSharingSpec(restricted, chatProductId), undefined);
  const routed = structuredClone(state);
  routed.slices.products.efficiencyInstalls[chatProductId + ':routing'] = { id: chatProductId + ':routing', companyId: player(state), productId: chatProductId,
    kind: 'routing', modelId: chatModelId, secondaryModelId: baseId, startedWeek: 1, requiredWork: 2 * U, completedWork: 2 * U,
    requiredStaff: 2 * U, completedStaff: 2 * U, status: 'active', readyWeek: 2, enabled: true, lastBottleneck: '' };
  assert.equal(adapterSharingSpec(routed, chatProductId), undefined);
  routed.slices.products.efficiencyInstalls[chatProductId + ':routing'].enabled = false;
  assert.ok(adapterSharingSpec(routed, chatProductId));
  const paused = structuredClone(state); paused.slices.products.offers[chatProductId].status = 'paused';
  assert.equal(adapterSharingSpec(paused, chatProductId), undefined); assert.ok(modelAdapterReceipt(paused, chatModelId));
});

test('W7-A09: saves retain immutable adapter receipts and replay the same invoices, work and physical occupancy', () => {
  const { state } = servingCompany(), restored = deserializeState(serializeState(state));
  assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.deepEqual(restored.state, state);
  const left = advanceWeek(state), right = advanceWeek(restored.state);
  assert.equal(left.accepted, true, left.reason?.message); assert.equal(right.accepted, true, right.reason?.message);
  assert.equal(canonicalStateHash(left.state), canonicalStateHash(right.state));
  assert.equal(ADAPTER_BANK_RULES.adapterMemoryMU, U / 4);
  if (process.env.ADAPTER_CAMPAIGN_EXPORT) {
    mkdirSync(dirname(process.env.ADAPTER_CAMPAIGN_EXPORT), { recursive: true });
    writeFileSync(process.env.ADAPTER_CAMPAIGN_EXPORT, serializeState(left.state));
  }
});

test('W7-A10: the cloud weight guard recognizes the bank while retaining each standalone model requirement', () => {
  const run = new AdapterCampaign(servingCompany().state);
  for (const product of Object.values(run.state.slices.products.offers)) if (product.companyId === run.id && !adapterSharingSpec(run.state, product.id))
    run.queue({ kind: 'set_product_paused', productId: product.id, paused: true });
  run.queue({ kind: 'allocate_compute', serving: 0, development: 0, research: 0 }); run.step();
  assert.equal(previewCommand(run.state, { kind: 'set_cloud_capacity', cu: 2 * U }).accepted, true, 'Four MU can hold the 2.5 MU bank; old independent copies would need 4.5 MU.');
  assert.equal(previewCommand(run.state, { kind: 'set_cloud_capacity', cu: U }).reason?.code, 'MISSING_MEMORY');
  run.queue({ kind: 'set_cloud_capacity', cu: 2 * U }); run.step();
  assert.equal(fleet(run.state).cloudCU, 2 * U); assert.deepEqual(validateState(run.state), []);
});

test('W7-A11: acquisition admits trials into shared-bank memory that cannot hold independent weight copies', () => {
  const { state } = servingCompany(), id = player(state);
  // A market-boundary fixture isolates fresh demand on the two paid adapters.
  // Their actual model evidence, rights, prices and installed bank are unchanged.
  state.slices.markets.cohorts = state.slices.markets.cohorts.filter(cohort => cohort.companyId !== id);
  state.slices.markets.trials = state.slices.markets.trials.filter(trial => trial.companyId !== id);
  for (const offer of Object.values(state.slices.products.offers)) if (offer.companyId === id) {
    if (!adapterSharingSpec(state, offer.id)) offer.status = 'paused';
    delete state.slices.products.lastUsage[offer.id];
  }
  fleet(state).cloudCU = 2 * U; fleet(state).memoryMU = 4 * U; fleet(state).allocation = { serving: 2 * U, development: 0, research: 0 };
  const requests = adapterRequests(state), placed = allocate(state, requests);
  assert.equal(placed.result.updates!.compute!.fleets[id].occupiedMemoryMU, 2.5 * U);
  const independent = requests.map(request => { const copy = { ...request }; delete copy.sharedAdapterMemory; return copy; });
  assert.ok(allocate(state, independent).frame.computeGrants.some(grant => grant.memoryMU === 0));
  const context: ModuleContext = { week: state.week + 1, phase: 'market', content: CONTENT, facts: [], resources: placed.frame,
    random: { draw: () => { throw new Error('Trial capacity checks must not draw randomness.'); } } };
  const result = createMarketsModule(CONTENT).handlers.market!(state, context), market = result.updates!.markets!;
  assert.ok(market.lastTrialCount > 0, 'Acquisition must use the same shared-base placement as paid service.');
  assert.ok(market.trials.some(trial => trial.companyId === id && trial.activeWeek === context.week + 1));
});
