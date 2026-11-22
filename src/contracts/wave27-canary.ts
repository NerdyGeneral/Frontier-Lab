import type { FacilityTariffFields } from './wave28-tariffs';
import type { MarketSegmentId, ProductFeatures, ProductKind } from './wave2-market';
import type { ReleaseConfiguration } from './wave9-rehearsals';

/** Exact paid evidence for one immutable model/runtime, shared by public and private releases. */
export interface EvaluatedReleaseIdentity {
  modelId: string; modelFingerprint: string; capabilityReportId: string; policyReportId: string | null;
  runtimeSourceModelId: string | null; runtimeFingerprint: string | null;
  rights: { hosted: boolean; weights: boolean };
}
export interface CanaryOptions { releaseId: string; shareBps: 100 | 500 | 1000; sampleFloor: number; budgetCUw: number }
export type CanaryCommand =
  | ({ kind: 'start_release_canary' } & CanaryOptions)
  | { kind: 'stop_release_canary'; canaryId: string };
export type CanaryStatus = 'scheduled' | 'collecting' | 'qualified' | 'stopped' | 'promoted';
export type CanaryStopCode = 'manual' | 'regression' | 'severe-incident' | 'headroom' | 'budget' | 'insufficient-sample' | 'configuration' | 'arrears';
export interface CanaryOutcomes { useful: number; confidentError: number; falseRefusal: number; clarification: number }
export interface CanarySegmentReceipt {
  segmentId: MarketSegmentId; accounts: number; requestedRequests: number; executedRequests: number;
  technicalErrorBps: number; outcomes: CanaryOutcomes;
}
export interface CanaryCohortReceipt extends FacilityTariffFields {
  modelId: string; requestId: string; requestedRequests: number; executedRequests: number;
  requestedWorkCUw: number; effectiveWorkCUw: number; physicalWorkCUw: number; requiredMemoryMU: number; grantedMemoryMU: number;
  poolId: string | null; hardwareId: string | null; ownership: 'cloud' | 'owned' | null; multiplierBps: number; rateCentsPerCUw: number;
  /** Existing compute tariff attribution; never a second expense or customer invoice. */
  attributedComputeCents: number; ownedVariableCostCents: number;
  inputTokens: number; outputTokens: number; internalTokens: number;
  fulfillmentBps: number; errorBps: number; confidentErrorBps: number; falseRefusalBps: number;
  outcomes: CanaryOutcomes; segments: CanarySegmentReceipt[];
}
/** One observation of disjoint paid requests. Trial work stays with the incumbent. */
export interface CanaryUsageReceipt {
  protocol: 'release-canary-1'; canaryId: string; week: number; evidenceKey: string;
  shareBps: 100 | 500 | 1000; eligibleRequests: number; candidateBudgetBeforeCUw: number;
  incumbent: CanaryCohortReceipt; candidate: CanaryCohortReceipt;
  trialRequestedWorkCUw: number; trialExecutedWorkCUw: number; trialPhysicalWorkCUw: number;
  /** Full source request proof includes its paid cohort and unchanged trials. */
  sourceRequestedWorkCUw: number; sourceEffectiveWorkCUw: number; sourcePhysicalWorkCUw: number;
  trialCompletedIds: string[];
  paidAccounts: number; trialAccounts: number;
  grossBillCents: number; creditsCents: number; billedCents: number; billCarryIn: number; billCarryOut: number;
}
export interface CanaryIncident {
  id: string; week: number; code: CanaryStopCode; severity: 'notice' | 'major' | 'severe';
  productId: string; modelId: string; deploymentId: string;
  candidateSamples: number; incumbentSamples: number; sampleFloor: number;
  message: string; restoredRoutingWeek: number;
}
export interface CanaryRelease {
  id: string; startCommandId: string; companyId: string; productId: string; releaseId: string;
  sourceDeploymentId: string; sourceModelId: string; candidateModelId: string;
  source: EvaluatedReleaseIdentity; candidate: EvaluatedReleaseIdentity;
  configuration: ReleaseConfiguration; configurationFingerprint: string;
  productKind: ProductKind; features: ProductFeatures; priceCents: number; allowance: number;
  evidenceKey: string; shareBps: 100 | 500 | 1000; sampleFloor: number; budgetCUw: number;
  startedWeek: number; availableWeek: number; status: CanaryStatus;
  qualifiedWeek: number | null; stoppedWeek: number | null; stopCommandId: string | null; stopCode: CanaryStopCode | null;
  promotedWeek: number | null; consumedWorkCUw: number;
  observations: CanaryUsageReceipt[]; incident: CanaryIncident | null;
  lastMessage: string;
}
export interface Wave27CanaryFields { canaryReleases?: Record<string, CanaryRelease> }
export interface CanaryReleaseChoice {
  releaseId: string; productId: string; productName: string; sourceModelId: string; sourceName: string;
  candidateModelId: string; candidateName: string; eligible: boolean; reason: string | null;
}
export interface CanaryViewRecord extends CanaryRelease {
  productName: string; sourceName: string; candidateName: string;
  activeShareBps: number; remainingBudgetCUw: number; candidateSamples: number; incumbentSamples: number;
  latest: CanaryUsageReceipt | null; canStop: boolean; canPromote: boolean; promotionReason: string | null;
  assessment: CanaryAssessment;
}
export interface CanaryAssessment {
  candidateSamples: number; incumbentSamples: number; sufficient: boolean;
  candidateUsefulBps: number; incumbentUsefulBps: number;
  candidateConfidentErrorBps: number; incumbentConfidentErrorBps: number;
  candidateFalseRefusalBps: number; incumbentFalseRefusalBps: number;
  costRatioBps: number | null;
}
export interface CanaryView {
  researched: boolean; researchReason: string | null;
  releases: CanaryReleaseChoice[]; canaries: CanaryViewRecord[]; incidents: CanaryIncident[];
  rules: { setupFeeCents: number; shares: readonly (100 | 500 | 1000)[]; minimumSample: number; maximumSample: number; maximumBudgetCUw: number; maximumObservations: number; regressionBps: number; maximumCostRatioBps: number; minimumFulfillmentBps: number };
}
