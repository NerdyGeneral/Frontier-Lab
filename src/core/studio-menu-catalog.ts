import { STUDIO_DESTINATIONS, getStudioDestinationForPanel } from './studio-navigation';
import type { StudioCanonicalScreen, StudioDestination } from './studio-navigation';
import { STUDIO_PANEL_TITLES, STUDIO_TASKS } from './studio-tasks';
import type { StudioPanelId, StudioTaskId } from './studio-tasks';

/** A directory entry only opens a destination or an existing form. It never
 * creates a command, chooses an entity, or changes an unlock. */
export type StudioMenuTarget =
  | { kind: 'screen'; screen: StudioDestination }
  | { kind: 'panel'; panel: StudioPanelId }
  | { kind: 'task'; task: StudioTaskId };

export interface StudioMenuEntry {
  id: string;
  label: string;
  description: string;
  keywords: string;
  workspace: StudioCanonicalScreen;
  kind: 'menu' | 'task';
  target: StudioMenuTarget;
  /** The existing workbench gate, if any. Locked entries remain discoverable. */
  panel?: StudioPanelId;
}

interface MenuCopy { label?: string; description: string; keywords: string }
const PANEL_COPY = {
  'development-plans': { description: 'Delegate data preparation, model training and evaluation within a fee budget, reserve and deadline.', keywords: 'automation automatic pipeline prepare train test evaluate delegate handoff plan budget deadline' },
  'model-challenges': { description: 'Test all seven skills in harder named challenge tiers and earn lasting titles.', keywords: 'applied frontier horizon benchmark difficulty trophy title achievement seven skills challenge' },
  data: { label: 'Datasets & marketplace', description: 'Prepare data, acquire new sources, improve quality, and inspect skill coverage.', keywords: 'buy purchase acquire curate curation marketplace advanced reasoning long context multimodal sources licenses' },
  'lab-projects': { label: 'Training & model design', description: 'Train a model, design its size and data mix, or continue a saved version.', keywords: 'custom designer foundation adaptation parameters sparsity budget recipes checkpoints experiments replay curriculum retention' },
  models: { label: 'Models & evaluations', description: 'Compare saved versions, test their skills, and inspect reports and training history.', keywords: 'benchmark test advanced reasoning long context multimodal held out report checkpoints behavior policy holdout' },
  people: { label: 'Team & hiring', description: 'Recruit specialists and see the work points your team produces each week.', keywords: 'staff hire employees wages salary roles points assignment allocation onboarding' },
  compute: { label: 'Compute & cloud rental', description: 'Allocate GPUs to projects and services, or rent and release cloud capacity.', keywords: 'allocation rent rental capacity gpu memory cu cuw mu serving development research' },
  product: { description: 'Launch Basic Chat and manage its model, price, allowance, and service settings.', keywords: 'consumer chat launch deploy price allowance pause resume routing feedback efficiency' },
  'release-desk': { description: 'Prepare releases, monitor canaries, roll back a model, and manage private appliances.', keywords: 'launch promotion rollback deployment telemetry canary appliance private rehearsal' },
  research: { description: 'Browse discovery requirements, start research, and review completed methods.', keywords: 'catalog methods discovery prerequisites technology unlock r1 evaluation r3 automation' },
  'applied-research': { label: 'Research applications', description: 'Turn discoveries into deployment variants, adapters, training supervision, and assistance.', keywords: 'compression memory format adapter bank install supervisor assistant variant efficiency' },
  market: { description: 'See forecastable demand opportunities, rival plans, and the wider market for your products.', keywords: 'rivals competitors competition market share trust opportunity forecast demand calendar plans' },
  'developer-api': { description: 'Manage your API, token pricing, batch work, feedback, and service safeguards.', keywords: 'developer tokens batch inference scheduler assured api guardrails feedback review' },
  'business-commitments': { description: 'Serve document customers, install retrieval, and manage business contracts and licenses.', keywords: 'enterprise documents retrieval rag license contracts renew invoices private deployment' },
  'customer-briefs': { description: 'Choose a client brief, review its requirements, and deliver a qualifying model.', keywords: 'clients delivery contract deadline tasks rewards' },
  agents: { description: 'Configure agent jobs, tool permissions, verification, and workflow recovery.', keywords: 'support tools checker bounded agent recovery job workflow verification outcomes' },
  business: { label: 'Finances & company', description: 'Review cash, income, operating costs, bills, and your company name.', keywords: 'money ledger finances financial cash budget wages balance income rename bills arrears' },
  infrastructure: { label: 'Racks & facilities', description: 'Buy GPUs and manage racks, facilities, power, cooling, and relocation.', keywords: 'hardware rack data center datacenter facility power cooling retrofit relocate infrastructure' },
  chips: { label: 'Chips & networking', description: 'Design chips, arrange fabrication, and connect compatible GPUs with fast fabric.', keywords: 'fabric fabrication custom silicon chip foundry networking network sparse hardware sales' },
  'compute-costs': { description: 'Inspect what compute costs your company and where resources are being used.', keywords: 'gpu billing bill expenses utilization consumption costs budget' },
  'capacity-forecast': { description: 'Estimate future capacity needs before committing to more infrastructure.', keywords: 'forecast projection planning future capacity cost compute demand' },
  campaign: { label: 'Chapters & ambitions', description: 'Choose a chapter, track its lasting milestones, and work toward company endings.', keywords: 'campaign goals chapter milestone ambitions ending achievements objective focus' },
  'company-log': { description: 'Read your company’s recent decisions, completed work, and important events.', keywords: 'journal history log events decisions timeline' },
  save: { description: 'Save, export, import, recover a company, or manage this browser session.', keywords: 'load backup restore recovery export import file session control new company reset' },
  'synthetic-data': { description: 'Generate examples from a teacher model, audit them, and prepare a training curriculum.', keywords: 'synthetic teacher generate generation audit curriculum quality' },
  'model-corpus-compare': { label: 'Compare models & data', description: 'Compare model scores, dataset coverage, and source histories side by side.', keywords: 'comparison corpus corpora dataset skills benchmark source lineage' },
  campus: { description: 'Develop your campus, specialize sites, and plan successor chips.', keywords: 'campus site specialization successor chip data center facilities' },
} satisfies Record<StudioPanelId, MenuCopy>;

const TASK_COPY = {
  'development-plan': 'Choose data and a design, set limits, and delegate preparation, training and evaluation.',
  'model-challenge': 'Choose an eligible model for a harder paid challenge and a lasting achievement.',
  'prepare-data': 'Choose a dataset and schedule its preparation for training.',
  'train-model': 'Choose a base, data, and training method, or design your own model.',
  'evaluate-model': 'Select a saved model and the evaluation suite you want to run.',
  'launch-basic-chat': 'Choose a qualified model and set the terms for your first chat service.',
  'manage-basic-chat': 'Change the model, price, allowance, or status of an existing chat service.',
  staffing: 'Review your staff and the work your team can support.',
  'plan-week': 'Review project needs and plan next week’s people and compute.',
  'research-method': 'Choose a discovery and check its costs and prerequisites.',
  'architecture-research': 'Repeat research to unlock Edge and Frontier families. Start after Evaluation suite (R1).',
  'apply-research': 'Install a discovered system or create a deployment variant.',
  'synthetic-data': 'Choose a teacher and produce new examples for a training curriculum.',
  'release-decision': 'Prepare, promote, monitor, or roll back a product release.',
  'compute-decision': 'Review compute allocation and rented capacity together.',
  'infrastructure-decision': 'Choose GPU racks, facilities, or infrastructure upgrades.',
  'chip-decision': 'Plan chip development, fabrication, and GPU networking.',
  'campus-decision': 'Choose a site specialization or a successor chip project.',
  'api-decision': 'Configure API service, pricing, batch work, and safeguards.',
  'business-decision': 'Choose business services, retrieval, contracts, or licensing terms.',
  'customer-brief': 'Inspect client requirements and select the model you will deliver.',
  'agent-decision': 'Choose an agent workflow, model, tools, and verification rules.',
  'company-decision': 'Review company finances and editable company details.',
  'compute-cost-decision': 'Inspect your current resource costs and their drivers.',
  'forecast-decision': 'Compare assumptions about future demand and capacity.',
  'hire-staff': 'Choose a specialist and review hiring cost, payroll, and onboarding.',
  'assign-staff': 'See the work points each specialist contributes automatically.',
  'allocate-compute': 'Set how much compute goes to serving, development, and research.',
  'rent-compute': 'Choose how much cloud capacity to rent and check the weekly bill.',
} satisfies Record<StudioTaskId, string>;

export const STUDIO_MENU_GROUPS: readonly { id: StudioCanonicalScreen; label: string; description: string }[] = [
  ...STUDIO_DESTINATIONS,
  { id: 'save', label: 'Save & session', description: 'Protect your progress and manage this browser session.' },
];

const panelEntries: StudioMenuEntry[] = (Object.keys(STUDIO_PANEL_TITLES) as StudioPanelId[]).map(panel => {
  const copy: MenuCopy = PANEL_COPY[panel];
  return {
    id: 'panel:' + panel, label: copy.label ?? STUDIO_PANEL_TITLES[panel], description: copy.description,
    keywords: copy.keywords + ' ' + STUDIO_PANEL_TITLES[panel], workspace: getStudioDestinationForPanel(panel), kind: 'menu',
    target: { kind: 'panel', panel }, panel,
  };
});

const taskEntries: StudioMenuEntry[] = (Object.keys(STUDIO_TASKS) as StudioTaskId[]).map(task => {
  const owner = STUDIO_TASKS[task].owner;
  const panel = owner === 'planner' ? undefined : owner;
  return {
    id: 'task:' + task, label: STUDIO_TASKS[task].title, description: TASK_COPY[task],
    keywords: panel ? PANEL_COPY[panel].keywords : 'planner plan staffing resources people compute allocation',
    workspace: panel ? getStudioDestinationForPanel(panel) : 'projects', kind: 'task',
    target: { kind: 'task', task }, ...(panel ? { panel } : {}),
  };
});

export const STUDIO_MENU_ENTRIES: readonly StudioMenuEntry[] = [
  { id: 'screen:studio', label: 'Studio home', description: 'Return to your room, current goal, and pinned projects.', keywords: 'home room garage next goal', workspace: 'studio', kind: 'menu', target: { kind: 'screen', screen: 'studio' } },
  { id: 'screen:projects', label: 'Work queue', description: 'See running, blocked, completed, and scheduled projects.', keywords: 'projects queue progress pending work results', workspace: 'projects', kind: 'menu', target: { kind: 'screen', screen: 'projects' } },
  { id: 'screen:research', label: 'Research pathways', description: 'Explore every discovery, its prerequisites, and what it unlocks.', keywords: 'research tree map technology branches discovery', workspace: 'research', kind: 'menu', target: { kind: 'screen', screen: 'research' } },
  ...panelEntries,
  ...taskEntries,
];

export interface StudioMenuFilter {
  query?: string;
  workspace?: StudioCanonicalScreen | 'all';
  kind?: StudioMenuEntry['kind'] | 'all';
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** All query words must match, regardless of order. Filters never mutate the
 * registry or remove unavailable features from the catalog. */
export function findStudioMenuEntries({ query = '', workspace = 'all', kind = 'all' }: StudioMenuFilter = {}): StudioMenuEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return STUDIO_MENU_ENTRIES.filter(entry => {
    if (workspace !== 'all' && entry.workspace !== workspace) return false;
    if (kind !== 'all' && entry.kind !== kind) return false;
    const group = STUDIO_MENU_GROUPS.find(item => item.id === entry.workspace);
    const text = normalize([entry.label, entry.description, entry.keywords, group?.label ?? ''].join(' '));
    return words.every(word => text.includes(word));
  });
}
