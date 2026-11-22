import type { GameState, GameView } from '../contracts/types';
import { isCustomizationResearch } from '../content/model-customization-research';

export interface GuideLink { href: string; label: string }
export interface GameSectionVisibility {
  market: boolean; campaign: boolean; agents: boolean; research: boolean; appliedResearch: boolean;
  developerApi: boolean; businessCommitments: boolean; infrastructure: boolean; chips: boolean; capacityForecast: boolean;
}

/** Presentation gates only. Admission, prices and progress remain in the engine. */
export function getGameSectionVisibility(game: GameState, view: GameView): GameSectionVisibility {
  const owner = game.playerCompanyId;
  const known = new Set(game.slices.research.completedByCompany[owner] ?? []);
  const owns = (items: Record<string, { companyId: string }>) => Object.values(items).some(item => item.companyId === owner);
  const offers = Object.values(game.slices.products.offers).filter(offer => offer.companyId === owner);
  const enteredChipResearch = Object.values(game.slices.research.projects).some(project => project.companyId === owner && project.researchId === 'R16');
  return {
    market: true,
    campaign: true,
    agents: view.progress.firstSale || owns(game.slices.agents.jobs) || known.has('R9'),
    research: view.progress.dataReady || view.progress.firstSale || known.size > 0 || owns(game.slices.research.projects),
    appliedResearch: ['R7', 'R7A', 'R8', 'R8A', 'R3B', 'R13', 'R14', 'R15', 'R2A', 'R6A', 'R12A', 'R4B', 'R9A', 'R10A', 'R11A'].some(id => known.has(id))
      || owns(game.slices.models.applicationRuns) || owns(game.slices.research.systemRollouts),
    developerApi: view.progress.firstSale || offers.some(offer => offer.kind === 'developer-api') || known.has('R12')
      || !!game.slices.products.batchSchedulers?.[owner],
    businessCommitments: view.progress.firstSale || offers.some(offer => offer.kind === 'business-docs')
      || owns(game.slices.products.commercialContracts) || known.has('R6') || known.has('R12'),
    infrastructure: view.progress.firstSale || owns(game.slices.compute.racks) || owns(game.slices.compute.facilities)
      || owns(game.slices.compute.fabricProjects),
    chips: known.has('R16') || known.has('R14') || owns(game.slices.compute.chipDesigns)
      || owns(game.slices.compute.fabricProjects) || enteredChipResearch || (known.has('R7') && known.has('R12')),
    capacityForecast: known.has('R12') || known.has('R12A'),
  };
}

export function milestoneLink(view: GameView, hasEnding: boolean): GuideLink {
  if (hasEnding || view.progress.firstSale) return { href: '#campaign', label: 'Open company ambitions' };
  if (!view.progress.dataReady) return { href: '#data', label: 'Go to Data' };
  if (!view.progress.trained) return { href: '#lab-projects', label: 'Go to the Lab' };
  if (!view.progress.evaluated) return { href: '#models', label: 'Go to Models' };
  return { href: '#product', label: 'Go to Basic Chat' };
}

const CAMPAIGN_ACTIONS: Readonly<Record<string, readonly GuideLink[]>> = {
  revenue: [{ href: '#business', label: 'Review income and the ledger' }],
  margin: [{ href: '#business', label: 'Review operating costs' }, { href: '#compute', label: 'Review compute allocation' }],
  reserve: [{ href: '#business', label: 'Review cash and commitments' }],
  service: [{ href: '#compute', label: 'Check capacity and grants' }, { href: '#agents', label: 'Review agent outcomes' }],
  'frontier-model': [{ href: '#lab-projects', label: 'Design and train a model' }, { href: '#models', label: 'Review evaluations' }],
  'frontier-reliability': [{ href: '#lab-projects', label: 'Review tuning recipes' }, { href: '#models', label: 'Inspect the serving model' }],
  'behavior-evidence': [{ href: '#models', label: 'Run the behavior evaluation' }],
  consumers: [{ href: '#product', label: 'Manage Basic Chat' }],
  developers: [{ href: '#developer-api', label: 'Manage the Developer API' }],
  breadth: [{ href: '#developer-api', label: 'Open the Developer API' }, { href: '#business-commitments', label: 'Open business products' }],
  trust: [{ href: '#market', label: 'Review the market and trust' }],
  organizations: [{ href: '#business-commitments', label: 'Manage business customers' }],
  'specialist-model': [{ href: '#lab-projects', label: 'Train for the customer’s domain' }, { href: '#models', label: 'Review evaluations' }],
  'specialist-reliability': [{ href: '#lab-projects', label: 'Review tuning recipes' }, { href: '#models', label: 'Inspect the serving model' }],
  commitments: [{ href: '#business-commitments', label: 'Review named contracts' }],
};

export function campaignActionLinks(criterionId: string): readonly GuideLink[] {
  return CAMPAIGN_ACTIONS[criterionId] ?? [];
}

const RESEARCH_APPLICATIONS: Readonly<Record<string, GuideLink>> = {
  R1: { href: '#models', label: 'Evaluate a model' },
  R2: { href: '#data', label: 'Curate training data' },
  R2A: { href: '#data', label: 'Clean duplicate processing' },
  R1A: { href: '#models', label: 'Run a behavior evaluation' },
  R3: { href: '#lab-projects', label: 'Plan a training run' },
  R4: { href: '#lab-projects', label: 'Plan a training run' },
  R4B: { href: '#applied-research', label: 'Install the adapter bank' },
  R4C: { href: '#lab-projects', label: 'Plan a replay curriculum' },
  R5: { href: '#lab-projects', label: 'Tune model behavior' },
  R5A: { href: '#lab-projects', label: 'Tune model behavior' },
  R6: { href: '#business-commitments', label: 'Install document retrieval' },
  R6A: { href: '#business-commitments', label: 'Check document evidence' },
  R7: { href: '#applied-research', label: 'Create a deployment variant' },
  R7A: { href: '#applied-research', label: 'Create a deployment variant' },
  R8: { href: '#product', label: 'Manage serving efficiency' },
  R8A: { href: '#product', label: 'Manage serving efficiency' },
  R9: { href: '#agents', label: 'Open support workflows' },
  R9A: { href: '#agents', label: 'Install workflow recovery' },
  R10: { href: '#agents', label: 'Configure verification' },
  R10A: { href: '#models', label: 'Run independent outcome holdouts' },
  R11: { href: '#agents', label: 'Configure bounded agents' },
  R11A: { href: '#lab-projects', label: 'Train a budgeted planner' },
  R12: { href: '#business-commitments', label: 'Review business contracts' },
  R12A: { href: '#capacity-forecast', label: 'Forecast capacity' },
  D1: { href: '#lab-projects', label: 'Train a Support desk model' },
  D2: { href: '#lab-projects', label: 'Train a Document extractor' },
  D3: { href: '#lab-projects', label: 'Train a Tool dispatcher' },
  D4: { href: '#lab-projects', label: 'Design a Compact foundation' },
  D5: { href: '#lab-projects', label: 'Plan low-memory training' },
  D6: { href: '#lab-projects', label: 'Plan large-batch training' },
  R13: { href: '#lab-projects', label: 'Train a compact student' },
  R14: { href: '#chips', label: 'Install compatible fast fabric' },
  R3B: { href: '#applied-research', label: 'Install training supervision' },
  R15: { href: '#applied-research', label: 'Install research assistance' },
  R16: { href: '#chips', label: 'Develop a custom chip' },
  S1: { href: '#synthetic-data', label: 'Generate and audit synthetic data' },
  S2: { href: '#synthetic-data', label: 'Train a targeted synthetic curriculum' },
  S3: { href: '#release-desk', label: 'Open canary telemetry' },
  S4: { href: '#release-desk', label: 'Quote a private appliance' },
  S5: { href: '#campus', label: 'Specialize an owned site' },
  S6: { href: '#campus', label: 'Design a successor chip' },
};

export function researchApplicationLink(researchId: string): GuideLink | undefined {
  if (isCustomizationResearch(researchId)) return { href: '#lab-projects', label: 'Use in custom design' };
  return RESEARCH_APPLICATIONS[researchId];
}
