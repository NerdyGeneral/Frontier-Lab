import { OPTIONAL_BRIEF_IDS, type BriefBinding, type BriefId, type CustomerBrief, type OptionalBriefId } from '../contracts/customer-briefs';
import { RESOURCE_SCALE as U, type DomainResult, type GameCommand, type GameContent, type GameState, type LedgerFact, type ModuleContext, type Rejection } from '../contracts/types';
import { CUSTOMER_BRIEFS } from '../content/customer-briefs';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { isCapabilitySuite } from './evaluation-classification';
import { modelExecutionHints } from './model-runtime';
import { getResearchView } from './research';
import { isSpecialistBrief, specialistBriefBinding, specialistBriefMeter, specialistBriefProofId, specialistBriefRequestId, specialistBriefWorkRequest } from './specialist-briefs';

const emptyBinding: BriefBinding = { targetId: null, contractGeneration: 0, baselineCostCents: 0 };
const BURST_REQUEST = 'brief:launch-window:burst';
export const briefPaymentId = (owner: string, id: BriefId) => 'brief-payment:' + owner + ':' + id;
const activeBrief = (game: Readonly<GameState>) => Object.values(game.slices.campaign.customerBriefs ?? {}).find(brief => brief.status === 'active');
const getModelId = (game: Readonly<GameState>, productId: string) => {
  const offer = game.slices.products.offers[productId];
  return offer?.publicModelId ?? game.slices.products.deployments[offer?.deploymentId]?.modelId;
};

function computeBill(facts: readonly LedgerFact[], owner: string, week: number) {
  const ids = new Set(['cloud-rent', 'owned-fixed', 'owned-variable'].map(suffix => owner + ':' + suffix + ':' + week));
  return facts.filter(fact => fact.companyId === owner && fact.week === week && fact.kind === 'expense' && ids.has(fact.id))
    .reduce((total, fact) => checkedAdd(total, fact.amountCents), 0);
}

function recentCostBaseline(game: Readonly<GameState>, settledWeek: number) {
  const owner = game.playerCompanyId, ledger = game.slices.company.ledger;
  const costReports = game.slices.compute.costReports?.[owner] ?? [];
  const bills: number[] = [];
  for (let week = Math.max(1, settledWeek - 2); week <= settledWeek; week++) {
    const report = costReports.find(row => row.week === week);
    // The oldest ledger week may be partial after the 200-entry history rolls over.
    if (!report && ledger.length >= 200 && week <= ledger[0].week) continue;
    bills.push(computeBill(report?.ledgerFacts ?? ledger, owner, week));
  }
  return bills.length ? Math.min(...bills) : 0;
}

function binding(game: Readonly<GameState>, id: OptionalBriefId, settledWeek: number, content: GameContent): BriefBinding | string {
  const owner = game.playerCompanyId;
  if (game.slices.company.companies[owner].earnedRevenueCents <= 0) return 'Earn your first customer receipt to open this brief.';
  if (isSpecialistBrief(id)) return specialistBriefBinding(game, id);
  if (id === 'launch-window') {
    const product = Object.values(game.slices.products.offers).filter(offer => {
      const usage = game.slices.products.lastUsage[offer.id];
      return offer.companyId === owner && offer.status === 'active' && usage?.week === settledWeek && usage.billedCents > 0;
    }).sort((a, b) => a.createdWeek - b.createdWeek || a.id.localeCompare(b.id))[0];
    return product ? { ...emptyBinding, targetId: product.id } : 'Bill a customer on a live public product to host the launch.';
  }
  if (id === 'lean-service') {
    const contract = Object.values(game.slices.products.commercialContracts).filter(c =>
      c.companyId === owner && c.contractKind === 'private-hosted' && c.status === 'active' && c.lastUsage?.week === settledWeek
      && c.lastUsage.billedCents > 0 && c.lastUsage.fulfillmentBps >= 9500)
      .sort((a, b) => a.signedWeek - b.signedWeek || a.id.localeCompare(b.id))[0];
    if (!contract) return 'Bill a private hosting client and fulfill at least 95% of its most recent weekly requests.';
    const baselineCostCents = recentCostBaseline(game, settledWeek);
    if (!baselineCostCents) return 'The lowest recent weekly compute bill must be positive to set a savings target.';
    return { targetId: contract.id, contractGeneration: contract.generation, baselineCostCents };
  }
  if (id === 'research-sprint' && !getResearchView(game, owner, content).some(r =>
    r.status === 'available' || r.project && r.project.startedWeek > settledWeek)) return 'Unlock a research project you can newly commission.';
  return { ...emptyBinding };
}

function newBrief(id: BriefId, startedWeek: number, bound: BriefBinding): CustomerBrief {
  return { ...bound, id, startedWeek, deadlineWeek: (startedWeek || 1) + CUSTOMER_BRIEFS[id].weeks - 1,
    finishedWeek: null, status: 'active', qualifyingWeeks: 0, feedback: 'Awaiting the first delivery week.' };
}

export function initializeConsultancyBrief(state: GameState): void {
  if (state.week !== 0 || state.slices.campaign.origin !== 'consultancy' || state.slices.campaign.customerBriefs) throw new Error('The pilot belongs to the consultancy opening.');
  state.slices.campaign.customerBriefs = { 'consultancy-pilot': newBrief('consultancy-pilot', 0, emptyBinding) };
}

export function validateBriefCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload;
  if (command.companyId !== state.playerCompanyId || p.kind !== 'accept_customer_brief' || !OPTIONAL_BRIEF_IDS.includes(p.briefId)
    || Object.keys(p).sort().join() !== 'briefId,kind') return {code: 'INVALID_COMMAND', message: 'Choose an optional customer brief for your lab.'};
  if (activeBrief(state) || state.queuedCommands.some(c => c.companyId === command.companyId && c.id !== command.id && c.payload.kind === p.kind)) {
    return { code: 'ALREADY_ACTIVE', message: 'Finish the active or scheduled customer brief before taking another.' };
  }
  if (state.slices.campaign.customerBriefs?.[p.briefId]?.status === 'completed') return { code: 'ALREADY_ACTIVE', message: 'The client has already paid for this delivery.' };
  const result = binding(state, p.briefId, command.issuedForWeek - 1, content);
  if (typeof result === 'string') return { code: 'NOT_READY', message: result };
}

export function briefTargetText(game: Readonly<GameState>, id: BriefId, bound: BriefBinding): string {
  if (isSpecialistBrief(id) && bound.targetId) {
    const model = game.slices.models.versions[bound.targetId];
    if (!model) return '';
    const meter = specialistBriefMeter(model, id);
    return `${model.name} · Client workload ${formatUnits(meter.weeklyWorkCUw)} serving CUw/week · ${formatUnits(meter.memoryMU)} MU for its model copy and sessions. Existing customer work is additional.`;
  }
  if (id === 'launch-window' && bound.targetId) {
    const model = game.slices.models.versions[getModelId(game, bound.targetId)];
    const name = game.slices.products.offers[bound.targetId]?.name;
    return (name ?? 'Public service') + (model ? ' · Burst worker needs ' + formatUnits(checkedAdd(model.residentMU, U / 4)) + ' MU.' : '');
  }
  if (id === 'lean-service' && bound.targetId) {
    const customerId = bound.targetId.slice('business:'.length);
    const contract = game.slices.products.commercialContracts[bound.targetId];
    const term = contract?.generation === bound.contractGeneration && contract.termEndsWeek
      ? ' Term ends in Week ' + contract.termEndsWeek + ' · renewal ' + (contract.autoRenew ? 'on.' : 'off.') : '';
    return (BUSINESS_BY_ID[customerId]?.name ?? 'Private client') + ' · Lowest recent bill ' + formatMoney(bound.baselineCostCents)
      + '/week · Target ' + formatMoney(mulDiv(bound.baselineCostCents, 90, 100)) + '/week or less.' + term;
  }
  return '';
}

export function quoteBriefCommand(game: Readonly<GameState>, command: GameCommand, content: GameContent) {
  if (command.payload.kind !== 'accept_customer_brief') throw new Error('Choose a customer brief.');
  const id = command.payload.briefId, brief = CUSTOMER_BRIEFS[id];
  const bound = binding(game, id, command.issuedForWeek - 1, content);
  const target = typeof bound === 'string' ? '' : briefTargetText(game, id, bound);
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: [brief.client + ' pays ' + formatMoney(brief.feeCents)
    + ' on delivery by Week ' + (command.issuedForWeek + brief.weeks - 1) + '.', target].filter(Boolean).join(' ') };
}

export function applyBriefCommand(game: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  if (command.payload.kind !== 'accept_customer_brief') return {};
  const id = command.payload.briefId;
  const bound = binding(game, id, command.issuedForWeek - 1, content);
  if (typeof bound === 'string') throw new Error(bound);
  const brief = newBrief(id, command.issuedForWeek, bound), campaign = structuredClone(game.slices.campaign);
  (campaign.customerBriefs ??= {})[id] = brief;
  return { updates: { campaign }, ...(brief.specialist ? { facts: [{ id: specialistBriefProofId(game, brief), companyId: game.playerCompanyId,
    week: command.issuedForWeek, sourceId: 'customer-brief:' + id, category: 'operating' as const, kind: 'expense' as const, amountCents: 0,
    label: CUSTOMER_BRIEFS[id].title + ' · selected model and paid reports' }] } : {}),
    messages: [{ category: 'project', message: CUSTOMER_BRIEFS[id].title + ' accepted. Delivery is due by Week ' + brief.deadlineWeek + '.' }] };
}

export function reserveBrief(game: Readonly<GameState>): DomainResult {
  const specialist = activeBrief(game);
  if (specialist && isSpecialistBrief(specialist.id)) {
    const request = specialistBriefWorkRequest(game, specialist);
    return request ? { workRequests: [request] } : {};
  }
  const brief = game.slices.campaign.customerBriefs?.['launch-window'];
  if (!brief || brief.status !== 'active' || !brief.targetId || game.slices.products.offers[brief.targetId]?.status !== 'active') return {};
  const model = game.slices.models.versions[getModelId(game, brief.targetId)];
  if (!model) return {};
  return { workRequests: [{ id: BURST_REQUEST, taskId: 'brief:launch-window', companyId: game.playerCompanyId,
    category: 'serving', priority: 90, normalizedWorkCUw: U, memoryMU: checkedAdd(model.residentMU, U / 4), poolId: 'auto', ...modelExecutionHints(model) }] };
}

function measureDelivery(game: Readonly<GameState>, ctx: ModuleContext, brief: CustomerBrief): { qualifies: boolean; feedback: string } {
  const owner = game.playerCompanyId;
  if (isSpecialistBrief(brief.id)) {
    const request = specialistBriefWorkRequest(game, brief);
    const work = ctx.resources.computeGrants.find(item => item.requestId === specialistBriefRequestId(brief))?.hardwareEffectiveCUw ?? 0;
    return { qualifies: !!request && work === request.normalizedWorkCUw,
      feedback: `${game.slices.models.versions[brief.targetId!]?.name ?? 'Selected model'} · Client work ${formatUnits(work)}/${formatUnits(request?.normalizedWorkCUw ?? 0)} serving CUw. ${request && work === request.normalizedWorkCUw ? 'All client requests delivered.' : 'Leave serving compute and memory after ordinary customer service.'}` };
  }
  if (brief.id === 'launch-window') {
    const grant = ctx.resources.computeGrants.find(item => item.requestId === BURST_REQUEST)?.hardwareEffectiveCUw ?? 0;
    const product = game.slices.products.offers[brief.targetId!], usage = game.slices.products.lastUsage[brief.targetId!];
    const live = product?.status === 'active' && usage?.week === ctx.week;
    const billed = live ? usage.billedCents : 0, fulfillment = live ? usage.fulfillmentBps : 0;
    return { qualifies: grant === U && billed > 0 && fulfillment >= 8500, feedback: 'Burst ' + formatUnits(grant) + '/1 CUw · Regular service ' + (fulfillment / 100) + '% · ' + formatMoney(billed) + ' billed.' };
  }
  if (brief.id === 'lean-service') {
    const contract = game.slices.products.commercialContracts[brief.targetId!];
    const retained = contract?.status === 'active' && contract.companyId === owner && contract.contractKind === 'private-hosted' && contract.generation === brief.contractGeneration;
    const usage = retained && contract.lastUsage?.week === ctx.week ? contract.lastUsage : null;
    const cost = computeBill(ctx.facts, owner, ctx.week);
    return { qualifies: !!usage && usage.billedCents > 0 && usage.fulfillmentBps >= 9500 && cost <= mulDiv(brief.baselineCostCents, 90, 100),
      feedback: 'Compute bill ' + formatMoney(cost) + ' · ' + (retained ? 'Client service ' + (usage?.fulfillmentBps ?? 0) / 100 + '% · ' + formatMoney(usage?.billedCents ?? 0) + ' billed.' : 'The signed hosting contract has ended.') };
  }
  if (brief.id === 'research-sprint') {
    const projects = Object.values(game.slices.research.projects).filter(p => p.companyId === owner && p.startedWeek >= brief.startedWeek);
    const project = projects.find(p => p.status === 'complete') ?? projects[0];
    if (!project) return { qualifies: false, feedback: 'Start a new project on the research board.' };
    const name = ctx.content.research.find(r => r.id === project.researchId)?.name ?? project.researchId;
    const percent = Math.min(mulDiv(project.completedWork, 100, project.requiredWork), mulDiv(project.completedStaff, 100, project.requiredStaff));
    return { qualifies: project.status === 'complete', feedback: name + ' · ' + percent + '% of both research requirements delivered.' };
  }
  const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === owner && run.startedWeek >= brief.startedWeek);
  const trained = new Set(runs.filter(run => run.status === 'complete').map(run => run.outputModelId));
  const tested = new Set(Object.values(game.slices.models.reports).filter(r => r.companyId === owner && trained.has(r.modelId) && r.heldOut
    && r.week >= brief.startedWeek && !r.scenarioStart && isCapabilitySuite(r.suiteId) && r.basicChatEligible).map(r => r.modelId));
  if (brief.id === 'model-acceptance') return { qualifies: tested.size > 0, feedback: tested.size ? 'New model passed the held-out Basic Chat gate.'
    : trained.size ? 'Training complete. Run a capability evaluation on the new model.' : runs.length ? 'New training run in progress.' : 'Waiting for a newly started training run.' };
  const live = Object.values(game.slices.products.offers).some(p => p.companyId === owner && p.kind === 'basic-chat' && p.status === 'active' && tested.has(getModelId(game, p.id)));
  return { qualifies: live, feedback: live ? 'The tested Basic Chat pilot is live.' : tested.size ? 'Model passed. Launch Basic Chat and allow deployment to go live.'
    : trained.size ? 'Model trained. Run its Basic Chat evaluation.' : runs.length ? 'Pilot training in progress.' : 'Prepare the training data and start pilot training.' };
}

export function settleBrief(game: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const old = activeBrief(game);
  if (!old) return {};
  const measure = measureDelivery(game, ctx, old);
  const brief = { ...old, feedback: measure.feedback, qualifyingWeeks: measure.qualifies ? old.qualifyingWeeks + 1 : 0 };
  const definition = CUSTOMER_BRIEFS[brief.id];
  const result: DomainResult = { updates: { campaign: { ...game.slices.campaign, customerBriefs: { ...game.slices.campaign.customerBriefs, [brief.id]: brief } } } };
  if (brief.specialist) {
    brief.specialist = { ...brief.specialist, deliveryWeeks: measure.qualifies ? [...brief.specialist.deliveryWeeks, ctx.week] : [] };
    if (measure.qualifies) result.facts = [{ id: specialistBriefProofId(game, brief, ctx.week), companyId: game.playerCompanyId,
      week: ctx.week, sourceId: 'customer-brief:' + brief.id, category: 'operating', kind: 'expense', amountCents: 0,
      label: definition.title + ' · client workload delivered' }];
  }
  if (brief.qualifyingWeeks >= definition.qualifyingWeeks) {
    brief.status = 'completed';
    brief.finishedWeek = ctx.week;
    (result.facts ??= []).push({ id: briefPaymentId(game.playerCompanyId, brief.id), companyId: game.playerCompanyId, week: ctx.week, sourceId: 'customer-brief:' + brief.id,
      category: 'revenue', kind: 'receipt', amountCents: definition.feeCents, label: definition.title + ' · customer delivery fee' });
    result.messages = [{ category: 'delivery', message: definition.title + ' delivered. The client paid ' + formatMoney(definition.feeCents) + '.' }];
  } else if (ctx.week >= brief.deadlineWeek) {
    brief.status = 'expired';
    brief.finishedWeek = ctx.week;
    result.messages = [{ category: 'project', message: definition.title + ' expired in Week ' + ctx.week + '. The delivery fee was forfeited.' }];
  }
  return result;
}

export function getCustomerBriefSpotlight(game: Readonly<GameState>) {
  const brief = activeBrief(game) ?? Object.values(game.slices.campaign.customerBriefs ?? {}).sort((a, b) => (b.finishedWeek ?? 0) - (a.finishedWeek ?? 0))[0];
  if (!brief) return null;
  const definition = CUSTOMER_BRIEFS[brief.id];
  const progressText = brief.status === 'completed' ? formatMoney(definition.feeCents) + ' received in Week ' + brief.finishedWeek
    : brief.status === 'expired' ? 'Deadline passed in Week ' + brief.finishedWeek
    : (definition.qualifyingWeeks > 1 ? brief.qualifyingWeeks + '/' + definition.qualifyingWeeks + ' qualifying weeks · ' : '') + brief.feedback;
  return { title: definition.title, status: brief.status, deadlineWeek: brief.deadlineWeek, progressText };
}
