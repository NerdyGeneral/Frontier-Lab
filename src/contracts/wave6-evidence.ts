import type { ProductEfficiencyInstall } from './wave4-research';

/** A settled citation-support meter, not a factual-correctness certificate. */
export interface EvidenceCheckUsage {
  installationId: string;
  retrievalId: string;
  packetId: string;
  qualityBps: number;
  documentCoverageBps: number;
  freshnessBps: number;
  supportBps: number;
  requestWorkCUw: number;
  checkWorkCUw: number;
  requestedRequests: number;
  checkedRequests: number;
  supportedRequests: number;
  withheldRequests: number;
  uncheckedRequests: number;
}

export interface EvidenceCheckView {
  researched: boolean;
  installation: ProductEfficiencyInstall | null;
  active: boolean;
  capturedInputsMatch: boolean;
  retrievalReady: boolean;
  status: string;
  supportBps: number;
  usage: EvidenceCheckUsage | null;
  usageWeek: number | null;
}
