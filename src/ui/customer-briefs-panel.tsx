'use client';

import { CUSTOMER_BRIEFS } from '../content/customer-briefs';
import { OPTIONAL_BRIEF_IDS, type CustomerBrief } from '../contracts/customer-briefs';
import { formatMoney } from '../core/math';
import { briefTargetText } from '../modules/customer-briefs';
import { getSpecialistBriefCandidate, isSpecialistBrief } from '../modules/specialist-briefs';
import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { SystemsBriefsPanel } from './systems-briefs-panel';
import { ActionControl, Section } from './components';
import type { PanelProps } from './panels';

function deliveryLink(brief: CustomerBrief, props: PanelProps) {
  if (isSpecialistBrief(brief.id)) return { href: '#compute', label: 'Reserve the client’s serving capacity' };
  if (brief.id === 'launch-window' || brief.id === 'lean-service') return { href: '#compute', label: 'Manage compute capacity' };
  if (brief.id === 'research-sprint') return { href: '#research', label: 'Choose a research project' };
  const { view, game } = props;
  if (brief.id === 'consultancy-pilot' && !view.progress.dataReady) return { href: '#data', label: 'Prepare pilot data' };
  const candidate = Object.values(game.slices.models.trainingRuns).find(r => r.companyId === game.playerCompanyId && r.startedWeek >= brief.startedWeek && r.status === 'complete');
  if (!candidate) return { href: '#lab-projects', label: 'Design the training run' };
  return brief.id === 'consultancy-pilot' && view.progress.evaluated
    ? { href: '#product', label: 'Launch Basic Chat' } : { href: '#models', label: 'Test the new model' };
}

export function CustomerBriefsPanel(props: PanelProps) {
  const { game, canAct, onQueue } = props;
  const records = game.slices.campaign.customerBriefs ?? {};
  const active = Object.values(records).find(b => b.status === 'active');
  const closed = Object.values(records).filter(b => b.status !== 'active').sort((a, b) => b.finishedWeek! - a.finishedWeek!);
  const earned = game.slices.company.companies[game.playerCompanyId].earnedRevenueCents > 0;
  const offers = OPTIONAL_BRIEF_IDS.filter(id => records[id]?.status !== 'completed'
    && (!isSpecialistBrief(id) || [GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(game.contentVersion)));
  function activeCard(brief: CustomerBrief) {
    const def = CUSTOMER_BRIEFS[brief.id], target = briefTargetText(game, brief.id, brief), next = deliveryLink(brief, props);
    return <article className="project-row campaign-route" aria-label="Active customer brief">
      <div className="project-heading"><strong>{def.title}</strong><span>Due Week {brief.deadlineWeek}</span></div>
      <p>{def.client} · {formatMoney(def.feeCents)} on delivery</p>
      <p className="small-note">{def.terms}</p>
      {target && <p className="small-note">{target}</p>}
      {def.qualifyingWeeks > 1 && <><strong>{brief.qualifyingWeeks} / {def.qualifyingWeeks} consecutive weeks</strong>
        <progress value={brief.qualifyingWeeks} max={def.qualifyingWeeks} aria-label="Consecutive qualifying weeks" /></>}
      <p role="status">{brief.feedback}</p>
      <p className="guide-actions"><a href={next.href}>{next.label}</a>{brief.id === 'lean-service' && <a href="#business-commitments">Check client renewal</a>}</p>
    </article>;
  }
  function offer(id: typeof OPTIONAL_BRIEF_IDS[number]) {
    const def = CUSTOMER_BRIEFS[id];
    const candidate = isSpecialistBrief(id) ? getSpecialistBriefCandidate(game, id) : null;
    return <article key={id} className="project-row campaign-route">
      <div className="project-heading"><strong>{def.title}</strong><span>{formatMoney(def.feeCents)} · {def.weeks} weeks</span></div>
      <p className="small-note">{def.client}</p><p>{def.terms}</p>
      <p className="small-note">{def.advice}</p>
      {isSpecialistBrief(id) && <>
        <p className="small-note">{candidate ? briefTargetText(game, id, candidate) : 'No tested model meets every requirement yet. Build toward this target before accepting the client workload.'}</p>
        <p className="guide-actions"><a href="#lab-projects">Design a specialist</a><a href="#models">Inspect models and tests</a></p>
      </>}
      <ActionControl game={game} canAct={canAct} onQueue={onQueue} payload={{ kind: 'accept_customer_brief', briefId: id }}
        label={(records[id]?.status === 'expired' ? 'Retry ' : 'Accept ') + def.title} compact />
    </article>;
  }
  return <Section title="Customer briefs" id="customer-briefs">
    <SystemsBriefsPanel game={game} canAct={canAct} onQueue={onQueue} />
    <h3 className="systems-legacy-heading">Campaign commissions</h3>
    {active ? activeCard(active) : earned && offers.length > 0 ? <>
      <p className="small-note">Choose one commission at a time. The first delivery week is Week {game.week + 1}. The client pays on completion. Missed optional briefs can be tried again.</p>
      <div className="campaign-routes">{offers.map(offer)}</div>
    </> : <p className="small-note">{earned ? 'All available commissions have been delivered.' : 'Make your first sale to receive customer commissions.'}</p>}
    {closed.length > 0 && <details className="inline-details"><summary>Delivery history · {closed.length}</summary><ul className="campaign-criteria">
      {closed.map(brief => <li key={brief.id}><strong>{CUSTOMER_BRIEFS[brief.id].title}</strong>{' · Week ' + brief.finishedWeek + ' · '}
        {brief.status === 'completed' ? formatMoney(CUSTOMER_BRIEFS[brief.id].feeCents) + ' received' : 'Expired · no fee earned'}
        <p className="small-note">{brief.feedback}</p></li>)}
    </ul></details>}
  </Section>;
}
