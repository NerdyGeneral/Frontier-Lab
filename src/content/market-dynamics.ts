import type { MarketOpportunityDefinition, RivalCampaignKind, RivalTactic } from '../contracts/market-dynamics';

export const MARKET_OPPORTUNITY_RULES = { noticeWeeks: 6, activeWeeks: 4, intervalWeeks: 12 } as const;

export const RIVAL_TACTIC_RULES: Readonly<Record<RivalTactic, { name: string; description: string; valueDiscountCents: number }>> = {
  efficiency: { name: 'Lower serving cost', description: 'Fund compression research, apply it to a saved model, test the result and accept at most a three-point task tradeoff for lower serving work.', valueDiscountCents: 300 },
  reliability: { name: 'Dependable answers', description: 'Prioritize paid behavior research and training while preserving the current service’s capabilities.', valueDiscountCents: 600 },
  reach: { name: 'Wider audience', description: 'Try broader positioning and a bounded lower price while preserving the serving contribution and operating reserve.', valueDiscountCents: 900 },
};

/** Authored demand windows shift existing shoppers; populations never increase. */
export const MARKET_OPPORTUNITIES: readonly MarketOpportunityDefinition[] = [
  { id: 'everyday-assistants', name: 'Everyday assistant buying season',
    description: 'More casual and regular users are comparing everyday assistants.',
    segmentIds: ['casual', 'regular'], demandMultiplierBps: 16000,
    response: 'An affordable chat offer can compete for these trials. Keep enough serving headroom, or keep your current focus and let the window pass.' },
  { id: 'developer-showcase', name: 'Developer showcase',
    description: 'Developer teams are trying APIs before choosing tools for their next projects.',
    segmentIds: ['developers'], demandMultiplierBps: 20000,
    response: 'A qualified coding API, a sensible reference bill and spare serving capacity can help. You can continue serving another audience instead.' },
  { id: 'records-renewal', name: 'Records digitization window',
    description: 'Businesses are comparing document services during a scheduled buying period.',
    segmentIds: ['business'], demandMultiplierBps: 20000,
    response: 'Document quality, enterprise eligibility and dependable service still decide who qualifies. Improve the current offer or leave this market to other labs.' },
  { id: 'professional-planning', name: 'Professional planning season',
    description: 'Heavy and professional users are reviewing assistants for demanding work.',
    segmentIds: ['heavy', 'professional'], demandMultiplierBps: 17500,
    response: 'A reliable professional offer can benefit. Stronger models cost more to serve, so compare the opportunity with the customers you already support.' },
];

export const RIVAL_CAMPAIGN_RULES: Readonly<Record<RivalCampaignKind, { name: string; durationWeeks: number; description: string }>> = {
  'value-expansion': { name: 'Affordable API expansion', durationWeeks: 16,
    description: 'Compete for developers with a lower reference bill while preserving paid serving contribution.' },
  'quality-leadership': { name: 'Dependable model release', durationWeeks: 24,
    description: 'Research, train, test and release a more reliable model for demanding users.' },
  'enterprise-service': { name: 'Enterprise relationships', durationWeeks: 24,
    description: 'Improve dependable document service and pursue or renew a qualified business license.' },
  'cash-recovery': { name: 'Protect operating runway', durationWeeks: 12,
    description: 'Repair service and protect cash before beginning more speculative work.' },
};
