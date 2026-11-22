import type { RivalCampaignKind, RivalTactic } from '../contracts/market-dynamics';
import type { RivalState } from '../contracts/wave2-market';
import { RIVAL_TACTIC_RULES } from '../content/market-dynamics';
import { canonicalStateHash } from '../core/canonical';

export function rivalTacticFor(seed: string, companyId: string, startedWeek: number, style: RivalState['style']): RivalTactic {
  const order: readonly RivalTactic[] = style === 'efficient' ? ['efficiency', 'reach', 'reliability']
    : style === 'enterprise' ? ['reliability', 'efficiency', 'reach'] : ['reliability', 'reach', 'efficiency'];
  return order[parseInt(canonicalStateHash({ seed, companyId, startedWeek, style, protocol: 'rival-tactics-1' }), 16) % order.length];
}

export function rivalCampaignPriceTarget(kind: RivalCampaignKind, startingPrice: number | null, tactic?: RivalTactic): number | null {
  if (startingPrice === null || kind === 'cash-recovery') return null;
  if (kind === 'value-expansion') return Math.max(4800, startingPrice - (tactic ? RIVAL_TACTIC_RULES[tactic].valueDiscountCents : 600));
  return tactic === 'reach' ? Math.max(100, Math.floor(startingPrice * 0.95)) : null;
}
