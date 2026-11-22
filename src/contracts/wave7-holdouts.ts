import type { AgentDraftOutcome } from './wave3-agents';

/** A reserved protocol and candidate are captured before paid evaluation work. */
export interface IndependentHoldoutAdmission {
  protocol: 'independent-support-v1';
  baselineReportId: string;
  modelFingerprint: string;
  evidenceKey: string;
}

export interface IndependentHoldoutCase {
  templateId: string;
  outcome: AgentDraftOutcome;
  claimedComplete: boolean;
  actualSuccess: boolean;
  basicAccepted: boolean;
  independentAccepted: boolean;
  necessaryLookups: number;
  plannedLookups: number;
  repeatedLookups: number;
  outOfScopeProposals: number;
}

export interface IndependentHoldoutTotals {
  cases: number;
  claimedCompletions: number;
  actualSuccesses: number;
  unsuccessfulCases: number;
  basicAccepted: number;
  basicFalseAccepts: number;
  independentAccepted: number;
  independentFalseAccepts: number;
  necessaryLookups: number;
  plannedLookups: number;
  repeatedLookups: number;
  outOfScopeProposals: number;
}

export interface IndependentHoldoutReport extends IndependentHoldoutAdmission {
  totals: IndependentHoldoutTotals;
}
