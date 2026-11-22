import type { CampaignCriterion, CampaignView, CampaignWeek, DomainSlices, EndingId, GameContent, GameState, ModelVersion } from '../contracts/types';
import type { CampaignRules } from '../contracts/wave4-campaign';
import { CONTENT } from '../content/catalog';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { CAMPAIGN_HISTORY_LIMIT, ENDING_IDS, ENDING_RULES } from '../content/wave4-campaign';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, formatMoney, mulDiv } from '../core/math';
import { getWeeklyBaseCost } from '../core/selectors';

export function hasCompletedModelTraining(state: Readonly<GameState>, model: ModelVersion): boolean {
  const seen = new Set<string>();
  let current: ModelVersion | undefined = model;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.companyId !== model.companyId || current.scenarioStart) return false;
    const run = current.trainingRunId ? state.slices.models.trainingRuns[current.trainingRunId] : undefined;
    if (run?.status === 'complete' && run.outputModelId === current.id && run.companyId === model.companyId) return true;
    const parentId: string | undefined = current.runtimeVariant?.sourceModelId ?? current.parentModelId;
    current = parentId ? state.slices.models.versions[parentId] : undefined;
  }
  return false;
}

/** Uses paid delivered service from the settled week, never next-week trial conversions. */
export function captureCampaignWeek(state: Readonly<GameState>, content: GameContent = CONTENT): CampaignWeek {
  const companyId = state.playerCompanyId, company = state.slices.company.companies[companyId];
  const products = state.slices.products, paidKinds = new Set<string>(), deliveredModels = new Set<string>();
  const specialists = new Map<string, 'documents' | 'coding'>(), service: number[] = [];
  let consumerAccounts = 0, developerAccounts = 0, businessOrganizations = 0, sustainedContracts = 0;
  for (const offer of Object.values(products.offers)) {
    if (offer.companyId !== companyId) continue;
    const usage = products.lastUsage[offer.id], deployment = products.deployments[offer.deploymentId];
    if (!usage || usage.week !== state.week || !usage.paidAccounts) continue;
    service.push(usage.fulfillmentBps);
    if (!usage.billedCents || !usage.paidExecutedWork || !deployment) continue;
    paidKinds.add(offer.kind); deliveredModels.add(deployment.modelId);
    if (offer.kind === 'basic-chat') consumerAccounts += usage.paidAccounts;
    else if (offer.kind === 'developer-api') developerAccounts += usage.paidAccounts;
    else { businessOrganizations += usage.paidAccounts; specialists.set(deployment.modelId, 'documents'); }
  }
  for (const contract of Object.values(products.commercialContracts)) {
    if (contract.companyId !== companyId || contract.lastUsage?.week !== state.week) continue;
    const usage = contract.lastUsage;
    service.push(usage.serviceBps);
    if (!usage.billedCents) continue;
    businessOrganizations++; paidKinds.add('business-docs'); deliveredModels.add(contract.modelId);
    specialists.set(contract.modelId, BUSINESS_BY_ID[contract.customerId].domain);
    // A successful renewal proves the previous full term. Resetting the current
    // term's billing counters must not erase the relationship's earned maturity.
    if ((contract.termWeeksServed >= 4 || contract.termIndex > 1) && usage.serviceBps >= BUSINESS_BY_ID[contract.customerId].slaBps
      && contract.termServiceBpsTotal >= contract.termWeeksServed * BUSINESS_BY_ID[contract.customerId].slaBps) sustainedContracts++;
  }
  let frontierModelId: string | null = null, frontierScoreBps = 0, frontierReliabilityBps = 0, frontierBehaviorTested = false;
  let specialistModelId: string | null = null, specialistScoreBps = 0, specialistReliabilityBps = 0;
  const reports = Object.values(state.slices.models.reports).filter(report => report.companyId === companyId && report.heldOut && !report.scenarioStart);
  for (const modelId of deliveredModels) {
    const model = state.slices.models.versions[modelId];
    if (!model || !hasCompletedModelTraining(state, model)) continue;
    const report = reports.find(item => item.modelId === modelId && item.suiteId === 'expanded-capabilities-1');
    if (!report) continue;
    if (model.family === 'large' || model.family === 'frontier' || model.architecture === 'sparse') {
      const score = Math.min(...Object.values(report.capabilityBps));
      const behaviorTested = reports.some(item => item.modelId === modelId && item.suiteId === 'behavior-cases-1'
        && !!item.outcomes && item.cases.length >= 100 && item.outcomes.confidentErrors * 20 <= item.cases.length);
      const qualifies = score >= 8000 && report.reliabilityBps >= 9200 && behaviorTested;
      const currentQualifies = frontierScoreBps >= 8000 && frontierReliabilityBps >= 9200 && frontierBehaviorTested;
      if ((qualifies && !currentQualifies) || (qualifies === currentQualifies && score > frontierScoreBps)) {
        frontierModelId = modelId; frontierScoreBps = score; frontierReliabilityBps = report.reliabilityBps; frontierBehaviorTested = behaviorTested;
      }
    }
    const domain = specialists.get(modelId);
    if (domain) {
      const score = report.capabilityBps[domain], qualifies = score >= 6500 && report.reliabilityBps >= 9200;
      const currentQualifies = specialistScoreBps >= 6500 && specialistReliabilityBps >= 9200;
      if ((qualifies && !currentQualifies) || (qualifies === currentQualifies && score > specialistScoreBps)) {
        specialistModelId = modelId; specialistScoreBps = score; specialistReliabilityBps = report.reliabilityBps;
      }
    }
  }
  return {
    week: state.week, revenueCents: company.lastWeek.revenueCents, operatingExpenseCents: company.lastWeek.operatingExpenseCents,
    cashCents: company.cashCents, baseCostCents: getWeeklyBaseCost(state as GameState, content, companyId), arrearsCents: company.arrearsCents,
    consumerAccounts, developerAccounts, businessOrganizations, paidProductKinds: paidKinds.size,
    serviceBps: service.length ? Math.min(...service) : 0, trustBps: state.slices.markets.companyTrustBps[companyId] ?? 5000,
    agentPenaltyCents: Object.values(state.slices.agents.jobs).filter(job => job.companyId === companyId && job.completedWeek === state.week)
      .reduce((sum, job) => checkedAdd(sum, job.penaltyCents), 0),
    frontierModelId, frontierScoreBps, frontierReliabilityBps, frontierBehaviorTested,
    specialistModelId, specialistScoreBps, specialistReliabilityBps, sustainedContracts,
  };
}

export function campaignRouteCriteria(row: CampaignWeek, route: EndingId, rules: CampaignRules = 'classic'): CampaignCriterion[] {
  const criteria: CampaignCriterion[] = [];
  const add = (id: string, label: string, current: string, target: string, met: boolean, detail: string) => criteria.push({ id, label, current, target, met, detail });
  const surplus = row.revenueCents - row.operatingExpenseCents;
  const margin = row.revenueCents ? Math.sign(surplus) * mulDiv(Math.abs(surplus), 10000, row.revenueCents) : 0;
  const percent = (value: number) => `${(value / 100).toFixed(1)}%`;
  const release = rules === 'release';
  const marginTarget = route === 'frontier' ? (release ? 500 : 0) : route === 'platform' ? 1500 : 1000;
  const revenueTarget = route === 'frontier' ? 1_000_000 : route === 'platform' ? 600_000 : 300_000;
  const serviceTarget = route === 'frontier' ? 9500 : 9800;
  add('revenue', 'Earned weekly revenue', formatMoney(row.revenueCents), `${formatMoney(revenueTarget)} / week`, row.revenueCents >= revenueTarget, 'Uses the settled company ledger, after service credits.');
  add('margin', 'Operating margin', percent(margin), `${percent(marginTarget)} or better`, row.revenueCents > 0 && margin >= marginTarget, 'Payroll, rent, actual GPU work and operating project fees count as expenses. Capital spending remains a cash decision.');
  add('reserve', 'Cash reserve', formatMoney(row.cashCents), `${formatMoney(row.baseCostCents * 8)} · 8 base-cost weeks`, row.cashCents >= row.baseCostCents * 8 && row.arrearsCents === 0, 'Keep eight weeks of current base costs in cash and have no unpaid bills.');
  add('service', 'Weakest paid service', percent(row.serviceBps), percent(serviceTarget), row.serviceBps >= serviceTarget && row.agentPenaltyCents === 0, 'Every current paid product and business commitment must meet the floor; an audited agent penalty breaks the streak.');
  if (route === 'frontier') {
    add('frontier-model', 'Live frontier model', `${(row.frontierScoreBps / 100).toFixed(1)} minimum domain score`, '80 in all four domains', !!row.frontierModelId && row.frontierScoreBps >= 8000, 'A trained large or sparse model must earn a full capability report and deliver paid service. Starting scenario models do not qualify.');
    add('frontier-reliability', 'Frontier reliability', percent(row.frontierReliabilityBps), '92.0%', row.frontierReliabilityBps >= 9200, 'The same live model must meet this reliability target.');
    add('behavior-evidence', 'Behavior holdout', row.frontierBehaviorTested ? 'Passed' : 'Needed', 'At most 5 confidently wrong cases / 100', row.frontierBehaviorTested, 'Run the independent behavior suite on that exact model version.');
  } else if (route === 'platform') {
    const consumerTarget = release ? 550 : 600, developerTarget = release ? 50 : 60;
    add('consumers', 'Paying consumer accounts', String(row.consumerAccounts), String(consumerTarget), row.consumerAccounts >= consumerTarget, 'Only accounts receiving billable service this week count.');
    add('developers', 'Paying developer accounts', String(row.developerAccounts), String(developerTarget), row.developerAccounts >= developerTarget, 'Serve the developer API alongside your consumer product.');
    add('breadth', 'Paid product families', String(row.paidProductKinds), '2', row.paidProductKinds >= 2, 'Consumer, developer and business products are distinct families.');
    add('trust', 'Company trust', percent(row.trustBps), '75.0%', row.trustBps >= 7500, 'Trust is earned through actual service in the finite market.');
  } else {
    const organizationTarget = release ? 10 : 12;
    add('organizations', 'Served business organizations', String(row.businessOrganizations), String(organizationTarget), row.businessOrganizations >= organizationTarget, 'Paid document subscriptions and active billed contracts share the same finite organization market.');
    add('specialist-model', 'Live domain score', (row.specialistScoreBps / 100).toFixed(1), '65', !!row.specialistModelId && row.specialistScoreBps >= 6500, 'An evaluated trained model must serve the document or coding domain bought by your business customer.');
    add('specialist-reliability', 'Specialist reliability', percent(row.specialistReliabilityBps), '92.0%', row.specialistReliabilityBps >= 9200, 'The same specialist model must meet this reliability target.');
    add('commitments', 'Sustained business commitments', String(row.sustainedContracts), '1', row.sustainedContracts >= 1, 'At least one named contract needs four delivered weeks and a term average meeting its SLA. Successful renewals preserve that maturity; current service must still qualify.');
  }
  return criteria;
}

export function qualifiesForEnding(row: CampaignWeek, route: EndingId, rules?: CampaignRules): boolean {
  return campaignRouteCriteria(row, route, rules).every(criterion => criterion.met);
}

export function advanceCampaignProgress(campaign: DomainSlices['campaign'], row: CampaignWeek): { category: 'project'; message: string }[] {
  const last = campaign.history.at(-1);
  if (last?.week === row.week) {
    if (canonicalStateHash(last) !== canonicalStateHash(row)) throw new Error('A settled campaign week cannot be rewritten.');
    return [];
  }
  if (last && row.week <= last.week) throw new Error('Campaign evidence must advance in order.');
  const messages: { category: 'project'; message: string }[] = [];
  const consecutive = !last || last.week + 1 === row.week;
  campaign.history.push(row); campaign.history = campaign.history.slice(-CAMPAIGN_HISTORY_LIMIT);
  for (const route of ENDING_IDS) {
    campaign.endingStreaks[route] = qualifiesForEnding(row, route, campaign.rules)
      ? Math.min(ENDING_RULES[route].weeks, (consecutive ? campaign.endingStreaks[route] : 0) + 1) : 0;
    if (!campaign.endings[route] && campaign.endingStreaks[route] >= ENDING_RULES[route].weeks) {
      campaign.endings[route] = { id: route, achievedWeek: row.week, proof: structuredClone(campaign.history.slice(-ENDING_RULES[route].weeks)) };
      campaign.milestones.push('ending-' + route);
      messages.push({ category: 'project', message: `${ENDING_RULES[route].name} achieved after ${ENDING_RULES[route].weeks} consecutive qualifying weeks. Your company continues; pursue the other routes or keep building.` });
    }
  }
  return messages;
}

export function getCampaignView(state: Readonly<GameState>, content: GameContent = CONTENT): CampaignView {
  const row = captureCampaignWeek(state, content), campaign = state.slices.campaign;
  return { completedCount: Object.keys(campaign.endings ?? {}).length, routes: ENDING_IDS.map(id => ({
    id, name: ENDING_RULES[id].name, description: ENDING_RULES[id].description,
    requiredWeeks: ENDING_RULES[id].weeks, streak: campaign.endingStreaks[id], achievedWeek: campaign.endings?.[id]?.achievedWeek ?? null,
    criteria: campaignRouteCriteria(row, id, campaign.rules),
  })) };
}
