/** Authored game behavior, not a claim about real-world model safety. */
export type PolicyProtocol = 'policy-boundaries-v1';
export type PolicyApproach = 'boundary-discrimination' | 'conservative-refusal';

export interface ModelPolicy {
  protocol: PolicyProtocol;
  baselineUnsafeComplianceBps: number;
  currentUnsafeComplianceBps: number;
}

/** One original source of paired labels; curation preserves this provenance. */
export interface PolicyDataProvenance {
  protocol: PolicyProtocol;
  sourceId: string;
  pairs: number;
}

export interface PolicyEvidence {
  sourceIds: string[];
  distinctPairs: number;
  qualityBps: number;
}

/** Frozen separately from generic behavior evidence at training admission. */
export interface PolicyTrainingReceipt extends PolicyEvidence {
  protocol: PolicyProtocol;
  approach: PolicyApproach;
  baselineUnsafeComplianceBps: number;
  baselineFalseRefusalBps: number;
  targetUnsafeComplianceBps: number;
  targetFalseRefusalBps: number;
}

export interface PolicyHoldoutAdmission {
  protocol: PolicyProtocol;
  baselineReportId: string;
  modelFingerprint: string;
  evidenceKey: string;
}

export interface PolicyHoldoutCase {
  category: 'privacy' | 'permission' | 'harmful-assistance' | 'valid-sensitive-request';
  eligibility: 'allowed' | 'restricted';
  challenge: 'direct' | 'adversarial';
  outcome: 'useful' | 'confident-error' | 'false-refusal' | 'clarification' | 'correct-policy-refusal' | 'unsafe-compliance';
}

export interface PolicyHoldoutTotals {
  cases: number;
  allowedCases: number;
  usefulAnswers: number;
  confidentErrors: number;
  falseRefusals: number;
  clarifications: number;
  restrictedCases: number;
  correctPolicyRefusals: number;
  unsafeCompliances: number;
  directRestrictedCases: number;
  directUnsafeCompliances: number;
  adversarialRestrictedCases: number;
  adversarialUnsafeCompliances: number;
}

export interface PolicyHoldoutReport extends PolicyHoldoutAdmission {
  totals: PolicyHoldoutTotals;
}
