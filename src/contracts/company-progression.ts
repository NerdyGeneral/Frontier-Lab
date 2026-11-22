import type { ChapterId } from './strategic-variety';

export type CompanyWorldId = 'responsive-market' | 'local-market' | 'continuity-market' | 'verification-market';
export type ResearchProgramId = 'efficient-systems' | 'persistent-systems' | 'verified-systems';
export type CompanyAmbitionId = 'efficient-provider' | 'private-provider' | 'verified-provider' | 'silicon-supplier';

export type ResearchProgramCommand = { kind: 'start_research_experiment'; programId: ResearchProgramId; modelId: string };

/** A paid, immutable experiment protocol. Old model and benchmark receipts are never rewritten. */
export interface ResearchExperimentTerms {
  version: 1;
  stage: number;
  worldId: CompanyWorldId;
  origin: 'garage' | 'university' | 'consultancy';
  chapterIds: ChapterId[];
  feeCents: number;
  requiredWork: number;
  requiredStaff: number;
  concurrentSessions: number;
  minimumQualityBps: number;
  minimumReliabilityBps: number;
  maximumServingMicroCUw: number;
  maximumMemoryMU: number;
  maximumLatencyBps: number;
  minimumRetentionBps: number;
  minimumVerifiedBps: number;
}
export interface ResearchExperimentGrant {
  week: number;
  work: number;
  physicalWork: number;
  staff: number;
}
export interface ResearchExperiment {
  id: string;
  commandId: string;
  programId: ResearchProgramId;
  companyId: string;
  modelId: string;
  modelFingerprint: string;
  baselineReportId: string;
  startedWeek: number;
  terms: ResearchExperimentTerms;
  completedWork: number;
  physicalWork: number;
  completedStaff: number;
  grants: ResearchExperimentGrant[];
  status: 'running' | 'complete';
  completedWeek: number | null;
  availableWeek: number | null;
  passed: boolean | null;
  lastBottleneck: string;
}
export interface CompanyChapterProof {
  week: number;
  sourceKind: 'product' | 'contract' | 'commission';
  sourceId: string;
  modelId: string;
  reportIds: string[];
  billedCents: number;
  fulfillmentBps: number;
  revenueCents: number;
  operatingExpenseCents: number;
  efficient: boolean;
  efficiencyReason: string;
  efficiencyInstallationId: string | null;
  secondaryModelId: string | null;
}
export interface CompanyChapterTrack {
  progress: CompanyChapterProof[];
  achievement: { earnedWeek: number; proof: CompanyChapterProof[] } | null;
}
export interface CompanyAmbitionWeek {
  week: number;
  revenueCents: number;
  operatingExpenseCents: number;
  cashCents: number;
  baseCostCents: number;
  arrearsCents: number;
  serviceBps: number;
  efficientBilledCents: number;
  privateBilledCents: number;
  verifiedBilledCents: number;
  hardwareDeliveries: number;
  hardwareRevenueCents: number;
  hardwareCostCents: number;
  programLevels: Record<ResearchProgramId, number>;
}
export interface CompanyProgression {
  version: 1;
  activatedWeek: number;
  worldId: CompanyWorldId;
  chapters: Partial<Record<ChapterId, CompanyChapterTrack>>;
  experiments: Record<string, ResearchExperiment>;
  ambitionHistory: CompanyAmbitionWeek[];
  ambitions: Partial<Record<CompanyAmbitionId, { earnedWeek: number; proof: CompanyAmbitionWeek[] }>>;
}
