import type { AISystemEffects, AISystemMetrics, AISystemModel, AISystemReceipt, AISystemSpec } from '../contracts/ai-systems';
import type { DesignDomain } from '../contracts/model-design';
import type { GameState, Rejection } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { mulDiv } from '../core/math';

const domains: readonly DesignDomain[] = ['conversation', 'documents', 'coding', 'tools', 'reasoning', 'longContext', 'multimodal'];
const clamp = (value: number, ceiling = 9950): number => Math.max(0, Math.min(ceiling, Math.round(value)));
const sameKeys = (value: object, keys: readonly string[]): boolean => Object.keys(value).sort().join() === [...keys, 'version', 'kind'].sort().join();

export function aiSystemShapeRejection(value: unknown): Rejection | undefined {
  const invalid = (): Rejection => ({ code: 'INVALID_COMMAND', message: 'Choose a supported AI system and its versioned operating controls.' });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const spec = value as AISystemSpec;
  if (spec.version !== 1) return invalid();
  if (spec.kind === 'experts') {
    if (!sameKeys(spec, ['experts', 'activeExperts', 'routing', 'specialization']) || ![4, 8, 16].includes(spec.experts)
      || ![1, 2, 4].includes(spec.activeExperts) || spec.activeExperts > spec.experts || !['uniform', 'learned', 'balanced'].includes(spec.routing)
      || !domains.includes(spec.specialization)) return invalid();
  } else if (spec.kind === 'stateful') {
    if (!sameKeys(spec, ['stateSlots', 'memory', 'repair']) || ![16, 64, 256].includes(spec.stateSlots)
      || !['fixed', 'compressed', 'selective'].includes(spec.memory) || typeof spec.repair !== 'boolean') return invalid();
  } else if (spec.kind === 'adaptive') {
    if (!sameKeys(spec, ['maxPasses', 'search', 'verifier', 'stopping']) || ![2, 4, 8].includes(spec.maxPasses)
      || !['single', 'branching'].includes(spec.search) || !['self', 'independent'].includes(spec.verifier)
      || !['fixed', 'confidence'].includes(spec.stopping)) return invalid();
  } else return invalid();
}

export function getAISystemResearchIds(spec: AISystemSpec): string[] {
  if (spec.kind === 'experts') return ['A1', ...(spec.routing !== 'uniform' ? ['A2'] : []), ...(spec.routing === 'balanced' ? ['A3'] : []),
    ...(spec.experts > 4 || spec.activeExperts > 2 ? ['A4'] : [])];
  if (spec.kind === 'stateful') return ['A5', ...(spec.memory !== 'fixed' || spec.stateSlots > 16 ? ['A6'] : []),
    ...(spec.memory === 'selective' || spec.stateSlots > 64 ? ['A7'] : []), ...(spec.repair ? ['A8'] : [])];
  return ['A9', ...(spec.search === 'branching' || spec.maxPasses > 2 ? ['A10'] : []),
    ...(spec.verifier === 'independent' ? ['A11'] : []), ...(spec.stopping === 'confidence' ? ['A12'] : [])];
}
export function aiSystemUnavailableReason(state: Readonly<GameState>, companyId: string, spec: AISystemSpec, atWeek = state.week): string | undefined {
  const malformed = aiSystemShapeRejection(spec); if (malformed) return malformed.message;
  const missing = getAISystemResearchIds(spec).filter(id => !(state.slices.research.completedByCompany[companyId] ?? []).includes(id)
    || !Object.values(state.slices.research.projects).some(project => project.companyId === companyId && project.researchId === id
      && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek));
  if (missing.length) return 'Complete ' + missing.join(', ') + ' before building this AI system.';
}

/** Version 1 is an authored game model, permanently retained for paid receipts. */
export function getAISystemEffects(spec: AISystemSpec): AISystemEffects {
  const effects: AISystemEffects = {
    skillBps: Object.fromEntries(domains.map(domain => [domain, 10000])) as Record<DesignDomain, number>,
    computeIntensityBps: 10000, residentMemoryBps: 10000, workspaceMemoryBps: 10000, servingWorkBps: 10000,
    evidenceBps: 10000, setupFeeBps: 10000, reliabilityDeltaBps: 0, sessionMemoryMU: 0,
    latencyBps: 10000, activeParameterBps: 10000, routingQualityBps: 10000, stateCapacity: 0,
  };
  if (spec.kind === 'experts') {
    const bankSteps = Math.log2(spec.experts / 4);
    const routeCost = spec.routing === 'uniform' ? 12500 + bankSteps * 800 : spec.routing === 'learned' ? 11000 + bankSteps * 300 : 10000 + bankSteps * 50;
    effects.activeParameterBps = Math.round(2500 + 7500 * spec.activeExperts / spec.experts);
    effects.servingWorkBps = mulDiv(effects.activeParameterBps, routeCost, 10000, 'nearest') + 700;
    effects.computeIntensityBps = 10000 + spec.experts * 220 + spec.activeExperts * 400;
    effects.residentMemoryBps = 10000 + spec.experts * 100;
    effects.workspaceMemoryBps = 10500 + spec.activeExperts * 250 + spec.experts * 50;
    effects.evidenceBps = 10000 + spec.experts * 350;
    effects.setupFeeBps = 12000 + spec.experts * 500;
    effects.reliabilityDeltaBps = spec.routing === 'uniform' ? -200 - bankSteps * 100 : spec.routing === 'learned' ? -75 : 0;
    effects.routingQualityBps = clamp(spec.routing === 'uniform' ? 6500 + spec.activeExperts * 450 - spec.experts * 80
      : spec.routing === 'learned' ? 8000 + spec.activeExperts * 300 - spec.experts * 30 : 9000 + spec.activeExperts * 180 - spec.experts * 10);
    for (const domain of domains) effects.skillBps[domain] = domain === spec.specialization ? 10800 + bankSteps * 400 : 9000 + spec.activeExperts * 150;
    effects.sessionMemoryMU = spec.activeExperts * 2_000_000;
    effects.latencyBps = Math.round(8000 + routeCost / 5 + spec.activeExperts * 450);
  } else if (spec.kind === 'stateful') {
    const compression = spec.memory === 'compressed' ? 5500 : spec.memory === 'selective' ? 7000 : 10000;
    effects.computeIntensityBps = (spec.memory === 'fixed' ? 11000 : spec.memory === 'compressed' ? 12500 : 15000) + (spec.repair ? 1000 : 0);
    effects.residentMemoryBps = 8500;
    effects.workspaceMemoryBps = 9000 + spec.stateSlots * 6;
    effects.servingWorkBps = mulDiv(8500 + spec.stateSlots * 10, spec.memory === 'fixed' ? 10000 : 9000, 10000, 'nearest') + (spec.repair ? 1800 : 0);
    effects.evidenceBps = 11000 + spec.stateSlots * 10 + (spec.repair ? 1000 : 0);
    effects.setupFeeBps = 12000 + spec.stateSlots * 15 + (spec.repair ? 2000 : 0);
    effects.reliabilityDeltaBps = spec.repair ? 200 : -150;
    effects.skillBps = { conversation: 9300, documents: 9800, coding: 8950, tools: 9000, reasoning: 8800, longContext: 10600, multimodal: 8800 };
    effects.sessionMemoryMU = mulDiv(spec.stateSlots * 1_000_000, compression, 10000, 'ceil');
    effects.stateCapacity = spec.stateSlots * (spec.memory === 'selective' ? 1.5 : 1);
    effects.latencyBps = 7800 + spec.stateSlots * 4 + (spec.repair ? 1200 : 0);
  } else {
    const passes = spec.stopping === 'confidence' ? 1 + (spec.maxPasses - 1) / 2 : spec.maxPasses;
    effects.computeIntensityBps = 13000 + spec.maxPasses * 600 + (spec.search === 'branching' ? 1800 : 0) + (spec.verifier === 'independent' ? 2400 : 0);
    effects.residentMemoryBps = spec.verifier === 'independent' ? 13500 : 10500;
    effects.workspaceMemoryBps = 11000 + spec.maxPasses * 500;
    effects.servingWorkBps = 10000 + (passes - 1) * 5500 + (spec.verifier === 'independent' ? 4500 : 1800) + (spec.search === 'branching' ? 2000 : 0);
    effects.evidenceBps = 12000 + spec.maxPasses * 600 + (spec.verifier === 'independent' ? 3500 : 0);
    effects.setupFeeBps = 14000 + spec.maxPasses * 700 + (spec.verifier === 'independent' ? 5000 : 0);
    effects.reliabilityDeltaBps = (spec.verifier === 'independent' ? 100 : 0) - (spec.search === 'branching' ? 100 : 0);
    effects.skillBps = { conversation: 9200, documents: 9200, coding: 10200, tools: 10400, reasoning: 11000, longContext: 9500, multimodal: 8800 };
    effects.sessionMemoryMU = spec.maxPasses * (spec.search === 'branching' ? 5_000_000 : 2_500_000);
    effects.latencyBps = 10000 + (passes - 1) * 7000 + (spec.verifier === 'independent' ? 3500 : 1000) + (spec.search === 'branching' ? 2500 : 0);
  }
  return effects;
}
export function createAISystemReceipt(spec: AISystemSpec): AISystemReceipt {
  return { version: 1, spec: structuredClone(spec), researchIds: getAISystemResearchIds(spec), effects: getAISystemEffects(spec) };
}
/** Extra account state is charged in ordinary serving as well as systems challenges. */
export function aiSystemSessionMemory(model: Pick<AISystemModel, 'modelDesign'>): number { return model.modelDesign?.system?.effects.sessionMemoryMU ?? 0; }

/** Independent constraints use earned capabilities and paid operating choices, never a model name. */
export function getAISystemMetrics(model: AISystemModel): AISystemMetrics {
  const receipt = model.modelDesign?.system, spec = receipt?.spec, effects = receipt?.effects;
  const advanced = model.advancedCapabilities ?? { reasoning: 0, longContext: 0, multimodal: 0 };
  const quality = mulDiv(model.capabilityBps.documents, 3000, 10000) + mulDiv(advanced.longContext, 7000, 10000);
  const reasoning = mulDiv(advanced.reasoning, 4500, 10000) + mulDiv(model.capabilityBps.tools, 3500, 10000) + mulDiv(model.capabilityBps.coding, 2000, 10000);
  const baseCompletion = mulDiv(reasoning, model.reliabilityBps, 10000);
  let retentionBps = mulDiv(quality, 5000, 10000), verifiedCompletionBps = baseCompletion;
  if (spec?.kind === 'stateful') {
    const capacityFit = 2500 + Math.round(7500 * Math.min(1, (effects?.stateCapacity ?? 0) / 128));
    retentionBps = mulDiv(quality, capacityFit, 10000);
    retentionBps = mulDiv(retentionBps, spec.memory === 'compressed' ? 9000 : spec.memory === 'selective' ? 9800 : 10000, 10000);
    retentionBps = mulDiv(retentionBps, spec.repair ? 11200 : 10000, 10000);
  } else if (spec?.kind === 'adaptive') {
    const effort = (spec.maxPasses === 2 ? 1000 : spec.maxPasses === 4 ? 2500 : 4000)
      + (spec.search === 'branching' ? 1500 : 0) + (spec.verifier === 'independent' ? 1000 : 0) - (spec.stopping === 'confidence' ? 600 : 0);
    const recovered = mulDiv(mulDiv(9950 - baseCompletion, effort, 10000), advanced.reasoning, 10000);
    verifiedCompletionBps = Math.min(model.reliabilityBps, baseCompletion + recovered);
  } else if (spec?.kind === 'experts') verifiedCompletionBps = mulDiv(baseCompletion, effects?.routingQualityBps ?? 10000, 10000);
  const family = { edge: 0.5, compact: 1, medium: 2, large: 4, frontier: 8 }[model.family];
  const workBps = mulDiv(model.modelDesign?.servingWorkBps ?? (model.architecture === 'sparse' ? 6500 : 10000), model.runtimeVariant?.servingWorkBps ?? 10000, 10000);
  const standardRequest = mulDiv(200_000 * family, workBps, 10000);
  const size = model.modelDesign?.spec.parameterMillions ?? { edge: 1000, compact: 4000, medium: 16000, large: 48000, frontier: 160000 }[model.family];
  return { kind: spec?.kind ?? 'standard', servingCUwPer1000: standardRequest * 1000 / U,
    residentMU: model.residentMU, sessionMemoryMU: 20_000_000 + aiSystemSessionMemory(model), retentionBps: clamp(retentionBps),
    verifiedCompletionBps: clamp(verifiedCompletionBps), latencyBps: effects?.latencyBps ?? 10000,
    routingQualityBps: effects?.routingQualityBps ?? 10000, activeParameterMillions: mulDiv(size, effects?.activeParameterBps ?? 10000, 10000, 'nearest'),
    stateCapacity: effects?.stateCapacity ?? 0 };
}
