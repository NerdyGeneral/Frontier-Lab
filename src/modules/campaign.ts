import type { DomainModule } from '../contracts/types';
import { applyBriefCommand, quoteBriefCommand, reserveBrief, settleBrief, validateBriefCommand } from './customer-briefs';
import { advanceCampaignProgress, captureCampaignWeek } from './campaign-progress';
import { CHAPTER_COMMANDS, advanceChapters, applyChapterCommand, quoteChapterCommand, validateChapterCommand } from './chapters';
import { activeSystemsBrief, applySystemsBriefCommand, quoteSystemsBriefCommand, reserveSystemsBrief, settleSystemsBrief, validateSystemsBriefCommand } from './systems-briefs';
export { getCampaignView } from './campaign-progress';

export function createCampaignModule(): DomainModule {
  return { id: 'campaign', owns: ['campaign'], commandKinds: ['accept_customer_brief', 'accept_systems_brief', ...CHAPTER_COMMANDS],
    validateCommand: (state, command, content) => command.payload.kind === 'select_chapter' ? validateChapterCommand(state, command) : command.payload.kind === 'accept_systems_brief' ? validateSystemsBriefCommand(state, command, content) : validateBriefCommand(state, command, content),
    quoteCommand: (state, command, content) => command.payload.kind === 'select_chapter' ? quoteChapterCommand(command) : command.payload.kind === 'accept_systems_brief' ? quoteSystemsBriefCommand(state, command) : quoteBriefCommand(state, command, content),
    applyCommand: (state, command, content) => command.payload.kind === 'select_chapter' ? applyChapterCommand(state, command) : command.payload.kind === 'accept_systems_brief' ? applySystemsBriefCommand(state, command) : applyBriefCommand(state, command, content),
    handlers: { reserve: state => activeSystemsBrief(state) ? reserveSystemsBrief(state) : reserveBrief(state),
      settle: (state, context) => activeSystemsBrief(state) ? settleSystemsBrief(state, context) : settleBrief(state, context), plan(state, context) {
    const campaign = structuredClone(state.slices.campaign);
    const conditions: [string, boolean, string][] = [
      ['starter-data-ready', Object.values(state.slices.data.packets).some(d => d.companyId === state.playerCompanyId && d.prepared), 'Prepared training data is ready.'],
      ['first-adaptation', Object.values(state.slices.models.trainingRuns).some(r => r.companyId === state.playerCompanyId && r.status === 'complete'), 'Your first adaptation is complete. Evaluate it before selling access.'],
      ['first-evaluation', Object.values(state.slices.models.reports).some(r => r.companyId === state.playerCompanyId && r.basicChatEligible), 'A model passed the Basic Chat eligibility gate.'],
      ['first-deployment', Object.values(state.slices.products.offers).some(p => p.companyId === state.playerCompanyId && p.status === 'active'), 'Basic Chat is live.'],
      ['first-paid-customer', state.slices.company.companies[state.playerCompanyId].earnedRevenueCents > 0, 'First paid customer: delivered work produced your first revenue receipt. Grow the company and manage its continuing costs.'],
      ['first-retrieval-service', Object.values(state.slices.products.retrievalInstalls).some(index => index.companyId === state.playerCompanyId && index.status === 'active' && index.lastFreshnessBps > 0), 'Your first retrieval index is operating. Its evidence helps document service while data upkeep is funded.'],
      ['first-reviewed-agent-draft', Object.values(state.slices.agents.jobs).some(job => job.companyId === state.playerCompanyId && job.deliveredDraft), 'Your first agent draft was reviewed and delivered. A finished draft is distinct from an executed customer action.'],
      ['first-verified-agent-outcome', Object.values(state.slices.agents.jobs).some(job => job.companyId === state.playerCompanyId && job.verifiedOutcome && job.billedCents > 0), 'Your first verified agent outcome earned a receipt. The calls, checks, authorization and action remain inspectable.'],
      ['first-private-business-receipt', Object.values(state.slices.products.commercialContracts).some(contract => contract.companyId === state.playerCompanyId && contract.contractKind === 'private-hosted' && contract.lifetimeBilledCents > 0), 'Your first private deployment earned revenue from delivered service. Its reserved workload and service obligations continue each week.'],
      ['first-model-license-receipt', Object.values(state.slices.products.commercialContracts).some(contract => contract.companyId === state.playerCompanyId && contract.contractKind === 'customer-hosted' && contract.lifetimeBilledCents > 0), 'Your first customer-hosted license earned revenue. The buyer supplies inference compute; your company supplies delivery and support.'],
      ['first-deployment-variant', Object.values(state.slices.models.applicationRuns).some(run => run.companyId === state.playerCompanyId && run.status === 'complete'), 'Your first deployment variant is saved. Its efficiency tradeoff needs a fresh evaluation before release.'],
      ['first-distilled-model', Object.values(state.slices.models.trainingRuns).some(run => run.companyId === state.playerCompanyId && run.status === 'complete' && run.plan?.kind === 'distillation'), 'Your first distilled student is trained. Teacher inference and student updates were separate workloads; evaluate the student before deployment.'],
      ['first-sparse-model', Object.values(state.slices.models.trainingRuns).some(run => run.companyId === state.playerCompanyId && run.status === 'complete' && run.plan?.architecture === 'sparse'), 'Your first sparse model is trained. Its memory and fast-fabric requirements continue when you serve it.'],
      ['first-research-assistance', (state.slices.research.assistantsByCompany[state.playerCompanyId]?.bonusStaff ?? 0) > 0, 'Reviewed model assistance contributed to research. Human staff, inference work and research compute still supplied the project.'],
      ['first-qualified-chip', Object.values(state.slices.compute.chipDesigns).some(design => design.companyId === state.playerCompanyId && design.status === 'validated'), 'Your first custom chip prototype is qualified. Its fixed yield is known; production and installation are the next investments.'],
      ['first-custom-rack', Object.values(state.slices.compute.racks).some(rack => rack.companyId === state.playerCompanyId && !!rack.chipDesignId && rack.status === 'installed'), 'Your first custom-chip rack is installed. Matching workloads, operations staff, power and cooling determine its useful output.'],
      ['first-fast-fabric', Object.values(state.slices.compute.fabricProjects).some(project => project.companyId === state.playerCompanyId && project.status === 'active'), 'Your first fast-fabric installation is active. Compatible connected pools can now run sparse workloads.'],
    ];
    const messages: { category: 'project'; message: string }[] = [];
    for (const [id, achieved, message] of conditions) if (achieved && !campaign.milestones.includes(id)) { campaign.milestones.push(id); messages.push({ category: 'project', message }); }
    messages.push(...advanceCampaignProgress(campaign, captureCampaignWeek(state, context.content)));
    messages.push(...advanceChapters(campaign, state));
    return { updates: { campaign }, messages };
  } } };
}
