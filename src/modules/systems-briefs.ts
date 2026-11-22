import { CONNECTED_COMPANY_CONTENT_VERSION, hasConnectedCompanyRules } from '../core/connected-company-version';
import type { SystemsBriefId, SystemsBriefOrder, SystemsBriefTerms } from '../contracts/systems-briefs';
import type { DomainResult, GameCommand, GameContent, GameState, ModelVersion, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { SYSTEMS_BRIEFS, SYSTEMS_BRIEF_ACCEPT_WEEKS, SYSTEMS_BRIEF_ORDER_LIMIT, SYSTEMS_BRIEF_WINDOW_WEEKS, systemsBriefDefinition } from '../content/systems-briefs';
import { CONTENT } from '../content/catalog';
import { canonicalStateHash } from '../core/canonical';
import { formatMoney, formatUnits } from '../core/math';
import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import { getSystemsModelMeasures, isPaidChallengeReport, modelChallengeFingerprint } from './model-challenges';
import { inheritedModelRights, modelExecutionHints } from './model-runtime';
import { policyReleaseRejection } from './policy-holdouts';
import { getSystemsClientRelationships } from './systems-client-relationships';

export function getSystemsBriefOrders(state: Readonly<GameState>): SystemsBriefOrder[] {
  return Object.values(state.slices.campaign.systemsBriefs ?? {}).sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));
}
export const activeSystemsBrief = (state: Readonly<GameState>) => getSystemsBriefOrders(state).find(order => order.status === 'active');
export const systemsBriefPaymentId = (owner: string, id: string) => `systems-brief-payment:${owner}:${id}`;
export const systemsBriefRequestId = (order: SystemsBriefOrder) => `systems-client:${order.id}`;
export const systemsBriefOfferId = (briefId: SystemsBriefId, windowIndex: number) => `systems-offer-${briefId}-${windowIndex}`;

/** Version-one market schedule is independent of mutable random streams or menu visits. */
export function createSystemsBriefTerms(seed: string, briefId: SystemsBriefId, windowIndex: number): SystemsBriefTerms {
  const def = systemsBriefDefinition(briefId)!;
  if (!def || !Number.isSafeInteger(windowIndex) || windowIndex < 0 || windowIndex > 100000) throw new Error('Unknown systems commission window.');
  const draw = Number.parseInt(canonicalStateHash({ seed, briefId, windowIndex, version: 1 }).slice(0, 8), 16);
  const scale = draw % 3, opensWeek = windowIndex * SYSTEMS_BRIEF_WINDOW_WEEKS + 1;
  const terms: SystemsBriefTerms = { version: 1, id: systemsBriefOfferId(briefId, windowIndex), briefId, windowIndex,
    opensWeek, acceptUntilWeek: opensWeek + SYSTEMS_BRIEF_ACCEPT_WEEKS - 1,
    client: def.clients[Math.floor(draw / 3) % def.clients.length], scale,
    feeCents: def.feeCents + scale * (briefId === 'verified-analysis' ? 80000 : 60000),
    requestsPerWeek: def.requestsPerWeek + scale * 500, concurrentSessions: 25,
    deadlineWeeks: 6, qualifyingWeeks: 2, challengeSuiteId: def.challengeSuiteId,
    minimumScores: {}, reliabilityBps: 8600, maxServingCUwPer1000: null, maxMemoryMU: null,
    minRetentionBps: null, minVerifiedBps: null, maxLatencyBps: null };
  if (briefId === 'efficient-experts') Object.assign(terms, { minimumScores: { conversation: 5000, documents: 4500 }, maxServingCUwPer1000: U / 5, maxMemoryMU: 10 * U });
  if (briefId === 'bounded-memory') Object.assign(terms, { minimumScores: { documents: 5000, conversation: 4500 }, maxMemoryMU: 4 * U });
  if (briefId === 'continuity-desk') Object.assign(terms, { minimumScores: { documents: 5300, longContext: 5000 }, reliabilityBps: 8700, minRetentionBps: 6800 + scale * 200, maxMemoryMU: 10 * U });
  if (briefId === 'verified-analysis') Object.assign(terms, { minimumScores: { reasoning: 5500, tools: 5000 }, reliabilityBps: 8800,
    minVerifiedBps: 7400 + scale * 200, maxLatencyBps: 40000, maxServingCUwPer1000: 2 * U });
  return terms;
}

/** Snapshot relationships when the market window opens, so a plan never changes
 * its price, customer, challenge or delivery commitment during development. */
export function createConnectedSystemsBriefTerms(state: Readonly<GameState>, briefId: SystemsBriefId, windowIndex: number): SystemsBriefTerms {
  const terms = createSystemsBriefTerms(state.seed, briefId, windowIndex);
  if (!hasConnectedCompanyRules(state.contentVersion)) return terms;
  const relationship = getSystemsClientRelationships(state, terms.opensWeek).find(item => item.briefId === briefId)!;
  const level = relationship.tier === 'partner' ? 2 : relationship.tier === 'repeat' ? 1 : 0;
  return { ...terms, version: 2, client: relationship.client ?? terms.client,
    relationship: { tier: relationship.tier, priorOrderIds: [...relationship.priorOrderIds] },
    feeCents: Math.round(terms.feeCents * [1, 2, 3.5][level]), requestsPerWeek: Math.round(terms.requestsPerWeek * [1, 1.5, 2.25][level]),
    concurrentSessions: [25, 32, 40][level], deadlineWeeks: 6 + level * 2, qualifyingWeeks: 2 + level,
    minRetentionBps: terms.minRetentionBps === null ? null : terms.minRetentionBps + level * 100,
    minVerifiedBps: terms.minVerifiedBps === null ? null : terms.minVerifiedBps + level * 100 };
}

export function isCanonicalSystemsBriefTerms(state: Readonly<GameState>, terms: SystemsBriefTerms): boolean {
  try {
    if (!terms || !systemsBriefDefinition(terms.briefId) || !Number.isSafeInteger(terms.windowIndex) || terms.windowIndex < 0 || terms.windowIndex > 100000) return false;
    const expected = terms.version === 1 ? createSystemsBriefTerms(state.seed, terms.briefId, terms.windowIndex)
      : terms.version === 2 && hasConnectedCompanyRules(state.contentVersion) ? createConnectedSystemsBriefTerms(state, terms.briefId, terms.windowIndex) : null;
    return !!expected && canonicalStateHash(terms) === canonicalStateHash(expected);
  } catch { return false; }
}

export function snapshotSystemsBriefOffer(state: Readonly<GameState>, offerId: string): SystemsBriefTerms | null {
  const windowIndex = Math.floor(state.week / SYSTEMS_BRIEF_WINDOW_WEEKS);
  return SYSTEMS_BRIEFS.map(def => createConnectedSystemsBriefTerms(state, def.id, windowIndex)).find(offer => offer.id === offerId) ?? null;
}

export function systemsBriefOfferAvailability(state: Readonly<GameState>, terms: SystemsBriefTerms, modelId?: string, atWeek = state.week + 1): string | null {
  if (![AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion)) return 'Upgrade this campaign to open systems commissions.';
  if (!isCanonicalSystemsBriefTerms(state, terms) || hasConnectedCompanyRules(state.contentVersion) && terms.version !== 2) return 'The saved offer terms are no longer offered. Review the current customer offer explicitly.';
  if (atWeek < terms.opensWeek || atWeek > terms.acceptUntilWeek) return 'The saved offer acceptance window has closed. Choose a new offer; this plan keeps its original goal.';
  const orders = getSystemsBriefOrders(state);
  if (orders.length >= SYSTEMS_BRIEF_ORDER_LIMIT) return 'This campaign has filled its systems commission archive.';
  if (orders.some(order => order.terms.windowIndex === terms.windowIndex)) return 'A commission has already been chosen for this market window.';
  if (activeSystemsBrief(state) || Object.values(state.slices.campaign.customerBriefs ?? {}).some(order => order.status === 'active')) return 'Finish the active customer commission first.';
  if (state.slices.company.companies[state.playerCompanyId].earnedRevenueCents <= 0) return 'Make your first customer sale to receive commissions.';
  return modelId ? modelRejection(state, modelId, terms, atWeek - 1, CONTENT) : null;
}

export function systemsBriefRequirementText(terms: SystemsBriefTerms): string[] {
  return [
    ...Object.entries(terms.minimumScores).map(([skill, score]) => `${skill === 'longContext' ? 'Long context' : skill[0].toUpperCase() + skill.slice(1)} ${score / 100}`),
    `Reliability ${terms.reliabilityBps / 100}%`,
    ...(terms.maxServingCUwPer1000 === null ? [] : [`At most ${formatUnits(terms.maxServingCUwPer1000)} CUw per 1,000 standard requests`]),
    ...(terms.maxMemoryMU === null ? [] : [`At most ${formatUnits(terms.maxMemoryMU)} MU for the model and ${terms.concurrentSessions} sessions`]),
    ...(terms.minRetentionBps === null ? [] : [`Retention at least ${terms.minRetentionBps / 100}%`]),
    ...(terms.minVerifiedBps === null ? [] : [`Verified completion at least ${terms.minVerifiedBps / 100}%`]),
    ...(terms.maxLatencyBps === null ? [] : [`Response time at most ${terms.maxLatencyBps / 10000}×`]),
    `A paid passing ${systemsBriefDefinition(terms.briefId)!.challengeSuiteId.replace('systems-', '').replace('-1', '')} challenge report for this exact model`,
  ];
}

/** Eligibility is measured from the trained model, never its name or chosen archetype. */
export function systemsBriefRequirements(model: ModelVersion, offer: SystemsBriefTerms | { terms: SystemsBriefTerms }): string[] {
  const terms = 'terms' in offer ? offer.terms : offer;
  const metrics = getSystemsModelMeasures(model), scores = { ...model.capabilityBps, ...(model.advancedCapabilities ?? {}) };
  const missing = Object.entries(terms.minimumScores).filter(([skill, target]) => (scores[skill as keyof typeof scores] ?? 0) < target)
    .map(([skill, target]) => `${skill === 'longContext' ? 'long context' : skill} ${target / 100}`);
  if (model.reliabilityBps < terms.reliabilityBps) missing.push(`reliability ${terms.reliabilityBps / 100}%`);
  if (terms.maxServingCUwPer1000 !== null && metrics.servingCUwPer1000 > terms.maxServingCUwPer1000) missing.push(`serving at most ${formatUnits(terms.maxServingCUwPer1000)} CUw per 1,000 requests`);
  if (terms.maxMemoryMU !== null && metrics.residentMU + metrics.sessionMemoryMU * terms.concurrentSessions > terms.maxMemoryMU) missing.push(`model and session memory at most ${formatUnits(terms.maxMemoryMU)} MU`);
  if (terms.minRetentionBps !== null && metrics.retentionBps < terms.minRetentionBps) missing.push(`retention ${terms.minRetentionBps / 100}%`);
  if (terms.minVerifiedBps !== null && metrics.verifiedCompletionBps < terms.minVerifiedBps) missing.push(`verified completion ${terms.minVerifiedBps / 100}%`);
  if (terms.maxLatencyBps !== null && metrics.latencyBps > terms.maxLatencyBps) missing.push(`response time at most ${terms.maxLatencyBps / 10000}×`);
  return missing;
}

export function systemsBriefReport(state: Readonly<GameState>, modelId: string, terms: SystemsBriefTerms, atWeek = state.week) {
  return Object.values(state.slices.models.reports).filter(report => report.companyId === state.playerCompanyId && report.modelId === modelId
    && report.suiteId === terms.challengeSuiteId && report.challenge?.passed && isPaidChallengeReport(state, report, atWeek))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];
}

function modelRejection(state: Readonly<GameState>, modelId: string, terms: SystemsBriefTerms, atWeek: number, content: GameContent): string | null {
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== state.playerCompanyId || model.scenarioStart || (model.createdWeek ?? 0) > atWeek) return 'Choose an owned model you have developed.';
  const missing = systemsBriefRequirements(model, terms);
  if (missing.length) return `Needs ${missing.join(', ')}.`;
  if (!inheritedModelRights(state, modelId, content).hosted) return 'The selected model does not have rights for hosted client work.';
  const policy = policyReleaseRejection(state, modelId); if (policy) return policy.message;
  if (!systemsBriefReport(state, modelId, terms, atWeek)) return 'Pass this offer’s paid systems challenge with the exact selected model first.';
  return null;
}

export interface SystemsBriefOffer extends SystemsBriefTerms {
  terms: SystemsBriefTerms;
  title: string;
  description: string;
  requirements: string[];
  candidateModelId: string | null;
  missing: string | null;
  available: boolean;
  nextOpensWeek: number;
}

export function getSystemsBriefOffers(state: Readonly<GameState>): SystemsBriefOffer[] {
  const atWeek = state.week + 1, windowIndex = Math.floor((atWeek - 1) / SYSTEMS_BRIEF_WINDOW_WEEKS), orders = getSystemsBriefOrders(state);
  const active = activeSystemsBrief(state) || Object.values(state.slices.campaign.customerBriefs ?? {}).some(order => order.status === 'active');
  const scheduled = state.queuedCommands.some(command => command.companyId === state.playerCompanyId && ['accept_customer_brief', 'accept_systems_brief'].includes(command.payload.kind));
  const taken = orders.some(order => order.terms.windowIndex === windowIndex);
  return SYSTEMS_BRIEFS.map(def => {
    const terms = createConnectedSystemsBriefTerms(state, def.id, windowIndex);
    const model = Object.values(state.slices.models.versions).filter(candidate => !modelRejection(state, candidate.id, terms, state.week, CONTENT))
      .sort((a, b) => getSystemsModelMeasures(a).servingCUwPer1000 - getSystemsModelMeasures(b).servingCUwPer1000 || a.residentMU - b.residentMU || a.id.localeCompare(b.id))[0];
    const missing = ![AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion) ? 'Upgrade this campaign to open systems commissions.'
      : state.slices.company.companies[state.playerCompanyId].earnedRevenueCents <= 0 ? 'Make your first customer sale to receive commissions.'
      : orders.length >= SYSTEMS_BRIEF_ORDER_LIMIT ? 'This campaign has filled its systems commission archive.'
      : taken ? 'You have chosen a commission for this window. New offers arrive next window.'
      : active || scheduled ? 'Finish the active or scheduled customer commission first.'
      : atWeek > terms.acceptUntilWeek ? 'This acceptance window has closed. New offers arrive next window.'
      : !model ? 'Develop a model that meets the requirements and pass its paid systems challenge.' : null;
    return { ...terms, terms, title: def.title, description: def.description, requirements: systemsBriefRequirementText(terms),
      candidateModelId: model?.id ?? null, missing, available: !missing, nextOpensWeek: (windowIndex + 1) * SYSTEMS_BRIEF_WINDOW_WEEKS + 1 };
  });
}

export function validateSystemsBriefCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const payload = command.payload;
  const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
  if (payload.kind !== 'accept_systems_brief' || command.companyId !== state.playerCompanyId
    || !['kind,modelId,offerId', 'kind,modelId,offerId,terms'].includes(Object.keys(payload).sort().join())) return reject('Choose a systems commission and its delivery model.', 'INVALID_COMMAND');
  if (![AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion)) return reject('Upgrade this campaign to open systems commissions.');
  const week = command.issuedForWeek, windowIndex = Math.floor((week - 1) / SYSTEMS_BRIEF_WINDOW_WEEKS);
  const terms = payload.terms ?? SYSTEMS_BRIEFS.map(def => createConnectedSystemsBriefTerms(state, def.id, windowIndex)).find(offer => offer.id === payload.offerId);
  if (!terms || week < terms.opensWeek || week > terms.acceptUntilWeek) return reject('That offer is no longer accepting commissions. Choose a current offer.');
  if (terms.id !== payload.offerId || terms.windowIndex !== windowIndex || !isCanonicalSystemsBriefTerms(state, terms)
    || hasConnectedCompanyRules(state.contentVersion) && terms.version !== 2) return reject('The pinned customer terms do not match this offer. Review a current offer explicitly.', 'INVALID_COMMAND');
  const orders = getSystemsBriefOrders(state);
  if (orders.length >= SYSTEMS_BRIEF_ORDER_LIMIT) return reject('This campaign has filled its systems commission archive.');
  if (orders.some(order => order.terms.windowIndex === windowIndex)) return reject('Choose only one systems commission per market window.', 'ALREADY_ACTIVE');
  if (activeSystemsBrief(state) || Object.values(state.slices.campaign.customerBriefs ?? {}).some(brief => brief.status === 'active')
    || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && ['accept_customer_brief', 'accept_systems_brief'].includes(other.payload.kind)))
    return reject('Finish the active or scheduled customer commission first.', 'ALREADY_ACTIVE');
  if (state.slices.company.companies[state.playerCompanyId].earnedRevenueCents <= 0) return reject('Make your first customer sale before taking a commission.');
  const reason = modelRejection(state, payload.modelId, terms, week - 1, content);
  if (reason) return reject(reason);
}

export function quoteSystemsBriefCommand(state: Readonly<GameState>, command: GameCommand) {
  if (command.payload.kind !== 'accept_systems_brief') throw new Error('Choose a systems commission.');
  const payload = command.payload;
  const terms = payload.terms ?? SYSTEMS_BRIEFS.map(def => createConnectedSystemsBriefTerms(state, def.id, Math.floor((command.issuedForWeek - 1) / SYSTEMS_BRIEF_WINDOW_WEEKS)))
    .find(offer => offer.id === payload.offerId)!;
  const model = state.slices.models.versions[command.payload.modelId], metrics = model && getSystemsModelMeasures(model);
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: `${terms.client} pays ${formatMoney(terms.feeCents)} after ${terms.qualifyingWeeks} consecutive delivery weeks by Week ${command.issuedForWeek + terms.deadlineWeeks - 1}. `
      + (metrics ? `Reserve ${formatUnits(Math.ceil(metrics.servingCUwPer1000 * terms.requestsPerWeek / 1000))} serving CUw and ${formatUnits(metrics.residentMU + metrics.sessionMemoryMU * terms.concurrentSessions)} MU alongside existing customers.` : '') };
}

export function systemsBriefProofId(state: Readonly<GameState>, order: SystemsBriefOrder, week?: number): string {
  const identity = canonicalStateHash({ terms: order.terms, modelId: order.modelId, reportId: order.reportId,
    modelFingerprint: order.modelFingerprint, commandId: order.commandId, startedWeek: order.startedWeek });
  return `systems-proof:${state.playerCompanyId}:${order.id}:${week === undefined ? 'admission' : week}:${identity}`;
}

export function applySystemsBriefCommand(state: Readonly<GameState>, command: GameCommand): DomainResult {
  if (command.payload.kind !== 'accept_systems_brief') return {};
  const payload = command.payload;
  const terms = payload.terms ?? SYSTEMS_BRIEFS.map(def => createConnectedSystemsBriefTerms(state, def.id, Math.floor((command.issuedForWeek - 1) / SYSTEMS_BRIEF_WINDOW_WEEKS)))
    .find(offer => offer.id === payload.offerId)!;
  const report = systemsBriefReport(state, command.payload.modelId, terms, command.issuedForWeek - 1)!;
  const order: SystemsBriefOrder = { id: terms.id, briefId: terms.briefId, terms, commandId: command.id, modelId: command.payload.modelId,
    reportId: report.id, modelFingerprint: modelChallengeFingerprint(state.slices.models.versions[command.payload.modelId], terms.challengeSuiteId),
    startedWeek: command.issuedForWeek, deadlineWeek: command.issuedForWeek + terms.deadlineWeeks - 1,
    status: 'active', finishedWeek: null, qualifyingWeeks: 0, deliveryWeeks: [], feedback: 'Awaiting the first client delivery week.' };
  return { updates: { campaign: { ...state.slices.campaign, systemsBriefs: { ...state.slices.campaign.systemsBriefs, [order.id]: order } } },
    facts: [{ id: systemsBriefProofId(state, order), companyId: state.playerCompanyId, week: command.issuedForWeek,
      sourceId: order.id, category: 'operating', kind: 'expense', amountCents: 0, label: systemsBriefDefinition(order.briefId)!.title + ' · signed delivery requirements' }],
    messages: [{ category: 'project', message: `${systemsBriefDefinition(order.briefId)!.title} accepted for ${terms.client}. Deliver by Week ${order.deadlineWeek}.` }] };
}

export function systemsBriefWorkRequest(state: Readonly<GameState>, order: SystemsBriefOrder): WorkRequest | null {
  const model = state.slices.models.versions[order.modelId]; if (!model || order.status !== 'active') return null;
  const metrics = getSystemsModelMeasures(model);
  return { id: systemsBriefRequestId(order), taskId: order.id, companyId: state.playerCompanyId, category: 'serving', priority: 90,
    normalizedWorkCUw: Math.ceil(metrics.servingCUwPer1000 * order.terms.requestsPerWeek / 1000),
    memoryMU: metrics.residentMU + metrics.sessionMemoryMU * order.terms.concurrentSessions, poolId: 'auto', ...modelExecutionHints(model) };
}

export function reserveSystemsBrief(state: Readonly<GameState>): DomainResult {
  const order = activeSystemsBrief(state), request = order && systemsBriefWorkRequest(state, order);
  return request ? { workRequests: [request] } : {};
}

export function settleSystemsBrief(state: Readonly<GameState>, context: ModuleContext): DomainResult {
  const previous = activeSystemsBrief(state); if (!previous) return {};
  const request = systemsBriefWorkRequest(state, previous)!;
  const delivered = context.resources.computeGrants.find(grant => grant.requestId === request.id)?.hardwareEffectiveCUw ?? 0;
  const qualifies = delivered === request.normalizedWorkCUw;
  const order: SystemsBriefOrder = { ...previous, qualifyingWeeks: qualifies ? previous.qualifyingWeeks + 1 : 0,
    deliveryWeeks: qualifies ? [...previous.deliveryWeeks, context.week] : [],
    feedback: `${state.slices.models.versions[previous.modelId].name} · ${formatUnits(delivered)}/${formatUnits(request.normalizedWorkCUw)} serving CUw delivered. ${qualifies ? 'All client requests completed.' : 'Reserve the client’s compute and memory alongside ordinary customer service.'}` };
  const result: DomainResult = { updates: { campaign: { ...state.slices.campaign, systemsBriefs: { ...state.slices.campaign.systemsBriefs, [order.id]: order } } } };
  if (qualifies) result.facts = [{ id: systemsBriefProofId(state, order, context.week), companyId: state.playerCompanyId, week: context.week,
    sourceId: order.id, category: 'operating', kind: 'expense', amountCents: 0, label: 'Systems commission · client requests delivered' }];
  if (order.qualifyingWeeks >= order.terms.qualifyingWeeks) {
    order.status = 'completed'; order.finishedWeek = context.week;
    (result.facts ??= []).push({ id: systemsBriefPaymentId(state.playerCompanyId, order.id), companyId: state.playerCompanyId, week: context.week,
      sourceId: order.id, category: 'revenue', kind: 'receipt', amountCents: order.terms.feeCents, label: systemsBriefDefinition(order.briefId)!.title + ' · delivered systems commission' });
    const reward = order.terms.version === 2 ? order.terms.relationship?.tier === 'pilot'
      ? ' Your successful pilot earns repeat-work access and 12% more acquisition weight for the matching public workload.'
      : ' This delivery builds a partner relationship: larger follow-on commitments and 25% more acquisition weight for the matching public workload.' : '';
    result.messages = [{ category: 'delivery', message: `${order.terms.client} received the completed commission and paid ${formatMoney(order.terms.feeCents)}.${reward} New offers arrive in Week ${(order.terms.windowIndex + 1) * SYSTEMS_BRIEF_WINDOW_WEEKS + 1}.` }];
  } else if (context.week >= order.deadlineWeek) {
    order.status = 'expired'; order.finishedWeek = context.week;
    result.messages = [{ category: 'project', message: `${systemsBriefDefinition(order.briefId)!.title} expired without a delivery fee. A new commission window opens in Week ${(order.terms.windowIndex + 1) * SYSTEMS_BRIEF_WINDOW_WEEKS + 1}.` }];
  }
  return result;
}
