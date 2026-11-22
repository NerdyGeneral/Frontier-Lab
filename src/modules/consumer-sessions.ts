import type { ConsumerSessionHistory, ConsumerSessionProfile } from '../contracts/wave18-sessions';
import type { SegmentDefinition, SegmentUsage, WeeklyUsage } from '../contracts/types';
import { mulDiv } from '../core/math';

export const SESSION_PROFILES = {
  brief: { maxTokens: 400, repeatBps: 12000, churnReliefBps: 2000, qualityBps: 400 },
  extended: { maxTokens: 1200, repeatBps: 14000, churnReliefBps: 4000, qualityBps: 900 },
} satisfies Record<ConsumerSessionProfile, { maxTokens: number; repeatBps: number; churnReliefBps: number; qualityBps: number }>;

export const SESSION_GROWTH_TOKENS = 200;
export const SESSION_MEMORY_PER_TOKEN = 25_000;
export const emptySessionHistory: ConsumerSessionHistory = { accounts: 0, tokens: 0 };

export function returningExchanges(profile: ConsumerSessionProfile, segment: SegmentDefinition, allowance: number): number {
  return Math.min(allowance, mulDiv(segment.exchanges, SESSION_PROFILES[profile].repeatBps, 10000));
}

export function sessionExchanges(profile: ConsumerSessionProfile, segment: SegmentDefinition, allowance: number, accounts: number, returning: number): number {
  return (accounts - returning) * Math.min(segment.exchanges, allowance) + returning * returningExchanges(profile, segment, allowance);
}

export function sessionQuality(profile: ConsumerSessionProfile, accounts: number, history: ConsumerSessionHistory): number {
  const rule = SESSION_PROFILES[profile];
  return accounts ? mulDiv(rule.qualityBps, history.tokens, accounts * rule.maxTokens) : 0;
}

/** Context is averaged across paid traffic. Trials never use the retained input. */
export function sessionInputTokens(profile: ConsumerSessionProfile, rows: readonly SegmentUsage[], allowance: number, segments: Readonly<Record<string, SegmentDefinition>>): number {
  let weightedTokens = 0, exchanges = 0;
  for (const row of rows) {
    weightedTokens += (row.sessionHistory?.tokens ?? 0) * returningExchanges(profile, segments[row.segmentId], allowance);
    exchanges += row.requestedExchanges;
  }
  return exchanges ? Math.floor(weightedTokens / exchanges) : 0;
}

/** Each cohort is an aggregate. Fulfillment and churn apply proportionally, never by inventing per-account identities. */
export function settledSessionHistory(row: SegmentUsage | undefined, survivors: number, usage: WeeklyUsage): ConsumerSessionHistory | undefined {
  if (!row?.sessionHistory || !row.accounts || !survivors || !usage.consumerSessions || !usage.paidRequestedWork) return;
  const accounts = mulDiv(survivors, usage.paidExecutedWork, usage.paidRequestedWork);
  if (!accounts) return;
  const cap = SESSION_PROFILES[usage.consumerSessions.profile].maxTokens;
  const priorTokens = mulDiv(row.sessionHistory.tokens, accounts, row.accounts);
  return { accounts, tokens: Math.min(accounts * cap, priorTokens + accounts * SESSION_GROWTH_TOKENS) };
}

export function sessionChurnRelief(usage: WeeklyUsage, segment: SegmentDefinition, baseChurnBps: number): number {
  const row = usage.segments?.find(item => item.segmentId === segment.id);
  if (!usage.consumerSessions || !row?.sessionHistory || !row.accounts) return 0;
  const relief = mulDiv(baseChurnBps, SESSION_PROFILES[usage.consumerSessions.profile].churnReliefBps, 10000);
  return mulDiv(mulDiv(relief, row.sessionHistory.accounts, row.accounts), usage.fulfillmentBps, 10000);
}
