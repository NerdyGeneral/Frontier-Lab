export const STRATEGY_CONTENT_VERSION = '0.34.0';

/** New choices and paid evidence cannot be hidden behind a historical header. */
export function containsStrategyFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (['developmentPlans', 'opportunityCalendar', 'researchFocus', 'focusFactId', 'routingProtocol', 'routingPolicy', 'chapters'].some(key => Object.hasOwn(item, key))
    || (Object.hasOwn(item, 'secondaryShareBps') && item.secondaryShareBps !== 0 && item.secondaryShareBps !== 6_000)
    || (Object.hasOwn(item, 'strategy') && typeof item.strategy === 'object')
    || (typeof item.suiteId === 'string' && item.suiteId.startsWith('challenge-'))
    || (typeof item.kind === 'string' && ['start_development_plan', 'set_development_plan_paused', 'revise_development_plan', 'cancel_development_plan', 'set_product_strategy', 'select_chapter'].includes(item.kind))
    || (item.kind === 'start_model_research' && Object.hasOwn(item, 'focus'))
    || (Object.hasOwn(item, 'campaign') && typeof item.campaign === 'object' && item.campaign !== null && Object.hasOwn(item.campaign, 'reviewWeek'))) return true;
  return Object.values(item).some(containsStrategyFeatures);
}
