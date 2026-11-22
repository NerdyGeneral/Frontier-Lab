import { CHIP_RULES } from '../content/wave4-hardware';
import { FEEDBACK_REVIEW_RULES as RULES } from '../content/wave10-feedback-review';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import type { FeedbackReview, FeedbackReviewWorkReceipt } from '../contracts/wave10-feedback-review';
import { feedbackStudyFingerprint } from '../modules/feedback';
import { feedbackDataPacket, feedbackReviewReceiptKey, feedbackReviewTerms, feedbackReviewWorkId } from '../modules/feedback-review';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`);
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function hash(value: unknown, label: string): void { check(typeof value === 'string' && /^[a-f0-9]{8}$/.test(value), `${label} is invalid.`); }

export function assertFeedbackReviewCommand(payload: CommandPayload): void {
  if (payload.kind === 'start_feedback_review') {
    identifier(payload.studyId, 'Feedback study'); check(payload.mode === 'quick' || payload.mode === 'verified', 'Feedback review mode is invalid.');
  } else if (payload.kind === 'set_feedback_review_paused') {
    identifier(payload.reviewId, 'Feedback review'); check(typeof payload.paused === 'boolean', 'Feedback review pause choice is invalid.');
  }
}

function assertReceipt(receipt: FeedbackReviewWorkReceipt, key: string, review: FeedbackReview, state: GameState, content: GameContent): void {
  record(receipt, 'Feedback hardware receipt'); check(!Object.hasOwn(receipt, 'facilityTariff'), 'General feedback review work cannot claim an inference facility discount.'); identifier(receipt.hardwareId, 'Feedback hardware');
  check(['cloud', 'owned'].includes(receipt.ownership) && feedbackReviewReceiptKey(receipt) === key, 'Feedback hardware receipt identity changed.');
  for (const value of [receipt.multiplierBps, receipt.rateCentsPerCUw, receipt.physicalCUw, receipt.effectiveCUw, receipt.conversionRemainder,
    receipt.grants, receipt.firstWeek, receipt.lastWeek]) checkedInteger(value, 'Feedback hardware quantity');
  check(receipt.physicalCUw > 0 && receipt.effectiveCUw > 0 && receipt.grants > 0 && receipt.firstWeek >= review.startedWeek
    && receipt.lastWeek >= receipt.firstWeek && receipt.lastWeek <= state.week && receipt.grants <= receipt.lastWeek - receipt.firstWeek + 1,
  'Feedback GPU work violates its elapsed grant history.');
  if (receipt.ownership === 'cloud') {
    check(receipt.hardwareId === 'general' && receipt.multiplierBps === 10000 && receipt.rateCentsPerCUw === content.opening.rentCentsPerCUWeek,
      'Feedback cloud conversion or reservation tariff changed.');
  } else {
    const hardware = content.hardware.find(item => item.id === receipt.hardwareId);
    check(hardware, 'Feedback data processing requires authored general-purpose hardware.');
    const base = Math.round(hardware!.trainingMultiplier * 10000);
    check([base, mulDiv(base, content.infrastructure.crossRackTrainingBps, 10000), mulDiv(base, CHIP_RULES.fabricCrossRackBps, 10000)].includes(receipt.multiplierBps)
      && receipt.rateCentsPerCUw === hardware!.variableCentsPerCUw, 'Feedback owned GPU conversion or variable tariff is not authored.');
  }
  check(BigInt(receipt.physicalCUw) * BigInt(receipt.multiplierBps) === BigInt(receipt.effectiveCUw) * BigInt(10000) + BigInt(receipt.conversionRemainder)
    && BigInt(receipt.conversionRemainder) < BigInt(Math.max(receipt.multiplierBps, 10000)) * BigInt(receipt.grants),
  'Feedback useful work does not reconcile with its actual physical grants and integer conversion.');
}

function assertWork(review: FeedbackReview, state: GameState, content: GameContent): void {
  record(review.workReceipts, 'Feedback work receipts'); const receipts = Object.entries(review.workReceipts);
  check(receipts.length <= RULES.maximumReceiptBuckets, 'Feedback GPU receipt history is excessive.');
  let effective = 0, physical = 0, grants = 0;
  for (const [key, receipt] of receipts) {
    hash(key, 'Feedback hardware receipt key'); assertReceipt(receipt, key, review, state, content);
    effective = checkedAdd(effective, receipt.effectiveCUw); physical = checkedAdd(physical, receipt.physicalCUw); grants = checkedAdd(grants, receipt.grants);
  }
  check(effective === review.completedWork && physical === review.physicalWork && grants <= state.week - review.startedWeek + 1,
    'Feedback progress does not equal its bounded actual-work receipts.');
  if (review.latestGrant === null) check(review.completedWork === 0 && receipts.length === 0, 'Feedback progress has no actual GPU grant.');
  else {
    const latest = review.latestGrant; record(latest, 'Latest feedback GPU grant'); identifier(latest.poolId, 'Latest feedback pool'); hash(latest.receiptKey, 'Latest feedback tariff key');
    for (const value of [latest.week, latest.remainingBefore, latest.physicalCUw, latest.effectiveCUw, latest.memoryMU]) checkedInteger(value, 'Latest feedback GPU quantity');
    const receipt = review.workReceipts[latest.receiptKey];
    check(receipt && latest.week === Math.max(...receipts.map(([, item]) => item.lastWeek)) && latest.week === receipt.lastWeek
      && latest.physicalCUw > 0 && latest.physicalCUw <= receipt.physicalCUw && latest.effectiveCUw > 0 && latest.effectiveCUw <= receipt.effectiveCUw
      && latest.effectiveCUw <= latest.remainingBefore && latest.remainingBefore <= review.requiredWork
      && review.completedWork === review.requiredWork - latest.remainingBefore + latest.effectiveCUw && latest.memoryMU === review.memoryMU,
    'Latest feedback grant exceeds remaining work, separate workspace or receipt totals.');
    check(latest.effectiveCUw === Math.min(latest.remainingBefore, mulDiv(latest.physicalCUw, receipt!.multiplierBps, 10000)),
      'Latest feedback physical grant does not produce its reported useful work.');
    if (latest.week === state.week) {
      const actual = state.slices.compute.fleets[review.companyId].lastGrants.find(item => item.requestId === feedbackReviewWorkId(review.id, 'compute'));
      check(actual && actual.requestedWork === latest.remainingBefore && actual.grantedWork === latest.effectiveCUw,
        'Latest feedback work differs from the shared allocator grant.');
    }
    const cost = state.slices.compute.costReports?.[review.companyId]?.find(item => item.week === latest.week);
    if (cost) {
      const requestId = feedbackReviewWorkId(review.id, 'compute'), request = cost.resources.requests.find(item => item.id === requestId);
      const grant = cost.resources.computeGrants.find(item => item.requestId === requestId), pool = cost.pools.find(item => item.id === latest.poolId);
      check(request && grant && pool && request.taskId === review.id && request.category === 'development' && request.workloadKind === 'general'
        && request.normalizedWorkCUw === latest.remainingBefore && request.memoryMU === review.memoryMU && request.sharedAdapterMemory === undefined
        && grant.hardwareEffectiveCUw === latest.effectiveCUw && grant.physicalCUw === latest.physicalCUw && grant.memoryMU === review.memoryMU
        && !grant.sharedMemoryMU && grant.poolId === latest.poolId && pool.hardwareId === receipt!.hardwareId && pool.ownership === receipt!.ownership,
      'Feedback work disagrees with the retained settled compute-cost resource frame.');
    }
  }
}

function assertStaff(review: FeedbackReview, state: GameState): void {
  checkedInteger(review.staffGrantCount, 'Feedback staff grant count');
  if (review.latestStaffGrant === null) {
    check(review.completedStaff === 0 && review.firstStaffWeek === null && review.staffGrantCount === 0, 'Feedback staff progress has no actual grant.');
    return;
  }
  const latest = review.latestStaffGrant; record(latest, 'Latest feedback data grant');
  checkedInteger(review.firstStaffWeek!, 'First feedback review week');
  for (const value of [latest.week, latest.remainingBefore, latest.grantedStaff]) checkedInteger(value, 'Latest feedback staff quantity');
  check(review.firstStaffWeek! >= review.startedWeek && latest.week >= review.firstStaffWeek! && latest.week <= state.week
    && review.staffGrantCount > 0 && review.staffGrantCount <= latest.week - review.firstStaffWeek! + 1
    && review.completedStaff >= review.staffGrantCount && review.completedStaff <= review.staffGrantCount * RULES.maximumWeeklyStaff
    && latest.grantedStaff > 0 && latest.grantedStaff <= Math.min(RULES.maximumWeeklyStaff, latest.remainingBefore)
    && latest.remainingBefore <= review.requiredStaff && review.completedStaff === review.requiredStaff - latest.remainingBefore + latest.grantedStaff,
  'Feedback review exceeds its actual staff grants or weekly review cap.');
  const cost = state.slices.compute.costReports?.[review.companyId]?.find(item => item.week === latest.week);
  if (cost) {
    const requestId = feedbackReviewWorkId(review.id, 'data'), request = cost.resources.requests.find(item => item.id === requestId);
    const granted = cost.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'data')?.staffWeeks ?? 0;
    check(request?.taskId === review.id && request.normalizedWorkCUw === 0 && request.memoryMU === 0
      && request.staffDemand?.find(item => item.role === 'data')?.staffWeeks === Math.min(RULES.maximumWeeklyStaff, latest.remainingBefore)
      && granted === latest.grantedStaff, 'Feedback review disagrees with the retained settled staff grant.');
  }
}

/** Feedback source licensing, finite paid review and packet provenance survive every revision. */
export function assertWave10FeedbackReviews(state: GameState, content: GameContent): void {
  const collection = state.slices.data.feedbackReviews;
  if (collection !== undefined) record(collection, 'Feedback reviews');
  const entries = Object.entries(collection ?? {}), studies = new Set<string>();
  check(entries.length <= RULES.maximumReviews, 'Feedback review history exceeds its supported bound.');
  for (const [key, review] of entries) {
    record(review, 'Feedback review'); identifier(key, 'Feedback review ID'); identifier(review.companyId, 'Feedback review owner');
    identifier(review.studyId, 'Feedback source study'); identifier(review.outputPacketId, 'Feedback output packet'); hash(review.studyFingerprint, 'Feedback source fingerprint');
    const study = state.slices.data.feedbackStudies?.[review.studyId], commandId = key.slice('feedback-review:'.length), command = state.commandReceipts[commandId];
    check(review.id === key && key.startsWith('feedback-review:') && review.protocol === RULES.protocol
      && review.outputPacketId === `feedback-data:${commandId}` && command?.status === 'accepted' && command.week === review.startedWeek
      && study?.companyId === review.companyId && state.slices.company.companies[review.companyId], 'Feedback review identity, ownership or admitted command is missing.');
    checkedInteger(review.startedWeek, 'Feedback review start');
    check(study!.status === 'closed' && study!.reviewableWeek !== null && study!.reviewableWeek <= review.startedWeek && review.startedWeek <= state.week
      && study!.totalCases > 0 && feedbackStudyFingerprint(study!) === review.studyFingerprint, 'Feedback review changed or prematurely used its closed source evidence.');
    check(!studies.has(review.studyId), 'The same feedback study was reviewed more than once.'); studies.add(review.studyId);
    check(review.mode === 'quick' || review.mode === 'verified', 'Feedback review mode is invalid.');
    check(['running', 'ready', 'complete'].includes(review.status) && typeof review.paused === 'boolean', 'Feedback review status or pause choice is invalid.');
    check(typeof review.lastBottleneck === 'string' && review.lastBottleneck.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(review.lastBottleneck), 'Feedback review explanation is invalid.');
    for (const value of [review.requiredWork, review.completedWork, review.memoryMU, review.physicalWork, review.requiredStaff, review.completedStaff]) checkedInteger(value, 'Feedback review quantity');
    const terms = feedbackReviewTerms(study!, review.mode);
    check(review.requiredWork === terms.requiredWork && review.requiredStaff === terms.requiredStaff && review.memoryMU === terms.memoryMU
      && review.completedWork <= review.requiredWork && review.completedStaff <= review.requiredStaff, 'Feedback review changed its finite cost, workspace or progress.');
    assertWork(review, state, content); assertStaff(review, state);
    const finished = review.completedWork === review.requiredWork && review.completedStaff === review.requiredStaff;
    if (review.status === 'running') check(!finished && review.completedWeek === null && review.availableWeek === null, 'Unfinished feedback review has completion or availability evidence.');
    else {
      checkedInteger(review.completedWeek!, 'Feedback review completion'); checkedInteger(review.availableWeek!, 'Feedback dataset availability');
      check(finished && !review.paused && review.completedWeek! >= review.startedWeek && review.completedWeek! <= state.week
        && review.completedWeek === Math.max(review.latestGrant!.week, review.latestStaffGrant!.week)
        && review.availableWeek === review.completedWeek! + 1, 'Feedback review completed without its actual GPU and data work.');
      check(review.status === 'ready' ? review.availableWeek === state.week + 1 : review.availableWeek! <= state.week,
        'Feedback review violates next-boundary dataset availability.');
    }
    if (review.status === 'complete') {
      const packet = state.slices.data.packets[review.outputPacketId];
      check(packet && same(packet, feedbackDataPacket(state, review, content)), 'Completed feedback review lacks its exact paid, consented original dataset.');
    } else check(!state.slices.data.packets[review.outputPacketId], 'Feedback dataset appeared before paid review and its availability boundary.');
  }
  for (const packet of Object.values(state.slices.data.packets)) {
    const parent = packet.parentPacketId ? state.slices.data.packets[packet.parentPacketId] : undefined;
    const feedbackIdentity = packet.catalogId === RULES.catalogId || packet.id.startsWith('feedback-data:')
      || packet.sourceIds?.some(id => id.startsWith('feedback-source:')) || parent?.feedback;
    if (packet.feedback === undefined) { check(!feedbackIdentity, 'Feedback dataset lost its paid review and consent provenance.'); continue; }
    record(packet.feedback, 'Feedback dataset provenance');
    const review = collection?.[packet.feedback.reviewId];
    check(review?.status === 'complete' && review.companyId === packet.companyId, 'Feedback dataset has no completed owned review.');
    const expected = feedbackDataPacket(state, review!, content);
    check(same(packet.feedback, expected.feedback) && packet.catalogId === expected.catalogId && same(packet.sourceIds, expected.sourceIds)
      && packet.rawUnits === expected.rawUnits && packet.behaviorUnits === expected.behaviorUnits && packet.broadUnits === 0
      && same(packet.coverageBps, expected.coverageBps) && same(packet.rights, expected.rights), 'Feedback revision changed its source evidence, coverage or consent rights.');
    if (packet.id !== review!.outputPacketId) check(parent && same(parent.feedback, packet.feedback), 'Feedback derivatives must retain the same paid review through their parent packet.');
  }
}
