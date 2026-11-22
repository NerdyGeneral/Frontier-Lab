import type { SegmentDefinition } from '../contracts/types';

/** Fictional market populations and workload assumptions from the consolidated design. */
export const MARKET_SEGMENTS: readonly SegmentDefinition[] = [
  { id: 'casual', name: 'Casual consumers', market: 'consumer', population: 1800, exchanges: 50, referencePriceCents: 800, minConversationBps: 4500, minDocumentsBps: 0, minCodingBps: 0, minReliabilityBps: 6500, errorToleranceBps: 2000, difficultyBps: 0, shoppingBps: 300, churnBps: 100, trialExchanges: 25 },
  { id: 'regular', name: 'Regular consumers', market: 'consumer', population: 1400, exchanges: 100, referencePriceCents: 1200, minConversationBps: 4800, minDocumentsBps: 0, minCodingBps: 0, minReliabilityBps: 6500, errorToleranceBps: 1800, difficultyBps: 0, shoppingBps: 300, churnBps: 100, trialExchanges: 25 },
  { id: 'heavy', name: 'Heavy consumers', market: 'consumer', population: 600, exchanges: 300, referencePriceCents: 1800, minConversationBps: 5000, minDocumentsBps: 0, minCodingBps: 0, minReliabilityBps: 6500, errorToleranceBps: 1500, difficultyBps: 1000, shoppingBps: 300, churnBps: 100, trialExchanges: 25 },
  { id: 'professional', name: 'Professional consumers', market: 'consumer', population: 200, exchanges: 200, referencePriceCents: 3000, minConversationBps: 6000, minDocumentsBps: 5500, minCodingBps: 0, minReliabilityBps: 9000, errorToleranceBps: 800, difficultyBps: 2500, shoppingBps: 300, churnBps: 100, trialExchanges: 25 },
  { id: 'developers', name: 'Developer accounts', market: 'developer', population: 400, exchanges: 600, referencePriceCents: 6000, minConversationBps: 0, minDocumentsBps: 0, minCodingBps: 5000, minReliabilityBps: 8000, errorToleranceBps: 2500, difficultyBps: 1600, shoppingBps: 200, churnBps: 40, trialExchanges: 150 },
  { id: 'business', name: 'Business organizations', market: 'business', population: 80, exchanges: 3000, referencePriceCents: 30000, minConversationBps: 0, minDocumentsBps: 5500, minCodingBps: 0, minReliabilityBps: 9000, errorToleranceBps: 800, difficultyBps: 600, shoppingBps: 100, churnBps: 0, trialExchanges: 750 },
];
export const SEGMENT_BY_ID = Object.fromEntries(MARKET_SEGMENTS.map(s => [s.id, s])) as Record<SegmentDefinition['id'], SegmentDefinition>;
export const DEFAULT_FEATURES = { memory: false, extendedContext: false, deepReasoning: false } as const;
