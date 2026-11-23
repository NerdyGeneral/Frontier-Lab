'use client';

import { BookOpen, Building2, ChevronRight, LayoutGrid, ListTodo, LockKeyhole, Rocket, Wallet } from 'lucide-react';
import { STUDIO_DESTINATIONS, getStudioScreenTarget } from '../core/studio-navigation';
import type { StudioDestination, StudioScreen } from '../core/studio-navigation';
import type { StudioPanelId, StudioTaskId } from '../core/studio-tasks';
import type { StudioMenuTarget } from '../core/studio-menu-catalog';
import type { GameSectionVisibility } from './guide-links';

const ICONS = { studio: LayoutGrid, projects: ListTodo, research: BookOpen, products: Rocket, operations: Building2, company: Wallet };

export function StudioNavigation({ screen, disabled, projectCount, onSelect }: {
  screen: StudioScreen; disabled: boolean; projectCount: number; onSelect: (screen: StudioDestination) => void;
}) {
  const current = getStudioScreenTarget(screen).screen;
  return <nav className="studio-nav" aria-label="Studio navigation">
    {STUDIO_DESTINATIONS.map(destination => {
      const Icon = ICONS[destination.id];
      return <button type="button" key={destination.id}
        disabled={disabled} aria-current={current === destination.id ? 'page' : undefined} title={destination.description} aria-description={destination.description} onClick={() => onSelect(destination.id)}>
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{destination.label}</span>
        {destination.id === 'projects' && projectCount > 0 && <small>{projectCount}</small>}
      </button>;
    })}
    <span className="studio-nav-caption">FRONTIER LAB</span>
  </nav>;
}

/** Visibility describes discoverability only. It never admits a command or
 * fabricates an unlock; existing workbenches keep their authoritative gates. */
export function getStudioPanelLock(panel: StudioPanelId, sections: GameSectionVisibility): string | null {
  if (panel === 'research' && !sections.research) return 'Prepare your starter data to open the research catalog. Discoveries need money, staff and compute.';
  if (panel === 'applied-research' && !sections.appliedResearch) return 'Finish a discovery with an upgrade you can build. Open Research to see what to unlock and how to use it.';
  if (panel === 'developer-api' && !sections.developerApi) return 'Make your first sale to unlock the Developer API. You can also enter with an existing API, batch scheduler or Enterprise operations research.';
  if (panel === 'business-commitments' && !sections.businessCommitments) return 'Make your first sale, or research Retrieval or Enterprise operations, to find business customers. You can also manage existing business services here.';
  if (panel === 'agents' && !sections.agents) return 'Make your first sale or research Defined workflows to unlock agent services. Existing jobs are also available here.';
  if (panel === 'infrastructure' && !sections.infrastructure) return 'Make your first sale to unlock racks and data centers. Existing hardware and building projects are also available here.';
  if (panel === 'chips' && !sections.chips) return 'Start Chip feasibility, finish Sparse architecture, or research both Compression and Enterprise operations to open this menu. Existing chip and network projects are also available here.';
  if ((panel === 'compute-costs' || panel === 'capacity-forecast') && !sections.capacityForecast) return 'Research Enterprise operations or Capacity forecast to unlock these reports. Check Research for costs and requirements.';
  return null;
}

export type StudioWorkspaceSection = { id: StudioPanelId | 'work' | 'plan'; label: string };

export function isCapacityPanel(panel: StudioPanelId | null): boolean {
  return panel === 'capacity' || panel === 'compute' || panel === 'capacity-forecast' || panel === 'compute-costs';
}

/** Allocation, cost and forecast are views of the same resource decision. */
export function StudioCapacityNavigation({ panel, sections, disabled, onSelect }: {
  panel: StudioPanelId | null; sections: GameSectionVisibility; disabled: boolean;
  onSelect: (panel: StudioPanelId) => void;
}) {
  if (!isCapacityPanel(panel)) return null;
  const views = [
    { id: 'capacity', label: 'Plan resources' },
    { id: 'compute', label: 'Allocation & rental' },
    { id: 'capacity-forecast', label: 'Forecast' },
    { id: 'compute-costs', label: 'Costs' },
  ] as const;
  return <nav className="studio-capacity-navigation" aria-label="Capacity views">
    {views.map(view => {
      const reason = getStudioPanelLock(view.id, sections);
      return <button key={view.id} type="button" aria-current={panel === view.id ? 'page' : undefined}
        disabled={disabled} title={reason ?? undefined} aria-description={reason ?? undefined}
        onClick={() => onSelect(view.id)}>{view.label}{reason && <><LockKeyhole size={13} aria-hidden="true" /><span className="visually-hidden"> — locked</span></>}</button>;
    })}
  </nav>;
}
const SECTIONS: Partial<Record<StudioDestination, readonly StudioWorkspaceSection[]>> = {
  projects: [{ id: 'work', label: 'Work queue' }, { id: 'models', label: 'Models' }, { id: 'data', label: 'Datasets' }, { id: 'model-corpus-compare', label: 'Compare' }],
  products: [{ id: 'product', label: 'Basic Chat' }, { id: 'developer-api', label: 'Developer API' }, { id: 'business-commitments', label: 'Business' }, { id: 'customer-briefs', label: 'Customer briefs' }, { id: 'agents', label: 'Agents' }, { id: 'release-desk', label: 'Release desk' }, { id: 'market', label: 'Market & rivals' }],
  operations: [{ id: 'people', label: 'Team' }, { id: 'capacity', label: 'Capacity' }, { id: 'infrastructure', label: 'Racks & facilities' }, { id: 'campus', label: 'Campus' }, { id: 'chips', label: 'Chips & fabrication' }],
  company: [{ id: 'business', label: 'Overview & ledger' }, { id: 'company-log', label: 'Journal' }, { id: 'campaign', label: 'Chapters & ambitions' }],
};
export function getStudioWorkspaceSections(screen: StudioScreen): readonly StudioWorkspaceSection[] {
  const canonical = getStudioScreenTarget(screen).screen;
  return canonical === 'save' ? [] : SECTIONS[canonical] ?? [];
}
const HEADINGS: Partial<Record<StudioDestination, { eyebrow: string; title: string; detail: string }>> = {
  projects: { eyebrow: 'The workbench', title: 'Projects', detail: 'Develop models, follow your plans and review completed work.' },
  products: { eyebrow: 'Out into the world', title: 'Build something people use.', detail: 'Manage your products, customers and next launch.' },
  operations: { eyebrow: 'Behind every breakthrough', title: 'Give your ideas room to grow.', detail: 'Put people and machines behind the work that matters.' },
  company: { eyebrow: 'The longer view', title: 'Keep your company running.', detail: 'Check your income, bills and company history.' },
};

export function StudioWorkspaceHeader({ screen, panel, projectTab, sections, disabled, onSelect, onDevelop }: {
  screen: StudioScreen; panel: StudioPanelId | null; projectTab: 'work' | 'plan'; sections: GameSectionVisibility;
  disabled: boolean; onSelect: (id: StudioWorkspaceSection['id']) => void; onDevelop?: () => void;
}) {
  const canonical = getStudioScreenTarget(screen).screen;
  const copy = canonical === 'save' ? undefined : HEADINGS[canonical];
  if (!copy) return null;
  const selectedLock = panel ? getStudioPanelLock(panel, sections) : null;
  return <section className="studio-workspace-heading studio-only" aria-label={`${canonical} workspace`}>
    <span className="studio-eyebrow">{copy.eyebrow}</span>
    <div className="studio-workspace-title"><h1>{copy.title}</h1>{canonical === 'projects' && onDevelop && <button type="button" className="studio-primary" disabled={disabled} onClick={onDevelop}>Develop a model</button>}</div><p>{copy.detail}</p>
    <div className="studio-workspace-sections" role="group" aria-label={`${canonical} workspace sections`}>
      {getStudioWorkspaceSections(screen).map(item => {
        const locked = item.id === 'work' || item.id === 'plan' ? null : getStudioPanelLock(item.id, sections);
        const active = item.id === panel || panel === null && item.id === projectTab
          || item.id === 'capacity' && isCapacityPanel(panel)
          || item.id === 'work' && panel === 'development-plans';
        return <button type="button" key={item.id} aria-pressed={active} disabled={disabled} title={locked ?? undefined} aria-description={locked ?? undefined} data-locked={locked ? 'true' : undefined} onClick={() => onSelect(item.id)}>
          {item.label}{locked && <><LockKeyhole size={12} aria-hidden="true" /><span className="visually-hidden"> — locked</span></>}
        </button>;
      })}
    </div>
    {selectedLock && <p className="studio-navigation-lock-note"><LockKeyhole size={14} aria-hidden="true" />{selectedLock}</p>}
  </section>;
}

const RESEARCH_SECTIONS: readonly { id: string; label: string; target: StudioMenuTarget; panel?: StudioPanelId }[] = [
  { id: 'pathways', label: 'Discoveries', target: { kind: 'screen', screen: 'research' } },
  { id: 'programs', label: 'Programs', panel: 'research-programs', target: { kind: 'panel', panel: 'research-programs' } },
  { id: 'challenges', label: 'Challenges', panel: 'model-challenges', target: { kind: 'panel', panel: 'model-challenges' } },
  { id: 'applications', label: 'Applications', panel: 'applied-research', target: { kind: 'panel', panel: 'applied-research' } },
  { id: 'synthetic', label: 'Synthetic data', panel: 'synthetic-data', target: { kind: 'panel', panel: 'synthetic-data' } },
];

export function StudioResearchNavigation({ panel, activeTask, sections, disabled, onNavigate }: {
  panel: StudioPanelId | null;
  activeTask?: StudioTaskId | null;
  sections: GameSectionVisibility;
  disabled: boolean;
  onNavigate: (target: StudioMenuTarget) => void;
}) {
  const architecture = activeTask === 'architecture-research';
  const selectedLock = !architecture && panel ? getStudioPanelLock(panel, sections) : null;
  return <>
    <div className="studio-research-tabs studio-workspace-sections" role="group" aria-label="Research workspace sections">
      {RESEARCH_SECTIONS.map(item => {
        const active = item.id === 'programs' ? architecture || panel === 'research-programs'
          : item.id === 'pathways' ? (panel === null || panel === 'research') && !architecture : panel === item.panel && !architecture;
        const lock = item.panel ? getStudioPanelLock(item.panel, sections) : null;
        return <button type="button" key={item.id} aria-pressed={active} disabled={disabled} title={lock ?? undefined}
          aria-description={lock ?? undefined} data-locked={lock ? 'true' : undefined} onClick={() => onNavigate(item.target)}>
          {item.label}{lock && <><LockKeyhole size={12} aria-hidden="true" /><span className="visually-hidden"> — locked</span></>}
        </button>;
      })}
    </div>
    {selectedLock && <p className="studio-navigation-lock-note"><LockKeyhole size={14} aria-hidden="true" />{selectedLock}</p>}
  </>;
}

export function StudioLockedWorkbench({ title, reason, onResearch, onStudio }: {
  title: string; reason: string; onResearch: () => void; onStudio: () => void;
}) {
  return <section className="studio-locked-workbench" aria-label={`${title} availability`}>
    <LockKeyhole size={28} /><h3>Unlock this menu as your lab grows.</h3><p>{reason}</p>
    <div><button type="button" onClick={onResearch}>Explore research<ChevronRight size={14} /></button>
      <button type="button" onClick={onStudio}>Return to your current goal<ChevronRight size={14} /></button></div>
  </section>;
}
