import { CONNECTED_COMPANY_CONTENT_VERSION } from './connected-company-version';
import type { GameState } from '../contracts/types';
import { SYSTEMS_BRIEF_IDS, type SystemsBriefOrder } from '../contracts/systems-briefs';
import { SYSTEMS_BRIEF_ORDER_LIMIT } from '../content/systems-briefs';
import { CONTENT } from '../content/catalog';
import { canonicalStateHash } from './canonical';
import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { isCanonicalSystemsBriefTerms, systemsBriefPaymentId, systemsBriefProofId, systemsBriefReport, systemsBriefRequirements } from '../modules/systems-briefs';
import { modelChallengeFingerprint } from '../modules/model-challenges';
import { inheritedModelRights } from '../modules/model-runtime';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
const fields = 'briefId,commandId,deadlineWeek,deliveryWeeks,feedback,finishedWeek,id,modelFingerprint,modelId,qualifyingWeeks,reportId,startedWeek,status,terms';

export function assertSystemsBriefsState(state: GameState): void {
  const orders = state.slices.campaign.systemsBriefs;
  const paymentPrefix = `systems-brief-payment:${state.playerCompanyId}:`;
  const proofPrefix = `systems-proof:${state.playerCompanyId}:`;
  const posted = Object.keys(state.slices.company.postedFacts).filter(id => id.startsWith(paymentPrefix));
  const proofs = Object.keys(state.slices.company.postedFacts).filter(id => id.startsWith(proofPrefix));
  if (orders === undefined) { check(posted.length === 0 && proofs.length === 0, 'Systems commission payments or work proofs have no order history.'); return; }
  check([AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion) && orders && typeof orders === 'object' && !Array.isArray(orders)
    && Object.keys(orders).length <= SYSTEMS_BRIEF_ORDER_LIMIT, 'Invalid systems commission archive.');
  const windows = new Set<number>();
  let active = Object.values(state.slices.campaign.customerBriefs ?? {}).filter(order => order.status === 'active').length;
  for (const [id, order] of Object.entries(orders)) {
    check(order && typeof order === 'object' && !Array.isArray(order) && Object.keys(order).sort().join() === fields
      && order.id === id && SYSTEMS_BRIEF_IDS.includes(order.briefId), 'Invalid systems commission identity.');
    check(order.terms && typeof order.terms === 'object' && [1, 2].includes(order.terms.version) && order.terms.briefId === order.briefId
      && Number.isSafeInteger(order.terms.windowIndex) && order.terms.windowIndex >= 0, 'Invalid signed systems commission terms.');
    const expected = order.terms;
    check(isCanonicalSystemsBriefTerms(state, expected) && id === expected.id, 'Signed systems commission requirements, client, relationship or payment were changed.');
    check(!windows.has(expected.windowIndex), 'Only one systems commission can be chosen per market window.'); windows.add(expected.windowIndex);
    check(Number.isSafeInteger(order.startedWeek) && order.startedWeek >= expected.opensWeek && order.startedWeek <= expected.acceptUntilWeek
      && order.startedWeek <= state.week && order.deadlineWeek === order.startedWeek + expected.deadlineWeeks - 1, 'Invalid systems commission dates.');
    const command = state.commandReceipts[order.commandId];
    check(typeof order.commandId === 'string' && command?.status === 'accepted' && command.week === order.startedWeek, 'Systems commission has no accepted command receipt.');
    const model = state.slices.models.versions[order.modelId];
    check(model && model.companyId === state.playerCompanyId && !model.scenarioStart && (model.createdWeek ?? 0) < order.startedWeek
      && !systemsBriefRequirements(model, expected).length && inheritedModelRights(state, model.id, CONTENT).hosted,
    'The signed systems commission model does not meet its quality, memory, cost or license requirements.');
    check(order.modelFingerprint === modelChallengeFingerprint(model, expected.challengeSuiteId), 'The systems commission candidate changed after admission.');
    const report = systemsBriefReport(state, model.id, expected, order.startedWeek - 1);
    check(report && report.id === order.reportId && report.week < order.startedWeek, 'Systems commission needs its exact prior paid passing challenge.');
    check(Number.isSafeInteger(order.qualifyingWeeks) && order.qualifyingWeeks >= 0 && order.qualifyingWeeks <= expected.qualifyingWeeks
      && typeof order.feedback === 'string' && order.feedback.length <= 320, 'Invalid systems commission progress.');
    check(Array.isArray(order.deliveryWeeks) && order.deliveryWeeks.length === order.qualifyingWeeks
      && order.deliveryWeeks.every((week, index) => Number.isSafeInteger(week) && week >= order.startedWeek
        && week <= (order.finishedWeek ?? state.week) && (index === 0 || week === order.deliveryWeeks[index - 1] + 1)),
    'Systems commission requires consecutive paid-work delivery weeks.');
    if (order.deliveryWeeks.length) check(order.deliveryWeeks.at(-1) === (order.finishedWeek ?? state.week), 'Systems delivery progress is not current.');
    if (order.status === 'active') {
      check(order.finishedWeek === null && state.week < order.deadlineWeek && order.qualifyingWeeks < expected.qualifyingWeeks, 'Invalid active systems commission.'); active++;
    } else {
      check(['completed', 'expired'].includes(order.status) && Number.isSafeInteger(order.finishedWeek) && order.finishedWeek! >= order.startedWeek
        && order.finishedWeek! <= Math.min(state.week, order.deadlineWeek), 'Invalid settled systems commission.');
      check(order.status === 'completed' ? order.qualifyingWeeks === expected.qualifyingWeeks : order.finishedWeek === order.deadlineWeek
        && order.qualifyingWeeks < expected.qualifyingWeeks, 'Invalid systems commission result.');
    }
    const paymentId = systemsBriefPaymentId(state.playerCompanyId, id);
    check((state.slices.company.postedFacts[paymentId] === true) === (order.status === 'completed'), 'Systems commission payment differs from its delivered result.');
    const payment = state.slices.company.ledger.find(fact => fact.id === paymentId);
    if (payment) check(payment.companyId === state.playerCompanyId && payment.week === order.finishedWeek && payment.amountCents === expected.feeCents
      && payment.kind === 'receipt' && payment.category === 'revenue' && payment.sourceId === order.id, 'Invalid systems commission delivery receipt.');
    assertProof(state, order);
    for (const week of order.deliveryWeeks) assertProof(state, order, week);
  }
  check(active <= 1, 'Only one customer commission can be active.');
  for (const id of posted) check(orders[id.slice(paymentPrefix.length)]?.status === 'completed', 'A systems commission fee has no completed order.');
  // Retain prior successful delivery facts even when a later shortfall resets the
  // consecutive streak. An unfinished or expired order still owns those facts.
  for (const id of proofs) {
    const parts = id.slice(proofPrefix.length).split(':'), order = orders[parts[0]];
    check(parts.length === 3 && order, 'A systems commission work proof has no order history.');
    const week = parts[1] === 'admission' ? undefined : Number(parts[1]);
    check(week === undefined || Number.isSafeInteger(week) && week >= order.startedWeek && week <= (order.finishedWeek ?? state.week), 'Systems commission work proof is outside its delivery period.');
    check(id === systemsBriefProofId(state, order, week), 'Systems commission work proof differs from its signed order.');
  }
}

function assertProof(state: GameState, order: SystemsBriefOrder, week?: number) {
  const id = systemsBriefProofId(state, order, week);
  check(state.slices.company.postedFacts[id] === true, 'Systems commission is missing its immutable signed or delivered-work proof.');
  const fact = state.slices.company.ledger.find(row => row.id === id);
  if (fact) check(fact.companyId === state.playerCompanyId && fact.week === (week ?? order.startedWeek) && fact.sourceId === order.id
    && fact.kind === 'expense' && fact.category === 'operating' && fact.amountCents === 0 && fact.paidCents === 0 && fact.unpaidCents === 0,
  'Invalid systems commission work proof.');
}
