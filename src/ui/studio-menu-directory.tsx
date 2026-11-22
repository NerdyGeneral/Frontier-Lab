'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, LockKeyhole, Search, X } from 'lucide-react';
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
  const [kind, setKind] = useState<NonNullable<StudioMenuFilter['kind']>>('all');
  const entries = useMemo(() => findStudioMenuEntries({ query, workspace, kind }), [query, workspace, kind]);
  useEffect(() => {
    const search = searchRef.current;
    search?.focus({ preventScroll: true });
    if (search?.closest('.studio-mode[data-studio-short-viewport="true"]')) search.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, []);

  return <section className="studio-menu-directory" aria-labelledby={id + '-title'}>
    <header className="studio-menu-heading">
      <div><span className="studio-eyebrow">Find your next step</span><h1 id={id + '-title'}>All menus</h1>
        <p>Find every workspace and task. Choose one to open it; your current draft is kept.</p></div>
      {onClose && <button type="button" className="studio-surface-button" onClick={onClose}><X size={16} aria-hidden="true" />Back to work</button>}
    </header>
    <div className="studio-menu-search" role="search" aria-label="Find a menu or task">
      <label htmlFor={id + '-search'}>Search menus and tasks</label>
      <div><Search size={18} aria-hidden="true" /><input ref={searchRef} id={id + '-search'} type="search" value={query}
        autoComplete="off" placeholder="Try: buy data, design model, hire, rollback…" onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear menu search"><X size={16} aria-hidden="true" /></button>}</div>
    </div>
    <div className="studio-menu-filters">
      <label htmlFor={id + '-workspace'}>Workspace<select id={id + '-workspace'} value={workspace} onChange={event => setWorkspace(event.target.value as typeof workspace)}>
        <option value="all">All workspaces</option>{STUDIO_MENU_GROUPS.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
      </select></label>
      <label htmlFor={id + '-kind'}>Show<select id={id + '-kind'} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
        <option value="all">Menus and tasks</option><option value="menu">Menus</option><option value="task">Tasks</option>
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
          return <li key={entry.id}><button type="button" className="studio-menu-item" disabled={disabled} data-menu-kind={entry.kind}
            data-locked={lock ? 'true' : undefined} onClick={() => onNavigate(entry.target)}>
            <span><span className="studio-menu-item-heading"><strong>{entry.label}</strong><small>{entry.kind === 'task' ? 'Task' : 'Menu'}</small></span>
              <span className="studio-menu-item-description">{entry.description}</span>
              {lock && <span className="studio-menu-lock"><LockKeyhole size={13} aria-hidden="true" />{lock}</span>}</span>
            {entry.kind === 'task' ? <ArrowUpRight size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
          </button></li>;
        })}</ul>
      </section>;
    })}</div> : <div className="studio-menu-empty"><h2>No matching menu</h2><p>Try a feature name such as “data”, “model”, “staff”, or “release”.</p>
      <button type="button" className="studio-surface-button" onClick={() => { setQuery(''); setWorkspace('all'); setKind('all'); searchRef.current?.focus(); }}>Show every menu and task</button></div>}
  </section>;
}
