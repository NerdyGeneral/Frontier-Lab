'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronRight, LockKeyhole, Search, X } from 'lucide-react';
import { STUDIO_MENU_GROUPS, findStudioMenuEntries } from '../core/studio-menu-catalog';
import type { StudioMenuFilter, StudioMenuTarget } from '../core/studio-menu-catalog';
import type { GameSectionVisibility } from './guide-links';
import { getStudioPanelLock } from './studio-navigation';

export interface StudioMenuDirectoryProps {
  sections: GameSectionVisibility;
  disabled?: boolean;
  onNavigate: (target: StudioMenuTarget) => void;
  onClose?: () => void;
}

/** An ordinary workspace page, not a modal. Every destination stays visible in
 * the catalog; a lock explains where to go next without hiding the entry. */
export function StudioMenuDirectory({ sections, disabled = false, onNavigate, onClose }: StudioMenuDirectoryProps) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [workspace, setWorkspace] = useState<NonNullable<StudioMenuFilter['workspace']>>('all');
  const entries = useMemo(() => findStudioMenuEntries({ query, workspace }), [query, workspace]);
  useEffect(() => {
    const search = searchRef.current;
    search?.focus({ preventScroll: true });
    if (search?.closest('.studio-mode[data-studio-short-viewport="true"]')) search.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, []);

  return <section className="studio-menu-directory" aria-labelledby={id + '-title'}>
    <header className="studio-menu-heading">
      <div><span className="studio-eyebrow">Find your next step</span><h1 id={id + '-title'}>All menus</h1>
        <p>Find a feature or search for what you want to do. Related actions stay together; your current draft is kept.</p></div>
      {onClose && <button type="button" className="studio-surface-button" onClick={onClose}><X size={16} aria-hidden="true" />Back to work</button>}
    </header>
    <div className="studio-menu-search" role="search" aria-label="Find a feature or action">
      <label htmlFor={id + '-search'}>Search features and actions</label>
      <div><Search size={18} aria-hidden="true" /><input ref={searchRef} id={id + '-search'} type="search" value={query}
        autoComplete="off" placeholder="Try: buy data, design model, hire, rollback…" onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear menu search"><X size={16} aria-hidden="true" /></button>}</div>
    </div>
    <div className="studio-menu-filters">
      <label htmlFor={id + '-workspace'}>Workspace<select id={id + '-workspace'} value={workspace} onChange={event => setWorkspace(event.target.value as typeof workspace)}>
        <option value="all">All workspaces</option>{STUDIO_MENU_GROUPS.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
      </select></label>
      <p role="status" aria-live="polite">{entries.length} {entries.length === 1 ? 'match' : 'matches'}{query.trim() ? ' for “' + query.trim() + '”' : ''}</p>
    </div>
    {entries.length ? <div className="studio-menu-groups">{STUDIO_MENU_GROUPS.map(group => {
      const matches = entries.filter(entry => entry.workspace === group.id);
      if (!matches.length) return null;
      return <section className="studio-menu-group" key={group.id} aria-labelledby={id + '-group-' + group.id}>
        <header><h2 id={id + '-group-' + group.id}>{group.label}</h2><p>{group.description}</p></header>
        <ul className="studio-menu-list">{matches.map(entry => {
          const lock = entry.panel ? getStudioPanelLock(entry.panel, sections) : null;
          return <li key={entry.id} data-menu-feature={entry.id}><button type="button" className="studio-menu-item" disabled={disabled}
            data-locked={lock ? 'true' : undefined} onClick={() => onNavigate(entry.target)}>
            <span><span className="studio-menu-item-heading"><strong>{entry.label}</strong></span>
              <span className="studio-menu-item-description">{entry.description}</span>
              {lock && <span className="studio-menu-lock"><LockKeyhole size={13} aria-hidden="true" />{lock}</span>}</span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
            {entry.actions.length > 0 && <div className="studio-menu-item-actions" role="group" aria-label={entry.label + ' shortcuts'}>{entry.actions.map(action => {
              const actionLock = action.panel ? getStudioPanelLock(action.panel, sections) : null;
              return <button type="button" key={action.id} className="studio-menu-shortcut" data-menu-action={action.id}
                disabled={disabled} data-locked={actionLock ? 'true' : undefined} title={actionLock ?? action.description}
                aria-description={actionLock ?? action.description} onClick={() => onNavigate(action.target)}>
                <span>{action.label}{actionLock && <LockKeyhole size={12} aria-hidden="true" />}</span>
                {actionLock && <small>{actionLock}</small>}
              </button>;
            })}</div>}
          </li>;
        })}</ul>
      </section>;
    })}</div> : <div className="studio-menu-empty"><h2>No matching feature</h2><p>Try a feature name or action such as “data”, “hire”, “research programs”, or “release”.</p>
      <button type="button" className="studio-surface-button" onClick={() => { setQuery(''); setWorkspace('all'); searchRef.current?.focus(); }}>Show every feature</button></div>}
  </section>;
}
