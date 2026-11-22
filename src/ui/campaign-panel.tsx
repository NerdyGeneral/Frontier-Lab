'use client';

import { CONTENT } from '../content/catalog';
import { getCampaignView } from '../modules/campaign';
import { Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';
import { campaignActionLinks } from './guide-links';
import { ChapterPanel } from './chapter-panel';

export function CampaignPanel(props: PanelProps) {
  const { game } = props;
  const campaign = getCampaignView(game, CONTENT);
  return <Section title="Chapters and company ambitions" id="campaign">
    <ChapterPanel {...props} />
    <h3 className="campaign-ambition-heading">Long-term ambitions</h3>
    <p className="small-note">All three ambitions track your results automatically at the end of each week. Open a route’s requirements to find your next goal.</p>
    <Metrics><Metric label="Campaign rules">{game.slices.campaign.rules === 'release' ? 'Release' : 'Classic'}</Metric><Metric label="Endings earned">{campaign.completedCount} / {campaign.routes.length}</Metric></Metrics>
    {campaign.completedCount > 0 && <p className="campaign-achievement">Ending unlocked! Keep running your company and work toward the other ambitions.</p>}
    <div className="campaign-routes">{campaign.routes.map(route => {
      const achieved = route.achievedWeek !== null && route.achievedWeek !== undefined;
      const met = route.criteria.filter(criterion => criterion.met).length;
      return <article className="project-row campaign-route" key={route.id} aria-label={route.name + ' route'}>
        <div className="project-heading"><strong>{route.name}</strong><span>{achieved ? 'Earned · Week ' + route.achievedWeek : route.streak + ' / ' + route.requiredWeeks + ' weeks'}</span></div>
        <p className="small-note">{route.description}</p>
        {!achieved && <p className="small-note">{met === route.criteria.length ? 'Hold these results to finish the streak.' : 'Next requirement · ' + route.criteria.find(criterion => !criterion.met)?.label}</p>}
        <progress value={achieved ? route.requiredWeeks : route.streak} max={route.requiredWeeks} aria-label={route.name + ' consecutive qualifying weeks'} />
        <details className="inline-details"><summary>{achieved ? 'Current company and route requirements' : 'Requirements met · ' + met + ' / ' + route.criteria.length}</summary>
          <ul className="campaign-criteria">{route.criteria.map(criterion => <li key={criterion.id}>
            <div className="criterion-heading"><span><span aria-hidden="true">{criterion.met ? '✓' : '·'}</span><span className="visually-hidden">{criterion.met ? 'Met: ' : 'Still needed: '}</span> {criterion.label}</span><span>{criterion.current} / {criterion.target}</span></div>
            <p className="small-note">{criterion.detail}</p>
            {!criterion.met && campaignActionLinks(criterion.id).length > 0 && <p className="guide-actions">{campaignActionLinks(criterion.id).map(link => <a key={link.href} href={link.href}>{link.label}</a>)}</p>}
          </li>)}</ul>
          <p className="small-note">Meet every goal for {route.requiredWeeks} weeks in a row. Missing a goal resets an unfinished streak. Endings you have already earned stay unlocked.</p>
        </details>
      </article>;
    })}</div>
  </Section>;
}
