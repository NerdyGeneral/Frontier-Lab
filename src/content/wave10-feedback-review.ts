/** Fictional first-party feedback review. Existing training recipes consume the output. */
export const FEEDBACK_REVIEW_RULES = {
  protocol: 'customer-feedback-review-1' as const,
  catalogId: 'customer-feedback-1',
  memoryMU: 1_000_000_000,
  maximumWeeklyStaff: 1_000_000_000,
  requestPriority: 31,
  maximumReviews: 16,
  maximumReceiptBuckets: 40,
  modes: {
    quick: { name: 'Quick review', staffPer100: 1_000_000_000, workPer100: 500_000_000, qualityBps: 6500 },
    verified: { name: 'Verified review', staffPer100: 2_000_000_000, workPer100: 1_000_000_000, qualityBps: 9000 },
  },
  sampling: {
    representative: { primaryCoverageBps: 8000, behaviorDensityBps: 5000 },
    'failure-focused': { primaryCoverageBps: 4500, behaviorDensityBps: 10000 },
  },
};

export const FEEDBACK_REVIEW_SCOPE = 'Review turns opted-in customer cases into reusable training data. Representative sampling keeps wider coverage; failure-focused sampling provides denser behavior evidence with narrower coverage. Both are selected customer feedback, not independent evaluation or broad pretraining data. Training, evaluation and a new release still require their own work.';
