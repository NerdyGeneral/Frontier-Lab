import { ADAPTER_BANK_RULES as RULES } from '../content/wave7-adapters';
import { CONTENT } from '../content/catalog';
import type { GameContent, GameState, Rejection, TrainingRun, WorkRequest } from '../contracts/types';
import type { TrainingRecipe } from '../contracts/wave2-lab';
import type { AdapterBankGroupView, AdapterTrainingReceipt, SharedAdapterMemory } from '../contracts/wave7-adapters';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, checkedInteger } from '../core/math';
import { hasCapabilityEvaluation, inheritedModelRights } from './model-runtime';

const same = (left: unknown, right: unknown) => canonicalStateHash(left) === canonicalStateHash(right);
const requireValue = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const rejection = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });

export function adapterBankRollout(state: Readonly<GameState>, companyId = state.playerCompanyId) {
  return Object.values(state.slices.research.systemRollouts ?? {}).find(rollout => rollout.companyId === companyId && rollout.method === RULES.method) ?? null;
}

function declaredAdapter(state: Readonly<GameState>, modelId: string): AdapterTrainingReceipt | undefined {
  const model = state.slices.models.versions[modelId];
  return model?.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId]?.plan?.adapter : undefined;
}

/** The option never converts an old candidate or unfreezes another adapter. */
export function validateAdapterTrainingOption(state: Readonly<GameState>, companyId: string, baseModelId: string,
  recipeKind: TrainingRecipe['kind'], asAdapter?: boolean): Rejection | undefined {
  if (asAdapter !== undefined && typeof asAdapter !== 'boolean') return rejection('Choose whether this run creates an adapter.', 'INVALID_COMMAND');
  const base = state.slices.models.versions[baseModelId];
  if (base && declaredAdapter(state, base.id)) return rejection('An adapter is tied to its frozen base. Select the original base for another training run.', 'NO_IMPROVEMENT');
  if (!asAdapter) return;
  if (!(state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.researchId)
    || adapterBankRollout(state, companyId)?.status !== 'active') return rejection('Research Adapter bank (R4B), then finish its separate system rollout before training adapters.');
  if (!base || base.companyId !== companyId || base.architecture !== 'dense' || base.runtimeVariant)
    return rejection('Choose your original dense base; deployment formats, sparse models, and adapters cannot become adapter bases.');
  if (recipeKind !== 'adaptation') return rejection('Frozen-base adapters use a dense adaptation recipe. Foundations, distillation, and behavior recipes retain their ordinary training methods.');
}

export function getAdapterTrainingReceipt(state: Readonly<GameState>, companyId: string, baseModelId: string): AdapterTrainingReceipt | undefined {
  if (validateAdapterTrainingOption(state, companyId, baseModelId, 'adaptation', true)) return;
  const base = state.slices.models.versions[baseModelId], rollout = adapterBankRollout(state, companyId)!;
  return { baseModelId: base.id, rolloutId: rollout.id, baseResidentMU: base.residentMU, adapterMemoryMU: RULES.adapterMemoryMU };
}

/** Called by saved-plan validation after the ordinary recipe and base checks. */
export function assertAdapterTrainingPlan(state: Readonly<GameState>, run: TrainingRun): void {
  const plan = run.plan;
  if (!plan) return;
  const receipt = plan.adapter;
  requireValue(plan.methods.includes(RULES.researchId) === !!receipt, 'Training changed its captured adapter method.');
  requireValue(!declaredAdapter(state, run.baseModelId), 'Training stacked another adapter onto an adapter base.');
  if (!receipt) return;
  requireValue(typeof receipt === 'object' && !Array.isArray(receipt) && Object.keys(receipt).sort().join(',') === 'adapterMemoryMU,baseModelId,baseResidentMU,rolloutId', 'Adapter training has an unknown or missing receipt field.');
  checkedInteger(receipt.baseResidentMU, 'Adapter base memory'); checkedInteger(receipt.adapterMemoryMU, 'Adapter resident memory');
  requireValue(!validateAdapterTrainingOption(state, run.companyId, run.baseModelId, plan.kind, true), 'Adapter training has no eligible original base and installed research method.');
  requireValue(same(receipt, getAdapterTrainingReceipt(state, run.companyId, run.baseModelId)), 'Adapter training changed its frozen base or memory requirement.');
  const rollout = adapterBankRollout(state, run.companyId)!;
  requireValue(rollout.readyWeek !== null && rollout.readyWeek <= run.startedWeek, 'Adapter training began before its bank was installed.');
  requireValue(plan.architecture === 'dense' && plan.family === state.slices.models.versions[run.baseModelId].family,
    'Adapter training changed its frozen base architecture or family.');
  requireValue(plan.residentMU === checkedAdd(receipt.baseResidentMU, receipt.adapterMemoryMU), 'Adapter training erased its base or adapter residency.');
}

/** Only a completed final candidate can join the serving bank. */
export function modelAdapterReceipt(state: Readonly<GameState>, modelId: string): AdapterTrainingReceipt | null {
  const model = state.slices.models.versions[modelId], run = model?.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId] : undefined;
  const receipt = run?.plan?.adapter;
  if (!model || model.runtimeVariant || !run || run.status !== 'complete' || run.outputModelId !== model.id || !receipt
    || run.companyId !== model.companyId || model.parentModelId !== receipt.baseModelId || model.architecture !== 'dense'
    || model.residentMU !== receipt.baseResidentMU + receipt.adapterMemoryMU) return null;
  const base = state.slices.models.versions[receipt.baseModelId], rollout = adapterBankRollout(state, model.companyId);
  if (!base || base.companyId !== model.companyId || base.architecture !== 'dense' || base.runtimeVariant || declaredAdapter(state, base.id)
    || run.baseModelId !== base.id || run.plan?.kind !== 'adaptation' || !run.plan.methods.includes(RULES.researchId)
    || base.residentMU !== receipt.baseResidentMU || receipt.adapterMemoryMU !== RULES.adapterMemoryMU
    || model.family !== base.family || !(state.slices.research.completedByCompany[model.companyId] ?? []).includes(RULES.researchId)
    || rollout?.id !== receipt.rolloutId || rollout.status !== 'active'
    || rollout.readyWeek === null || rollout.readyWeek > run.startedWeek) return null;
  return receipt;
}

/** Public products may share an exact adapter base; named/private/internal work stays isolated. */
export function adapterSharingSpec(state: Readonly<GameState>, productId: string, content: GameContent = CONTENT): SharedAdapterMemory | undefined {
  const product = state.slices.products.offers[productId];
  if (!product || product.status !== 'active' || adapterBankRollout(state, product.companyId)?.status !== 'active') return;
  const deployment = state.slices.products.deployments[product.deploymentId], model = state.slices.models.versions[deployment?.modelId];
  if (!model || deployment.status !== 'active' || model.companyId !== product.companyId || !hasCapabilityEvaluation(state, model.id)
    || !inheritedModelRights(state, model.id, content).hosted) return;
  const receipt = modelAdapterReceipt(state, model.id);
  if (!receipt) return;
  // A routed pair has its own ordinary resident-weight reservation. Do not mix
  // routing's secondary model, cache identity, or different formats into this bank.
  const routing = state.slices.products.efficiencyInstalls?.[product.id + ':routing'];
  if (routing?.status === 'active' && routing.enabled && routing.modelId === model.id) return;
  return { baseModelId: receipt.baseModelId, modelId: model.id, baseMemoryMU: receipt.baseResidentMU, adapterMemoryMU: receipt.adapterMemoryMU };
}

/** Validate the opt-in request before any allocator can claim reused residency. */
export function assertAdapterSharingRequest(state: Readonly<GameState>, request: WorkRequest, content: GameContent = CONTENT): void {
  const spec = request.sharedAdapterMemory;
  if (spec === undefined) return;
  requireValue(!!spec && typeof spec === 'object' && !Array.isArray(spec), 'Shared adapter memory must be a structured request.');
  requireValue(request.category === 'serving' && request.workloadKind === 'inference' && request.modelArchitecture === 'dense'
    && request.id === 'serve:' + request.taskId, 'Only public dense inference may request shared adapter residency.');
  const product = state.slices.products.offers[request.taskId], expected = adapterSharingSpec(state, request.taskId, content);
  requireValue(product && product.companyId === request.companyId && expected && same(spec, expected), 'Shared adapter residency lost its paid base, model, owner, or rollout.');
  requireValue(request.modelFamily === state.slices.models.versions[expected!.modelId].family, 'Shared adapter residency changed its model family.');
  requireValue(Object.keys(spec).sort().join(',') === 'adapterMemoryMU,baseMemoryMU,baseModelId,modelId', 'Shared adapter residency contains an unknown or missing field.');
  checkedInteger(spec.baseMemoryMU, 'Shared adapter base memory'); checkedInteger(spec.adapterMemoryMU, 'Shared adapter memory');
  requireValue(request.memoryMU >= checkedAdd(spec.baseMemoryMU, spec.adapterMemoryMU), 'Shared adapter residency omitted the full model workspace.');
}

export function sharedAdapterKeys(spec: SharedAdapterMemory): readonly string[] {
  return ['base:' + spec.baseModelId, 'adapter:' + spec.modelId];
}

/** Residents belong to one company and one actual pool, never the whole fleet. */
export function sharedAdapterReuse(request: WorkRequest, residents: ReadonlySet<string>): number {
  const spec = request.sharedAdapterMemory;
  if (!spec) return 0;
  const [baseKey, adapterKey] = sharedAdapterKeys(spec);
  return checkedAdd(residents.has(baseKey) ? spec.baseMemoryMU : 0, residents.has(adapterKey) ? spec.adapterMemoryMU : 0);
}

export function getAdapterBankView(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT) {
  const researched = (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.researchId), rollout = adapterBankRollout(state, companyId);
  const groups = new Map<string, AdapterBankGroupView>();
  for (const model of Object.values(state.slices.models.versions)) {
    if (model.companyId !== companyId) continue;
    const receipt = modelAdapterReceipt(state, model.id);
    if (!receipt) continue;
    const group: AdapterBankGroupView = groups.get(receipt.baseModelId) ?? { baseModelId: receipt.baseModelId, baseName: state.slices.models.versions[receipt.baseModelId].name,
      baseMemoryMU: receipt.baseResidentMU, adapters: [], activeModels: 0, activeProducts: 0, independentMemoryMU: 0, sharedMemoryMU: 0 };
    const activeProducts = Object.values(state.slices.products.offers).filter(product => product.companyId === companyId
      && adapterSharingSpec(state, product.id, content)?.modelId === model.id).map(product => product.name);
    const rights = inheritedModelRights(state, model.id, content);
    group.adapters.push({ id: model.id, name: model.name, evaluated: hasCapabilityEvaluation(state, model.id), ...rights, activeProducts });
    if (activeProducts.length) {
      group.activeModels++; group.activeProducts += activeProducts.length;
      group.independentMemoryMU = checkedAdd(group.independentMemoryMU, model.residentMU * activeProducts.length);
    }
    groups.set(receipt.baseModelId, group);
  }
  for (const group of groups.values()) group.sharedMemoryMU = group.activeModels ? checkedAdd(group.baseMemoryMU, group.activeModels * RULES.adapterMemoryMU) : 0;
  return { researched, rollout, available: researched && rollout?.status === 'active', groups: [...groups.values()].sort((a, b) => a.baseModelId.localeCompare(b.baseModelId)) };
}
