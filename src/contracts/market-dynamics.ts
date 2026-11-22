import type { MarketSegmentId } from './wave2-market';

/** One saved epoch determines every announced window, including after a reload. */
export interface MarketOpportunityCalendar { startedWeek: number; sequenceVersion?: 2 }

export type MarketOpportunityId = 'everyday-assistants' | 'developer-showcase' | 'records-renewal' | 'professional-planning';
export interface MarketOpportunityDefinition {
  id: MarketOpportunityId;
  name: string;
  description: string;
  segmentIds: readonly MarketSegmentId[];
  demandMultiplierBps: number;
  response: string;
}
export interface MarketOpportunityWindow extends MarketOpportunityDefinition {
  instanceId: string;
  announcedWeek: number;
  startsWeek: number;
  endsWeek: number;
  status: 'announced' | 'active' | 'finished';
}

export type RivalCampaignKind = 'value-expansion' | 'quality-leadership' | 'enterprise-service' | 'cash-recovery';
export type RivalTactic = 'efficiency' | 'reliability' | 'reach';
/** Intent and its frozen baseline. It never awards work, money or customers. */
export interface RivalCampaign {
  tactics?: { version: 1; focus: RivalTactic };
  id: string;
  kind: RivalCampaignKind;
  startedWeek: number;
  reviewWeek: number;
  targetSegment: MarketSegmentId;
  startingCashCents: number;
  startingAccounts: number;
  startingModelId: string | null;
  startingPriceCents: number | null;
  priceTargetCents: number | null;
  reserveTargetCents: number;
  status: 'pursuing' | 'protecting-cash' | 'completed';
  lastDecisionWeek: number;
  lastDecision: string;
}
