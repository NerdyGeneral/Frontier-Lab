import type { DesignDomain } from './model-design';
import type { ModelBehavior } from './wave2-lab';

/** Explicit choices for new plans. Absence keeps the historical design protocol. */
export interface ModelCustomization {
  version: 1;
  attention: 'standard' | 'grouped-query' | 'sliding-window' | 'hybrid';
  contextWindow: 'standard' | 'extended' | 'ultra';
  precision: 'full' | 'int8' | 'int4';
  objective: 'generalist' | 'reasoning' | 'agentic' | 'grounded' | 'multimodal';
  behavior: 'balanced' | 'careful' | 'expressive';
}
export type ModelCustomizationField = Exclude<keyof ModelCustomization, 'version'>;
export interface ModelCustomizationEffects {
  skillBps: Record<DesignDomain, number>;
  computeIntensityBps: number;
  residentMemoryBps: number;
  workspaceMemoryBps: number;
  hardwareServingBps: number;
  runtimeServingBps: number;
  evidenceBps: number;
  setupFeeBps: number;
  reliabilityDeltaBps: number;
}
/** Absolute lineage targets prevent switching styles from compounding gains. */
export interface CustomizationBehaviorTraining {
  initial: ModelBehavior;
  anchor: ModelBehavior;
  target: ModelBehavior;
  requiredEvidence: number;
  falseRefusalFloorBps: number;
}
export interface ModelCustomizationReceipt {
  version: 1;
  choices: ModelCustomization;
  researchIds: string[];
  effects: ModelCustomizationEffects;
  /** Architecture cost before the changeable training objective is applied. */
  hardwareServingWorkBps: number;
  behaviorTraining?: CustomizationBehaviorTraining;
}
