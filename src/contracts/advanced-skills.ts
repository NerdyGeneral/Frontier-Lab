/** New capabilities are additive so historical four-skill saves keep their earned results. */
export type AdvancedDomain = 'reasoning' | 'longContext' | 'multimodal';
export type AdvancedScores = Record<AdvancedDomain, number>;

export interface AdvancedCorpusEvidence {
  packetIds: string[];
  sourceIds: string[];
  /** Relevant prepared examples, in RESOURCE_SCALE units. */
  relevantUnits: AdvancedScores;
  qualityBps: AdvancedScores;
  fingerprint: string;
}

/** Admission-time evidence and attainable scores; later discoveries cannot rewrite a running job. */
export interface AdvancedTrainingReceipt {
  foundation: boolean;
  anchors: AdvancedScores;
  targets: AdvancedScores;
  ceilings: AdvancedScores;
  corpus: AdvancedCorpusEvidence;
  requiredEvidence: number;
}
