import { OPTIONAL_BRIEF_IDS, type BriefId } from '../contracts/customer-briefs';
import type { GameState } from '../contracts/types';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { CUSTOMER_BRIEFS } from '../content/customer-briefs';
import { briefPaymentId } from '../modules/customer-briefs';
import { isSpecialistBrief } from '../modules/specialist-briefs';
import { assertSpecialistBrief } from './specialist-brief-validation';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const keys = 'baselineCostCents,contractGeneration,deadlineWeek,feedback,finishedWeek,id,qualifyingWeeks,startedWeek,status,targetId';
const ids: readonly BriefId[] = [...OPTIONAL_BRIEF_IDS, 'consultancy-pilot'];

export function assertCustomerBriefState(game: GameState) {
  const records = game.slices.campaign.customerBriefs;
  if (records === undefined) {
    check(game.slices.campaign.origin !== 'consultancy' && ids.every(id => !game.slices.company.postedFacts[briefPaymentId(game.playerCompanyId, id)]), 'Missing customer brief history.');
    return;
  }
  if (game.slices.campaign.origin === 'consultancy') check(records?.['consultancy-pilot'], 'The signed consultancy pilot must be present.');
  check(records && typeof records === 'object' && !Array.isArray(records) && Object.keys(records).every(id => ids.includes(id as BriefId)), 'Unknown customer brief.');
  let active = 0;
  for (const id of ids) {
    const brief = records[id], posted = game.slices.company.postedFacts[briefPaymentId(game.playerCompanyId, id)] === true;
    if (!brief) { check(!Object.hasOwn(records, id) && !posted, 'Missing customer brief delivery record.'); continue; }
    const def = CUSTOMER_BRIEFS[id];
    check(typeof brief === 'object' && Object.keys(brief).sort().join() === (isSpecialistBrief(id) ? [...keys.split(','), 'specialist'].sort().join() : keys) && brief.id === id, 'Invalid customer brief identity.');
    check([brief.startedWeek, brief.deadlineWeek, brief.qualifyingWeeks, brief.baselineCostCents, brief.contractGeneration].every(n => Number.isSafeInteger(n) && n >= 0), 'Invalid customer brief measurement.');
    check(brief.startedWeek <= game.week && brief.deadlineWeek === (brief.startedWeek || 1) + def.weeks - 1, 'Invalid customer brief deadline.');
    check(id === 'consultancy-pilot' ? brief.startedWeek === 0 && game.slices.campaign.origin === 'consultancy' : brief.startedWeek > 0, 'Invalid customer brief opening.');
    check(typeof brief.feedback === 'string' && brief.feedback.length <= 320 && brief.qualifyingWeeks <= def.qualifyingWeeks, 'Invalid customer brief progress.');
    if (id === 'launch-window') check(typeof brief.targetId === 'string' && Object.hasOwn(game.slices.products.offers, brief.targetId) && game.slices.products.offers[brief.targetId].companyId === game.playerCompanyId, 'Invalid launch brief product.');
    else if (id === 'lean-service') check(typeof brief.targetId === 'string' && Object.values(BUSINESS_BY_ID).some(customer => 'business:' + customer.id === brief.targetId && customer.kinds.includes('private-hosted')) && brief.baselineCostCents > 0 && brief.contractGeneration > 0, 'Invalid hosting brief contract.');
    else if (isSpecialistBrief(id)) assertSpecialistBrief(game, brief);
    else check(brief.targetId === null, 'Unexpected customer brief binding.');
    if (id !== 'lean-service') check(brief.contractGeneration === 0 && brief.baselineCostCents === 0, 'Invalid customer brief cost baseline.');
    check(posted === (brief.status === 'completed'), 'Customer delivery fee does not match the brief outcome.');
    const payment = game.slices.company.ledger.find(fact => fact.id === briefPaymentId(game.playerCompanyId, id));
    if (payment) check(payment.week === brief.finishedWeek && payment.companyId === game.playerCompanyId && payment.amountCents === def.feeCents
      && payment.kind === 'receipt' && payment.category === 'revenue' && payment.sourceId === 'customer-brief:' + id, 'Invalid customer delivery receipt.');
    check(brief.qualifyingWeeks <= (brief.finishedWeek ?? game.week) - Math.max(1, brief.startedWeek) + 1, 'Customer delivery progress exceeds the available weeks.');
    if (brief.status === 'active') {
      check(brief.finishedWeek === null && game.week < brief.deadlineWeek && brief.qualifyingWeeks < def.qualifyingWeeks, 'Invalid active customer brief.');
      active++;
    } else {
      check((brief.status === 'completed' || brief.status === 'expired') && brief.finishedWeek !== null && Number.isSafeInteger(brief.finishedWeek)
        && brief.finishedWeek >= Math.max(1, brief.startedWeek) && brief.finishedWeek <= game.week && brief.finishedWeek <= brief.deadlineWeek, 'Invalid settled customer brief.');
      check(brief.status === 'completed' ? brief.qualifyingWeeks === def.qualifyingWeeks : brief.finishedWeek === brief.deadlineWeek && brief.qualifyingWeeks < def.qualifyingWeeks, 'Invalid customer brief result.');
    }
  }
  check(active <= 1, 'Only one customer brief can be active.');
}
