'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowUpRight, Archive, Check, ChevronRight, Inbox, RotateCcw } from 'lucide-react';
import { filterStudioResults, STUDIO_RESULT_LIMIT } from '../core/studio-results';
import type { StudioAttention, StudioResult, StudioResultFilter, StudioResultFlags, StudioResultKind, StudioResultTarget } from '../core/studio-results';

export interface StudioResultsPanelProps {
  results: readonly StudioResult[];
  flags: StudioResultFlags;
  attention: readonly StudioAttention[];
  ready?: boolean;
  persistenceNotice?: string;
  disabled?: boolean;
  onReview: (keys: readonly string[]) => void;
  onDismiss: (key: string) => void;
  onRestore: (key: string) => void;
  onAction: (target: StudioResultTarget) => void;
}

export const STUDIO_RESULT_LABELS: Record<StudioResultKind, string> = {
  data: 'Data', training: 'Training', evaluation: 'Evaluation', research: 'Research', deployment: 'Products', staff: 'People', brief: 'Customer briefs',
};

interface StudioResultDetailProps extends Pick<StudioResultsPanelProps, 'flags' | 'disabled' | 'onReview' | 'onDismiss' | 'onRestore' | 'onAction'> {
  result: StudioResult;
  onBack: () => void;
}

export function StudioResultDetail({ result, flags, disabled, onReview, onDismiss, onRestore, onAction, onBack }: StudioResultDetailProps) {
  const heading = useRef<HTMLHeadingElement>(null), flag = flags[result.key];
  useEffect(() => { heading.current?.focus(); }, [result.key]);
  return <section className="studio-result-detail" aria-label="Result detail">
    <button type="button" className="studio-results-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back to results</button>
    <div className="studio-result-kicker"><span>{STUDIO_RESULT_LABELS[result.kind]}</span><span>Week {result.week}</span><span>{flag?.dismissed ? 'Dismissed' : flag?.reviewed ? 'Reviewed' : 'Unreviewed'}</span></div>
    <h2 ref={heading} tabIndex={-1}>{result.title}</h2>
    <p className="studio-result-summary">{result.summary}</p>
    <dl className="studio-result-facts">{result.details.map((detail, index) => <div key={detail.label + index}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
    {result.unavailableReason && <p className="studio-result-unavailable" role="status"><AlertCircle size={18} aria-hidden="true" />{result.unavailableReason}</p>}
    <div className="studio-result-detail-actions">
      {result.action && <button type="button" className="studio-results-primary" disabled={disabled} onClick={() => { onReview([result.key]); onAction(result.action!.target); }}>{result.action.label}<ArrowUpRight size={16} aria-hidden="true" /></button>}
      {result.developmentAction && <button type="button" className="studio-results-secondary" disabled={disabled} onClick={() => { onReview([result.key]); onAction(result.developmentAction!.target); }}>{result.developmentAction.label}</button>}
      {flag?.dismissed ? <button type="button" className="studio-results-secondary" disabled={disabled} onClick={() => onRestore(result.key)}><RotateCcw size={16} aria-hidden="true" />Show in recent results</button>
        : <button type="button" className="studio-results-secondary" disabled={disabled} onClick={() => onDismiss(result.key)}><Archive size={16} aria-hidden="true" />Hide from recent results</button>}
    </div>
    <p className="studio-results-footnote">Hiding this card keeps the original result in your lab’s history.</p>
  </section>;
}

/** Body for the single shared Studio surface. This component never creates a
 * dialog, opens itself, changes clock state, or commits a simulation command. */
export function StudioResultsPanel({ results, flags, attention, ready = true, persistenceNotice, disabled = false, onReview, onDismiss, onRestore, onAction }: StudioResultsPanelProps) {
  const id = useId();
  const [tab, setTab] = useState<'recent' | 'attention'>('recent');
  const [filter, setFilter] = useState<StudioResultFilter>({ kind: 'all', week: null, visibility: 'all' });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectionButton = useRef<HTMLButtonElement | null>(null);
  const selectionKey = useRef<string | null>(null);
  const recentButton = useRef<HTMLButtonElement | null>(null);
  const selected = selectedKey ? results.find(item => item.key === selectedKey) : undefined;
  const unreadCount = results.filter(item => !flags[item.key]?.reviewed && !flags[item.key]?.dismissed).length;
  const visible = filterStudioResults(results, flags, filter);
  const weeks = [...new Set(results.map(item => item.week))].sort((a, b) => b - a);
  const visibleWeeks = [...new Set(visible.map(item => item.week))];
  const controlsDisabled = disabled || !ready;
  const closeDetail = () => {
    setSelectedKey(null);
    // The row is already mounted when React commits this callback's update.
    requestAnimationFrame(() => (selectionButton.current ?? recentButton.current)?.focus());
  };

  return <div className="studio-results-panel">
    {persistenceNotice && <p className="studio-results-notice" role="status">{persistenceNotice}</p>}
    {!ready && <p className="studio-results-notice" role="status">Loading your results…</p>}
    {selected ? <StudioResultDetail result={selected} flags={flags} disabled={controlsDisabled} onReview={onReview} onDismiss={onDismiss} onRestore={onRestore} onAction={onAction} onBack={closeDetail} /> : <>
      {selectedKey && <p className="studio-result-unavailable" role="status">This result is no longer available here. Choose another result.</p>}
      <div className="studio-results-tabs" role="group" aria-label="Results sections">
        <button ref={recentButton} type="button" aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}><Inbox size={17} aria-hidden="true" />Recent results<span className="studio-results-count">{ready ? unreadCount : '…'}<span className="sr-only"> unreviewed</span></span></button>
        <button type="button" aria-pressed={tab === 'attention'} onClick={() => setTab('attention')}><AlertCircle size={17} aria-hidden="true" />Needs attention<span className="studio-results-count">{attention.length}</span></button>
      </div>
      {tab === 'attention' ? <section className="studio-attention-list" aria-label="Needs attention">
        <p className="studio-results-intro">See what’s holding up your lab and what’s ready to use. Open an item to take a closer look.</p>
        {!attention.length ? <div className="studio-results-empty"><Check size={30} aria-hidden="true" /><h2>Nothing needs attention</h2><p>Project delays, new staff and save problems will appear here when they need your attention.</p></div>
          : attention.map(item => <article key={item.key} className={'studio-attention-card attention-' + (item.tone ?? 'info')}><div><span className="studio-result-kind">{item.tone === 'warning' ? 'Needs a decision' : 'Readiness'}</span><h2>{item.title}</h2><p>{item.detail}</p></div>{item.action && <button type="button" className="studio-results-secondary" disabled={disabled} onClick={() => onAction(item.action!.target)}>{item.action.label}<ChevronRight size={16} aria-hidden="true" /></button>}</article>)}
      </section> : <section aria-label="Recent results">
        <p className="studio-results-intro">Your newest {STUDIO_RESULT_LIMIT} results appear here with suggested next steps. Read or hide a card whenever you like.</p>
        <div className="studio-results-filters">
          <label htmlFor={id + '-kind'}>Result type<select id={id + '-kind'} value={filter.kind} onChange={event => setFilter({ ...filter, kind: event.target.value as StudioResultFilter['kind'] })}><option value="all">All types</option>{Object.entries(STUDIO_RESULT_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <label htmlFor={id + '-week'}>Completion week<select id={id + '-week'} value={filter.week ?? 'all'} onChange={event => setFilter({ ...filter, week: event.target.value === 'all' ? null : Number(event.target.value) })}><option value="all">All weeks</option>{weeks.map(week => <option key={week} value={week}>Week {week}</option>)}</select></label>
          <label htmlFor={id + '-visibility'}>Show<select id={id + '-visibility'} value={filter.visibility} onChange={event => setFilter({ ...filter, visibility: event.target.value as StudioResultFilter['visibility'] })}><option value="all">All visible</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option></select></label>
        </div>
        {!visible.length ? <div className="studio-results-empty"><Inbox size={30} aria-hidden="true" /><h2>{results.length ? 'No results match these filters' : 'No results yet'}</h2><p>{results.length ? 'Try another type, week or filter. Use Show to find hidden cards.' : 'Finished projects, discoveries, launches and new staff will appear here.'}</p>{results.length > 0 && <button className="studio-results-secondary" type="button" onClick={() => setFilter({ kind: 'all', week: null, visibility: 'all' })}>Reset filters</button>}</div>
          : visibleWeeks.map(week => <section key={week} className="studio-result-week" aria-label={'Week ' + week + ' outcomes'}><div className="studio-result-week-heading"><h2>Week {week}</h2><button type="button" className="studio-results-text-button" disabled={controlsDisabled || results.filter(item => item.week === week).every(item => flags[item.key]?.reviewed)} onClick={() => onReview(results.filter(item => item.week === week).map(item => item.key))}><Check size={14} aria-hidden="true" />Mark week reviewed</button></div>
            <div className="studio-result-cards">{visible.filter(item => item.week === week).map(item => <button key={item.key} ref={node => { if (selectionKey.current === item.key) selectionButton.current = node; }} type="button" className={'studio-result-card' + (!flags[item.key]?.reviewed && !flags[item.key]?.dismissed ? ' is-unreviewed' : '')} onClick={event => { selectionKey.current = item.key; selectionButton.current = event.currentTarget; setSelectedKey(item.key); if (ready) onReview([item.key]); }}>
              <span className="studio-result-card-main"><span className="studio-result-card-meta"><span className="studio-result-kind">{STUDIO_RESULT_LABELS[item.kind]}</span><span className="studio-result-reviewed">{flags[item.key]?.dismissed ? 'Dismissed' : flags[item.key]?.reviewed ? 'Reviewed' : ready ? 'Unreviewed' : 'Loading'}</span></span><strong>{item.title}</strong><span className="studio-result-card-summary">{item.summary}</span><span className="studio-result-card-next">{item.action?.label ?? 'View result'}</span></span><ChevronRight size={20} aria-hidden="true" />
            </button>)}</div>
          </section>)}
        <p className="studio-results-footnote">Look in each project’s menu for older results. Read and hidden markers stay in this browser and are not included in exported saves.</p>
      </section>}
    </>}
  </div>;
}
