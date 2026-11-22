import type { ConsumerSessionHistory } from './wave18-sessions';
import type { CommandPayload } from './types';

export type MarketSegmentId = 'casual' | 'regular' | 'heavy' | 'professional' | 'developers' | 'business';
export type ProductKind = 'basic-chat' | 'developer-api' | 'business-docs';
export interface ProductFeatures { memory: boolean; extendedContext: boolean; deepReasoning: boolean }
export interface SegmentDefinition {
  id: MarketSegmentId; name: string; market: 'consumer' | 'developer' | 'business';
  population: number; exchanges: number; referencePriceCents: number;
  minConversationBps: number; minDocumentsBps: number; minCodingBps: number; minReliabilityBps: number;
  errorToleranceBps: number; difficultyBps: number; shoppingBps: number; churnBps: number;
  trialExchanges: number;
}
export interface MarketCarries { conversion: number; churn: number; reach: number }
export interface RivalState {
  campaign?: import('./market-dynamics').RivalCampaign;
  companyId: string; style: 'frontier' | 'efficient' | 'enterprise'; interval: number;
  reserveWeeks: number; nextPlanWeek: number; lastPriceWeek: number;
  publicActivity: string; lastActionWeek: number; withdrawn: boolean;
}
export interface Wave2MarketFields {
  companyTrustBps: Record<string, number>;
  carries: Record<string, MarketCarries>;
  shopperCarry: Record<string, number>;
  rivals: Record<string, RivalState>;
  returnedNextWeek: Record<string, number>;
}
export interface SegmentUsage {
  sessionHistory?: ConsumerSessionHistory;
  segmentId: MarketSegmentId; accounts: number; requestedWork: number;
  errorBps: number; requestedExchanges: number;
}
export interface TokenMeter {
  inputTokens: number; outputTokens: number; internalTokens: number;
  inputPriceCentsPerMillion: number; outputPriceCentsPerMillion: number;
  physicalWork: number; ownedVariableCostCents: number;
  billCarryIn?: number; billCarryOut?: number;
}
export type Wave2ProductCommand =
  | { kind: 'set_product_features'; productId: string; features: ProductFeatures }
  | { kind: 'upgrade_product'; productId: string; modelId: string };
export interface PlannedCommand { companyId: string; payload: CommandPayload }
