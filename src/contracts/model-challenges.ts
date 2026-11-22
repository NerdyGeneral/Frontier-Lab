import type { DesignDomain } from './model-design';

export type SystemsChallengeFormat = 'cost' | 'memory' | 'retention' | 'verification';
export type SystemsChallengeSuiteId = 'systems-cost-1' | 'systems-memory-1' | 'systems-retention-1' | 'systems-verification-1';
export type ModelChallengeTier = 'applied' | 'frontier' | 'horizon' | 'systems-cost' | 'systems-memory' | 'systems-retention' | 'systems-verification';
export type ModelChallengeSuiteId = 'challenge-applied-1' | 'challenge-frontier-1' | 'challenge-horizon-1' | SystemsChallengeSuiteId;
export interface ModelChallengeAdmission {
  tierId: ModelChallengeTier;
  benchmarkVersion: 1;
  modelFingerprint: string;
  baselineReportId: string;
  previousAchievementReportId: string | null;
  admittedWeek: number;
}
export interface ModelChallengeReceipt {
  admission: ModelChallengeAdmission;
  passedCases: number;
  totalCases: number;
  requiredPasses: number;
  minimumPassesPerSkill: number;
  skills: Record<DesignDomain, { passed: number; total: number }>;
  passed: boolean;
  earnedTitle: string | null;
}

