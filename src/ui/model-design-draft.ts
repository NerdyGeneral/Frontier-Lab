import { RESOURCE_SCALE as U, type ModelVersion } from '../contracts/types';
import type { ModelDesignSpec } from '../contracts/model-design';
import type { ModelCustomization } from '../contracts/model-customization';
import { DEFAULT_MODEL_CUSTOMIZATION, MODEL_CUSTOMIZATION_OPTIONS } from '../content/model-customization';
import { AI_SYSTEM_DEFAULTS } from '../content/ai-systems';
import { MODEL_DESIGN_FAMILIES, getModelDesignForBase } from '../modules/model-design';

export const MODEL_CUSTOMIZATION_KEYS = ['attention', 'contextWindow', 'precision', 'objective', 'behavior'] as const;
export type ModelCustomizationKey = typeof MODEL_CUSTOMIZATION_KEYS[number];
export const MODEL_HARDWARE_KEYS = ['attention', 'contextWindow', 'precision'] as const;

export interface ModelDesignPurpose {
  id: 'balanced' | 'support' | 'coding' | 'analyst' | 'visual';
  name: string;
  description: string;
  dataMix: ModelDesignSpec['dataMix'];
  customization: ModelCustomization;
  budgetMultiplier: number;
}

/** Editable starting points. The ordinary planner calculates every outcome. */
export const MODEL_DESIGN_PURPOSES: readonly ModelDesignPurpose[] = [
  { id: 'balanced', name: 'Balanced', description: 'Everyday dialogue and useful all-round skills.',
    dataMix: { conversation: 30, documents: 25, coding: 20, tools: 15, reasoning: 5, longContext: 5, multimodal: 0 },
    customization: { ...DEFAULT_MODEL_CUSTOMIZATION }, budgetMultiplier: 1 },
  { id: 'support', name: 'Customer support', description: 'Grounded answers and cautious responses to customer questions.',
    dataMix: { conversation: 40, documents: 30, coding: 0, tools: 15, reasoning: 5, longContext: 10, multimodal: 0 },
    customization: { version: 1, attention: 'grouped-query', contextWindow: 'standard', precision: 'int8', objective: 'grounded', behavior: 'careful' }, budgetMultiplier: 1 },
  { id: 'coding', name: 'Coding partner', description: 'Code and tools for practical workflows.',
    dataMix: { conversation: 10, documents: 10, coding: 35, tools: 25, reasoning: 15, longContext: 5, multimodal: 0 },
    customization: { version: 1, attention: 'grouped-query', contextWindow: 'extended', precision: 'full', objective: 'agentic', behavior: 'balanced' }, budgetMultiplier: 1.5 },
  { id: 'analyst', name: 'Research analyst', description: 'Reasoning over long documents, with cautious answers.',
    dataMix: { conversation: 10, documents: 25, coding: 5, tools: 5, reasoning: 35, longContext: 20, multimodal: 0 },
    customization: { version: 1, attention: 'hybrid', contextWindow: 'ultra', precision: 'full', objective: 'reasoning', behavior: 'careful' }, budgetMultiplier: 2 },
  { id: 'visual', name: 'Visual assistant', description: 'Image understanding alongside text and documents.',
    dataMix: { conversation: 15, documents: 10, coding: 0, tools: 5, reasoning: 15, longContext: 15, multimodal: 40 },
    customization: { version: 1, attention: 'standard', contextWindow: 'extended', precision: 'full', objective: 'multimodal', behavior: 'balanced' }, budgetMultiplier: 1.5 },
];

/** Rebase only the immutable architecture, keeping the player's paid-training
 * choices, name, priorities and budget. A new foundation is independent. */
export function inheritModelDesignDraft(draft: ModelDesignSpec, base: ModelVersion): ModelDesignSpec {
  const result = structuredClone(draft);
  if (draft.mode === 'foundation') return result;
  const inherited = getModelDesignForBase(base);
  result.family = inherited.family;
  result.parameterMillions = inherited.parameterMillions;
  result.sparsityBps = inherited.sparsityBps;
  if (inherited.system) result.system = structuredClone(inherited.system);
  else delete result.system;
  if (draft.customization || inherited.customization) {
    const hardware = inherited.customization ?? DEFAULT_MODEL_CUSTOMIZATION;
    result.customization = { ...(draft.customization ?? hardware),
      attention: hardware.attention, contextWindow: hardware.contextWindow, precision: hardware.precision };
  }
  return result;
}

export function applyModelDesignPurpose(draft: ModelDesignSpec, purpose: ModelDesignPurpose, base?: ModelVersion): ModelDesignSpec {
  const next: ModelDesignSpec = { ...structuredClone(draft), dataMix: { ...purpose.dataMix }, customization: { ...purpose.customization },
    computeBudgetCUw: Math.min(50000 * U, Math.max(U, Math.round(MODEL_DESIGN_FAMILIES[draft.family].defaultComputeCUw / U * purpose.budgetMultiplier) * U)) };
  return base ? inheritModelDesignDraft(next, base) : next;
}

/** Research navigation changes the retained draft, never an existing model.
 * An architecture invention starts a foundation; training choices can adapt. */
export function applyModelDesignResearch(draft: ModelDesignSpec, researchId: string): ModelDesignSpec | null {
  const number = /^A([1-9]|1[0-2])$/.exec(researchId)?.[1];
  if (number) {
    const level = Number(number);
    const system = structuredClone(level <= 4 ? AI_SYSTEM_DEFAULTS.experts : level <= 8 ? AI_SYSTEM_DEFAULTS.stateful : AI_SYSTEM_DEFAULTS.adaptive);
    if (system.kind === 'experts') {
      if (level >= 2) system.routing = 'learned';
      if (level >= 3) system.routing = 'balanced';
      if (level >= 4) system.experts = 8;
    } else if (system.kind === 'stateful') {
      if (level >= 6) { system.memory = 'compressed'; system.stateSlots = 64; }
      if (level >= 7) { system.memory = 'selective'; system.stateSlots = 256; }
      if (level >= 8) system.repair = true;
    } else {
      if (level >= 10) { system.maxPasses = 4; system.search = 'branching'; }
      if (level >= 11) system.verifier = 'independent';
      if (level >= 12) system.stopping = 'confidence';
    }
    return { ...structuredClone(draft), mode: 'foundation', system, ...(system.kind === 'experts' ? { sparsityBps: 0 } : {}) };
  }
  for (const key of MODEL_CUSTOMIZATION_KEYS) {
    const option = MODEL_CUSTOMIZATION_OPTIONS[key].find(item => item.requiredResearch === researchId);
    if (!option) continue;
    const customization = { ...DEFAULT_MODEL_CUSTOMIZATION, ...draft.customization, [key]: option.value };
    return { ...structuredClone(draft),
      mode: (MODEL_HARDWARE_KEYS as readonly string[]).includes(key) ? 'foundation' : draft.mode,
      customization };
  }
  return null;
}

export function customizationOptionName(key: ModelCustomizationKey, value: string): string {
  return MODEL_CUSTOMIZATION_OPTIONS[key].find(option => option.value === value)?.name ?? value;
}
