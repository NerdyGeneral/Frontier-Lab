import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from './model-customization-version';
import { CHALLENGE_SKILLS } from '../content/model-challenges';
import { isModelChallengeSuite } from '../modules/model-challenges';
import { STRATEGY_CONTENT_VERSION } from './strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { CAMPAIGN_ORIGINS, originStaffId } from '../content/campaign-origins';
import { careerLevel, MAX_WEEKLY_EXPERIENCE } from '../modules/staff-careers';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { EVALUATION_SUITES, TRAINING_RECIPES } from '../content/wave2-lab';
import { MARKET_SEGMENTS, SEGMENT_BY_ID } from '../content/wave2-market';
import type { DataPacket, GameContent, GameState, RoleAllocation } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { STAFF_ROLES } from './command-shape';
import { checkedAdd, checkedInteger } from './math';
import { commercialOrganizationCount } from '../modules/business';
import { ADVANCED_DOMAINS, ADVANCED_EVALUATION_SUITE } from '../content/advanced-skills';

const fail = (message: string): never => { throw new Error(message); };
const check = (condition: unknown, message: string): void => { if (!condition) fail(message); };
function record(v: unknown, label: string): void { check(!!v && typeof v === 'object' && !Array.isArray(v), label + ' must be a record.'); }
function list(v: unknown, label: string, max = 10000): void { check(Array.isArray(v) && v.length <= max, label + ' is missing or too large.'); }
function note(v: unknown): void { check(typeof v === 'string' && v.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(v), 'Project explanation is invalid.'); }
function id(v: unknown): void { check(typeof v === 'string' && v.length > 0 && v.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(v), 'Record identifier is invalid.'); }
function bps(v: number): void { checkedInteger(v); check(v <= 10000, 'A score exceeds 100%.'); }
function roleAllocation(v: RoleAllocation, quarter = false): void {
  record(v, 'Role allocation');
  check(Object.keys(v).sort().join() === [...STAFF_ROLES].sort().join(), 'All workforce roles must be present.');
  for (const role of STAFF_ROLES) { checkedInteger(v[role]); if (quarter) check(v[role] % (RESOURCE_SCALE / 4) === 0, 'Staff allocations use quarter FTE increments.'); }
}
function packet(v: DataPacket): void {
  record(v, 'Training evidence'); id(v.id); note(v.name);
  checkedInteger(v.rawUnits); checkedInteger(v.readyUnits); bps(v.qualityBps);
  check(typeof v.prepared === 'boolean' && v.readyUnits <= v.rawUnits && (v.prepared || v.readyUnits === 0), 'Training evidence readiness is inconsistent.');
  record(v.coverageBps, 'Evidence coverage'); for (const k of ['conversation', 'documents', 'coding', 'tools'] as const) bps(v.coverageBps[k]);
  record(v.rights, 'Evidence rights'); for (const k of ['hosted', 'weights', 'feedback'] as const) check(typeof v.rights[k] === 'boolean', 'Evidence rights must be explicit.');
}

/** Cross-slice persistence invariants, checked before and after every transaction. */
export function assertWave1State(state: GameState, content: GameContent): void {
  const { company, compute, models, data, products, markets } = state.slices;
  const ownCompany = (companyId: string) => check(Object.hasOwn(company.companies, companyId), 'Record has an unknown company.');
  const pastWeek = (week: number) => { checkedInteger(week); check(week <= state.week, 'Completed work is from a future week.'); };
  const job = (key: string, value: { id: string; companyId: string; startedWeek: number; status: string; lastProgress: number; lastBottleneck: string; completedWeek?: number }) => {
    check(key === value.id, 'Project identity mismatch.'); ownCompany(value.companyId); pastWeek(value.startedWeek);
    check(['running', 'paused', 'complete'].includes(value.status), 'Unknown project status.'); checkedInteger(value.lastProgress); note(value.lastBottleneck);
    if (value.status === 'complete') { check(value.completedWeek !== undefined, 'Completed project has no completion week.'); pastWeek(value.completedWeek!); check(value.completedWeek! >= value.startedWeek, 'Project completed before it began.'); }
    else check(value.completedWeek === undefined, 'Unfinished project has a completion week.');
  };
  const meter = (completed: number, required: number) => { checkedInteger(completed); checkedInteger(required); check(required > 0 && completed <= required, 'Project work is outside its required range.'); };
  check(!Object.hasOwn(company, 'passiveWorkforce') || (company.passiveWorkforce === true && [WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version)), 'These workforce campaign rules do not belong to this build.');
  const origin = state.slices.campaign.origin;
  if (origin !== undefined) {
    check(Object.hasOwn(CAMPAIGN_ORIGINS, origin) && state.slices.campaign.rules === 'release' && [WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version), 'Campaign origin is invalid.');
    const seed = origin === 'garage' ? content.opening.seed : content.opening.seed + ':' + origin;
    check(state.seed === seed, 'Campaign origin seed is invalid.');
    check(CAMPAIGN_ORIGINS[origin].knowledge.every(id => state.slices.research.completedByCompany[state.playerCompanyId]?.includes(id)), 'Founding research is missing.');
  }
  record(company.staff, 'Staff'); record(company.founderAssignments, 'Founder assignments'); record(company.lastStaff, 'Staff grants');
  check(Object.keys(company.founderAssignments).sort().join() === Object.keys(company.companies).sort().join(), 'Each company needs founder assignments.');
  for (const [companyId, allocation] of Object.entries(company.founderAssignments)) {
    roleAllocation(allocation, true);
    check(STAFF_ROLES.reduce((s, role) => checkedAdd(s, allocation[role]), 0) <= company.companies[companyId].founderFte && allocation.hardware === 0, 'Founder time is over-allocated.');
  }
  for (const [key, s] of Object.entries(company.staff)) {
    check(key === s.id, 'Employee identity mismatch.'); ownCompany(s.companyId);
    check(STAFF_ROLES.includes(s.role), 'Employee role is not available.');
    if (s.role === 'hardware') check((state.slices.research.completedByCompany[s.companyId] ?? []).includes('R16')
      || Object.values(state.slices.research.projects).some(project => project.companyId === s.companyId && project.researchId === 'R16' && project.startedWeek <= s.hiredWeek), 'Hardware recruitment requires entry into chip feasibility.');
    pastWeek(s.hiredWeek); checkedInteger(s.readyWeek); checkedInteger(s.assignedFte);
    if (s.scenarioStart === true) {
      const foundingEmployee = origin !== undefined && CAMPAIGN_ORIGINS[origin].crew.includes(s.role) && s.id === originStaffId(origin, s.role) && s.hiredWeek === 0;
      check((s.companyId === state.playerCompanyId ? foundingEmployee : Boolean(markets.rivals[s.companyId])) && s.readyWeek === s.hiredWeek, 'Employee onboarding boundary is invalid.');
    } else check(s.readyWeek === s.hiredWeek + content.staff.find(r => r.id === s.role)!.onboardingWeeks, 'Employee onboarding boundary is invalid.');
    if (s.career !== undefined) {
      const career = s.career;
      check(company.passiveWorkforce === true && s.companyId === state.playerCompanyId && career !== null && typeof career === 'object', 'Invalid employee career record.');
      checkedInteger(career.experience); checkedInteger(career.lastEarned); pastWeek(career.earnedWeek);
      check(career.earnedWeek >= Math.max(1, s.readyWeek) && career.lastEarned > 0 && career.lastEarned <= Math.min(career.experience, MAX_WEEKLY_EXPERIENCE)
        && Math.ceil(career.experience / MAX_WEEKLY_EXPERIENCE) <= career.earnedWeek - Math.max(1, s.readyWeek) + 1
        && (career.specialty === undefined || (['depth', 'breadth'].includes(career.specialty) && careerLevel(career.experience) > 0)), 'Invalid employee career progression.');
    }
    check(s.assignedFte <= RESOURCE_SCALE && s.assignedFte % (RESOURCE_SCALE / 4) === 0, 'Employee allocation must be 0–1 in quarter FTE increments.');
  }
  for (const [companyId, s] of Object.entries(company.lastStaff)) {
    ownCompany(companyId); roleAllocation(s.capacity); roleAllocation(s.granted);
    if (s.founderOutput !== undefined) {
      check(company.passiveWorkforce && companyId === state.playerCompanyId, 'Automatic founder output requires a passive player company.');
      roleAllocation(s.founderOutput);
      const founder = s.founderOutput;
      check(founder.hardware === 0 && STAFF_ROLES.every(role => founder[role] <= s.granted[role])
        && STAFF_ROLES.reduce((total, role) => checkedAdd(total, founder[role]), 0) <= company.companies[companyId].founderFte,
        'Automatic founder contributions exceed granted work or the weekly budget.');
    }
    for (const role of STAFF_ROLES) check(s.granted[role] <= s.capacity[role], 'Granted staff exceeds shared capacity.');
  }
  for (const f of Object.values(compute.fleets)) {
    note(f.lastBottleneck); checkedInteger(f.lastReservedMemoryMU); list(f.lastGrants, 'Compute grants');
    check(f.lastReservedMemoryMU === f.occupiedMemoryMU, 'Reserved and occupied memory do not reconcile.');
    const ids = new Set<string>();
    for (const g of f.lastGrants) { id(g.requestId); checkedInteger(g.requestedWork); checkedInteger(g.grantedWork); note(g.reason); check(!ids.has(g.requestId) && g.grantedWork <= g.requestedWork, 'Compute grant is duplicated or excessive.'); ids.add(g.requestId); }
  }
  record(data.preparationJobs, 'Preparation jobs');
  for (const [key, p] of Object.entries(data.preparationJobs)) {
    job(key, p); meter(p.completedStaff, p.requiredStaff);
    check(Object.hasOwn(data.packets, p.packetId), 'Preparation has no data packet.');
    if (p.status === 'complete') check(p.completedStaff === p.requiredStaff && data.packets[p.packetId].prepared, 'Completed preparation is missing ready data.');
  }
  record(models.trainingRuns, 'Training runs'); record(models.evaluationRuns, 'Evaluation runs'); record(models.reports, 'Evaluation reports');
  for (const [key, r] of Object.entries(models.trainingRuns)) {
    job(key, r); meter(r.completedWork, r.requiredWork); checkedInteger(r.physicalWork); checkedInteger(r.requiredMemory); checkedInteger(r.checkpointWork); id(r.outputModelId);
    check(r.checkpointWork <= r.completedWork && TRAINING_RECIPES.some(recipe => recipe.id === r.recipeId), 'Training checkpoint or recipe is invalid.');
    check(models.versions[r.baseModelId]?.companyId === r.companyId && Object.hasOwn(data.packets, r.packetId), 'Training inputs are missing.');
    packet(r.evidence); check(r.evidence.prepared && r.evidence.readyUnits > 0, 'Training needs prepared evidence.');
    record(r.anchorScores, 'Training anchors'); for (const domain of ['conversation', 'documents', 'coding', 'tools'] as const) bps(r.anchorScores[domain]); bps(r.anchorReliabilityBps);
    if (r.checkpointModelId !== null) check(models.versions[r.checkpointModelId]?.trainingRunId === r.id, 'Training checkpoint belongs to another run.');
    if (r.status === 'complete') check(r.completedWork === r.requiredWork && models.versions[r.outputModelId]?.trainingRunId === r.id, 'Completed training has no output model.');
  }
  for (const [key, r] of Object.entries(models.evaluationRuns)) {
    job(key, r); meter(r.completedWork, r.requiredWork); meter(r.completedStaff, r.requiredStaff);
    check(models.versions[r.modelId]?.companyId === r.companyId, 'Evaluation model is missing or belongs to another company.');
    if (r.status === 'complete') check(r.completedWork === r.requiredWork && r.completedStaff === r.requiredStaff && r.reportId !== null && models.reports[r.reportId]?.modelId === r.modelId, 'Completed evaluation has no matching report.');
    else check(r.reportId === null, 'Unfinished evaluation has a report.');
  }
  for (const [key, r] of Object.entries(models.reports)) {
    check(key === r.id && r.heldOut === true, 'Held-out report identity is invalid.'); ownCompany(r.companyId); pastWeek(r.week);
    const m = models.versions[r.modelId]; check(m && m.companyId === r.companyId, 'Evaluation report has no matching model.');
    record(r.capabilityBps, 'Report scores'); for (const domain of ['conversation', 'documents', 'coding', 'tools'] as const) { bps(r.capabilityBps[domain]); check(r.capabilityBps[domain] === m.capabilityBps[domain], 'Evaluation changed a trained score.'); }
    bps(r.reliabilityBps); check(r.reliabilityBps === m.reliabilityBps, 'Report reliability differs from the tested model.');
    const expectedCases = r.suiteId && r.suiteId !== 'basic-conversation-1' ? EVALUATION_SUITES.find(s => s.id === r.suiteId)?.cases : content.evaluation.cases;
    check(Boolean(expectedCases), 'Unknown evaluation suite.'); list(r.cases, 'Held-out cases', expectedCases); check(r.cases.length === expectedCases, 'Evaluation suite is incomplete.');
    const caseIds = new Set<string>();
    const allowedDomains: readonly string[] = isModelChallengeSuite(r.suiteId) ? CHALLENGE_SKILLS : r.suiteId === ADVANCED_EVALUATION_SUITE.id ? ADVANCED_DOMAINS : ['conversation', 'documents', 'coding', 'tools'];
    for (const c of r.cases) { id(c.id); bps(c.difficultyBps); check(!caseIds.has(c.id) && allowedDomains.includes(c.domain) && typeof c.passed === 'boolean', 'Evaluation case is invalid.'); caseIds.add(c.id); }
    check(r.passedCases === r.cases.filter(c => c.passed).length, 'Evaluation case count does not reconcile.');
    check(r.basicChatEligible === (isCapabilitySuite(r.suiteId) && m.capabilityBps.conversation >= content.firstSale.minConversationBps && m.reliabilityBps >= content.firstSale.minReliabilityBps), 'Basic Chat eligibility does not match its model gates.');
  }
  for (const m of Object.values(models.versions)) {
    if (m.createdWeek !== undefined) pastWeek(m.createdWeek);
    if (m.parentModelId !== undefined) {
      const seen = new Set([m.id]); let next = m.parentModelId;
      while (next) { check(!seen.has(next) && models.versions[next]?.companyId === m.companyId, 'Model lineage has a cycle or missing parent.'); seen.add(next); next = models.versions[next].parentModelId ?? ''; }
    }
    if (m.trainingRunId !== undefined) check(models.trainingRuns[m.trainingRunId]?.companyId === m.companyId, 'Model has no matching training run.');
    if (m.trainingEvidenceId !== undefined) id(m.trainingEvidenceId);
    if (m.evaluationReportId !== undefined) check(models.reports[m.evaluationReportId]?.modelId === m.id, 'Model report is missing.');
  }
  for (const k of ['offers', 'deployments', 'contracts', 'lastUsage'] as const) record(products[k], 'Product ' + k);
  list(products.invoices, 'Invoices', 100);
  for (const [key, p] of Object.entries(products.offers)) {
    check(key === p.id && ['basic-chat','developer-api','business-docs'].includes(p.kind) && ['deploying', 'active', 'paused'].includes(p.status), 'Product identity or status is invalid.'); ownCompany(p.companyId); pastWeek(p.createdWeek); note(p.name);
    check(products.deployments[p.deploymentId]?.productId === p.id && products.contracts[p.contractId]?.productId === p.id, 'Product deployment or contract is missing.');
  }
  check(products.activeIds.slice().sort().join() === Object.values(products.offers).filter(p => p.status === 'active').map(p => p.id).sort().join(), 'Active products do not reconcile.');
  for (const [key, d] of Object.entries(products.deployments)) {
    check(key === d.id && ['building', 'ready', 'active'].includes(d.status), 'Deployment identity or status is invalid.'); ownCompany(d.companyId); pastWeek(d.startedWeek); note(d.lastBottleneck);
    check(products.offers[d.productId]?.deploymentId === d.id && products.offers[d.productId].companyId === d.companyId && models.versions[d.modelId]?.companyId === d.companyId, 'Deployment references are invalid.');
    meter(d.completedStaff, d.requiredStaff);
    if (d.status === 'building') check(d.readyWeek === null && products.offers[d.productId].status === 'deploying', 'Unfinished deployment is already available.');
    else { checkedInteger(d.readyWeek!); check(d.completedStaff === d.requiredStaff && (d.scenarioStart === true ? d.companyId !== state.playerCompanyId && Boolean(markets.rivals[d.companyId]) && d.readyWeek === d.startedWeek : d.readyWeek! > d.startedWeek), 'Deployment completion is invalid.'); check(d.status === 'ready' ? d.readyWeek! > state.week : d.readyWeek! <= state.week, 'Deployment activates at the wrong boundary.'); }
  }
  for (const [key, c] of Object.entries(products.contracts)) {
    check(key === c.id && products.offers[c.productId]?.contractId === c.id && products.offers[c.productId].companyId === c.companyId, 'Contract references are invalid.'); ownCompany(c.companyId); pastWeek(c.effectiveWeek);
    checkedInteger(c.weeklyPriceCents); checkedInteger(c.allowance); bps(c.creditBps);
    check(c.weeklyPriceCents >= content.firstSale.minPriceCents && c.weeklyPriceCents <= (products.offers[c.productId].kind === 'basic-chat' ? 10000 : 100000) && c.allowance >= content.firstSale.minAllowance && c.allowance <= (products.offers[c.productId].kind === 'basic-chat' ? 500 : 5000) && c.creditBps === 10000, 'Contract terms are outside this build’s limits.');
  }
  for (const [key, u] of Object.entries(products.lastUsage)) {
    check(key === u.productId && Object.hasOwn(products.offers, key), 'Usage product is missing.'); pastWeek(u.week);
    for (const value of [u.paidAccounts, u.trialAccounts, u.requestedWork, u.executedWork, u.paidRequestedWork, u.paidExecutedWork, u.trialRequestedWork, u.trialExecutedWork, u.exchanges, u.grossBillCents, u.creditsCents, u.billedCents]) checkedInteger(value);
    bps(u.fulfillmentBps); bps(u.errorBps); list(u.trialCompletedIds, 'Completed trials'); u.trialCompletedIds.forEach(id);
    check(u.executedWork <= u.requestedWork && u.paidExecutedWork <= u.paidRequestedWork && u.trialExecutedWork <= u.trialRequestedWork && checkedAdd(u.paidRequestedWork, u.trialRequestedWork) === u.requestedWork && checkedAdd(u.paidExecutedWork, u.trialExecutedWork) === u.executedWork, 'Executed usage does not reconcile.');
    check(checkedAdd(u.billedCents, u.creditsCents) === u.grossBillCents, 'Service credits do not reconcile with the bill.');
  }
  const invoiceIds = new Set<string>();
  for (const i of products.invoices) {
    id(i.id); ownCompany(i.companyId); pastWeek(i.week);
    check(!invoiceIds.has(i.id) && products.offers[i.productId]?.contractId === i.contractId && products.offers[i.productId].companyId === i.companyId && company.postedFacts[i.id], 'Invoice is duplicated, unposted, or has invalid references.'); invoiceIds.add(i.id);
    for (const n of [i.accounts, i.grossCents, i.creditsCents, i.amountCents]) checkedInteger(n);
    check(checkedAdd(i.creditsCents, i.amountCents) === i.grossCents, 'Invoice totals do not reconcile.');
    const entry = company.ledger.find(e => e.id === i.id); if (entry) check(entry.kind === 'receipt' && entry.category === 'revenue' && entry.amountCents === i.amountCents, 'Invoice and financial ledger differ.');
  }
  list(markets.trials, 'Trials'); list(markets.cohorts, 'Customer cohorts'); bps(markets.trustBps); note(markets.lastExplanation);
  for (const n of [markets.acquisitionCarry, markets.conversionCarry, markets.churnCarry, markets.reachCarry, markets.nextTrialId, markets.lastGained, markets.lastLost, markets.lastTrialCount]) checkedInteger(n);
  check(markets.nextTrialId >= 1 && markets.acquisitionCarry < 10000 && markets.conversionCarry < 10000 && markets.churnCarry < 10000 && markets.reachCarry < RESOURCE_SCALE, 'Market fractional carries are invalid.');
  check(markets.waitlistRemaining <= content.opening.waitlist, 'The one-time waitlist has grown.');
  const customerIds = new Set<string>();
  for (const c of markets.cohorts) {
    id(c.id); ownCompany(c.companyId); checkedInteger(c.count); checkedInteger(c.activeWeek);
    check(!customerIds.has(c.id) && c.count > 0 && c.activeWeek <= state.week + 1 && products.offers[c.productId]?.contractId === c.contractId && products.offers[c.productId].companyId === c.companyId, 'Customer cohort is invalid.'); customerIds.add(c.id);
  }
  for (const t of markets.trials) {
    id(t.id); ownCompany(t.companyId); pastWeek(t.createdWeek);
    for (const n of [t.count, t.activeWeek, t.expiresWeek, t.workCompleted, t.requiredWork]) checkedInteger(n);
    check(!customerIds.has(t.id) && t.count > 0 && products.offers[t.productId]?.companyId === t.companyId && t.activeWeek === t.createdWeek + 1 && t.expiresWeek === t.activeWeek + 1 && t.expiresWeek > state.week, 'Trial identity or timing is invalid.'); customerIds.add(t.id);
    check(t.requiredWork === t.count * (t.workPerAccount ?? content.firstSale.trialWork) && t.workCompleted < (t.workPerAccount ?? content.firstSale.trialWork), 'Trial work does not reconcile.');
  }
  const customers = markets.cohorts.filter(c => c.companyId === state.playerCompanyId && SEGMENT_BY_ID[c.segmentId ?? 'regular'].market === 'consumer').reduce((sum, c) => checkedAdd(sum, c.count), 0);
  check(markets.payingConsumers === customers, 'The player consumer count is inconsistent.');
  for (const segment of MARKET_SEGMENTS) check(markets.cohorts.filter(c => (c.segmentId ?? 'regular') === segment.id).reduce((n,c) => n+c.count,0) + markets.trials.filter(t => (t.segmentId ?? 'regular') === segment.id).reduce((n,t) => n+t.count,0) + (segment.market === 'business' ? commercialOrganizationCount(state) : 0) <= segment.population, 'The finite segment population is exceeded.');
}
