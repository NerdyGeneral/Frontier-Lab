import type { DesignDomain } from './model-design';
import type { ModelVersion } from './types';

/** Versioned operating choices. Absence means the original single-model protocol. */
export type AISystemSpec =
  | { version: 1; kind: 'experts'; experts: 4 | 8 | 16; activeExperts: 1 | 2 | 4; routing: 'uniform' | 'learned' | 'balanced'; specialization: DesignDomain }
  | { version: 1; kind: 'stateful'; stateSlots: 16 | 64 | 256; memory: 'fixed' | 'compressed' | 'selective'; repair: boolean }
  | { version: 1; kind: 'adaptive'; maxPasses: 2 | 4 | 8; search: 'single' | 'branching'; verifier: 'self' | 'independent'; stopping: 'fixed' | 'confidence' };
export type AISystemKind = AISystemSpec['kind'];

export interface AISystemEffects {
  skillBps: Record<DesignDomain, number>;
  computeIntensityBps: number;
  residentMemoryBps: number;
  workspaceMemoryBps: number;
  servingWorkBps: number;
  evidenceBps: number;
  setupFeeBps: number;
  reliabilityDeltaBps: number;
  /** Additional per-account memory, above the ordinary request session. */
  sessionMemoryMU: number;
  latencyBps: number;
  activeParameterBps: number;
  routingQualityBps: number;
  stateCapacity: number;
}
/** Frozen at paid admission. Future research never rewrites existing systems. */
export interface AISystemReceipt {
  version: 1;
  spec: AISystemSpec;
  researchIds: string[];
  effects: AISystemEffects;
}

export type AISystemModel = Pick<ModelVersion, 'family' | 'architecture' | 'capabilityBps' | 'reliabilityBps' | 'residentMU'>
  & Partial<Pick<ModelVersion, 'modelDesign' | 'advancedCapabilities' | 'runtimeVariant'>>;
export interface AISystemMetrics {
  kind: AISystemKind | 'standard';
  /** Standard 500-input / 100-output request, in display CUw per 1,000 requests. */
  servingCUwPer1000: number;
  /** Resident weights, excluding per-account session memory. */
  residentMU: number;
  /** Full per-account memory, including the standard 0.02 MU session. */
  sessionMemoryMU: number;
  retentionBps: number;
  verifiedCompletionBps: number;
  latencyBps: number;
  routingQualityBps: number;
  activeParameterMillions: number;
  stateCapacity: number;
}
