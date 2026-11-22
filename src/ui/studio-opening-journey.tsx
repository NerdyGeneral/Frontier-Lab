'use client';

import { ArrowUpRight, Check, CheckCircle2, ChevronRight, FlaskConical, Wallet } from 'lucide-react';
import type { StudioMilestone } from '../core/studio';
import type { StudioJourney, StudioJourneyAction } from '../core/studio-journey';
import { formatMoney } from '../core/math';

interface StudioOpeningJourneyProps {
  journey: StudioJourney;
  milestones: StudioMilestone[];
  paused: boolean;
  disabled: boolean;
  weeklyBaseCostCents: number;
  onAction: (action: StudioJourneyAction) => void;
  onChooseCandidate: (id: string) => void;
}

const statusLabels = {
  ready: 'Ready', queued: 'Queued', working: 'Working', waiting: 'Waiting',
  blocked: 'Blocked', complete: 'Complete', unavailable: 'Unavailable', choose: 'Choose a model', rejected: 'Rejected',
};

/** One derived opening guide. It never queues, advances time, or invents a run
 * from an accepted receipt; every action is handled by the ordinary shell. */
export function StudioOpeningJourney({ journey, milestones, paused, disabled, weeklyBaseCostCents, onAction, onChooseCandidate }: StudioOpeningJourneyProps) {
  return <section className="studio-next-move studio-opening-guide" aria-label="Opening journey">
    <div className="studio-opening-kicker"><span className="studio-eyebrow">YOUR FIRST LAUNCH</span><span className="studio-opening-clock">{paused ? 'Lab paused' : 'Lab running'}</span></div>
    <div className="studio-next-icon"><FlaskConical size={24} strokeWidth={1.5} /></div>
    <span className={'studio-opening-status journey-' + journey.status}>{statusLabels[journey.status]}</span>
    <h2>{journey.title}</h2>
    <p>{journey.detail}</p>
    {journey.progressBps !== undefined && <div className="studio-opening-progress"><progress value={journey.progressBps} max={10000} aria-label={journey.title + ' progress'} /><span>{Math.floor(journey.progressBps / 100)}%</span></div>}
    {!!journey.candidates?.length && <label className="studio-opening-choice" htmlFor="studio-journey-candidate">Model to follow
      <select id="studio-journey-candidate" value={journey.candidateId ?? ''} onChange={event => { if (event.target.value) onChooseCandidate(event.target.value); }} disabled={disabled}>
        <option value="">Choose a trained model</option>
        {journey.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>}
    <button className="studio-primary" type="button" onClick={() => onAction(journey.primary.action)} disabled={disabled}>{journey.primary.label}<ArrowUpRight size={16} /></button>
    {journey.secondary && <button className="studio-opening-secondary" type="button" onClick={() => onAction(journey.secondary!.action)} disabled={disabled}>{journey.secondary.label}<ChevronRight size={15} /></button>}
    <div className="studio-journey"><h3>The road to your first sale</h3><ol>{milestones.map((item, index) => <li key={item.id} className={item.complete ? 'is-done' : ''}><div className="studio-opening-milestone"><span className="studio-journey-step">{item.complete ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span><span>{item.label}</span>{item.complete && <CheckCircle2 size={14} />}</div></li>)}</ol></div>
    <div className="studio-weekly-cost"><Wallet size={17} /><span>Keep the lights on<strong>{formatMoney(weeklyBaseCostCents)}<small> / week base costs</small></strong></span></div>
  </section>;
}
