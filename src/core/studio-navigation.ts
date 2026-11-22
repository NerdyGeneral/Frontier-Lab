import type { StudioPanelId } from './studio-tasks';

/** Navigation is presentation only. Availability and command admission remain
 * in the existing selectors and engine; a route does not queue a decision. */
export const STUDIO_DESTINATIONS = [
  { id: 'studio', label: 'Studio', description: 'Your room, current goal and pinned work.' },
  { id: 'projects', label: 'Projects', description: 'Runs, models, datasets and next-week planning.' },
  { id: 'research', label: 'Research', description: 'Discoveries, applications and synthetic data.' },
  { id: 'products', label: 'Products', description: 'Services, customers, releases and the market.' },
  { id: 'operations', label: 'Operations', description: 'People, compute, racks, Campus and chips.' },
  { id: 'company', label: 'Company', description: 'Finances, costs, history and ambitions.' },
] as const;

export type StudioDestination = (typeof STUDIO_DESTINATIONS)[number]['id'];
export type StudioCanonicalScreen = StudioDestination | 'save';
/** Kept for older return targets and callers while the visible navigation uses
 * only the six canonical destinations. Save is a global utility. */
export type StudioScreen = StudioCanonicalScreen | 'release' | 'campus' | 'market' | 'finance';

export interface StudioNavigationTarget {
  screen: StudioCanonicalScreen;
  panel: StudioPanelId | null;
}

export const STUDIO_PANEL_DESTINATIONS = {
  'development-plans': 'projects', 'model-challenges': 'research',
  data: 'projects', 'lab-projects': 'projects', models: 'projects',
  'model-corpus-compare': 'projects',
  research: 'research', 'applied-research': 'research', 'synthetic-data': 'research',
  product: 'products', 'developer-api': 'products', 'business-commitments': 'products', 'customer-briefs': 'products',
  agents: 'products', 'release-desk': 'products', market: 'products',
  people: 'operations', compute: 'operations', infrastructure: 'operations', chips: 'operations', campus: 'operations',
  business: 'company', 'compute-costs': 'company', 'capacity-forecast': 'company',
  'company-log': 'company', campaign: 'company', save: 'save',
} as const satisfies Readonly<Record<StudioPanelId, StudioCanonicalScreen>>;

export function getStudioDestinationForPanel(panel: StudioPanelId): StudioCanonicalScreen {
  return STUDIO_PANEL_DESTINATIONS[panel];
}

/** Screen selection and a historical panel hash have different meanings:
 * selecting Research opens the map; #research keeps the original catalog. */
export function getStudioScreenTarget(screen: StudioScreen): StudioNavigationTarget {
  switch (screen) {
    case 'studio': case 'projects': case 'research': return { screen, panel: null };
    case 'products': case 'market': return { screen: 'products', panel: 'product' };
    case 'operations': return { screen: 'operations', panel: 'people' };
    case 'company': case 'finance': return { screen: 'company', panel: 'business' };
    case 'release': return { screen: 'products', panel: 'release-desk' };
    case 'campus': return { screen: 'operations', panel: 'campus' };
    case 'save': return { screen: 'save', panel: 'save' };
  }
}

/** Resolve only named internal destinations. Existing panel anchors take
 * precedence over screen aliases, retaining the exact old workbench. */
export function resolveStudioHash(hash: string): StudioNavigationTarget | null {
  let id: string;
  try { id = decodeURIComponent(hash.startsWith('#') ? hash.slice(1) : hash); }
  catch { return null; }
  if (Object.hasOwn(STUDIO_PANEL_DESTINATIONS, id)) {
    const panel = id as StudioPanelId;
    return { screen: getStudioDestinationForPanel(panel), panel };
  }
  if (id === 'lab') return getStudioScreenTarget('studio');
  if (id === 'studio-project-board') return getStudioScreenTarget('projects');
  if (id === 'studio-research-tree') return getStudioScreenTarget('research');
  if (STUDIO_DESTINATIONS.some(destination => destination.id === id)
    || id === 'release' || id === 'finance') return getStudioScreenTarget(id as StudioScreen);
  return null;
}
