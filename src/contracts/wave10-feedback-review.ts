import type { FacilityTariffFields } from './wave28-tariffs';
export type FeedbackReviewMode = 'quick' | 'verified';

export type Wave10FeedbackReviewCommand =
  | { kind: 'start_feedback_review'; studyId: string; mode: FeedbackReviewMode }
  | { kind: 'set_feedback_review_paused'; reviewId: string; paused: boolean };

/** Kept unchanged when a reviewed packet is curated into a new revision. */
export interface FeedbackDataProvenance {
  protocol: 'customer-feedback-review-1';
  studyId: string;
  reviewId: string;
  studyFingerprint: string;
  mode: FeedbackReviewMode;
}

/** Coalesced actual hardware grants keep long, interrupted reviews bounded. */
export interface FeedbackReviewWorkReceipt extends FacilityTariffFields {
  hardwareId: string;
  ownership: 'cloud' | 'owned';
  multiplierBps: number;
  rateCentsPerCUw: number;
  physicalCUw: number;
  effectiveCUw: number;
  conversionRemainder: number;
  grants: number;
  firstWeek: number;
  lastWeek: number;
}

export interface FeedbackReview {
  id: string;
  companyId: string;
  protocol: 'customer-feedback-review-1';
  studyId: string;
  studyFingerprint: string;
  mode: FeedbackReviewMode;
  outputPacketId: string;
  status: 'running' | 'ready' | 'complete';
  paused: boolean;
  startedWeek: number;
  completedWeek: number | null;
  availableWeek: number | null;
  requiredWork: number;
  completedWork: number;
  memoryMU: number;
  physicalWork: number;
  workReceipts: Record<string, FeedbackReviewWorkReceipt>;
  latestGrant: { week: number; poolId: string; receiptKey: string; remainingBefore: number; physicalCUw: number; effectiveCUw: number; memoryMU: number } | null;
  requiredStaff: number;
  completedStaff: number;
  staffGrantCount: number;
  firstStaffWeek: number | null;
  latestStaffGrant: { week: number; remainingBefore: number; grantedStaff: number } | null;
  lastBottleneck: string;
}

export interface Wave10FeedbackReviewFields {
  /** Omitted until a player starts paid review; old company representation stays intact. */
  feedbackReviews?: Record<string, FeedbackReview>;
}
