import type { CapabilityScores } from './wave2-lab';
import type { AdvancedDomain, AdvancedScores } from './advanced-skills';
import type { ModelCustomization, ModelCustomizationReceipt } from './model-customization';

export type ModelFamily = 'edge' | 'compact' | 'medium' | 'large' | 'frontier';
export type DesignDomain = keyof CapabilityScores | AdvancedDomain;
export interface ModelDesignSpec {
  name: string;
  mode: 'foundation' | 'adaptation';
  family: ModelFamily;
  parameterMillions: number;
  sparsityBps: number;
  computeBudgetCUw: number;
  dataMix: Record<DesignDomain, number>;
  customization?: ModelCustomization;
  system?: import('./ai-systems').AISystemSpec;
}
/** Immutable engineering choices and research available when the run began. */
export interface ModelDesignReceipt {
  spec: ModelDesignSpec;
  researchLevel: number;
  researchFocus?: import('./model-research').ModelResearchFocusReceipt;
  customization?: ModelCustomizationReceipt;
  system?: import('./ai-systems').AISystemReceipt;
  frontierRating: number;
  servingWorkBps: number;
  requiredEvidence: number;
  ceilings: CapabilityScores;
  advancedCeilings: AdvancedScores;
}
export const MODEL_DESIGN_CONTENT_VERSION = '0.33.0';
export const CUSTOM_MODEL_RECIPES = ['custom-model-foundation', 'custom-model-adaptation'] as const;
