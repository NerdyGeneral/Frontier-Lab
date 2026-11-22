import type { FacilityTariffFields } from './wave28-tariffs';
import type { ModelVersion, WorkRequest } from './types';

export type BatchOrderId = 'archive-tagging' | 'code-index' | 'longform-digest';
export type BatchCommand =
  | { kind: 'install_batch_scheduler' }
  | { kind: 'accept_batch_job'; productId: string; orderId: BatchOrderId; modelId: string; weeklyWorkCapCUw: number; poolId?: string }
  | { kind: 'set_batch_job_placement'; jobId: string; poolId: string }
  | { kind: 'set_batch_job_paused'; jobId: string; paused: boolean }
  | { kind: 'cancel_batch_job'; jobId: string };

export interface BatchOrderDefinition {
  id: BatchOrderId; name: string; description: string; domain: keyof ModelVersion['capabilityBps'];
  minimumScoreBps: number; minimumReliabilityBps: number; requests: number;
  inputTokensPerRequest: number; outputTokensPerRequest: number; windowWeeks: number;
  inputPriceCentsPerMillion: number; outputPriceCentsPerMillion: number;
}

/** Coalesced actual hardware grants preserve lifetime work without relying on the short cost-report window. */
export interface BatchWorkReceipt extends FacilityTariffFields {
  hardwareId: string; ownership: 'cloud' | 'owned'; multiplierBps: number; rateCentsPerCUw: number;
  physicalCUw: number; effectiveCUw: number; conversionRemainder: number; grants: number; firstWeek: number; lastWeek: number;
}
export interface BatchGrant {
  week: number; poolId: string; receiptKey: string; remainingBefore: number; requestedWork: number;
  effectiveCUw: number; physicalCUw: number; memoryMU: number;
}
export interface BatchScheduler {
  id: string; companyId: string; status: 'building' | 'ready' | 'active'; startedWeek: number;
  completedWeek: number | null; availableWeek: number | null; feeCents: number; feeFactId: string;
  requiredWork: number; completedWork: number; physicalWork: number; memoryMU: number;
  requiredStaff: number; completedStaff: number; workReceipts: Record<string, BatchWorkReceipt>; latestGrant: BatchGrant | null;
  staffGrantCount: number; firstStaffWeek: number | null;
  latestStaffGrant: { week: number; remainingBefore: number; grantedStaff: number } | null; lastBottleneck: string;
}

export interface BatchModelBinding {
  modelId: string; modelFingerprint: string; capabilityReportId: string; policyReportId: string | null;
  hostedRights: true; family: ModelVersion['family']; architecture: ModelVersion['architecture'];
  residentMU: number; workBps: number;
}
export interface BatchMeter {
  inputTokensPerRequest: number; outputTokensPerRequest: number; workPerRequestCUw: number;
  memoryMU: number; executionHints: Pick<WorkRequest, 'modelArchitecture' | 'modelFamily' | 'workloadKind' | 'requiresFastFabric'>;
}

/** One bounded calendar receipt per admitted service week, including paused and capacity-starved weeks. */
export interface BatchWeekUsage {
  week: number; paused: boolean; remainingBefore: number; requestedWorkCUw: number;
  executedWorkCUw: number; physicalWorkCUw: number; poolId: string | null; receiptKey: string | null; memoryMU: number;
  staffRequired: number; staffGranted: number; supervisedLimitCUw: number;
  completedWorkBefore: number; completedWorkAfter: number; completedRequestsBefore: number; completedRequestsAfter: number;
  completedRequests: number; inputTokens: number; outputTokens: number; explanation: string;
}

export interface BatchJob {
  id: string; companyId: string; productId: string; orderId: BatchOrderId; claim: number; schedulerId: string;
  acceptedWeek: number; deadlineWeek: number; terminalWeek: number | null;
  status: 'active' | 'paused' | 'completed' | 'expired' | 'cancelled'; cancellationCommandId: string | null;
  admission: { publicInvoiceId: string; publicInvoiceWeek: number; paidAccounts: number; publicContractId: string };
  model: BatchModelBinding; meter: BatchMeter; terms: BatchOrderDefinition; weeklyWorkCapCUw: number;
  requiredWork: number; completedWork: number; physicalWork: number; completedRequests: number;
  inputTokens: number; outputTokens: number; commercialStaffSpent: number;
  workReceipts: Record<string, BatchWorkReceipt>; latestGrant: BatchGrant | null; usageHistory: BatchWeekUsage[];
  quotedCents: number; invoiceId: string | null; lastBottleneck: string;
  /** Absent means legacy automatic placement. One explicit choice per service week. */
  placementHistory?: Array<{ commandId: string; week: number; poolId: string }>;
}

export interface BatchInvoice {
  id: string; jobId: string; companyId: string; productId: string; orderId: BatchOrderId; week: number;
  reason: 'completed' | 'deadline' | 'cancelled'; modelId: string; modelFingerprint: string;
  requestedRequests: number; completedRequests: number; inputTokens: number; outputTokens: number;
  grossCents: number; creditsCents: number; amountCents: number;
}

export interface Wave14BatchFields {
  batchSchedulers?: Record<string, BatchScheduler>;
  batchJobs?: Record<string, BatchJob>;
  batchInvoices?: BatchInvoice[];
}

export interface BatchView {
  researched: boolean; scheduler: BatchScheduler | null;
  products: Array<{ id: string; name: string; status: string; paidAccounts: number; available: boolean }>;
  models: Array<{ id: string; name: string; family: ModelVersion['family']; architecture: ModelVersion['architecture']; residentMU: number; eligibleOrders: BatchOrderId[] }>;
  board: Array<BatchOrderDefinition & { acceptedClaims: number; remainingClaims: number; quotedCents: number }>;
  jobs: BatchJob[]; invoices: BatchInvoice[]; activeJobs: number; remainingWorkCUw: number;
  requestedWeeklyCapCUw: number; maximumCommercialStaff: number;
}
