import type { GameState, Rejection, TrainingRun } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { ModelBehavior } from '../contracts/wave2-lab';
import type { CustomizationBehaviorTraining, ModelCustomization, ModelCustomizationEffects, ModelCustomizationField } from '../contracts/model-customization';
import { DEFAULT_MODEL_CUSTOMIZATION, MODEL_CUSTOMIZATION_OPTIONS } from '../content/model-customization';
import { mulDiv } from '../core/math';
import { finiteOutcome } from './lab-math';

const fields = ['attention', 'contextWindow', 'precision', 'objective', 'behavior'] as const;
const domains = ['conversation', 'documents', 'coding', 'tools', 'reasoning', 'longContext', 'multimodal'] as const;
export function customizationShapeRejection(value: unknown): Rejection | undefined {
  const invalid = (): Rejection => ({ code: 'INVALID_COMMAND', message: 'Choose supported attention, context, precision, objective and behavior options.' });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const choices = value as ModelCustomization;
  if (Object.keys(choices).sort().join() !== 'attention,behavior,contextWindow,objective,precision,version' || choices.version !== 1
    || fields.some(field => !MODEL_CUSTOMIZATION_OPTIONS[field].some(option => option.value === choices[field]))) return invalid();
}
export function isDefaultModelCustomization(choices: ModelCustomization): boolean {
  return fields.every(field => choices[field] === DEFAULT_MODEL_CUSTOMIZATION[field]);
}
export function getCustomizationResearchIds(choices: ModelCustomization): string[] {
  return fields.flatMap(field => MODEL_CUSTOMIZATION_OPTIONS[field].find(option => option.value === choices[field])?.requiredResearch ?? []).sort();
}
export function customizationUnavailableReason(state: Readonly<GameState>, companyId: string, choices: ModelCustomization, atWeek = state.week): string | undefined {
  const malformed = customizationShapeRejection(choices); if (malformed) return malformed.message;
  const missing = getCustomizationResearchIds(choices).filter(id => !(state.slices.research.completedByCompany[companyId] ?? []).includes(id)
    || !Object.values(state.slices.research.projects).some(project => project.companyId === companyId && project.researchId === id && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek));
  if (missing.length) return 'Complete ' + missing.join(', ') + ' before using these model choices.';
}
export function getCustomizationEffects(choices: ModelCustomization): ModelCustomizationEffects {
  const result: ModelCustomizationEffects = {
    skillBps: Object.fromEntries(domains.map(domain => [domain, 10000])) as ModelCustomizationEffects['skillBps'],
    computeIntensityBps: 10000, residentMemoryBps: 10000, workspaceMemoryBps: 10000,
    hardwareServingBps: 10000, runtimeServingBps: 10000, evidenceBps: 10000, setupFeeBps: 10000, reliabilityDeltaBps: 0,
  };
  for (const field of fields) {
    const option = MODEL_CUSTOMIZATION_OPTIONS[field].find(item => item.value === choices[field]);
    if (!option) continue;
    const effect = option.effects;
    for (const domain of domains) result.skillBps[domain] = mulDiv(result.skillBps[domain], effect.skillBps?.[domain] ?? 10000, 10000, 'nearest');
    for (const key of ['computeIntensityBps', 'residentMemoryBps', 'workspaceMemoryBps', 'hardwareServingBps', 'runtimeServingBps', 'evidenceBps', 'setupFeeBps'] as const)
      result[key] = mulDiv(result[key], effect[key] ?? 10000, 10000, 'nearest');
    result.reliabilityDeltaBps += effect.reliabilityDeltaBps ?? 0;
  }
  return result;
}
export function customizationHardwareMatches(left: ModelCustomization | undefined, right: ModelCustomization | undefined): boolean {
  const a = left ?? DEFAULT_MODEL_CUSTOMIZATION, b = right ?? DEFAULT_MODEL_CUSTOMIZATION;
  return (['attention', 'contextWindow', 'precision'] as ModelCustomizationField[]).every(field => a[field] === b[field]);
}
export function buildCustomizationBehaviorTraining(choices: ModelCustomization, anchor: ModelBehavior, initial: ModelBehavior, policyFalseRefusalFloor = 0): CustomizationBehaviorTraining | undefined {
  if (choices.behavior === 'balanced') return;
  const careful = choices.behavior === 'careful';
  return { initial: structuredClone(initial), anchor: structuredClone(anchor), requiredEvidence: 100 * U, falseRefusalFloorBps: policyFalseRefusalFloor,
    target: { confidentErrorBps: Math.min(10000, mulDiv(anchor.confidentErrorBps, careful ? 4000 : 15000, 10000, 'nearest')),
      falseRefusalBps: Math.max(policyFalseRefusalFloor, Math.min(10000, mulDiv(anchor.falseRefusalBps, careful ? 16000 : 4500, 10000, 'nearest'))) } };
}
/** New behavior is earned with the same paid work and reviewed cases as the run. */
export function customizationBehaviorOutcome(run: TrainingRun, work: number): ModelBehavior | undefined {
  if (run.recipeId !== 'custom-model-foundation' && run.recipeId !== 'custom-model-adaptation') return;
  const receipt = run.plan?.modelDesign?.customization?.behaviorTraining;
  if (!receipt || !run.plan) return;
  const result = {} as ModelBehavior;
  for (const key of ['confidentErrorBps', 'falseRefusalBps'] as const) {
    const attainable = Math.max(key === 'falseRefusalBps' ? receipt.falseRefusalFloorBps : 0, finiteOutcome({ anchorBps: receipt.anchor[key], targetBps: receipt.target[key], completedWork: run.requiredWork,
      requiredWork: run.requiredWork, relevantEvidence: run.plan.corpus.behaviorUnits * U, requiredEvidence: receipt.requiredEvidence,
      qualityBps: run.plan.corpus.behaviorQualityBps }));
    const change = mulDiv(Math.abs(attainable - receipt.initial[key]), Math.min(work, run.requiredWork), run.requiredWork, 'nearest');
    result[key] = receipt.initial[key] + (attainable >= receipt.initial[key] ? change : -change);
  }
  return result;
}
