'use client';

import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import { useId, useMemo } from 'react';
import { ArrowRight, BookOpen, Check, Clock3, Cpu, GitBranch, LockKeyhole, Users } from 'lucide-react';
import type { CommandPayload, GameState, StaffRole } from '../contracts/types';
import { formatMoney, formatUnits } from '../core/math';
import { reservedCash } from '../core/selectors';
import { ActionControl, ROLE_LABELS } from './components';
import { researchApplicationLink } from './guide-links';
import { getStudioResearchApplication, getStudioResearchCapacity, getStudioResearchReadiness, getStudioResearchTreeNodes } from './studio-research-tree';

export interface StudioResearchMethodProps {
  game: GameState;
  canAct: boolean;
  onQueue: (payload: CommandPayload) => void;
  /** An exact method, never an instruction to choose the newest available one. */
  researchId: string | null;
  onOpenMethod: (researchId: string) => void;
  onOpenPanel: (panelId: string, researchId?: string) => void;
  onReviewResources?: () => void;
  onReviewStaff?: (role: StaffRole) => void;
  onReviewCompute?: () => void;
  onBrowse?: () => void;
}

const STATUS_LABELS = {
  planned: 'Planned', locked: 'Locked', available: 'Unlocked', running: 'In progress',
  paused: 'Paused', pending: 'Research finished · ready next week', complete: 'Available to use',
  queued: 'Queued', blocked: 'Needs a decision',
} as const;

/** A focused body for the shared task surface. It has no second modal, command
 * owner or editable copy of research state. The full tree remains its workspace. */
export function StudioResearchMethod({ game, canAct, onQueue, researchId, onOpenMethod, onOpenPanel, onReviewResources, onReviewStaff, onReviewCompute, onBrowse }: StudioResearchMethodProps) {
  const chooserId = useId();
  const nodes = useMemo(() => getStudioResearchTreeNodes(game), [game]);
  const selected = nodes.find(node => node.id === researchId);
  const capacity = useMemo(() => getStudioResearchCapacity(game), [game]);
  const browse = onBrowse ?? (() => onOpenPanel('research'));
  const chooser = <label className="studio-method-chooser" htmlFor={chooserId}>Research method
    <select id={chooserId} value={selected?.id ?? ''} onChange={event => { if (event.target.value) onOpenMethod(event.target.value); }}>
      <option value="">Choose a method</option>
      {nodes.map(node => <option key={node.id} value={node.id}>{node.id} · {node.name} · {STATUS_LABELS[node.status]}</option>)}
    </select>
  </label>;

  if (!selected) return <section className="studio-research-method" aria-label="Research method" data-research-method="">
    <div className="studio-method-empty" role="status"><BookOpen size={26} aria-hidden="true" />
      <h3>{researchId ? 'This method is unavailable' : 'Choose a research method'}</h3>
      <p>{researchId ? 'This discovery is unavailable. Choose another method or return to the research tree.' : 'Choose a discovery to see what it needs, what it costs, and what it unlocks.'}</p>
    </div>
    {chooser}
    <button type="button" className="studio-method-secondary" onClick={browse}>Browse research tree<ArrowRight size={15} aria-hidden="true" /></button>
  </section>;

  const project = selected.project;
  const available = selected.status === 'complete';
  const pending = selected.status === 'pending';
  const payload: CommandPayload | null = project && project.status !== 'complete'
    ? { kind: 'set_research_paused', projectId: project.id, paused: project.status !== 'paused' }
    : !available && !pending ? { kind: 'start_research', researchId: selected.id } : null;
  const actionLabel = project ? (project.status === 'paused' ? 'Review resume' : 'Review pause') : 'Review research';
  const application = getStudioResearchApplication(game, selected.id);
  const applicationLink = researchApplicationLink(selected.id);
  const readiness = getStudioResearchReadiness(selected, capacity);
  const cashAvailable = game.slices.company.companies[game.playerCompanyId].cashCents - reservedCash(game, game.playerCompanyId);
  const queued = selected.status === 'queued';
  const cashReady = !!project || queued || cashAvailable >= selected.feeCents;
  const prerequisitesReady = selected.definition.requires.every(id => nodes.find(node => node.id === id)?.status === 'complete');
  const staffReady = readiness.staffRemaining <= 0 || capacity.roles[selected.role] > 0;
  const computeReady = readiness.computeRemaining <= 0 || !readiness.needsCompute;
  const roleLabel = WORK_POINT_LABELS[selected.role].toLowerCase();
  const reviewStaff = () => onReviewStaff ? onReviewStaff(selected.role) : onReviewResources ? onReviewResources() : onOpenPanel('people');
  const reviewCompute = () => onReviewCompute ? onReviewCompute() : onReviewResources ? onReviewResources() : onOpenPanel('compute');
  const successors = nodes.filter(node => node.definition.requires.includes(selected.id));

  return <section className="studio-research-method" aria-label="Research method" data-research-method={selected.id}>
    <header className="studio-method-heading">
      <span className="studio-method-kicker">Discovery {selected.id}</span>
      <h3>{selected.name}</h3>
      <span className={'studio-method-state is-' + selected.status}>{available ? <Check size={14} aria-hidden="true" /> : pending ? <Clock3 size={14} aria-hidden="true" /> : selected.gate ? <LockKeyhole size={14} aria-hidden="true" /> : <BookOpen size={14} aria-hidden="true" />}{STATUS_LABELS[selected.status]}</span>
    </header>

    <section className="studio-method-summary" aria-label="What you gain and spend">
    <h4>What you gain</h4><p>{selected.description}</p>
    <dl className="studio-method-facts">
      <div><dt>{project ? 'Entry fee · already charged' : queued ? 'Entry fee · reserved' : 'Entry fee'}</dt><dd>{formatMoney(selected.feeCents)}</dd></div>
      <div><dt>Required {WORK_POINT_LABELS[selected.role].toLowerCase()} work</dt><dd>{formatWorkPoints(project?.requiredStaff ?? selected.requiredStaff)} points</dd></div>
      <div><dt>Required research compute</dt><dd>{formatUnits(project?.requiredWork ?? selected.requiredWork)} CUw</dd></div>
      <div><dt>Ready to use</dt><dd>{available ? project?.availableWeek === undefined ? 'Available now' : 'Available since Week ' + project.availableWeek : pending ? project?.availableWeek === undefined ? 'Waiting to unlock' : 'Week ' + project.availableWeek : 'The week after research finishes'}</dd></div>
    </dl>
    <p className="studio-method-note">{project ? 'The entry fee is already paid.' : queued ? 'The entry fee is reserved for next week.' : 'Pay the research fee once when the project starts.'} Salaries and GPU rentals continue each week. Using the discovery later is a separate project with its own costs and requirements.</p>
    </section>

    {!available && !pending && <section className="studio-method-section studio-method-readiness" aria-label="Research requirements">
      <h4>What it needs</h4>
      <ul className="studio-method-checklist">
        <li data-ready={cashReady}>{cashReady ? <Check size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<div><strong className="studio-method-check-label">Cash for the entry fee</strong><span className="studio-method-check-detail">{project ? 'Already paid' : queued ? formatMoney(selected.feeCents) + ' reserved' : formatMoney(cashAvailable) + ' available · ' + formatMoney(selected.feeCents) + ' needed'}</span></div></li>
        <li data-ready={prerequisitesReady}>{prerequisitesReady ? <Check size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}<div><strong className="studio-method-check-label">Prerequisites</strong>{selected.definition.requires.length ? <div className="studio-method-prerequisites">
          {selected.definition.requires.map(id => {
            const prerequisite = nodes.find(node => node.id === id);
            return <button type="button" key={id} onClick={() => onOpenMethod(id)}><span>{id} · {prerequisite?.name ?? 'Unavailable prerequisite'}</span><small>{prerequisite ? STATUS_LABELS[prerequisite.status] : 'Unavailable'}</small><ArrowRight size={14} aria-hidden="true" /></button>;
          })}
        </div> : <span className="studio-method-check-detail">No earlier discoveries needed</span>}</div></li>
        <li data-ready={staffReady}>{staffReady ? <Check size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<div><strong className="studio-method-check-label">{WORK_POINT_LABELS[selected.role]} points each week</strong><span className="studio-method-check-detail">{formatWorkPoints(capacity.roles[selected.role])} points / week{readiness.staffRemaining <= 0 ? ' · required points complete' : readiness.needsStaff ? ' · waiting for points' : ' · shared with your other projects'}</span></div></li>
        <li data-ready={computeReady}>{computeReady ? <Check size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<div><strong className="studio-method-check-label">Research compute limit</strong><span className="studio-method-check-detail">{formatUnits(capacity.researchCU)} CU{readiness.computeRemaining <= 0 ? ' · required compute work finished' : capacity.researchCU <= 0 ? ' · compute work will wait' : readiness.needsCompute ? ' · no suitable GPUs online' : ' · ' + readiness.estimate.poolName}</span></div></li>
      </ul>
      {selected.gate && <p className="studio-method-blocker" role="status"><LockKeyhole size={15} aria-hidden="true" /><span>{selected.gate}</span></p>}
      {(readiness.needsStaff || readiness.needsCompute) && <p className="studio-method-readiness-note">{selected.status === 'available' ? 'You can schedule this now. ' : ''}{readiness.needsStaff && readiness.needsCompute ? 'Both point progress and compute work will wait for resources.' : readiness.needsStaff ? 'Point progress will wait for matching team output; compute work can progress if capacity is available.' : 'Compute work will wait for suitable GPUs and a research allocation; point progress can continue if the team produces the right points.'} Both must finish before the discovery unlocks.</p>}
      <p className="studio-method-note">Other projects share the team’s points and GPUs. Queued changes and new hires finishing onboarding can change next week’s output.</p>
      <div className="studio-method-resource-actions">
        <button type="button" className="studio-method-secondary" onClick={reviewStaff}><Users size={15} aria-hidden="true" />{readiness.needsStaff ? 'Increase ' + roleLabel + ' output' : 'Review team output'}</button>
        <button type="button" className="studio-method-secondary" onClick={reviewCompute}><Cpu size={15} aria-hidden="true" />{readiness.needsCompute ? 'Allocate research compute' : 'Review research compute'}</button>
      </div>
    </section>}

    {project && <section className="studio-method-section" aria-label="Research progress">
      <h4>Research progress</h4>
      <div className="studio-method-meters">
        <label>{WORK_POINT_LABELS[selected.role]} work <strong>{formatWorkPoints(project.completedStaff)} / {formatWorkPoints(project.requiredStaff)} points</strong><progress value={project.completedStaff} max={project.requiredStaff} aria-label={selected.name + ' point progress'} /></label>
        <label>Research compute <strong>{formatUnits(project.completedWork)} / {formatUnits(project.requiredWork)} CUw</strong><progress value={project.completedWork} max={project.requiredWork} aria-label={selected.name + ' compute progress'} /></label>
      </div>
      {project.lastBottleneck && !available && !pending && <p className="studio-method-blocker">{project.lastBottleneck}</p>}
      {project.completedWeek !== undefined && <p className="studio-method-note">Research finished in Week {project.completedWeek}.{pending ? ' The discovery will be ready to use next week.' : ''}</p>}
    </section>}

    {payload && <section className="studio-method-section" aria-label="Research decision">
      <ActionControl game={game} payload={payload} label={actionLabel} taskAction="research-method" canAct={canAct} onQueue={onQueue} />
    </section>}

    <details className="studio-method-section studio-method-application" aria-label="Method application" open={available || pending}>
      <summary>Put it to work</summary>
      <strong>{application.summary}</strong><p>{application.detail}</p>
      {!available && <p className="studio-method-note">Unlock this discovery first. Using it is a separate project with its own costs and requirements.</p>}
      {applicationLink && <button type="button" className="studio-method-secondary" onClick={() => onOpenPanel(applicationLink.href.slice(1), selected.id)}>{available ? applicationLink.label : 'See how to use it'}<ArrowRight size={15} aria-hidden="true" /></button>}
      {application.entries && <details><summary>Projects using this discovery ({application.entries.length})</summary><ul>{application.entries.map(entry => <li key={entry.name}><strong>{entry.name}</strong><span>{entry.status}</span><p>{entry.staff}{entry.work ? ' · ' + entry.work : ''}</p>{entry.note && <p>{entry.note}</p>}</li>)}</ul></details>}
    </details>

    <details className="studio-method-record"><summary>More details and other methods</summary>{chooser}
      <dl><div><dt>Research ID</dt><dd>{selected.id}</dd></div>{project && <><div><dt>Project</dt><dd>{project.id}</dd></div><div><dt>Started</dt><dd>Week {project.startedWeek}</dd></div></>}</dl>
      {successors.length > 0 && <><p>Leads to</p><div className="studio-method-successors">{successors.map(node => <button type="button" key={node.id} onClick={() => onOpenMethod(node.id)}>{node.id} · {node.name}<ArrowRight size={14} aria-hidden="true" /></button>)}</div></>}
      <button type="button" className="studio-method-secondary" onClick={browse}>Browse research tree<ArrowRight size={15} aria-hidden="true" /></button>
    </details>
  </section>;
}
