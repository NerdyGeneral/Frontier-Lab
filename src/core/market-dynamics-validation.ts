import { CONNECTED_COMPANY_CONTENT_VERSION } from './connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import type { GameState } from '../contracts/types';
import { RIVAL_CAMPAIGN_RULES } from '../content/market-dynamics';
import { SEGMENT_BY_ID } from '../content/wave2-market';
import { checkedInteger } from './math';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { rivalCampaignPriceTarget, rivalTacticFor } from '../modules/rival-tactics';
import { rivalSystemsFocus } from '../modules/rival-systems';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const keys = (value: object, expected: readonly string[], label: string) => check(Object.keys(value).sort().join() === [...expected].sort().join(), `${label} has unknown or missing fields.`);

export function assertMarketDynamicsState(state: GameState): void {
  const calendar = state.slices.markets.opportunityCalendar;
  if (calendar !== undefined) {
    check(!!calendar && typeof calendar === 'object' && !Array.isArray(calendar), 'The market calendar must be an object.');
    keys(calendar, ['startedWeek', ...(calendar.sequenceVersion === undefined ? [] : ['sequenceVersion'])], 'The market calendar');
    if (calendar.sequenceVersion !== undefined) check(calendar.sequenceVersion === 2 && [GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion), 'The market calendar sequence is not supported by these rules.');
    checkedInteger(calendar.startedWeek, 'Market calendar start');
    check(calendar.startedWeek <= state.week, 'The market calendar cannot begin in the future.');
  }
  for (const rival of Object.values(state.slices.markets.rivals)) {
    const campaign = rival.campaign;
    if (campaign === undefined) continue;
    check(!!calendar, 'A rival campaign requires the saved market calendar.');
    check(!!campaign && typeof campaign === 'object' && !Array.isArray(campaign), 'A rival campaign must be an object.');
    keys(campaign, ['id', 'kind', 'startedWeek', 'reviewWeek', 'targetSegment', 'startingCashCents', 'startingAccounts', 'startingModelId', 'startingPriceCents', 'priceTargetCents', 'reserveTargetCents', 'status', 'lastDecisionWeek', 'lastDecision', ...(campaign.tactics === undefined ? [] : ['tactics']), ...(campaign.systems === undefined ? [] : ['systems'])], 'A rival campaign');
    if (campaign.systems !== undefined) {
      check(!!campaign.systems && typeof campaign.systems === 'object' && !Array.isArray(campaign.systems), 'Rival systems program must be an object.');
      keys(campaign.systems, ['version', 'focus'], 'Rival systems program');
      check(state.contentVersion === CONNECTED_COMPANY_CONTENT_VERSION && campaign.systems.version === 1 && campaign.systems.focus === rivalSystemsFocus(state, rival.style)
        && !!state.slices.campaign.progression && campaign.startedWeek >= state.slices.campaign.progression.activatedWeek, 'Rival operating program differs from its announced world and style.');
    }
    if (campaign.tactics !== undefined) {
      check(!!campaign.tactics && typeof campaign.tactics === 'object' && !Array.isArray(campaign.tactics), 'The rival tactics must be an object.');
      keys(campaign.tactics, ['version', 'focus'], 'Rival tactics');
      check([GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion) && campaign.tactics.version === 1
        && campaign.tactics.focus === rivalTacticFor(state.seed, rival.companyId, campaign.startedWeek, rival.style), 'The rival tactic does not match its frozen campaign choice.');
    }
    check(Object.hasOwn(RIVAL_CAMPAIGN_RULES, campaign.kind), 'The rival campaign kind is not authored.');
    const expectedKind = rival.style === 'efficient' ? 'value-expansion' : rival.style === 'enterprise' ? 'enterprise-service' : 'quality-leadership';
    check(campaign.kind === 'cash-recovery' || campaign.kind === expectedKind, 'The rival campaign does not match its operating style.');
    for (const value of [campaign.startedWeek, campaign.reviewWeek, campaign.startingCashCents, campaign.startingAccounts, campaign.reserveTargetCents, campaign.lastDecisionWeek]) checkedInteger(value, 'Rival campaign value');
    check(campaign.id === `rival-campaign:${rival.companyId}:${campaign.startedWeek}`, 'The rival campaign identity changed.');
    check(campaign.startedWeek >= calendar!.startedWeek && campaign.startedWeek <= state.week
      && campaign.reviewWeek === campaign.startedWeek + RIVAL_CAMPAIGN_RULES[campaign.kind].durationWeeks,
    'The rival campaign review does not match its announced duration.');
    check(campaign.lastDecisionWeek >= campaign.startedWeek && campaign.lastDecisionWeek <= state.week, 'The rival campaign decision week is invalid.');
    const expectedSegment = campaign.kind === 'value-expansion' ? 'developers' : campaign.kind === 'enterprise-service' ? 'business'
      : campaign.kind === 'quality-leadership' ? 'professional' : rival.style === 'efficient' ? 'developers' : rival.style === 'enterprise' ? 'business' : 'regular';
    check(campaign.targetSegment === expectedSegment, 'The rival campaign targets the wrong market.');
    check(campaign.startingAccounts <= SEGMENT_BY_ID[expectedSegment].population, 'The rival campaign baseline exceeds its finite market.');
    if (campaign.startingModelId !== null) {
      const model = state.slices.models.versions[campaign.startingModelId];
      check(!!model && model.companyId === rival.companyId && (model.createdWeek ?? 0) <= campaign.startedWeek, 'The rival campaign baseline model is not an existing owned model.');
      checkedInteger(campaign.startingPriceCents!, 'Rival campaign starting price');
      check(campaign.startingPriceCents! >= 100 && campaign.startingPriceCents! <= 100000, 'The rival campaign starting price is invalid.');
    } else check(campaign.startingPriceCents === null, 'A rival campaign without a starting product cannot invent its price.');
    check(campaign.priceTargetCents === rivalCampaignPriceTarget(campaign.kind, campaign.startingPriceCents, campaign.tactics?.focus),
      'The rival campaign price target does not match its frozen plan.');
    check(['pursuing', 'protecting-cash', 'completed'].includes(campaign.status), 'The rival campaign status is invalid.');
    check(typeof campaign.lastDecision === 'string' && campaign.lastDecision.length > 0 && campaign.lastDecision.length <= 1000, 'The rival campaign explanation is invalid.');
  }
}
