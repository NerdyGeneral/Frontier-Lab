'use client';

import { COMPANY_ORIGIN_LEGACIES } from '../content/company-progression';
import { getCompanyAmbitionView, getCompanyWorld } from '../modules/company-progression';
import { Metric, Metrics } from './components';
import type { PanelProps } from './panels';

export function CompanyWorldPanel({ game }: Pick<PanelProps, 'game'>) {
  const world = getCompanyWorld(game);
  if (!world) return null;
  const origin = COMPANY_ORIGIN_LEGACIES[game.slices.campaign.origin ?? 'garage'];
  return <article className="project-row" aria-label="World conditions and founding advantage">
    <div className="project-heading"><strong>{world.name}</strong><span>Campaign conditions</span></div>
    <p className="small-note">{world.description}</p>
    <p className="small-note"><strong>Founding advantage · {origin.name}.</strong> {origin.description}</p>
    <p className="small-note">These conditions stay fixed for this campaign. A different campaign seed can favor another business path. Existing customers and market populations are unchanged.</p>
  </article>;
}
export function CompanySpecialistAmbitions({ game }: Pick<PanelProps, 'game'>) {
  const ambitions = getCompanyAmbitionView(game);
  if (!ambitions.length) return null;
  return <div>
    <h3>Build the company your technology deserves</h3>
    <p className="small-note">These additional paths recognize efficient services, private delivery, verified work and hardware. All track delivered outcomes automatically. Earning any company path opens the frontier stage of systems research.</p>
    <Metrics><Metric label="Specialist company ambitions">{ambitions.filter(ambition => ambition.earnedWeek !== null).length} / {ambitions.length}</Metric></Metrics>
    <div className="campaign-routes">{ambitions.map(ambition => <article className="project-row campaign-route" key={ambition.id} aria-label={ambition.name + ' ambition'}>
      <div className="project-heading"><strong>{ambition.name}</strong><span>{ambition.earnedWeek !== null ? `Earned · Week ${ambition.earnedWeek}` : `${ambition.streak} / ${ambition.weeks} weeks`}</span></div>
      <p className="small-note">{ambition.description}</p>
      {ambition.earnedWeek === null && <p className="small-note">{ambition.criteria.find(criterion => !criterion.met)?.label ?? 'All requirements met. Sustain the company through the remaining weeks.'}</p>}
      <progress value={ambition.earnedWeek !== null ? ambition.weeks : ambition.streak} max={ambition.weeks} aria-label={ambition.name + ' consecutive weeks'} />
      <details className="inline-details"><summary>Requirements · {ambition.criteria.filter(criterion => criterion.met).length} / {ambition.criteria.length} met</summary><ul className="campaign-criteria">{ambition.criteria.map(criterion => <li key={criterion.id}><div className="criterion-heading"><span>{criterion.met ? '✓' : '·'} {criterion.label}</span><span>{criterion.current} / {criterion.target}</span></div><p className="small-note">{criterion.detail}</p></li>)}</ul></details>
    </article>)}</div>
  </div>;
}
