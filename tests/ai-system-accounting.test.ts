import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameState, ModelVersion } from '../src/contracts/types';
import type { ModelApplicationRun } from '../src/contracts/wave4-research';
import type { RuntimeGuardrailBinding } from '../src/contracts/wave12-guardrails';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_FEATURES } from '../src/content/wave2-market';
import { DEFAULT_MODEL_CUSTOMIZATION } from '../src/content/model-customization';
import { COMMERCE_RULES } from '../src/content/wave3-commerce';
import { RUNTIME_GUARDRAIL_PROFILES } from '../src/content/wave12-guardrails';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState } from '../src/core/engine';
import { mulDiv } from '../src/core/math';
import { aiSystemSessionMemory, getAISystemMetrics } from '../src/modules/ai-systems';
import { DEFAULT_MODEL_DESIGN, getAISystemForecastModel, getModelDesignForecast, getModelDesignForBase } from '../src/modules/model-design';
import { requestMeter } from '../src/modules/product-models';
import { productDemand, productRequestMeter, standardServingRequests } from '../src/modules/products';
import { getProductEfficiencyView, productRoutingStateMemory } from '../src/modules/product-efficiency';
import { assuranceMeter } from '../src/modules/assured-api';
import { queuedBusinessCapacityRequests } from '../src/modules/business';
import { variantModel } from '../src/modules/applied-research';
import { buildTrainingPlan } from '../src/modules/lab-planner';
import { buildCustomTrainingPlan } from '../src/modules/model-design-training';
import { getCustomizationEffects } from '../src/modules/model-customization';
import { getCompatibleComputePools } from '../src/modules/compute-pools';
import { createComputeModule } from '../src/modules/compute';

/** Focused metering inputs. These projections are not paid campaign fixtures. */
function systemModel(state: GameState, id: string, slots: 16 | 256 = 256): ModelVersion {
  const spec = { ...structuredClone(DEFAULT_MODEL_DESIGN), mode: 'foundation' as const, parameterMillions: 8000, computeBudgetCUw: 800 * U,
    customization: { ...DEFAULT_MODEL_CUSTOMIZATION, attention: 'grouped-query' as const },
    system: { version: 1 as const, kind: 'stateful' as const, stateSlots: slots, memory: 'selective' as const, repair: true } };
  const model = getAISystemForecastModel(spec, getModelDesignForecast(state, state.playerCompanyId, CONTENT.seedModel.id, [], spec));
  model.id = id; model.companyId = state.playerCompanyId; state.slices.models.versions[id] = model; return model;
}
function publicRoute(state: GameState, primary: ModelVersion, secondary: ModelVersion) {
  const owner = state.playerCompanyId;
  const product = state.slices.products.offers['meter-service'] = { id: 'meter-service', companyId: owner, name: 'Meter service', kind: 'developer-api' as const,
    deploymentId: 'meter-deployment', contractId: 'meter-contract', publicModelId: primary.id, features: { ...DEFAULT_FEATURES }, status: 'active' as const, createdWeek: 0 };
  state.slices.products.deployments[product.deploymentId] = { id: product.deploymentId, companyId: owner, productId: product.id, modelId: primary.id,
    status: 'active', startedWeek: 0, requiredStaff: U, completedStaff: U, readyWeek: 0, lastBottleneck: '' };
  state.slices.products.contracts[product.contractId] = { id: product.contractId, companyId: owner, productId: product.id, weeklyPriceCents: 6000, allowance: 100, creditBps: 10000, effectiveWeek: 0 };
  state.slices.markets.cohorts = [{ id: 'meter-accounts', companyId: owner, productId: product.id, contractId: product.contractId, segmentId: 'developers', count: 10, activeWeek: 0 }];
  state.slices.markets.trials = [];
  state.slices.products.efficiencyInstalls[product.id + ':routing'] = { id: 'efficiency:meter-route', companyId: owner, productId: product.id,
    kind: 'routing', modelId: primary.id, secondaryModelId: secondary.id, routingProtocol: 2, startedWeek: 0,
    requiredWork: 2 * U, completedWork: 2 * U, requiredStaff: 2 * U, completedStaff: 2 * U, status: 'active', readyWeek: 0, enabled: true, lastBottleneck: '' };
  return product;
}

test('public routing reserves both systems state for every account and releases secondary state when disabled', () => {
  const state = createInitialState(), primary = systemModel(state, 'state-primary'), secondary = systemModel(state, 'state-secondary', 16);
  const product = publicRoute(state, primary, secondary), primarySession = requestMeter(primary, DEFAULT_FEATURES).sessionMemory;
  const secondaryState = aiSystemSessionMemory(secondary), meter = productRequestMeter(state, product, primary);
  assert.equal(meter.sessionMemory, primarySession + secondaryState);
  const demand = productDemand(state, product, CONTENT, state.week);
  assert.equal(demand.memory, primary.residentMU + secondary.residentMU + 10 * meter.sessionMemory);
  assert.equal(standardServingRequests(state, CONTENT, state.week).find(request => request.taskId === product.id)!.memoryMU, demand.memory);
  assert.equal(getProductEfficiencyView(state, product.id).additionalMemoryMU, secondary.residentMU + 10 * secondaryState);
  const route = state.slices.products.efficiencyInstalls[product.id + ':routing']; route.enabled = false;
  assert.equal(productDemand(state, product, CONTENT, state.week).memory, primary.residentMU + 10 * primarySession);
  route.enabled = true; route.secondaryModelId = primary.id;
  assert.equal(productRoutingStateMemory(state, product), 0, 'A duplicated model id does not create a second state instance.');
  delete primary.modelDesign; delete secondary.modelDesign; route.secondaryModelId = secondary.id;
  assert.equal(productRequestMeter(state, product, primary).sessionMemory, 20_000_000, 'Legacy routes retain the original shared session exactly.');
});

test('assured and private hosted tenant reservations include retained system state without changing legacy meters', () => {
  const state = createInitialState(), primary = systemModel(state, 'host-primary'), secondary = systemModel(state, 'host-secondary', 16);
  const binding: RuntimeGuardrailBinding = { productKind: 'developer-api', features: { ...DEFAULT_FEATURES }, secondaryShareBps: 6000,
    primary: { modelId: primary.id, modelFingerprint: 'meter-primary', capabilityReportId: 'meter-report-a', policyReportId: 'meter-policy-a' },
    secondary: { modelId: secondary.id, modelFingerprint: 'meter-secondary', capabilityReportId: 'meter-report-b', policyReportId: 'meter-policy-b' } };
  const primaryState = aiSystemSessionMemory(primary), secondaryState = aiSystemSessionMemory(secondary);
  const withState = assuranceMeter(state, binding, 'balanced');
  assert.equal(withState.reservedMemoryMU, primary.residentMU + secondary.residentMU + 20_000_000 + primaryState + secondaryState + RUNTIME_GUARDRAIL_PROFILES.balanced.memoryMU);
  const packet = state.slices.data.packets[CONTENT.starterData.id]; packet.prepared = true; packet.readyUnits = packet.rawUnits;
  state.queuedCommands.push({ id: 'meter-private', companyId: state.playerCompanyId, issuedForWeek: state.week + 1,
    payload: { kind: 'sign_business_contract', customerId: 'aster-services', contractKind: 'private-hosted', modelId: primary.id, packetId: packet.id } });
  const privateState = queuedBusinessCapacityRequests(state)[0];
  assert.equal(privateState.memoryMU, primary.residentMU + COMMERCE_RULES.retrievalIndexMemoryMU + COMMERCE_RULES.privateSessionMemoryMU + primaryState);
  delete primary.modelDesign; delete secondary.modelDesign;
  assert.equal(withState.reservedMemoryMU - assuranceMeter(state, binding, 'balanced').reservedMemoryMU, primaryState + secondaryState);
  assert.equal(privateState.memoryMU - queuedBusinessCapacityRequests(state)[0].memoryMU, primaryState);
});

test('runtime formats retain account state and changed training objectives never apply system hardware twice', () => {
  const state = createInitialState(), source = systemModel(state, 'format-source');
  for (const kind of ['compression', 'memory-format'] as const) {
    const application = { outputModelId: 'format-' + kind, sourceModelId: source.id, companyId: source.companyId, variant: kind, id: 'application:' + kind } as ModelApplicationRun;
    const variant = variantModel(state, application, state.week);
    assert.deepEqual(variant.modelDesign, source.modelDesign);
    assert.equal(requestMeter(variant, DEFAULT_FEATURES).sessionMemory, requestMeter(source, DEFAULT_FEATURES).sessionMemory);
    assert.equal(getAISystemMetrics(variant).sessionMemoryMU, requestMeter(variant, DEFAULT_FEATURES).sessionMemory);
    if (kind === 'memory-format') assert.equal(variant.residentMU, source.residentMU / 2);
    else assert.ok(requestMeter(variant, DEFAULT_FEATURES).work < requestMeter(source, DEFAULT_FEATURES).work);
  }
  const spec = getModelDesignForBase(source); spec.customization!.objective = 'grounded';
  const plan = buildCustomTrainingPlan(state, source.companyId, { baseModelId: source.id, packetId: CONTENT.starterData.id, recipeId: 'custom-model-adaptation', modelDesign: spec }, CONTENT).plan;
  assert.equal(plan.residentMU, source.residentMU);
  assert.equal(plan.modelDesign!.customization!.hardwareServingWorkBps, source.modelDesign!.customization!.hardwareServingWorkBps);
  assert.equal(plan.modelDesign!.servingWorkBps, Math.max(500, mulDiv(source.modelDesign!.customization!.hardwareServingWorkBps, getCustomizationEffects(spec.customization!).runtimeServingBps, 10000, 'nearest')));
  const calibration = buildTrainingPlan(state, source.companyId, { baseModelId: source.id, packetId: CONTENT.starterData.id, recipeId: 'calibration-curriculum' }, CONTENT);
  assert.equal(calibration.plan.residentMU, source.residentMU);
  const distillation = buildTrainingPlan(state, source.companyId, { baseModelId: source.id, packetId: CONTENT.starterData.id, recipeId: 'compact-distillation', teacherModelId: CONTENT.seedModel.id, teacherDomain: 'coding' }, CONTENT);
  assert.equal(distillation.plan.kind, 'distillation'); assert.equal(distillation.plan.architecture, 'dense'); assert.equal(distillation.plan.residentMU, 2 * U);
  assert.equal(distillation.plan.modelDesign, undefined);
});

test('expert public serving cannot borrow ordinary cloud capacity without physical fast fabric', () => {
  const state = createInitialState(), spec = { ...structuredClone(DEFAULT_MODEL_DESIGN), mode: 'foundation' as const,
    system: { version: 1 as const, kind: 'experts' as const, experts: 4 as const, activeExperts: 1 as const, routing: 'uniform' as const, specialization: 'coding' as const } };
  const expert = getAISystemForecastModel(spec, getModelDesignForecast(state, state.playerCompanyId, CONTENT.seedModel.id, [], spec));
  expert.id = 'cloud-incompatible-expert'; expert.companyId = state.playerCompanyId; state.slices.models.versions[expert.id] = expert;
  const product = publicRoute(state, expert, expert); state.slices.products.efficiencyInstalls[product.id + ':routing'].enabled = false;
  const fleet = state.slices.compute.fleets[state.playerCompanyId]; fleet.allocation = { serving: 4 * U, development: 0, research: 0 };
  const requests = standardServingRequests(state, CONTENT, state.week).filter(request => request.taskId === product.id); assert.equal(requests[0].requiresFastFabric, true); assert.equal(requests[0].modelArchitecture, 'sparse');
  assert.deepEqual(getCompatibleComputePools(state, state.playerCompanyId, requests[0]), []);
  const result = createComputeModule(CONTENT).grantResources!(state, { week: state.week, phase: 'reserve', content: CONTENT, facts: [], resources: { requests, computeGrants: [], staffGrants: [] }, random: { draw: () => 0 } });
  assert.equal(result.computeGrants?.reduce((sum, grant) => sum + grant.hardwareEffectiveCUw, 0), 0);
});
