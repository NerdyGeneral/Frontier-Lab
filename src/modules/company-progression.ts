import type { CompanyAmbitionId, CompanyAmbitionWeek, CompanyChapterProof } from '../contracts/company-progression';
import type { ChapterId } from '../contracts/strategic-variety';
import type { CampaignCriterion, GameContent, GameState, ModelVersion } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { COMPANY_AMBITIONS, COMPANY_AMBITION_HISTORY_LIMIT, COMPANY_AMBITION_IDS, RESEARCH_PROGRAM_IDS } from '../content/company-progression';
import { CHAPTERS } from '../content/strategic-variety';
import { HARDWARE_BUYERS, chipProductionTerms } from '../content/silicon-market';
import { canonicalStateHash } from '../core/canonical';
import { formatMoney, mulDiv } from '../core/math';
import { getWeeklyBaseCost } from '../core/selectors';
import { getAISystemMetrics } from './ai-systems';
import { hasCompletedModelTraining } from './campaign-progress';
import { isCapabilitySuite } from './evaluation-classification';
import { isPaidChallengeReport } from './model-challenges';
import { activeEfficiency } from './product-efficiency';
import { productDemand, requestMeter } from './products';
import { getResearchProgramLevel } from './research-programs';
import { companyChapterEarnedWeek } from './progression-state';
import { hardwareCostFactId, hardwareRevenueFactId } from './hardware-sales';
export { initializeCompanyProgression, getCompanyWorld } from './progression-state';

export function connectedChapterDefinition(id: ChapterId) {
  if (id !== 'efficient-portfolio') return CHAPTERS[id];
  return { title: 'Make efficient intelligence profitable', description: 'Meet customer needs with a compact model, deployment engineering, caching or a useful model portfolio.', weeks: 3,
    requirements: ['Measured low-cost service or an active engineering improvement', 'Independently evaluated, paid service with 95% fulfillment', 'Positive company operating surplus for three consecutive weeks'] };
}
function modelEfficiency(model: ModelVersion): Pick<CompanyChapterProof, 'efficient' | 'efficiencyReason' | 'efficiencyInstallationId' | 'secondaryModelId'> {
  const metrics = getAISystemMetrics(model);
  if (metrics.servingCUwPer1000 <= 0.2 && Math.max(...Object.values(model.capabilityBps)) >= 5500)
    return { efficient: true, efficiencyReason: 'Useful service at no more than 0.2 CUw per 1,000 requests', efficiencyInstallationId: null, secondaryModelId: null };
  if (model.runtimeVariant && model.runtimeVariant.servingWorkBps <= 8500)
    return { efficient: true, efficiencyReason: 'A paid deployment variant reduces serving work by at least 15%', efficiencyInstallationId: null, secondaryModelId: null };
  return { efficient: false, efficiencyReason: 'Use a low-cost model or apply a measured serving improvement', efficiencyInstallationId: null, secondaryModelId: null };
}
/** Only settled, billed service can qualify. Model improvements can continue a company's streak. */
export function connectedChapterCandidates(state: Readonly<GameState>, content: GameContent = CONTENT): Array<{ name: string; proof: CompanyChapterProof }> {
  const owner = state.playerCompanyId, company = state.slices.company.companies[owner];
  const rows: Array<{ name: string; proof: CompanyChapterProof }> = [];
  const add = (name: string, sourceKind: CompanyChapterProof['sourceKind'], sourceId: string, modelId: string, billedCents: number, fulfillmentBps: number,
    efficiency?: Pick<CompanyChapterProof, 'efficient' | 'efficiencyReason' | 'efficiencyInstallationId' | 'secondaryModelId'>) => {
    const model = state.slices.models.versions[modelId];
    if (!model || model.companyId !== owner || !hasCompletedModelTraining(state, model) || billedCents <= 0) return;
    const reports = Object.values(state.slices.models.reports).filter(report => report.modelId === modelId && report.companyId === owner && isPaidChallengeReport(state, report, state.week));
    const capability = reports.find(report => isCapabilitySuite(report.suiteId));
    if (!capability) return;
    const advanced = reports.find(report => report.suiteId === 'advanced-capabilities-1');
    rows.push({ name, proof: { week: state.week, sourceKind, sourceId, modelId, reportIds: [capability.id, ...(advanced ? [advanced.id] : [])],
      billedCents, fulfillmentBps, revenueCents: company.lastWeek.revenueCents, operatingExpenseCents: company.lastWeek.operatingExpenseCents,
      ...(efficiency ?? modelEfficiency(model)) } });
  };
  for (const product of Object.values(state.slices.products.offers)) {
    const usage = state.slices.products.lastUsage[product.id], model = state.slices.models.versions[state.slices.products.deployments[product.deploymentId]?.modelId];
    if (product.companyId !== owner || !model || product.status !== 'active' || usage?.week !== state.week || !usage.paidAccounts || !usage.paidExecutedWork) continue;
    let efficiency = modelEfficiency(model);
    const demand = productDemand(state, product, content, state.week), plain = requestMeter(model, demand.features);
    if (demand.meter.work < Math.floor(plain.work * 0.95)) {
      const route = activeEfficiency(state, product.id, 'routing'), cache = activeEfficiency(state, product.id, 'prefix-cache');
      const installation = route ?? cache;
      if (installation) efficiency = { efficient: true, efficiencyReason: route ? 'Paid model routing reduces serving work by at least 5%' : 'A warm paid prefix cache reduces serving work by at least 5%',
        efficiencyInstallationId: installation.id, secondaryModelId: route?.secondaryModelId ?? null };
    }
    add(product.name, 'product', product.id, model.id, usage.billedCents, usage.fulfillmentBps, efficiency);
  }
  for (const contract of Object.values(state.slices.products.commercialContracts)) {
    if (contract.companyId !== owner || contract.lastUsage?.week !== state.week) continue;
    add(contract.customerId, 'contract', contract.id, contract.modelId, contract.lastUsage.billedCents, contract.lastUsage.serviceBps);
  }
  for (const order of Object.values(state.slices.campaign.systemsBriefs ?? {})) {
    if (order.status !== 'completed' || order.finishedWeek !== state.week || !order.deliveryWeeks.includes(state.week)) continue;
    add(order.terms.client, 'commission', order.id, order.modelId, order.terms.feeCents, 10000);
  }
  return rows;
}
export function connectedChapterCriteria(state: Readonly<GameState>, id: ChapterId, proof?: CompanyChapterProof) {
  const model = proof ? state.slices.models.versions[proof.modelId] : undefined;
  const advanced = model?.advancedCapabilities ?? { reasoning: 0, longContext: 0, multimodal: 0 };
  const hasAdvancedReport = !!proof?.reportIds.some(reportId => state.slices.models.reports[reportId]?.suiteId === 'advanced-capabilities-1');
  const criteria = [
    { label: 'A model trained by your lab with a paid capability evaluation', met: !!proof },
    { label: 'Real billed service this week: product, private contract or completed commission', met: !!proof && proof.billedCents > 0 },
    { label: `${id === 'first-product' ? 90 : 95}% of customer work fulfilled`, met: !!proof && proof.fulfillmentBps >= (id === 'first-product' ? 9000 : 9500) },
  ];
  if (id === 'efficient-portfolio') criteria.push({ label: proof?.efficient ? proof.efficiencyReason : 'A useful low-cost model, paid deployment variant, routing or cache improvement', met: !!proof?.efficient });
  if (id === 'advanced-specialist' || id === 'frontier-lab') criteria.push({ label: 'Paid advanced evaluation on this exact model', met: hasAdvancedReport });
  if (id === 'advanced-specialist') criteria.push({ label: 'Reasoning, long context or multimodal at 70+', met: Math.max(...Object.values(advanced)) >= 7000 });
  if (id === 'frontier-lab') criteria.push(
    { label: 'A custom Frontier model with four core skills at 80+', met: model?.family === 'frontier' && !!model.modelDesign && Math.min(...Object.values(model.capabilityBps)) >= 8000 },
    { label: 'All three advanced skills at 60+', met: Math.min(...Object.values(advanced)) >= 6000 });
  if (id === 'efficient-portfolio' || id === 'frontier-lab') criteria.push({ label: 'Positive company operating surplus', met: !!proof && proof.revenueCents > proof.operatingExpenseCents });
  return criteria;
}
export function assessConnectedChapter(state: Readonly<GameState>, id: ChapterId) {
  const candidates = connectedChapterCandidates(state).map(row => ({ ...row, criteria: connectedChapterCriteria(state, id, row.proof) }));
  candidates.sort((a, b) => b.criteria.filter(criterion => criterion.met).length - a.criteria.filter(criterion => criterion.met).length || b.proof.billedCents - a.proof.billedCents || a.proof.sourceId.localeCompare(b.proof.sourceId));
  const best = candidates[0];
  return { productName: best?.name ?? null, criteria: best?.criteria ?? connectedChapterCriteria(state, id),
    proof: best?.criteria.every(criterion => criterion.met) ? best.proof : null };
}
export function advanceConnectedChapters(campaign: GameState['slices']['campaign'], state: Readonly<GameState>) {
  const progression = campaign.progression, messages: Array<{ category: 'project'; message: string }> = [];
  if (!progression || state.week <= progression.activatedWeek) return messages;
  for (const id of Object.keys(CHAPTERS) as ChapterId[]) {
    if (companyChapterEarnedWeek(state, id) !== null || campaign.chapters?.completed[id]) continue;
    const track = progression.chapters[id] ??= { progress: [], achievement: null };
    if (track.progress.at(-1)?.week === state.week) continue;
    const assessment = assessConnectedChapter(state, id);
    if (!assessment.proof) { track.progress = []; continue; }
    const continued = track.progress.at(-1)?.week === state.week - 1;
    track.progress = [...(continued ? track.progress : []), assessment.proof].slice(-CHAPTERS[id].weeks);
    if (track.progress.length !== CHAPTERS[id].weeks) continue;
    track.achievement = { earnedWeek: state.week, proof: structuredClone(track.progress) };
    messages.push({ category: 'project', message: `Chapter earned: ${connectedChapterDefinition(id).title}. Your company keeps the achievement and its research benefit; successful model replacements do not erase progress.` });
  }
  return messages;
}
export function captureCompanyAmbitionWeek(state: Readonly<GameState>, content: GameContent = CONTENT): CompanyAmbitionWeek {
  const owner = state.playerCompanyId, company = state.slices.company.companies[owner], candidates = connectedChapterCandidates(state, content);
  let efficientBilledCents = 0, privateBilledCents = 0, verifiedBilledCents = 0;
  const service: number[] = [];
  for (const row of candidates) {
    const proof = row.proof, metrics = getAISystemMetrics(state.slices.models.versions[proof.modelId]);
    service.push(proof.fulfillmentBps);
    if (proof.efficient && proof.fulfillmentBps >= 9500) efficientBilledCents += proof.billedCents;
    if (proof.sourceKind === 'contract' && proof.fulfillmentBps >= 9800) privateBilledCents += proof.billedCents;
    const verifiedWork = proof.sourceKind === 'commission' ? state.slices.campaign.systemsBriefs?.[proof.sourceId]?.briefId === 'verified-analysis'
      : proof.sourceKind === 'product' ? state.slices.products.lastUsage[proof.sourceId]?.workload?.id === 'verified' : false;
    if (verifiedWork && metrics.verifiedCompletionBps >= 7400 && proof.fulfillmentBps >= 9800) verifiedBilledCents += proof.billedCents;
  }
  for (const job of Object.values(state.slices.agents.jobs)) if (job.companyId === owner && job.completedWeek === state.week && job.verifiedOutcome && job.billedCents > 0 && job.penaltyCents === 0)
    verifiedBilledCents += job.billedCents;
  // Include every current commitment in reliability, even a service that has no chapter-eligible model.
  for (const product of Object.values(state.slices.products.offers)) {
    const usage = state.slices.products.lastUsage[product.id];
    if (product.companyId === owner && usage?.week === state.week && usage.paidAccounts > 0) service.push(usage.fulfillmentBps);
  }
  for (const contract of Object.values(state.slices.products.commercialContracts)) if (contract.companyId === owner && contract.lastUsage?.week === state.week) service.push(contract.lastUsage.serviceBps);
  let hardwareDeliveries = 0, hardwareRevenueCents = 0, hardwareCostCents = 0;
  // Posted identities and immutable paid order terms outlive the bounded recent ledger.
  for (const sale of Object.values(state.slices.compute.hardwareSales ?? {})) if (sale.companyId === owner && sale.shippedWeek !== null && sale.shippedWeek <= state.week
    && state.slices.company.postedFacts[hardwareRevenueFactId(sale.buyerId)] && state.slices.company.postedFacts[hardwareCostFactId(sale.buyerId)]) {
    hardwareDeliveries++;
    hardwareRevenueCents += HARDWARE_BUYERS[sale.buyerId].priceCents;
    hardwareCostCents += chipProductionTerms(state.slices.compute.chipDesigns[sale.designId], HARDWARE_BUYERS[sale.buyerId].racks, content.infrastructure.rackCU, sale.foundry).costCents;
  }
  for (const order of Object.values(state.slices.products.privateApplianceOrders ?? {})) if (order.companyId === owner && order.settledWeek !== null && order.settledWeek <= state.week
    && state.slices.company.postedFacts[order.bundleReceiptId] && state.slices.company.postedFacts[order.fabricationFactId]) {
    hardwareDeliveries++; hardwareRevenueCents += order.bundlePriceCents;
    hardwareCostCents += order.configuration.fabricationCostCents + (state.slices.products.commercialContracts[order.contractId]?.setupFeeCents ?? 0);
  }
  return { week: state.week, revenueCents: company.lastWeek.revenueCents, operatingExpenseCents: company.lastWeek.operatingExpenseCents,
    cashCents: company.cashCents, baseCostCents: getWeeklyBaseCost(state as GameState, content, owner), arrearsCents: company.arrearsCents,
    serviceBps: service.length ? Math.min(...service) : verifiedBilledCents > 0 ? 10000 : 0,
    efficientBilledCents, privateBilledCents, verifiedBilledCents, hardwareDeliveries, hardwareRevenueCents, hardwareCostCents,
    programLevels: Object.fromEntries(RESEARCH_PROGRAM_IDS.map(id => [id, getResearchProgramLevel(state, id)])) as CompanyAmbitionWeek['programLevels'] };
}
export function companyAmbitionCriteria(row: CompanyAmbitionWeek, id: CompanyAmbitionId): CampaignCriterion[] {
  const criteria: CampaignCriterion[] = [], add = (key: string, label: string, current: string, target: string, met: boolean, detail: string) => criteria.push({ id: key, label, current, target, met, detail });
  add('reserve', 'Operating reserve', formatMoney(row.cashCents), '8 base-cost weeks', row.arrearsCents === 0 && row.cashCents >= 8 * row.baseCostCents, 'Retain cash for payroll, rent and overhead after the delivered work.');
  if (id === 'silicon-supplier') {
    add('hardware-delivery', 'Paid hardware or appliance deliveries', String(row.hardwareDeliveries), '1', row.hardwareDeliveries >= 1 && row.hardwareRevenueCents > 0, 'Counts qualified fabrication shipped and paid by a real customer. Internal rack installations do not count.');
    const margin = row.hardwareRevenueCents > 0 ? mulDiv(Math.max(0, row.hardwareRevenueCents - row.hardwareCostCents), 10000, row.hardwareRevenueCents) : 0;
    add('hardware-margin', 'Delivered batch contribution', `${margin / 100}%`, '15%', margin >= 1500, 'Revenue must exceed paid fabrication and delivery costs. This is contribution before company overhead and original design work.');
  } else {
    add('margin', 'Profitable company', formatMoney(row.revenueCents - row.operatingExpenseCents), 'Positive weekly surplus', row.revenueCents > row.operatingExpenseCents, 'Actual settled operating expenses count, including experiments and other projects.');
    const threshold = id === 'efficient-provider' ? 9500 : 9800;
    add('service', 'Reliable commitments', `${row.serviceBps / 100}%`, `${threshold / 100}%`, row.serviceBps >= threshold, 'Every active paid product and private commitment must meet the delivery floor.');
    const amount = id === 'efficient-provider' ? row.efficientBilledCents : id === 'private-provider' ? row.privateBilledCents : row.verifiedBilledCents;
    add('specialized-revenue', 'Delivered specialist revenue', formatMoney(amount), '$500 / week', amount >= 50000, 'Uses billed work from the exact evaluated model; free trials and merely owned technology do not count.');
    if (id !== 'private-provider') {
      const program = id === 'efficient-provider' ? 'efficient-systems' : 'verified-systems';
      add('program-evidence', 'Independent systems program', String(row.programLevels[program]), 'Stage 1', row.programLevels[program] >= 1, 'Complete a separately funded experiment, including real research compute, staff work and passing evidence.');
    }
  }
  return criteria;
}
export function advanceCompanyAmbitions(campaign: GameState['slices']['campaign'], state: Readonly<GameState>, content: GameContent) {
  const progression = campaign.progression, messages: Array<{ category: 'project'; message: string }> = [];
  if (!progression || state.week <= progression.activatedWeek) return messages;
  const row = captureCompanyAmbitionWeek(state, content), last = progression.ambitionHistory.at(-1);
  if (last?.week === row.week) { if (canonicalStateHash(last) !== canonicalStateHash(row)) throw new Error('A company ambition week cannot be rewritten.'); return messages; }
  progression.ambitionHistory = [...progression.ambitionHistory, row].slice(-COMPANY_AMBITION_HISTORY_LIMIT);
  for (const id of COMPANY_AMBITION_IDS) {
    if (progression.ambitions[id]) continue;
    const proof = progression.ambitionHistory.slice(-COMPANY_AMBITIONS[id].weeks);
    if (proof.length !== COMPANY_AMBITIONS[id].weeks || proof.some((week, index) => !companyAmbitionCriteria(week, id).every(criterion => criterion.met) || index > 0 && week.week !== proof[index - 1].week + 1)) continue;
    progression.ambitions[id] = { earnedWeek: state.week, proof: structuredClone(proof) };
    messages.push({ category: 'project', message: `${COMPANY_AMBITIONS[id].name} earned. Your company has proved this path through delivered results. The frontier stage of systems research is now open.` });
  }
  return messages;
}
export function getCompanyAmbitionView(state: Readonly<GameState>) {
  const progression = state.slices.campaign.progression;
  if (!progression) return [];
  const current = captureCompanyAmbitionWeek(state);
  return COMPANY_AMBITION_IDS.map(id => {
    let streak = 0;
    for (let index = progression.ambitionHistory.length - 1; index >= 0 && streak < COMPANY_AMBITIONS[id].weeks; index--) {
      const row = progression.ambitionHistory[index], next = progression.ambitionHistory[index + 1];
      if (next && row.week + 1 !== next.week || !companyAmbitionCriteria(row, id).every(criterion => criterion.met)) break;
      streak++;
    }
    return { id, ...COMPANY_AMBITIONS[id], streak, earnedWeek: progression.ambitions[id]?.earnedWeek ?? null, criteria: companyAmbitionCriteria(current, id) };
  });
}
