import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { DATA_CATALOG } from '../src/content/wave2-lab';
import { ASSISTANCE, PREFIX_CACHE, ROUTING } from '../src/content/wave4-research';
import type { CommandPayload, GameState, ModelVersion, ProductKind } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule } from '../src/modules/lab';
import { createResearchModule, researchEvidenceGate } from '../src/modules/research';
import { createProductsModule, productDemand, productRequestMeter, requestMeter } from '../src/modules/products';
import { getModelCommerceRights } from '../src/modules/business';
import { buildTrainingPlan } from '../src/modules/lab-planner';
import { getAppliedResearchView, systemApplied, trainingSupervision } from '../src/modules/applied-research';
import { cacheWarm, getProductEfficiencyView } from '../src/modules/product-efficiency';
import { modelExecutionHints, modelWorkBps } from '../src/modules/model-runtime';
import { getComputePools } from '../src/modules/compute-pools';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createLabModule(CONTENT), createResearchModule(CONTENT), createProductsModule(CONTENT)];
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];
const seed = (state: GameState) => state.slices.models.versions[CONTENT.seedModel.id];
function step(state: GameState): GameState { const result = advanceWeek(state, CONTENT, modules); assert.equal(result.accepted, true, result.reason?.message); return result.state; }
function queue(state: GameState, payload: CommandPayload, id?: string): GameState { const result = submitCommand(state, payload, CONTENT, id); assert.equal(result.accepted, true, result.reason?.message); return result.state; }
function until(state: GameState, done: (s: GameState) => boolean, limit = 100): GameState { for (let i = 0; i < limit && !done(state); i++) state = step(state); assert.ok(done(state), 'The paid project must progress with sufficient resources.'); return state; }
function report(state: GameState, model: ModelVersion): void {
  const id = 'scenario-report:' + model.id; model.evaluationReportId = id; model.status = 'evaluated';
  state.slices.models.reports[id] = { id, companyId: model.companyId, modelId: model.id, heldOut: true, scenarioStart: true, week: state.week,
    capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, basicChatEligible: model.capabilityBps.conversation >= 4500 && model.reliabilityBps >= 6500,
    cases: Array.from({ length: 20 }, (_, i) => ({ id: 'scenario-case-' + i, domain: 'conversation', difficultyBps: 0, passed: true })), passedCases: 20 };
}
/** A funded research scenario; subsequent project work and invoices use the actual engine. */
function initial(highModel = true): GameState {
  let state = createPlayerOnlyState(); for (let i = 0; i < 10; i++) state = step(state);
  const owner = state.playerCompanyId; company(state).cashCents = 1_000_000_000;
  state.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), ml: U };
  for (const [id, role] of [['researcher', 'research'], ['ml1', 'ml'], ['ml2', 'ml'], ['ml3', 'ml'], ['sales', 'commercial'], ['data', 'data']] as const) state.slices.company.staff[id] = { id, companyId: owner, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  company(state).activeStaff = 6;
  // This scenario predates the S-series discoveries and their paid release/site prerequisites.
  const known = CONTENT.research.filter(item => item.implemented && item.id.startsWith('R')).map(item => item.id);
  state.slices.research.completed = [...known].sort(); state.slices.research.completedByCompany[owner] = [...known].sort();
  for (const researchId of known) {
    const definition = CONTENT.research.find(item => item.id === researchId)!, id = 'scenario-research:' + researchId;
    state.slices.research.projects[id] = { id, companyId: owner, researchId, startedWeek: 0, completedWeek: 1, availableWeek: 2,
      requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U,
      role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
    state.slices.company.postedFacts[id + ':fee'] = true;
  }
  if (highModel) { seed(state).capabilityBps = { conversation: 7000, documents: 7000, coding: 7000, tools: 6500 }; seed(state).reliabilityBps = 9600; report(state, seed(state)); }
  const packet = state.slices.data.packets[CONTENT.starterData.id]; packet.prepared = true; packet.readyUnits = packet.rawUnits;
  fleet(state).cloudCU = 32 * U; fleet(state).memoryMU = 64 * U; fleet(state).allocation = { serving: 4 * U, development: 24 * U, research: 4 * U };
  state.slices.markets.waitlistRemaining = 0;
  assert.deepEqual(validateState(state, CONTENT), []); return state;
}
function removeKnowledge(state: GameState, researchId: string): void {
  state.slices.research.completed = state.slices.research.completed.filter(id => id !== researchId);
  state.slices.research.completedByCompany[state.playerCompanyId] = [...state.slices.research.completed];
  delete state.slices.research.projects['scenario-research:' + researchId];
}
function completeVariant(state: GameState, variant: 'compression' | 'memory-format' = 'compression', modelId = CONTENT.seedModel.id, commandId = 'variant-' + variant): GameState {
  state = queue(state, { kind: 'create_model_variant', modelId, variant }, commandId);
  return until(state, s => s.slices.models.applicationRuns['application:' + commandId]?.status === 'complete');
}
function evaluate(state: GameState, modelId: string): GameState {
  state = queue(state, { kind: 'evaluate_model', modelId });
  return until(state, s => !!s.slices.models.versions[modelId].evaluationReportId);
}
function product(state: GameState, modelId = CONTENT.seedModel.id, kind: ProductKind = 'developer-api'): GameState {
  const owner = state.playerCompanyId, model = state.slices.models.versions[modelId]; model.status = 'released';
  state.slices.products.offers.api = { id: 'api', companyId: owner, name: 'Scenario service', kind, features: { memory: false, extendedContext: false, deepReasoning: false }, deploymentId: 'api-deployment', contractId: 'api-contract', publicModelId: model.id, status: 'active', createdWeek: 8 };
  state.slices.products.deployments['api-deployment'] = { id: 'api-deployment', companyId: owner, productId: 'api', modelId: model.id, status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  state.slices.products.contracts['api-contract'] = { id: 'api-contract', companyId: owner, productId: 'api', weeklyPriceCents: 6000, allowance: 600, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['api']; state.slices.markets.cohorts = [{ id: 'scenario-customers', companyId: owner, productId: 'api', contractId: 'api-contract', segmentId: 'developers', count: 10, activeWeek: 9 }];
  return state;
}
function paidSystem(state: GameState, method: 'run-supervisor' | 'research-assistant'): GameState {
  state = queue(state, { kind: 'start_system_rollout', method });
  return until(state, s => systemApplied(s, s.playerCompanyId, method));
}
function packet(state: GameState, catalogId: string): string {
  const definition = DATA_CATALOG.find(item => item.id === catalogId)!, id = 'scenario-data:' + catalogId, owner = state.playerCompanyId;
  state.slices.data.packets[id] = { id, companyId: owner, catalogId, name: definition.name, rawUnits: definition.rawUnits, readyUnits: definition.rawUnits, qualityBps: definition.qualityBps,
    coverageBps: { ...definition.coverageBps }, rights: { ...definition.rights }, sourceIds: [catalogId], behaviorUnits: definition.behaviorUnits, broadUnits: definition.broadUnits,
    prepared: true, purchaseFactId: id + ':purchase', purchasedWeek: state.week };
  state.slices.company.postedFacts[id + ':purchase'] = true; return id;
}
function teacherScenario(): { state: GameState; teacherId: string; evidenceId: string } {
  let state = initial(false);
  // Two authored historical releases unlock the paid foundation design. Neither is the teacher.
  for (let i = 1; i <= 2; i++) { const historical = { ...structuredClone(seed(state)), id: 'historical-' + i, name: 'Historical release ' + i, parentModelId: seed(state).id }; state.slices.models.versions[historical.id] = historical; report(state, historical); historical.status = 'released'; }
  const broad = packet(state, 'broad-corpus-1'), coding = packet(state, 'specialist-coding-1');
  state = queue(state, { kind: 'start_training', recipeId: 'medium-foundation', baseModelId: seed(state).id, packetId: broad, packetIds: [broad, coding] }, 'teacher-foundation');
  state = until(state, s => s.slices.models.trainingRuns['training-teacher-foundation']?.status === 'complete');
  state = evaluate(state, 'model-teacher-foundation');
  return { state, teacherId: 'model-teacher-foundation', evidenceId: coding };
}

test('W4-R01: compression pays independent rollout meters, creates a fresh evaluated candidate, and cannot stack or replay', () => {
  let state = initial(); const sourceHash = canonicalStateHash(seed(state));
  // Withhold every Design supplier, including secondary output from other specialties.
  state.slices.company.founderAssignments[state.playerCompanyId].ml = 0; for (const member of Object.values(state.slices.company.staff)) member.assignedFte = 0;
  state = step(queue(state, { kind: 'create_model_variant', modelId: seed(state).id, variant: 'compression' }, 'compress'));
  const id = 'application:compress'; assert.equal(state.slices.models.applicationRuns[id].completedWork, 2 * U); assert.equal(state.slices.models.applicationRuns[id].completedStaff, 0); assert.equal(state.slices.models.versions['variant:compress'], undefined);
  state.slices.company.founderAssignments[state.playerCompanyId].ml = U;
  for (const member of Object.values(state.slices.company.staff)) if (member.role !== 'ml') member.assignedFte = U;
  state = until(state, s => s.slices.models.applicationRuns[id].status === 'complete');
  const variant = state.slices.models.versions['variant:compress']; assert.equal(variant.capabilityBps.conversation, 6700); assert.equal(variant.residentMU, seed(state).residentMU); assert.equal(variant.status, 'checkpoint');
  assert.equal(requestMeter(variant, { memory: false, extendedContext: false, deepReasoning: false }).work, 160000);
  assert.equal(previewCommand(state, { kind: 'deploy_product', modelId: variant.id, priceCents: 1200, allowance: 100 }, CONTENT).accepted, false);
  assert.equal(previewCommand(state, { kind: 'create_model_variant', modelId: seed(state).id, variant: 'compression' }, CONTENT).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(previewCommand(state, { kind: 'create_model_variant', modelId: variant.id, variant: 'memory-format' }, CONTENT).accepted, false);
  state = evaluate(state, variant.id); assert.equal(previewCommand(state, { kind: 'deploy_product', modelId: variant.id, priceCents: 1200, allowance: 100 }, CONTENT).accepted, true);
  assert.equal(canonicalStateHash(seed(state)), sourceHash); assert.deepEqual(getModelCommerceRights(state, variant.id, CONTENT), { hosted: true, weights: true });
});

test('W4-R02: the alternative memory format halves weights, preserves session/output work, and rejects retraining from a deployment artifact', () => {
  let state = completeVariant(initial(), 'memory-format'); const model = state.slices.models.versions['variant:variant-memory-format'];
  assert.equal(model.residentMU, U); assert.equal(model.capabilityBps.coding, 6500); assert.equal(modelWorkBps(model), 10000);
  const options = { memory: true, extendedContext: true, deepReasoning: true };
  assert.deepEqual(requestMeter(model, options), requestMeter(seed(state), options));
  assert.equal(previewCommand(state, { kind: 'start_training', baseModelId: model.id, packetId: CONTENT.starterData.id }, CONTENT).accepted, false);
  state = evaluate(state, model.id); assert.equal(getAppliedResearchView(state, state.playerCompanyId).variants[0].evaluated, true);
});

test('W4-R03: research entry gates require evidence and operating capacity; discovery alone creates no deployment asset', () => {
  const state = initial(false);
  assert.ok(researchEvidenceGate(state, state.playerCompanyId, 'R13')); assert.ok(researchEvidenceGate(state, state.playerCompanyId, 'R15')); assert.ok(researchEvidenceGate(state, state.playerCompanyId, 'R16'));
  assert.equal(researchEvidenceGate(state, state.playerCompanyId, 'R14'), null);
  fleet(state).cloudCU = 8 * U; fleet(state).memoryMU = 16 * U; fleet(state).allocation = { serving: 0, development: 8 * U, research: 0 };
  assert.ok(researchEvidenceGate(state, state.playerCompanyId, 'R14'));
  assert.equal(Object.keys(state.slices.models.applicationRuns).length, 0); assert.equal(Object.keys(state.slices.research.systemRollouts).length, 0);
  assert.equal(Object.keys(state.slices.products.efficiencyInstalls).length, 0);
});

test('W4-R04: routing pays rollout, retains both models, charges routing work and exposes the quality tradeoff', () => {
  let state = initial(); seed(state).family = 'medium'; seed(state).residentMU = 8 * U;
  state = completeVariant(state); state = evaluate(state, 'variant:variant-compression'); state = product(state);
  const offer = state.slices.products.offers.api, before = productDemand(state, offer, CONTENT, state.week);
  state = queue(state, { kind: 'install_product_efficiency', productId: offer.id, method: 'routing', secondaryModelId: 'variant:variant-compression' });
  state = until(state, s => !!getProductEfficiencyView(s, offer.id).routingActive);
  const after = productDemand(state, state.slices.products.offers.api, CONTENT, state.week), expected = before.meter.work * .4 + before.meter.work * .8 * .6 + ROUTING.overheadPerRequest;
  assert.equal(after.meter.work, expected); assert.equal(after.memory - before.memory, 8 * U); assert.equal(after.model.capabilityBps.coding, 6820);
  assert.ok(after.segments[0].errorBps > before.segments[0].errorBps); assert.equal(state.slices.models.versions['variant:variant-compression'].status, 'released');
  assert.equal(state.slices.products.lastUsage.api.tokens!.inputTokens, 10 * 600 * 500); assert.equal(state.slices.products.lastUsage.api.billedCents, 60000);
  state = step(queue(state, { kind: 'set_product_efficiency_enabled', productId: offer.id, method: 'routing', enabled: false }));
  assert.equal(productDemand(state, state.slices.products.offers.api, CONTENT, state.week).meter.work, before.meter.work);
});

test('W4-R05: prefix cache requires actual warm service, discounts only reused input, keeps token bills and invalidates changed context', () => {
  let state = product(initial()); const before = productRequestMeter(state, state.slices.products.offers.api, seed(state));
  state = queue(state, { kind: 'install_product_efficiency', productId: 'api', method: 'prefix-cache' });
  state = until(state, s => !!getProductEfficiencyView(s, 'api').cacheActive);
  assert.equal(cacheWarm(state, state.slices.products.offers.api), false, 'First service warms prefixes; it cannot claim a prior-week hit.');
  assert.equal(state.slices.products.lastUsage.api.paidRequestedWork, 10 * 600 * before.work);
  state = step(state); const view = getProductEfficiencyView(state, 'api'); assert.equal(view.cacheWarm, true);
  const meter = productRequestMeter(state, state.slices.products.offers.api, seed(state));
  assert.equal(meter.work, before.work - 500 * 200 * .5 * .8); assert.equal(meter.outputTokens, before.outputTokens); assert.equal(meter.inputTokens, before.inputTokens);
  assert.equal(view.additionalMemoryMU, PREFIX_CACHE.memoryMU + 10 * PREFIX_CACHE.tenantMemoryMU); assert.equal(state.slices.products.lastUsage.api.billedCents, 60000);
  state = step(queue(state, { kind: 'set_product_features', productId: 'api', features: { memory: false, extendedContext: true, deepReasoning: true } }));
  assert.equal(cacheWarm(state, state.slices.products.offers.api), false); assert.equal(state.slices.products.lastUsage.api.tokens!.internalTokens, 10 * 600 * 200);
  state = step(queue(state, { kind: 'set_product_efficiency_enabled', productId: 'api', method: 'prefix-cache', enabled: false }));
  assert.equal(getProductEfficiencyView(state, 'api').additionalMemoryMU, 0);
});

test('W4-R06: distillation meters teacher inference before student updates, preserves rights and uses a finite transfer target', () => {
  const setup = teacherScenario(); let state = setup.state;
  state = queue(state, { kind: 'start_training', recipeId: 'compact-distillation', baseModelId: CONTENT.seedModel.id, packetId: setup.evidenceId, teacherModelId: setup.teacherId, teacherDomain: 'coding' }, 'student');
  state = step(state); let run = state.slices.models.trainingRuns['training-student']; assert.equal(run.preparationCompleted, U); assert.equal(run.completedWork, 0); assert.equal(run.teacherWorkCompleted, 0);
  const waiting = step(queue(state, { kind: 'allocate_compute', serving: 0, development: 28 * U, research: 4 * U }));
  assert.equal(waiting.slices.models.trainingRuns[run.id].teacherWorkCompleted, 0); assert.equal(waiting.slices.models.trainingRuns[run.id].completedWork, 0);
  state = step(state); run = state.slices.models.trainingRuns[run.id]; assert.equal(run.teacherWorkCompleted, 4 * U); assert.equal(run.completedWork, 0);
  state = until(state, s => s.slices.models.trainingRuns[run.id].status === 'complete'); run = state.slices.models.trainingRuns[run.id];
  const model = state.slices.models.versions[run.outputModelId]; assert.equal(run.teacherWorkCompleted, 8 * U); assert.equal(run.teacherPhysicalWork, 8 * U); assert.equal(run.completedWork, 40 * U);
  assert.equal(model.family, 'compact'); assert.ok(model.capabilityBps.coding > seed(state).capabilityBps.coding); assert.ok(model.capabilityBps.coding < state.slices.models.versions[setup.teacherId].capabilityBps.coding);
  assert.deepEqual(getModelCommerceRights(state, model.id, CONTENT), { hosted: true, weights: true });
  assert.equal(previewCommand(state, { kind: 'start_training', recipeId: 'compact-distillation', baseModelId: model.id, packetId: setup.evidenceId, teacherModelId: setup.teacherId, teacherDomain: 'coding' }, CONTENT).accepted, false, 'The same teacher/evidence/lineage target cannot compound.');
  const bad = structuredClone(state); bad.slices.models.trainingRuns[run.id].plan!.teacher!.rights.weights = false; assert.ok(validateState(bad, CONTENT).length);
});

test('W4-R07: sparse design reduces work while increasing memory and refuses ordinary cloud-only admission', () => {
  const setup = teacherScenario(), state = setup.state; const broad = Object.values(state.slices.data.packets).find(p => p.catalogId === 'broad-corpus-1')!.id;
  const options = { recipeId: 'medium-foundation', baseModelId: CONTENT.seedModel.id, packetId: broad, packetIds: [broad, setup.evidenceId] };
  const dense = buildTrainingPlan(state, state.playerCompanyId, options), sparse = buildTrainingPlan(state, state.playerCompanyId, { ...options, architecture: 'sparse' });
  assert.equal(sparse.requiredWork, dense.requiredWork * .7); assert.equal(sparse.requiredMemory, dense.requiredMemory * 1.5); assert.equal(sparse.plan.residentMU, dense.plan.residentMU * 1.5); assert.ok(sparse.plan.methods.includes('R14'));
  assert.equal(previewCommand(state, { kind: 'start_training', ...options, architecture: 'sparse' }, CONTENT).accepted, false);
  const hints = modelExecutionHints({ ...seed(state), architecture: 'sparse' }, 'training'); assert.equal(hints.requiresFastFabric, true); assert.equal(hints.workloadKind, 'training');
});

test('W4-R08: paid run supervision scales real training work with coverage and never creates GPU capacity', () => {
  let state = initial(false); const dataId = packet(state, 'specialist-coding-1');
  // Founder 20 + two specialists at 30 each = 80 Design points, below the manual GPU limit.
  for (const member of Object.values(state.slices.company.staff)) member.assignedFte = ['ml1', 'ml2'].includes(member.id) ? U : 0;
  const baseline = queue(structuredClone(state), { kind: 'start_training', recipeId: 'coding-tools-adaptation', baseModelId: seed(state).id, packetId: dataId }, 'manual');
  const manual = step(baseline); assert.equal(manual.slices.models.trainingRuns['training-manual'].completedWork, 16 * U, '80 Design points cover exactly 16 CUw at the manual supervision rate.');
  state = paidSystem(state, 'run-supervisor'); state = step(queue(state, { kind: 'start_training', recipeId: 'coding-tools-adaptation', baseModelId: seed(state).id, packetId: dataId }, 'supervised'));
  const run = state.slices.models.trainingRuns['training-supervised']; assert.equal(run.completedWork, 24 * U); assert.equal(fleet(state).lastWork.development, 24 * U);
  const demand = trainingSupervision(state, run, run.requiredWork - run.completedWork, CONTENT); assert.ok(demand.staffDemand![0].staffWeeks >= U / 2);
  const paused = step(queue(state, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 4 * U })); assert.equal(paused.slices.models.trainingRuns[run.id].completedWork, run.completedWork);
});

test('W4-R09: research assistant needs real researcher effort, serving work and review; research compute is not discounted', () => {
  let state = initial(); removeKnowledge(state, 'R14'); state = paidSystem(state, 'research-assistant');
  state = queue(state, { kind: 'configure_research_assistant', modelId: seed(state).id, maxAssistedFte: U, enabled: true });
  state = queue(state, { kind: 'start_research', researchId: 'R14' }, 'assisted'); state = step(state);
  const projectId = 'research-assisted', assistant = state.slices.research.assistantsByCompany[state.playerCompanyId];
  assert.equal(assistant.executedWork, ASSISTANCE.workPerFte); assert.equal(assistant.reviewStaff, ASSISTANCE.reviewPerFte); assert.equal(assistant.assistedStaff, U); assert.equal(assistant.bonusStaff, U / 5);
  assert.equal(state.slices.research.projects[projectId].completedStaff, 3.7 * U, 'The team generates 70 Research points and the capped assistant adds four.'); assert.equal(state.slices.research.projects[projectId].completedWork, 4 * U);
  state.slices.company.staff.sales.assignedFte = 0; state = step(state); assert.equal(state.slices.research.assistantsByCompany[state.playerCompanyId].bonusStaff, 0);
  state.slices.company.staff.sales.assignedFte = U; state = step(queue(state, { kind: 'allocate_compute', serving: 4 * U, development: 24 * U, research: 0 }));
  const frozenWork = state.slices.research.projects[projectId].completedWork; state = until(state, s => s.slices.research.projects[projectId].completedStaff === 8 * U);
  assert.equal(state.slices.research.projects[projectId].completedWork, frozenWork); assert.equal(state.slices.research.projects[projectId].status, 'running'); assert.equal(state.slices.research.completed.includes('R14'), false);
});

test('W4-R10: application snapshots round-trip deterministically and reject forged costs, penalties, cache timing and bonus claims', () => {
  let state = product(evaluate(completeVariant(initial()), 'variant:variant-compression'));
  state = until(queue(state, { kind: 'install_product_efficiency', productId: 'api', method: 'prefix-cache' }), s => getProductEfficiencyView(s, 'api').cacheActive); state = step(state);
  const restored = deserializeState(serializeState(state)); assert.equal(restored.ok, true); if (!restored.ok) return;
  assert.equal(canonicalStateHash(step(restored.state)), canonicalStateHash(step(state)));
  const mutators: ((s: GameState) => void)[] = [
    s => { s.slices.models.versions['variant:variant-compression'].runtimeVariant!.servingWorkBps = 1000; },
    s => { s.slices.models.applicationRuns['application:variant-compression'].requiredStaff = 1; },
    s => { s.slices.products.efficiencyInstalls['api:prefix-cache'].warmedWeek = s.week + 1; },
    s => { s.slices.models.versions['variant:variant-compression'].capabilityBps.coding += 500; },
  ];
  for (const mutate of mutators) { const bad = structuredClone(state); mutate(bad); const raw = JSON.stringify({ format: 'frontier-lab', schemaVersion: bad.schemaVersion, contentVersion: bad.contentVersion, checksum: canonicalStateHash(bad), state: bad }); assert.equal(deserializeState(raw).ok, false); }
});

let sparseScenarioCache: GameState | undefined;
function paidSparseScenario(): GameState {
  if (sparseScenarioCache) return structuredClone(sparseScenarioCache);
  const setup = teacherScenario(); let state = setup.state;
  state = queue(state, { kind: 'hire_staff', role: 'infrastructure' });
  for (const id of ['sparse-memory-a', 'sparse-memory-b']) state = queue(state, { kind: 'order_rack', hardwareId: 'memory-rich', location: 'colocation' }, id);
  state = until(state, s => Object.values(s.slices.compute.racks).length === 2 && Object.values(s.slices.compute.racks).every(r => r.status === 'inventory'));
  for (const rack of Object.values(state.slices.compute.racks)) state = queue(state, { kind: 'install_rack', rackId: rack.id });
  state = until(state, s => Object.values(s.slices.compute.racks).every(r => r.status === 'installed'));
  state = queue(state, { kind: 'install_fast_fabric', location: 'colocation' });
  state = until(state, s => Object.values(s.slices.compute.fabricProjects).some(f => f.status === 'active'));
  const broad = Object.values(state.slices.data.packets).find(p => p.catalogId === 'broad-corpus-1')!.id;
  state = queue(state, { kind: 'start_training', recipeId: 'medium-foundation', architecture: 'sparse', baseModelId: CONTENT.seedModel.id, packetId: broad, packetIds: [broad, setup.evidenceId] }, 'sparse-foundation');
  state = until(state, s => s.slices.models.trainingRuns['training-sparse-foundation']?.status === 'complete');
  state = evaluate(state, 'model-sparse-foundation');
  state = completeVariant(state, 'compression', 'model-sparse-foundation', 'sparse-compact-runtime');
  state = evaluate(state, 'variant:sparse-compact-runtime');
  sparseScenarioCache = structuredClone(state); return state;
}

test('W4-R11: paid compatible racks and fabric admit a sparse foundation and its separate evaluation and deployment variant', () => {
  const state = paidSparseScenario(), run = state.slices.models.trainingRuns['training-sparse-foundation'], model = state.slices.models.versions[run.outputModelId];
  assert.equal(run.requiredWork, 168 * U); assert.equal(run.completedWork, 168 * U); assert.equal(run.requiredMemory, 36 * U);
  assert.equal(model.residentMU, 12 * U); assert.equal(model.architecture, 'sparse'); assert.equal(modelWorkBps(model), 6500);
  assert.equal(modelWorkBps(state.slices.models.versions['variant:sparse-compact-runtime']), 5200);
  assert.ok(run.physicalWork > 0); assert.ok(getComputePools(state).some(pool => pool.fastFabric && pool.memoryMU >= run.requiredMemory));
  assert.equal(previewCommand(state, { kind: 'deploy_product', modelId: model.id, priceCents: 1200, allowance: 100 }, CONTENT).accepted, true);
  assert.deepEqual(validateState(state, CONTENT), []);
});

test('W4-R12: admission distinguishes architecture and workload support even when a custom pool has fabric, capacity and memory', () => {
  const original = paidSparseScenario(), broad = Object.values(original.slices.data.packets).find(p => p.catalogId === 'broad-corpus-1')!.id;
  const coding = Object.values(original.slices.data.packets).find(p => p.catalogId === 'specialist-coding-1')!.id;
  for (const architecture of ['dense', 'sparse'] as const) for (const target of ['training', 'inference'] as const) {
    const state = product(structuredClone(original), 'model-sparse-foundation'), id = 'admission-profile';
    // A boundary unit fixture supplies each qualified hardware profile. Paid design,
    // manufacturing and installation provenance are covered by the hardware suite.
    state.slices.compute.chipDesigns[id] = { id, companyId: state.playerCompanyId, name: 'Admission profile', spec: { architecture, target, memory: 'wide' }, status: 'validated', paused: false,
      designFeeCents: 0, designPaymentId: 'profile-fee', qualifiedYieldBps: 10000, prototypeRun: null,
      design: { startedWeek: 0, requiredWorkCUw: 0, completedWorkCUw: 0, requiredHardwareStaff: 0, completedHardwareStaff: 0, requiredMlStaff: 0, completedMlStaff: 0, completedWeek: 1, readyWeek: 2, lastProgress: 0, lastBottleneck: '' } };
    for (const rack of Object.values(state.slices.compute.racks)) { rack.hardwareId = id; rack.chipDesignId = id; }
    const pool = getComputePools(state).find(p => p.ownership === 'owned')!; assert.equal(pool.capacityCU, 16 * U); assert.equal(pool.memoryMU, 64 * U); assert.equal(pool.fastFabric, true);
    const training = previewCommand(state, { kind: 'start_training', recipeId: 'medium-foundation', architecture: 'sparse', profile: 'ambitious', baseModelId: CONTENT.seedModel.id, packetId: broad, packetIds: [broad, coding] }, CONTENT);
    assert.equal(training.accepted, architecture === 'sparse' && target === 'training', architecture + '/' + target + ': ' + training.reason?.message);
    const serving = architecture === 'sparse' && target === 'inference';
    assert.equal(previewCommand(state, { kind: 'deploy_product', modelId: 'model-sparse-foundation', priceCents: 1200, allowance: 100 }, CONTENT).accepted, serving);
    assert.equal(previewCommand(state, { kind: 'install_product_efficiency', productId: 'api', method: 'routing', secondaryModelId: 'variant:sparse-compact-runtime' }, CONTENT).accepted, serving);
  }
});
