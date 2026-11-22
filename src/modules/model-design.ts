import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { GameState, ModelVersion, Rejection } from '../contracts/types';
import type { CapabilityScores } from '../contracts/wave2-lab';
import type { AdvancedScores } from '../contracts/advanced-skills';
import type { DesignDomain, ModelDesignSpec, ModelFamily } from '../contracts/model-design';
import type { ModelCustomizationReceipt } from '../contracts/model-customization';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from '../core/model-customization-version';
import { mulDiv } from '../core/math';
import { customizationHardwareMatches, customizationShapeRejection, customizationUnavailableReason, getCustomizationEffects, getCustomizationResearchIds } from './model-customization';
import { getModelFamilyGate, getModelResearchFocus, getModelResearchLevel, modelResearchBonusBps } from './model-research';

export const DESIGN_DOMAINS: readonly DesignDomain[] = ['conversation', 'documents', 'coding', 'tools', 'reasoning', 'longContext', 'multimodal'];
export const MODEL_DESIGN_FAMILIES: Record<ModelFamily, { name: string; minMillions: number; maxMillions: number; defaultMillions: number; defaultComputeCUw: number; description: string }> = {
  edge: { name: 'Edge', minMillions: 250, maxMillions: 2000, defaultMillions: 1000, defaultComputeCUw: 12 * U, description: 'Small footprint and inexpensive serving. Unlocked by architecture research level 1.' },
  compact: { name: 'Compact', minMillions: 1000, maxMillions: 8000, defaultMillions: 4000, defaultComputeCUw: 24 * U, description: 'An affordable starting point for focused skills and small deployments.' },
  medium: { name: 'Medium', minMillions: 8000, maxMillions: 32000, defaultMillions: 16000, defaultComputeCUw: 240 * U, description: 'More room for broad skills, with larger memory and data needs.' },
  large: { name: 'Large', minMillions: 32000, maxMillions: 100000, defaultMillions: 48000, defaultComputeCUw: 900 * U, description: 'High capacity for a well-funded lab with enough data and compute.' },
  frontier: { name: 'Frontier', minMillions: 100000, maxMillions: 500000, defaultMillions: 160000, defaultComputeCUw: 3200 * U, description: 'Research level 3 unlocks a new engineering tier beyond large models.' },
};
export const DEFAULT_MODEL_DESIGN: ModelDesignSpec = {
  name: 'My first model', mode: 'adaptation', family: 'compact', parameterMillions: 4000,
  sparsityBps: 0, computeBudgetCUw: 24 * U,
  dataMix: { conversation: 50, documents: 20, coding: 15, tools: 15, reasoning: 0, longContext: 0, multimodal: 0 },
};
const familyCeiling: Record<ModelFamily, number> = { edge: 6600, compact: 7600, medium: 8800, large: 9600, frontier: 9950 };
export const FAMILY_SERVING_MULTIPLIER: Record<ModelFamily, number> = { edge: 0.5, compact: 1, medium: 2, large: 4, frontier: 8 };

export function getModelDesignForBase(base: ModelVersion): ModelDesignSpec {
  const existing = base.modelDesign?.spec;
  const family = MODEL_DESIGN_FAMILIES[base.family];
  return { ...structuredClone(existing ?? DEFAULT_MODEL_DESIGN), name: base.name.slice(0, 30) + ' improved', mode: 'adaptation',
    family: base.family, parameterMillions: existing?.parameterMillions ?? family.defaultMillions,
    sparsityBps: existing?.sparsityBps ?? (base.architecture === 'sparse' ? 5000 : 0),
    computeBudgetCUw: existing?.computeBudgetCUw ?? family.defaultComputeCUw };
}
export function modelDesignShapeRejection(spec: unknown): Rejection | undefined {
  const invalid = (message: string): Rejection => ({ code: 'INVALID_COMMAND', message });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return invalid('Choose a model design.');
  const s = spec as ModelDesignSpec;
  const keys = ['computeBudgetCUw', 'dataMix', 'family', 'mode', 'name', 'parameterMillions', 'sparsityBps', ...(Object.hasOwn(s, 'customization') ? ['customization'] : [])];
  if (Object.keys(s).sort().join() !== keys.sort().join()) return invalid('The model design contains missing or unknown choices.');
  if (Object.hasOwn(s, 'customization')) { const problem = customizationShapeRejection(s.customization); if (problem) return problem; }
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(s.name)) return invalid('Name the model using 1–48 characters.');
  if (!['foundation', 'adaptation'].includes(s.mode) || !Object.hasOwn(MODEL_DESIGN_FAMILIES, s.family)) return invalid('Choose a supported model family and training mode.');
  const family = MODEL_DESIGN_FAMILIES[s.family];
  if (!Number.isSafeInteger(s.parameterMillions) || s.parameterMillions < family.minMillions || s.parameterMillions > family.maxMillions) return invalid(`Choose ${family.minMillions / 1000}–${family.maxMillions / 1000} billion parameters for ${family.name}.`);
  if (!Number.isSafeInteger(s.sparsityBps) || s.sparsityBps < 0 || s.sparsityBps > 8000) return invalid('Sparsity must be between 0% and 80%.');
  if (!Number.isSafeInteger(s.computeBudgetCUw) || s.computeBudgetCUw < U || s.computeBudgetCUw > 50000 * U) return invalid('Choose a training budget from 1 to 50,000 CUw.');
  if (!s.dataMix || typeof s.dataMix !== 'object' || Array.isArray(s.dataMix) || Object.keys(s.dataMix).sort().join() !== [...DESIGN_DOMAINS].sort().join()
    || Object.values(s.dataMix).some(value => !Number.isSafeInteger(value) || value < 0 || value > 100) || !Object.values(s.dataMix).some(value => value > 0)) return invalid('Allocate a 0–100 training weight to each skill, with at least one positive weight.');
}
function knownAt(state: Readonly<GameState>, companyId: string, id: string, atWeek: number): boolean {
  return (state.slices.research.completedByCompany[companyId] ?? []).includes(id)
    && Object.values(state.slices.research.projects).some(p => p.companyId === companyId && p.researchId === id && p.status === 'complete' && p.availableWeek! <= atWeek);
}
export function modelDesignRejection(state: Readonly<GameState>, companyId: string, baseModelId: string, spec: ModelDesignSpec, atWeek = state.week): Rejection | undefined {
  const shape = modelDesignShapeRejection(spec); if (shape) return shape;
  if (spec.customization && ![MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(state.contentVersion)) return { code: 'INVALID_COMMAND', message: 'These model customization choices require the current model-design version.' };
  const base = state.slices.models.versions[baseModelId];
  if (!base || base.companyId !== companyId || base.runtimeVariant) return { code: 'NOT_READY', message: 'Choose an owned trainable model as the starting point.' };
  if (spec.mode === 'adaptation') {
    const original = getModelDesignForBase(base);
    if (spec.family !== original.family || spec.parameterMillions !== original.parameterMillions || spec.sparsityBps !== original.sparsityBps) return { code: 'NOT_READY', message: 'Continued training keeps the starting model’s family, size and sparsity. Choose a new foundation to change its architecture.' };
    if ((original.customization && !spec.customization) || !customizationHardwareMatches(original.customization, spec.customization)) return { code: 'NOT_READY', message: 'Continued training keeps attention, context and precision from the starting model. Choose a new foundation to change its hardware design.' };
  } else {
    const gate = getModelFamilyGate(state, companyId, spec.family, atWeek);
    if (gate) return { code: 'NOT_READY', message: gate };
    if (['medium', 'large', 'frontier'].includes(spec.family) && !knownAt(state, companyId, 'R3', atWeek)) return { code: 'NOT_READY', message: 'Complete Checkpoint automation (R3) before designing a medium, large or frontier foundation.' };
  }
  if (spec.sparsityBps > 0 && !knownAt(state, companyId, 'R14', atWeek)) return { code: 'NOT_READY', message: 'Complete Sparse architecture research before using sparse custom models.' };
  if (spec.customization) { const reason = customizationUnavailableReason(state, companyId, spec.customization, atWeek); if (reason) return { code: 'NOT_READY', message: reason }; }
}
export interface ModelDesignForecast {
  targets: CapabilityScores; advancedTargets: AdvancedScores; ceilings: CapabilityScores; advancedCeilings: AdvancedScores;
  residentMU: number; requiredMemory: number; workCUw: number; feeCents: number; preparationStaff: number;
  servingWorkBps: number; researchLevel: number; frontierRating: number; requiredEvidence: number;
  researchFocus?: import('../contracts/model-research').ModelResearchFocusReceipt;
  customization?: ModelCustomizationReceipt;
  reliabilityTargetBps: number;
  notes: string[]; reason?: Rejection;
}
/** Fictional, deterministic design economy. No recipe selects these targets. */
export function getModelDesignForecast(state: Readonly<GameState>, companyId: string, baseModelId: string, packetIds: readonly string[], input: ModelDesignSpec, atWeek = state.week): ModelDesignForecast {
  const shape = modelDesignShapeRejection(input);
  const spec = shape ? DEFAULT_MODEL_DESIGN : input;
  const base = state.slices.models.versions[baseModelId];
  const family = MODEL_DESIGN_FAMILIES[spec.family], sizeB = spec.parameterMillions / 1000;
  const researchLevel = getModelResearchLevel(state, companyId, atWeek);
  const researchFocus = getModelResearchFocus(state, companyId, atWeek);
  const effects = spec.customization ? getCustomizationEffects(spec.customization) : undefined;
  const sparse = spec.sparsityBps / 10000;
  const researchBonus = researchFocus?.capacityBonusBps ?? modelResearchBonusBps(researchLevel);
  const capacity = Math.min(9950, familyCeiling[spec.family] + researchBonus);
  const totalWeight = Object.values(spec.dataMix).reduce((a, b) => a + b, 0);
  const researchEfficiency = researchFocus ? 1 - researchFocus.efficiencyBonusBps / 10000 : 1 - researchBonus / 20000;
  const reliabilityTargetBps = 9200 + (researchFocus?.reliabilityBonusBps ?? 0) + (effects?.reliabilityDeltaBps ?? 0);
  const computeRatio = spec.computeBudgetCUw / U / ((spec.mode === 'foundation' ? 10 : 3) * sizeB + 2) / (1 - sparse * 0.55) / researchEfficiency / ((effects?.computeIntensityBps ?? 10000) / 10000);
  const computeFit = Math.min(1, Math.log2(1 + computeRatio) / 2.5);
  const sizeFit = Math.min(1, 0.70 + 0.30 * Math.log2(1 + spec.parameterMillions / family.minMillions) / Math.log2(1 + family.maxMillions / family.minMillions));
  const ceiling = Math.round(capacity * sizeFit);
  const skillCeilings = Object.fromEntries(DESIGN_DOMAINS.map(domain => [domain, effects ? Math.min(9950, mulDiv(ceiling, effects.skillBps[domain], 10000, 'nearest')) : ceiling])) as Record<DesignDomain, number>;
  const skillTargets = Object.fromEntries(DESIGN_DOMAINS.map(domain => {
    const share = spec.dataMix[domain] / totalWeight;
    const focus = 0.58 + 0.42 * Math.min(1.2, Math.sqrt(share * 7));
    const domainCeiling = skillCeilings[domain];
    const target = Math.min(domainCeiling, Math.round(domainCeiling * (0.28 + 0.72 * computeFit) * focus * (1 - sparse * 0.08)));
    const prior = domain in (base?.capabilityBps ?? {}) ? base!.capabilityBps[domain as keyof CapabilityScores] : base?.advancedCapabilities?.[domain as keyof AdvancedScores] ?? 0;
    return [domain, share ? target : spec.mode === 'adaptation' ? prior : (domain === 'conversation' || domain === 'documents' ? 2000 : domain === 'coding' || domain === 'tools' ? 1000 : 0)];
  })) as Record<DesignDomain, number>;
  const targets: CapabilityScores = { conversation: skillTargets.conversation, documents: skillTargets.documents, coding: skillTargets.coding, tools: skillTargets.tools };
  const advancedTargets: AdvancedScores = { reasoning: skillTargets.reasoning, longContext: skillTargets.longContext, multimodal: skillTargets.multimodal };
  const ceilings: CapabilityScores = { conversation: Math.max(skillCeilings.conversation, targets.conversation), documents: Math.max(skillCeilings.documents, targets.documents), coding: Math.max(skillCeilings.coding, targets.coding), tools: Math.max(skillCeilings.tools, targets.tools) };
  const advancedCeilings: AdvancedScores = { reasoning: Math.max(skillCeilings.reasoning, advancedTargets.reasoning), longContext: Math.max(skillCeilings.longContext, advancedTargets.longContext), multimodal: Math.max(skillCeilings.multimodal, advancedTargets.multimodal) };
  const foundationMemory = Math.ceil(sizeB / 2 * U * (1 + sparse * 0.25));
  const residentMU = spec.mode === 'adaptation' && base ? base.residentMU : effects ? mulDiv(foundationMemory, effects.residentMemoryBps, 10000, 'ceil') : foundationMemory;
  const requiredMemory = mulDiv(residentMU * (spec.mode === 'foundation' ? 3 : 2), effects?.workspaceMemoryBps ?? 10000, 10000, 'ceil');
  const originalServingWorkBps = spec.mode === 'adaptation' && base?.modelDesign ? base.modelDesign.servingWorkBps
    : spec.mode === 'adaptation' && base ? (base.architecture === 'sparse' ? 6500 : 10000)
      : Math.max(500, Math.round(spec.parameterMillions / family.defaultMillions * 10000 * (1 - sparse * 0.75) * researchEfficiency));
  const hardwareServingWorkBps = effects ? spec.mode === 'adaptation' && base
    ? base.modelDesign?.customization?.hardwareServingWorkBps ?? originalServingWorkBps
    : Math.max(500, mulDiv(originalServingWorkBps, effects.hardwareServingBps, 10000, 'nearest')) : originalServingWorkBps;
  const servingWorkBps = effects ? Math.max(500, mulDiv(hardwareServingWorkBps, effects.runtimeServingBps, 10000, 'nearest')) : originalServingWorkBps;
  const requiredEvidence = Math.ceil(Math.ceil(65 + Math.sqrt(sizeB) * (spec.mode === 'foundation' ? 35 : 15)) * (effects?.evidenceBps ?? 10000) / 10000) * U;
  const frontierRating = Math.round(100 * Math.log2(1 + sizeB) + 100 * Math.log2(1 + computeRatio) + 20 * researchLevel);
  const feeCents = mulDiv(Math.round((spec.mode === 'foundation' ? 50000 + sizeB * 15000 : 15000 + sizeB * 2000) * (1 + sparse * 0.2)), effects?.setupFeeBps ?? 10000, 10000, 'nearest');
  const preparationStaff = spec.mode === 'foundation' ? Math.ceil(0.5 + sizeB / 8) * U : 0;
  const notes = [
    'Size, active parameters, compute and the relative data weights calculate the targets. Prepared evidence and data quality determine how much of that potential is earned.',
    'Training uses the entire chosen compute budget. Larger budgets have diminishing returns; a higher score is never awarded before the work finishes.',
    `Architecture research level ${researchLevel} contributes ${researchBonus / 100} points of capacity and ${(100 * (1 - researchEfficiency)).toFixed(1)}% engineering efficiency. This level is frozen for the run.`,
    'The capacity index can exceed 100. Skill scores are percentages on a fixed benchmark; the index describes engineering scale, not a test result.',
  ];
  if (researchFocus) notes.push(`Your paid research focus history sets these gains and a ${reliabilityTargetBps / 100}% training reliability target. It is frozen at admission; later discoveries do not change this design.`);
  if (effects) notes.push(`Your saved model profile changes skill ceilings, evidence and resource costs. The entire ${spec.computeBudgetCUw / U} CUw budget is still paid; training intensity changes what that work can achieve. Attention, context and precision are fixed when the foundation is built.`);
  if (spec.customization && spec.customization.behavior !== 'balanced') notes.push('Behavior changes need at least 100 reviewed cases. Checkpoints earn a fraction of the change; repeating or renaming a plan does not compound it. Existing policy refusal limits are preserved.');
  if (sparse) notes.push('Sparsity lowers active compute at a small capability cost and extra memory overhead. Compatible fast fabric is still required.');
  if (!packetIds.length) notes.push('Select prepared datasets. A data-mix weight cannot create examples that are missing from your corpus.');
  return { targets, advancedTargets, ceilings, advancedCeilings, residentMU, requiredMemory, workCUw: spec.computeBudgetCUw,
    feeCents, preparationStaff, servingWorkBps, researchLevel, frontierRating, requiredEvidence, reliabilityTargetBps, ...(researchFocus ? { researchFocus } : {}),
    ...(effects && spec.customization ? { customization: { version: 1 as const, choices: structuredClone(spec.customization), researchIds: getCustomizationResearchIds(spec.customization), effects, hardwareServingWorkBps } } : {}), notes,
    ...(shape ?? modelDesignRejection(state, companyId, baseModelId, spec, atWeek) ? { reason: shape ?? modelDesignRejection(state, companyId, baseModelId, spec, atWeek) } : {}) };
}
