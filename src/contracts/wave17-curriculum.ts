import type { CapabilityDomain, CorpusEvidence } from './wave2-lab';
import type { TrainingDeduplicationReceipt } from './wave6-data';

export interface CurriculumTrackChoice {
  domain: CapabilityDomain;
  packetIds: string[];
}

/** An explicit two-skill curriculum; the total replay share is split equally. */
export interface TrainingCurriculumChoice {
  shareBps: 5000 | 7500;
  tracks: [CurriculumTrackChoice, CurriculumTrackChoice];
}

/** One independently funded replay track and its bounded incoming skill. */
export interface TrainingCurriculumTrackReceipt {
  domain: CapabilityDomain;
  shareBps: 2500 | 3750;
  baselineScoreBps: number;
  corpus: CorpusEvidence;
  requiredEvidence: number;
  coverageBps: number;
  qualityBps: number;
  retentionBps: number;
  preservationFloorBps: number;
  nominalReplayWorkCUw: number;
  replayWorkCUw: number;
  deduplication?: TrainingDeduplicationReceipt;
}

/** Frozen proof for both distinct replay sources, the paid base, and all work. */
export interface TrainingCurriculumReceipt {
  shareBps: 5000 | 7500;
  baseModelId: string;
  baseModelFingerprint: string;
  baselineReportId: string;
  ordinaryIdentity: string;
  nominalFocusWorkCUw: number;
  focusWorkCUw: number;
  nominalReplayWorkCUw: number;
  replayWorkCUw: number;
  tracks: [TrainingCurriculumTrackReceipt, TrainingCurriculumTrackReceipt];
}
