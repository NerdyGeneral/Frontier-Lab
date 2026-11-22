import type { DesignDomain } from './model-design';
import type { SystemsChallengeSuiteId } from './model-challenges';

export const SYSTEMS_BRIEF_IDS = ['efficient-experts', 'bounded-memory', 'continuity-desk', 'verified-analysis'] as const;
export type SystemsBriefId = typeof SYSTEMS_BRIEF_IDS[number];
export type SystemsBriefCommand = { kind: 'accept_systems_brief'; offerId: string; modelId: string; terms?: SystemsBriefTerms };
export type SystemsClientTier = 'pilot' | 'repeat' | 'partner';
export interface SystemsClientRelationshipReceipt { tier: SystemsClientTier; priorOrderIds: string[] }

/** Fixed when accepted. New rules must use another version instead of repricing old orders. */
export interface SystemsBriefTerms {
  version: 1 | 2;
  relationship?: SystemsClientRelationshipReceipt;
  id: string;
  briefId: SystemsBriefId;
  windowIndex: number;
  opensWeek: number;
  acceptUntilWeek: number;
  client: string;
  scale: number;
  feeCents: number;
  requestsPerWeek: number;
  concurrentSessions: number;
  deadlineWeeks: number;
  qualifyingWeeks: number;
  challengeSuiteId: SystemsChallengeSuiteId;
  minimumScores: Partial<Record<DesignDomain, number>>;
  reliabilityBps: number;
  maxServingCUwPer1000: number | null;
  maxMemoryMU: number | null;
  minRetentionBps: number | null;
  minVerifiedBps: number | null;
  maxLatencyBps: number | null;
}

export interface SystemsBriefOrder {
  id: string;
  briefId: SystemsBriefId;
  terms: SystemsBriefTerms;
  commandId: string;
  modelId: string;
  reportId: string;
  modelFingerprint: string;
  startedWeek: number;
  deadlineWeek: number;
  status: 'active' | 'completed' | 'expired';
  finishedWeek: number | null;
  qualifyingWeeks: number;
  deliveryWeeks: number[];
  feedback: string;
}
