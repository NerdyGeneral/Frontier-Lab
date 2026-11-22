/** A paid cleanup receipt. Evidence units are retained; repeated processing is removed. */
export interface DataDeduplicationReceipt {
  sourcePacketId: string;
  rolloutId: string;
  sourceUnits: number;
  duplicateProcessingUnits: number;
  processedUnits: number;
  reductionBps: number;
}

/** Frozen at training admission; neither later cleanup nor curation reprices this work. */
export interface TrainingDeduplicationReceipt {
  sourceIds: string[];
  reductionBps: number;
  originalWorkCUw: number;
  savedWorkCUw: number;
}
