import type { DesignDomain } from './model-design';

export type ModelChallengeTier = 'applied' | 'frontier' | 'horizon';
export type ModelChallengeSuiteId = 'challenge-applied-1' | 'challenge-frontier-1' | 'challenge-horizon-1';
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

