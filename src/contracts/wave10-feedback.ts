import type { Deployment } from './wave1';
import type { RuntimeGuardrailProfile } from './wave12-guardrails';

/** Prospective, consented samples from fictional paid product usage. No customer text is stored. */
export type FeedbackSampling = 'representative' | 'failure-focused';
export type FeedbackConsent = 'hosted-only' | 'distribution';

export type FeedbackCommand =
  | { kind: 'start_feedback_study'; productId: string; sampling: FeedbackSampling; consent: FeedbackConsent }
  | { kind: 'cancel_feedback_study'; studyId: string };

export interface FeedbackOutcomes {
  cases: number;
  useful: number;
  confidentError: number;
  falseRefusal: number;
  clarification: number;
}

/** A bounded receipt of the paid portion of one actual serving week. */
export interface FeedbackPaidUsage {
  /** Attribution from the live benign-response meter; never restricted audit labels. */
  guardrail?: {
    installationId: string;
    profile: RuntimeGuardrailProfile;
    bindingFingerprint: string;
    checkingApplied: boolean;
    baselineFalseRefusalBps: number;
    addedFalseRefusalBps: number;
  };
  paidAccounts: number;
  paidRequestedExchanges: number;
  paidRequestedWork: number;
  paidExecutedWork: number;
  paidCompletedExchanges: number;
  errorBps: number;
  confidentErrorBps: number;
  falseRefusalBps: number;
  billedCents: number;
  invoiceId: string | null;
}

export type FeedbackRowReason = 'sampled' | 'no-paid-service' | 'source-changed' | 'no-consent-cases' | 'no-negative-cases';

export interface FeedbackWeekReceipt {
  week: number;
  sourceId: string;
  observedDeploymentId: string;
  observedModelId: string;
  /** Live deployments are replaced on release; this historical receipt remains immutable. */
  observedDeployment: Deployment;
  routingModelId: string | null;
  paidUsage: FeedbackPaidUsage;
  servedAccounts: number;
  consentAccounts: number;
  negativeCandidates: number;
  reason: FeedbackRowReason;
  outcomes: FeedbackOutcomes;
}

export interface FeedbackStudy {
  id: string;
  companyId: string;
  productId: string;
  productKind: 'basic-chat' | 'developer-api';
  protocol: 'customer-feedback-1';
  sourceDeploymentId: string;
  sourceModelId: string;
  sourceDeployment: Deployment;
  sourceModelFingerprint: string;
  sampling: FeedbackSampling;
  consent: FeedbackConsent;
  status: 'collecting' | 'closed';
  startedWeek: number;
  /** Fixed calendar window, even if service is paused or the source changes. */
  endsWeek: number;
  endedEarly: boolean;
  closedWeek: number | null;
  reviewableWeek: number | null;
  endCommandId: string | null;
  weeks: FeedbackWeekReceipt[];
  totalCases: number;
  totalNegativeCases: number;
  lastBottleneck: string;
}

export interface Wave10FeedbackFields {
  /** Omitted until adopted so existing companies retain their exact saved representation. */
  feedbackStudies?: Record<string, FeedbackStudy>;
}
