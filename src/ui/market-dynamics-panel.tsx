import type { GameState } from '../contracts/types';
import type { StudioPanelId } from '../core/studio-tasks';
import { MARKET_OPPORTUNITY_RULES, RIVAL_CAMPAIGN_RULES, RIVAL_TACTIC_RULES } from '../content/market-dynamics';
import { SEGMENT_BY_ID } from '../content/wave2-market';
import { formatMoney } from '../core/math';
import { getMarketOpportunityView } from '../modules/market-opportunities';
import { RIVAL_SYSTEMS_RULES } from '../modules/rival-systems';
import { CompanyWorldPanel } from './company-progression-panel';

export interface MarketDynamicsPanelProps {
  game: GameState;
  onNavigate?: (panel: StudioPanelId) => void;
}

/** A visible strategy briefing, with links to existing workbenches and no extra weekly chores. */
export function MarketDynamicsPanel({ game, onNavigate }: MarketDynamicsPanelProps) {
  const view = getMarketOpportunityView(game), opportunity = view.active ?? view.upcoming;
  const rivals = Object.values(game.slices.markets.rivals);
  if (!game.slices.markets.opportunityCalendar) return null;
  const responsePanel: StudioPanelId = opportunity?.segmentIds.includes('developers') ? 'developer-api'
    : opportunity?.segmentIds.includes('business') ? 'business-commitments' : 'product';
  return <section className="market-dynamics-panel" aria-labelledby="market-opportunities-heading">
    <CompanyWorldPanel game={game} />
    <h3 id="market-opportunities-heading">Market opportunities</h3>
    <p className="small-note">Buying windows are announced {MARKET_OPPORTUNITY_RULES.noticeWeeks} weeks ahead. You can prepare for one or keep your current strategy; participation is automatic for eligible offers.</p>
    {opportunity ? <article className="market-opportunity-card">
      <div className="asset-summary"><strong>{opportunity.name}</strong><span>{opportunity.status === 'active' ? 'Open now' : `Opens in ${opportunity.startsWeek - game.week} weeks`}</span></div>
      <p><strong>Weeks {opportunity.startsWeek}–{opportunity.endsWeek}</strong> · {opportunity.segmentIds.map(id => SEGMENT_BY_ID[id].name).join(' and ')}</p>
      <p>{opportunity.description}</p>
      <p className="small-note"><strong>{(opportunity.demandMultiplierBps / 10000).toFixed(2).replace(/0$/, '')}× the normal shopping rate</strong> among available customers. This raises opportunities for trials, not guaranteed sales. Qualification, competition, reach and available serving capacity still apply.</p>
      <p className="small-note">{opportunity.response}</p>
      {onNavigate && <div className="market-dynamics-actions"><button type="button" onClick={() => onNavigate(responsePanel)}>Review your offer</button><button type="button" onClick={() => onNavigate('compute')}>Check serving capacity</button></div>}
    </article> : <p className="small-note">No buying window is active. {view.nextAnnouncementWeek !== null ? `The next opportunity is announced in Week ${view.nextAnnouncementWeek}.` : 'Keep developing your current offer.'}</p>}
    <h3>Rival plans</h3>
    <p className="small-note">These are announced intentions, with review dates rather than promised completion dates. Rivals fund the same research, training, testing and delivery work that you do.</p>
    <div className="rival-campaign-list">{rivals.map(rival => {
      const campaign = rival.campaign, definition = campaign ? RIVAL_CAMPAIGN_RULES[campaign.kind] : null;
      const tactic = campaign?.tactics ? RIVAL_TACTIC_RULES[campaign.tactics.focus] : null;
      return <article className="rival-campaign-card" key={rival.companyId}>
        <div className="asset-summary"><strong>{game.slices.company.companies[rival.companyId].name}</strong><span>{rival.withdrawn ? 'Operations suspended' : campaign?.status === 'protecting-cash' ? 'Protecting cash' : campaign?.status === 'completed' ? 'Objective reached' : 'In progress'}</span></div>
        <h4>{campaign?.systems ? RIVAL_SYSTEMS_RULES[campaign.systems.focus].name : definition?.name ?? 'Preparing a strategy'}</h4>
        {campaign && <p className="small-note">{SEGMENT_BY_ID[campaign.targetSegment].name} · Review in Week {campaign.reviewWeek}{campaign.priceTargetCents !== null ? ` · Reference bill target ${formatMoney(campaign.priceTargetCents)}` : ''}</p>}
        {definition && <p className="small-note"><strong>{definition.name}.</strong> {definition.description}</p>}
        {campaign?.systems && <p className="small-note">{RIVAL_SYSTEMS_RULES[campaign.systems.focus].description}</p>}
        {tactic && <p className="small-note"><strong>Approach: {tactic.name}.</strong> {tactic.description}</p>}
        <p className="small-note">{campaign?.lastDecision ?? rival.publicActivity}</p>
      </article>;
    })}</div>
    <p className="small-note">You can compete on price, improve the offer, serve another audience, or keep a profitable niche. No response is required each week.</p>
  </section>;
}
