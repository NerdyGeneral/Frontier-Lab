import type { CapabilityDomain, CapabilityScores, DataPacket, StaffRole } from './types';
import type { FeedbackReviewWorkReceipt } from './wave10-feedback-review';

export interface SyntheticGenerationOptions { teacherModelId: string; sourcePacketId: string; domain: CapabilityDomain }
export type SyntheticCommand =
  | ({ kind: 'start_synthetic_generation' } & SyntheticGenerationOptions)
  | { kind: 'start_synthetic_review'; jobId: string }
  | { kind: 'set_synthetic_job_paused'; jobId: string; paused: boolean };
export type SyntheticPhase = 'generating' | 'awaiting-review' | 'reviewing' | 'auditing' | 'ready' | 'complete';
export interface SyntheticComputeMeter {
  requiredWork: number; completedWork: number; physicalWork: number; memoryMU: number;
  workReceipts: Record<string, FeedbackReviewWorkReceipt>;
  latestGrant: { week: number; poolId: string; receiptKey: string; remainingBefore: number; physicalCUw: number; effectiveCUw: number; memoryMU: number; supervisionStaff: number } | null;
}
export interface SyntheticStaffMeter {
  role: StaffRole; requiredStaff: number; completedStaff: number;
  grantCount: number; firstWeek: number | null;
  latestGrant: { week: number; remainingBefore: number; grantedStaff: number } | null;
}
export interface SyntheticAudit {
  protocol: 'synthetic-audit-1'; bankId: string; fingerprint: string;
  acceptedUnits: number; sourceOverlapUnits: number; holdoutOverlapUnits: number; qualityRejectedUnits: number; qualityBps: number;
  acceptedCaseIds: string[]; quarantinedCaseIds: string[];
}
export interface SyntheticDataProvenance {
  protocol: 'targeted-synthetic-1'; jobId: string; teacherModelId: string; teacherFingerprint: string;
  sourcePacketId: string; sourceIds: string[]; sourceKey: string; domain: CapabilityDomain; auditFingerprint: string;
}
export interface SyntheticTrainingReceipt {
  packetId: string; jobId: string; teacherModelId: string; domain: CapabilityDomain;
  teacherScoreBps: number; targetBps: number; acceptedUnits: number; sourceKey: string; auditFingerprint: string;
}
export interface SyntheticJob extends SyntheticGenerationOptions {
  id: string; companyId: string; protocol: 'targeted-synthetic-1'; phase: SyntheticPhase; paused: boolean;
  startedWeek: number; generatedWeek: number | null; reviewStartedWeek: number | null; reviewCommandId: string | null;
  completedWeek: number | null; availableWeek: number | null; outputPacketId: string;
  sourceIds: string[]; sourceKey: string; sourceFingerprint: string; sourceUnits: number;
  teacherFingerprint: string; teacherReportId: string; teacherLineageIds: string[];
  teacherScoreBps: number; teacherReliabilityBps: number; sourceQualityBps: number; rights: DataPacket['rights'];
  candidateUnits: number; generation: SyntheticComputeMeter; review: SyntheticStaffMeter;
  auditCompute: SyntheticComputeMeter; auditStaff: SyntheticStaffMeter;
  generationStaffGranted: number; generationStaffGrantCount: number;
  audit: SyntheticAudit | null; lastProgress: number; lastBottleneck: string;
}
export interface SyntheticDataFields { syntheticJobs?: Record<string, SyntheticJob> }
export interface SyntheticGenerationPreview {
  accepted: boolean; reason: string | null; sourceKey: string | null; candidateUnits: number;
  generationFeeCents: number; reviewFeeCents: number; requiredWork: number; memoryMU: number;
  reviewStaff: number; auditStaff: number; auditWork: number; rights: DataPacket['rights'] | null;
}
export interface SyntheticJobView extends SyntheticJob {
  teacherName: string; sourceName: string; progressBps: number; generationFeeCents: number; reviewFeeCents: number;
  actualGpuTariffEstimateCents: number; canReview: boolean; reviewReason: string | null;
}
export interface SyntheticView {
  canGenerate: boolean; canReview: boolean; canTrain: boolean; generationGate: string | null; trainingGate: string | null;
  teachers: { id: string; name: string; capabilityBps: CapabilityScores; reliabilityBps: number; residentMU: number; transferRights: boolean; eligibleDomains: CapabilityDomain[]; reason: string | null }[];
  sources: { id: string; name: string; readyUnits: number; qualityBps: number; coverageBps: CapabilityScores; rights: DataPacket['rights']; sourceIds: string[]; eligible: boolean; reason: string | null }[];
  jobs: SyntheticJobView[];
  packets: { id: string; name: string; jobId: string; domain: CapabilityDomain; teacherModelId: string; teacherName: string; acceptedUnits: number; qualityBps: number; rights: DataPacket['rights']; auditFingerprint: string }[];
  costs: { generationFeeCents: number; reviewFeeCents: number; trainingFeeCents: number; reviewStaff: number; auditStaff: number; auditWork: number; trainingWork: number };
}
