/** Fictional, finite production-model comparison; never customer traffic or training. */
export const RELEASE_REHEARSAL_RULES = {
  protocol: 'release-rehearsal-1' as const,
  requiredResearch: 'R12',
  cases: 100,
  exchangesPerCase: 100,
  reviewStaff: 1_000_000_000,
  requestPriority: 14,
  maximumPerProduct: 8,
  maximumHistory: 24,
  maximumReceiptBuckets: 40,
};

export const RELEASE_REHEARSAL_SCOPE = 'The same 100 reserved benign cases represent 10,000 standard exchanges per model. False refusal means refusing an allowed task; this bank does not test harmful-request policy. Uses current feature settings and separate resident memory. Excludes routing, prefix caching, retrieval, evidence links and runtime guardrails. It compares model behavior and execution cost; it does not certify capacity for all future customer traffic. Runtime protection needs its own paid audit for the exact deployed models and options.';
