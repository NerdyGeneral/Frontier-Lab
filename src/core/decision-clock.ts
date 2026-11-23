import type { GameContent, GameState } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { ASSURANCE_BY_ID } from '../content/wave13-assurance';
import { getKnownWeeklyBaseCost } from './selectors';
import { getMarketOpportunityView } from '../modules/market-opportunities';

export interface DecisionClockPolicy {
  cashReserveCents: number;
  maxWeeks: number;
  projects: boolean;
  research: boolean;
  deadlines: boolean;
  opportunities: boolean;
  service: boolean;
}
export const DEFAULT_DECISION_CLOCK_POLICY: DecisionClockPolicy = {
  cashReserveCents: 500_000, maxWeeks: 24,
  projects: true, research: true, deadlines: true, opportunities: true, service: true,
};
export interface DecisionStop { reason: string; target: string }

/** This guard uses known bills and queued cash, not speculative future revenue.
 * Metered work and completed installations can add cost, so the settled week is
 * checked again afterward. Pending bill increases count; savings wait until applied. */
export function decisionCashGuard(state: GameState, policy: DecisionClockPolicy, content: GameContent = CONTENT): DecisionStop | null {
  const company = state.slices.company.companies[state.playerCompanyId];
  const reserved = state.queuedCommands.filter(c => c.companyId === state.playerCompanyId).reduce((n, c) => n + (c.reservedCents ?? 0), 0);
  if (company.arrearsCents) return { reason: 'This run has ended with unpaid bills. Review or export the company before starting a new lab.', target: '#save' };
  if (company.cashCents - reserved - getKnownWeeklyBaseCost(state, content) < policy.cashReserveCents)
    return { reason: 'Queued spending and current or scheduled higher bills could cross your cash reserve. Pending savings count after they apply. Review the budget or adjust the decision-run reserve.', target: '#business' };
  return null;
}

type Work = { companyId: string; status: string; availableWeek?: number | null };
function newlyCompleted(before: Record<string, Work>, after: Record<string, Work>, owner: string, previousWeek: number, week: number, ignored = new Set<string>()): string | undefined {
  return Object.keys(after).find(id => {
    const next = after[id], previous = before[id];
    const available = next.status === 'complete' && (next.availableWeek ?? 0) <= week;
    const wasAvailable = previous?.status === 'complete' && (previous.availableWeek ?? 0) <= previousWeek;
    return next.companyId === owner && available && !wasAvailable && !ignored.has(id);
  });
}

export function decisionStartGuard(state: GameState, policy: DecisionClockPolicy, content: GameContent = CONTENT): DecisionStop | null {
  const cash = decisionCashGuard(state, policy, content);
  if (cash) return cash;
  const blocked = Object.values(state.slices.models.developmentPlans ?? {}).find(p => p.status === 'blocked');
  if (blocked) return { reason: `${blocked.name}: ${blocked.message}`, target: '#development-plans' };
  const due = policy.deadlines && deadlineEntries(state).find(p => p.week <= state.week + 1);
  if (due) return { reason: `${due.label} is due in Week ${due.week}. Review delivery, then use Next week when ready.`, target: due.target };
  return null;
}
function deadlineEntries(state: GameState): Array<{ id: string; week: number; label: string; target: string }> {
  const plans = Object.values(state.slices.models.developmentPlans ?? {}).filter(p => p.companyId === state.playerCompanyId && !['review', 'cancelled'].includes(p.status));
  const chosenWindows = new Set(Object.values(state.slices.campaign.systemsBriefs ?? {}).map(order => order.terms.windowIndex));
  return [
    ...plans.map(p => ({ id: p.id, week: p.deadlineWeek, label: p.name, target: '#development-plans' })),
    ...plans.flatMap(plan => {
      const objective = plan.objective;
      // Keep immutable expired goals inspectable without trapping the clock on
      // an acceptance window that no next-week command can still meet.
      return objective?.kind === 'renewable-brief' && objective.terms.acceptUntilWeek > state.week && !chosenWindows.has(objective.terms.windowIndex)
        ? [{ id: plan.id + ':offer', week: objective.terms.acceptUntilWeek, label: `${plan.name}: ${objective.terms.client} offer acceptance`, target: '#development-plans' }] : [];
    }),
    ...Object.values(state.slices.campaign.customerBriefs ?? {}).filter(p => p.status === 'active').map(p => ({ id: p.id, week: p.deadlineWeek, label: 'Customer commission', target: '#customer-briefs' })),
    ...Object.values(state.slices.campaign.systemsBriefs ?? {}).filter(p => p.status === 'active').map(p => ({ id: p.id, week: p.deadlineWeek, label: p.terms.client, target: '#customer-briefs' })),
  ];
}

export function decisionRunPreview(state: GameState, policy: DecisionClockPolicy): string {
  const deadlines = deadlineEntries(state).filter(p => p.week >= state.week).sort((a, b) => a.week - b.week);
  const until = policy.deadlines && deadlines.length ? Math.min(state.week + policy.maxWeeks, Math.max(state.week, deadlines[0].week - 1)) : state.week + policy.maxWeeks;
  return `Runs at your selected speed, for up to ${Math.max(0, until - state.week)} weeks. Stops when an enabled decision needs attention. Weekly bills and work continue normally.`;
}

/** Observe committed engine transitions only. This never skips work, issues a
 * command, invents evidence, or simulates a different outcome from Next week. */
export function nextDecisionStop(before: GameState, after: GameState, policy: DecisionClockPolicy, startedWeek: number): DecisionStop | null {
  const owner = after.playerCompanyId;
  const company = after.slices.company.companies[owner];
  if (company.arrearsCents) return { reason: 'This run has ended with unpaid bills. Review or export the company before starting a new lab.', target: '#save' };
  if (company.cashCents < policy.cashReserveCents) return { reason: 'Cash reached your decision-run reserve. Review company spending.', target: '#business' };
  const plan = Object.values(after.slices.models.developmentPlans ?? {}).find(p => ['review', 'blocked'].includes(p.status) && before.slices.models.developmentPlans?.[p.id]?.status !== p.status);
  if (plan) return { reason: `${plan.name}: ${plan.message}`, target: '#development-plans' };
  const finishedBrief = Object.values(after.slices.campaign.systemsBriefs ?? {}).find(p => p.status !== 'active' && before.slices.campaign.systemsBriefs?.[p.id]?.status === 'active');
  if (finishedBrief) return { reason: `${finishedBrief.terms.client}: ${finishedBrief.feedback}`, target: '#customer-briefs' };
  const finishedCustomer = Object.values(after.slices.campaign.customerBriefs ?? {}).find(p => p.status !== 'active' && before.slices.campaign.customerBriefs?.[p.id]?.status === 'active');
  if (finishedCustomer) return { reason: finishedCustomer.feedback, target: '#customer-briefs' };
  if (policy.research) {
    const discovery = newlyCompleted(before.slices.research.projects, after.slices.research.projects, owner, before.week, after.week);
    const architecture = newlyCompleted(before.slices.research.modelResearch ?? {}, after.slices.research.modelResearch ?? {}, owner, before.week, after.week);
    const experiment = newlyCompleted(before.slices.campaign.progression?.experiments ?? {}, after.slices.campaign.progression?.experiments ?? {}, owner, before.week, after.week);
    if (experiment) return { reason: 'A research experiment finished. Review its exact-model evidence and the next program stage.', target: '#research-experiment/' + encodeURIComponent(experiment) };
    if (architecture) return { reason: 'Architecture research is ready to use. Review the new design options before continuing.', target: '#architecture-research' };
    if (discovery) return { reason: 'Research is ready to use. Review the new design options before continuing.', target: '#research' };
  }
  if (policy.projects) {
    // A delegated plan owns its intermediate handoffs. Its completion or blocked
    // state above is the decision; stopping at every internal job defeats delegation.
    const delegatedJobs = new Set(Object.values(after.slices.models.developmentPlans ?? {}).filter(p => p.status === 'running')
      .flatMap(p => p.steps.flatMap(s => ['preparation-', 'training-', 'evaluation-'].map(prefix => prefix + s.commandId))));
    const stages: Array<[Record<string, Work>, Record<string, Work>, string, string]> = [
      [before.slices.data.preparationJobs, after.slices.data.preparationJobs, 'Data preparation finished.', '#data'],
      [before.slices.models.trainingRuns, after.slices.models.trainingRuns, 'A model training run finished.', '#models'],
      [before.slices.models.evaluationRuns, after.slices.models.evaluationRuns, 'A paid evaluation finished.', '#models'],
    ];
    for (const [previous, next, label, target] of stages) if (newlyCompleted(previous, next, owner, before.week, after.week, delegatedJobs))
      return { reason: label + ' Review the result and choose the next step.', target };
  }
  if (policy.deadlines) {
    const deadline = deadlineEntries(after).find(p => p.week > before.week && p.week <= after.week + 1);
    if (deadline) return { reason: `${deadline.label} is due in Week ${deadline.week}. Review delivery before advancing.`, target: deadline.target };
  }
  if (policy.service) {
    const service = Object.values(after.slices.products.lastUsage).find(u => u.week === after.week && u.paidAccounts > 0 && u.fulfillmentBps < 9500
      && after.slices.products.offers[u.productId]?.companyId === owner
      && (before.slices.products.lastUsage[u.productId]?.fulfillmentBps ?? 10000) >= 9500);
    if (service) return { reason: `${after.slices.products.offers[service.productId].name} delivered less than 95% of paid demand. Review capacity.`, target: '#capacity-forecast' };
    const business = Object.values(after.slices.products.commercialContracts).find(contract => contract.companyId === owner
      && contract.lastUsage?.week === after.week && contract.lastUsage.grossCents > 0 && contract.lastUsage.serviceBps < 9500
      && (before.slices.products.commercialContracts[contract.id]?.lastUsage?.serviceBps ?? 10000) >= 9500);
    if (business) return { reason: `${BUSINESS_BY_ID[business.customerId].name} ${business.contractKind === 'customer-hosted' ? 'support' : 'private service'} fell below 95%. Review the customer commitment, staffing and capacity.`, target: '#business-commitments' };
    const assured = Object.values(after.slices.products.assuranceContracts ?? {}).find(contract => contract.companyId === owner
      && contract.lastUsage?.week === after.week && contract.lastUsage.grossCents > 0 && contract.lastUsage.serviceBps < 9500
      && (before.slices.products.assuranceContracts?.[contract.id]?.lastUsage?.serviceBps ?? 10000) >= 9500);
    if (assured) return { reason: `${ASSURANCE_BY_ID[assured.buyerId].name} assured API service fell below 95%. Review its support, qualification and reserved capacity.`, target: '#developer-api' };
  }
  if (policy.opportunities) {
    const progression = after.slices.campaign.progression;
    const achievement = progression && (Object.entries(progression.chapters).some(([id, track]) => track?.achievement
      && !before.slices.campaign.progression?.chapters[id as keyof typeof progression.chapters]?.achievement)
      || Object.keys(progression.ambitions).some(id => !before.slices.campaign.progression?.ambitions[id as keyof typeof progression.ambitions]));
    if (achievement) return { reason: 'Your company earned a chapter or ambition. Review its lasting benefits and choose the next direction.', target: '#campaign' };
    const oldWindow = getMarketOpportunityView(before), nextWindow = getMarketOpportunityView(after);
    if ((nextWindow.active && nextWindow.active.instanceId !== oldWindow.active?.instanceId)
      || (nextWindow.upcoming && nextWindow.upcoming.instanceId !== oldWindow.upcoming?.instanceId))
      return { reason: 'A market opportunity changed. Review its timing and customer demand.', target: '#market' };
    if (after.week % 12 === 0 && company.earnedRevenueCents > 0) return { reason: 'The next customer commission window is ready to plan. Review the new offers.', target: '#customer-briefs' };
  }
  if (after.week - startedWeek >= policy.maxWeeks) return { reason: `Completed ${policy.maxWeeks} weeks without another selected stop. Review the company before continuing.`, target: '#lab-projects' };
  return null;
}
