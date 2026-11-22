import { formatWorkPoints } from './workforce-points';
import { CONTENT } from '../content/catalog';
import { FEEDBACK_REVIEW_RULES as RULES } from '../content/wave10-feedback-review';
import type { CommandQuote, DataPacket, DataSlice, DomainResult, GameCommand, GameContent, GameState, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import type { FeedbackStudy } from '../contracts/wave10-feedback';
import type { FeedbackReview, FeedbackReviewMode, FeedbackReviewWorkReceipt } from '../contracts/wave10-feedback-review';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, checkedInteger, formatUnits, mulDiv } from '../core/math';
import { getComputePools, getPoolMultiplierBps, poolSupportsWorkload, usesCrossRackTraining } from './compute-pools';
import { feedbackStudyFingerprint, feedbackStudySourceIds, getReviewableFeedbackStudy } from './feedback';
import { inheritedModelRights } from './model-runtime';

export const FEEDBACK_REVIEW_COMMANDS = ['start_feedback_review', 'set_feedback_review_paused'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const records = (data: Readonly<DataSlice>): FeedbackReview[] => Object.values(data.feedbackReviews ?? {});
export const feedbackReviewWorkId = (id: string, kind: 'compute' | 'data') => `feedback-review:${id}:${kind}`;

export function feedbackReviewTerms(study: FeedbackStudy, mode: FeedbackReviewMode) {
  const terms = RULES.modes[mode];
  return { requiredWork: mulDiv(terms.workPer100, study.totalCases, 100),
    requiredStaff: mulDiv(terms.staffPer100, study.totalCases, 100), memoryMU: RULES.memoryMU, qualityBps: terms.qualityBps };
}

export function feedbackReviewReceiptKey(receipt: Pick<FeedbackReviewWorkReceipt, 'hardwareId' | 'ownership' | 'multiplierBps' | 'rateCentsPerCUw'>): string {
  return canonicalStateHash({ hardwareId: receipt.hardwareId, ownership: receipt.ownership,
    multiplierBps: receipt.multiplierBps, rateCentsPerCUw: receipt.rateCentsPerCUw });
}

export function feedbackDataRights(state: Readonly<GameState>, study: FeedbackStudy, content: GameContent = CONTENT): DataPacket['rights'] {
  const models = new Set([study.sourceModelId, ...study.weeks.filter(row => row.outcomes.cases > 0 && row.routingModelId !== null)
    .map(row => row.routingModelId!)]);
  return { hosted: true, weights: study.consent === 'distribution'
    && [...models].every(id => inheritedModelRights(state, id, content).weights), feedback: true };
}

/** A pure recipe; only commitFeedbackReviews makes this packet available in the game. */
export function feedbackDataPacket(state: Readonly<GameState>, review: FeedbackReview, content: GameContent = CONTENT): DataPacket {
  const study = state.slices.data.feedbackStudies![review.studyId], sampling = RULES.sampling[study.sampling];
  const coverageBps = { conversation: 0, documents: 0, coding: 0, tools: 0 };
  coverageBps[study.productKind === 'basic-chat' ? 'conversation' : 'coding'] = sampling.primaryCoverageBps;
  return { id: review.outputPacketId, companyId: review.companyId, catalogId: RULES.catalogId,
    name: `${study.productKind === 'basic-chat' ? 'Chat' : 'API'} customer feedback · Week ${study.startedWeek}`,
    rawUnits: study.totalCases, readyUnits: study.totalCases, qualityBps: RULES.modes[review.mode].qualityBps,
    coverageBps, rights: feedbackDataRights(state, study, content),
    prepared: true, sourceIds: feedbackStudySourceIds(study), revision: 0,
    behaviorUnits: mulDiv(study.totalCases, sampling.behaviorDensityBps, 10000), broadUnits: 0,
    feedback: { protocol: RULES.protocol, studyId: study.id, reviewId: review.id, studyFingerprint: review.studyFingerprint, mode: review.mode } };
}

export function validateFeedbackReviewCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload, company = state.slices.company.companies[command.companyId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (p.kind === 'start_feedback_review') {
    if (company.arrearsCents) return reject('ARREARS', 'Resolve unpaid bills before starting feedback review.');
    if (p.mode !== 'quick' && p.mode !== 'verified') return reject('INVALID_COMMAND', 'Choose quick or verified feedback review.');
    const study = getReviewableFeedbackStudy(state, command.companyId, p.studyId);
    if (!study) return reject('NOT_READY', 'Close an owned customer-feedback study with collected cases and wait for its following weekly boundary.');
    if (records(state.slices.data).some(item => item.studyId === study.id)
      || state.queuedCommands.some(item => item.id !== command.id && item.payload.kind === 'start_feedback_review' && item.payload.studyId === study.id)) {
      return reject('ALREADY_ACTIVE', 'This study already has a queued, running or completed review. Resume its paid work or reuse the resulting data.');
    }
    if (records(state.slices.data).length >= RULES.maximumReviews) return reject('CAPACITY_EXCEEDED', 'The bounded feedback-review history is full. Existing reviewed datasets remain reusable.');
    return;
  }
  if (p.kind === 'set_feedback_review_paused') {
    const review = state.slices.data.feedbackReviews?.[p.reviewId];
    if (!review || review.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your feedback reviews.');
    if (review.status !== 'running') return reject('NO_IMPROVEMENT', 'This feedback review has finished its work.');
    if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether feedback review is paused.');
    if (review.paused === p.paused) return reject('ALREADY_ACTIVE', p.paused ? 'This review is already paused.' : 'This review is already running.');
    return;
  }
  return reject('INVALID_COMMAND', 'This is not a feedback-review command.');
}

export function quoteFeedbackReviewCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): CommandQuote {
  const p = command.payload;
  if (p.kind === 'start_feedback_review') {
    const study = state.slices.data.feedbackStudies![p.studyId], terms = feedbackReviewTerms(study, p.mode);
    return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${RULES.modes[p.mode].name}: ${study.totalCases} cases, ${formatWorkPoints(terms.requiredStaff)} Data points and ${formatUnits(terms.requiredWork)} development CUw, with 1 MU workspace. At most 20 Data points are applied each week; GPU work and Data points progress independently. Ordinary payroll and compute bills apply. The reusable dataset arrives at the boundary after both finish.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.kind === 'set_feedback_review_paused' && p.paused
    ? 'Pause remaining GPU and data review work next week; all paid progress remains.' : 'Resume remaining feedback review work next week.' };
}

export function applyFeedbackReviewCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): DomainResult {
  const data = structuredClone(state.slices.data), p = command.payload;
  let message = '';
  if (p.kind === 'start_feedback_review') {
    const study = data.feedbackStudies![p.studyId], terms = feedbackReviewTerms(study, p.mode), id = `feedback-review:${command.id}`;
    data.feedbackReviews ??= {};
    data.feedbackReviews[id] = { id, companyId: command.companyId, protocol: RULES.protocol, studyId: study.id,
      studyFingerprint: feedbackStudyFingerprint(study), mode: p.mode, outputPacketId: `feedback-data:${command.id}`,
      status: 'running', paused: false, startedWeek: state.week, completedWeek: null, availableWeek: null,
      requiredWork: terms.requiredWork, completedWork: 0, memoryMU: terms.memoryMU, physicalWork: 0, workReceipts: {}, latestGrant: null,
      requiredStaff: terms.requiredStaff, completedStaff: 0, staffGrantCount: 0, firstStaffWeek: null, latestStaffGrant: null,
      lastBottleneck: 'Case review needs Data points and development compute with 1 MU of memory.' };
    message = `${RULES.modes[p.mode].name} started for ${study.totalCases} customer-feedback cases. The reviewed dataset will be available after the paid work finishes.`;
  } else if (p.kind === 'set_feedback_review_paused') {
    const review = data.feedbackReviews![p.reviewId]; review.paused = p.paused;
    review.lastBottleneck = p.paused ? 'Feedback review paused; paid progress is retained.' : 'Feedback review resumed.';
    message = `Feedback review ${p.paused ? 'paused' : 'resumed'}.`;
  }
  return { updates: { data }, messages: [{ companyId: command.companyId, category: 'project', message }] };
}

export function feedbackReviewRequests(state: Readonly<GameState>, _content: GameContent = CONTENT): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const review of records(state.slices.data)) {
    if (review.status !== 'running' || review.paused || state.slices.company.companies[review.companyId].arrearsCents) continue;
    if (review.completedWork < review.requiredWork) requests.push({ id: feedbackReviewWorkId(review.id, 'compute'), companyId: review.companyId,
      taskId: review.id, category: 'development', normalizedWorkCUw: review.requiredWork - review.completedWork,
      memoryMU: review.memoryMU, priority: RULES.requestPriority, poolId: 'auto', workloadKind: 'general' });
    if (review.completedStaff < review.requiredStaff) requests.push({ id: feedbackReviewWorkId(review.id, 'data'), companyId: review.companyId,
      taskId: review.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: RULES.requestPriority, poolId: 'auto',
      staffDemand: [{ role: 'data', staffWeeks: Math.min(RULES.maximumWeeklyStaff, review.requiredStaff - review.completedStaff) }] });
  }
  return requests;
}

export function advanceFeedbackReviews(state: Readonly<GameState>, context: ModuleContext, data: DataSlice): void {
  for (const review of records(data)) {
    if (review.status !== 'running' || review.paused) continue;
    if (state.slices.company.companies[review.companyId].arrearsCents) { review.lastBottleneck = 'Unpaid bills; feedback review is suspended.'; continue; }
    const grant = context.resources.computeGrants.find(item => item.requestId === feedbackReviewWorkId(review.id, 'compute'));
    if (grant?.hardwareEffectiveCUw) {
      const remaining = review.requiredWork - review.completedWork;
      const pool = getComputePools(state, review.companyId, context.content, context.resources.staffGrants).find(item => item.id === grant.poolId);
      if (!pool || !poolSupportsWorkload(pool, { category: 'development', workloadKind: 'general' }) || grant.hardwareEffectiveCUw > remaining
        || grant.memoryMU !== review.memoryMU || grant.sharedMemoryMU) throw new Error('Feedback review grant exceeds remaining work or omits its separate 1 MU workspace.');
      const multiplierBps = getPoolMultiplierBps(pool, 'development', usesCrossRackTraining(pool, 'development', grant.physicalCUw, review.memoryMU), context.content, 'general');
      if (grant.physicalCUw <= 0 || grant.hardwareEffectiveCUw !== Math.min(remaining, mulDiv(grant.physicalCUw, multiplierBps, 10000))) {
        throw new Error('Feedback review requires a matching actual physical GPU grant.');
      }
      const rateCentsPerCUw = pool.ownership === 'cloud' ? context.content.opening.rentCentsPerCUWeek : pool.variableCentsPerCUw;
      const key = feedbackReviewReceiptKey({ hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw });
      const receipt = review.workReceipts[key] ??= { hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw,
        physicalCUw: 0, effectiveCUw: 0, conversionRemainder: 0, grants: 0, firstWeek: context.week, lastWeek: context.week };
      const conversionRemainder = checkedInteger(Number(BigInt(grant.physicalCUw) * BigInt(multiplierBps) - BigInt(grant.hardwareEffectiveCUw) * BigInt(10000)));
      receipt.physicalCUw = checkedAdd(receipt.physicalCUw, grant.physicalCUw); receipt.effectiveCUw = checkedAdd(receipt.effectiveCUw, grant.hardwareEffectiveCUw);
      receipt.conversionRemainder = checkedAdd(receipt.conversionRemainder, conversionRemainder); receipt.grants += 1; receipt.lastWeek = context.week;
      review.completedWork = checkedAdd(review.completedWork, grant.hardwareEffectiveCUw); review.physicalWork = checkedAdd(review.physicalWork, grant.physicalCUw);
      review.latestGrant = { week: context.week, poolId: grant.poolId, receiptKey: key, remainingBefore: remaining,
        physicalCUw: grant.physicalCUw, effectiveCUw: grant.hardwareEffectiveCUw, memoryMU: grant.memoryMU };
    }
    const staff = context.resources.staffGrants.find(item => item.requestId === feedbackReviewWorkId(review.id, 'data'))?.grants.find(item => item.role === 'data')?.staffWeeks ?? 0;
    const remainingStaff = review.requiredStaff - review.completedStaff;
    if (staff > Math.min(RULES.maximumWeeklyStaff, remainingStaff)) throw new Error('Feedback review exceeds its remaining data review or weekly staff cap.');
    if (staff > 0) {
      review.latestStaffGrant = { week: context.week, remainingBefore: remainingStaff, grantedStaff: staff };
      review.firstStaffWeek ??= context.week; review.staffGrantCount += 1;
      review.completedStaff = checkedAdd(review.completedStaff, staff);
    }
    const needsCompute = review.completedWork < review.requiredWork, needsStaff = review.completedStaff < review.requiredStaff;
    review.lastBottleneck = needsCompute && needsStaff ? 'Needs development compute with 1 MU workspace and data staff; each can progress independently.'
      : needsCompute ? 'Data review finished; provide development compute with 1 MU workspace.'
      : needsStaff ? 'GPU processing finished; generate Data points to complete review, up to 20 each week.' : '';
  }
}

export function resolveFeedbackReviews(_state: Readonly<GameState>, context: ModuleContext, data: DataSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const review of records(data)) {
    if (review.status !== 'running' || review.paused || review.completedWork !== review.requiredWork || review.completedStaff !== review.requiredStaff) continue;
    review.status = 'ready'; review.completedWeek = context.week; review.availableWeek = context.week + 1;
    review.lastBottleneck = `Paid review finished; the dataset becomes available in week ${review.availableWeek}.`;
    messages.push({ companyId: review.companyId, category: 'project', message: 'Feedback GPU processing and data review finished. The reusable dataset becomes available next week.' });
  }
  return messages;
}

export function commitFeedbackReviews(state: Readonly<GameState>, context: ModuleContext, data: DataSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const review of records(data)) {
    if (review.status !== 'ready' || review.availableWeek === null || review.availableWeek > context.week) continue;
    review.status = 'complete'; review.lastBottleneck = '';
    data.packets[review.outputPacketId] = feedbackDataPacket(state, review, context.content);
    messages.push({ companyId: review.companyId, category: 'delivery', message: 'Reviewed customer-feedback data is available in Data. Select it for a separate paid training run, then evaluate the resulting model.' });
  }
  return messages;
}

/** An actual-grant tariff estimate, never an additional company invoice. */
export function feedbackReviewTariffEstimateCents(review: FeedbackReview): number {
  return Number(Object.values(review.workReceipts).reduce((sum, item) => sum + BigInt(item.physicalCUw) * BigInt(item.rateCentsPerCUw), BigInt(0)) / BigInt(1_000_000_000));
}
