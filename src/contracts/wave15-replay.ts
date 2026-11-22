import type { CapabilityDomain, CorpusEvidence } from './wave2-lab';
import type { TrainingDeduplicationReceipt } from './wave6-data';

/** Explicitly opt in while preserving the ordinary training command when absent. */
export interface ReplayTrainingChoice {
  domain: CapabilityDomain;
  shareBps: 2500 | 5000;
  packetIds: string[];
}

/** Frozen paid base evidence, independent replay corpus, and additional update work. */
export interface TrainingReplayReceipt {
  domain: CapabilityDomain;
  shareBps: 2500 | 5000;
  baseModelId: string;
  baseModelFingerprint: string;
  baselineReportId: string;
  baselineScoreBps: number;
  ordinaryIdentity: string;
  corpus: CorpusEvidence;
  requiredEvidence: number;
  coverageBps: number;
  qualityBps: number;
  retentionBps: number;
  preservationFloorBps: number;
  nominalFocusWorkCUw: number;
  focusWorkCUw: number;
  nominalReplayWorkCUw: number;
  replayWorkCUw: number;
  deduplication?: TrainingDeduplicationReceipt;
}
