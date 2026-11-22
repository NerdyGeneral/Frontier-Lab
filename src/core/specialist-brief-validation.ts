import { CONNECTED_COMPANY_CONTENT_VERSION } from './connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import type { CustomerBrief } from '../contracts/customer-briefs';
import type { GameState } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { SPECIALIST_BRIEF_RULES } from '../content/customer-briefs';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { inheritedModelRights } from '../modules/model-runtime';
import { isPaidBriefReport, isSpecialistBrief, specialistBriefProofId, specialistModelRequirements } from '../modules/specialist-briefs';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function assertSpecialistBrief(state: GameState, brief: CustomerBrief): void {
  check(isSpecialistBrief(brief.id) && [GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion), 'Specialist commissions require the current gameplay rules.');
  const receipt = brief.specialist;
  check(receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && Object.keys(receipt).sort().join() === 'advancedReportId,capabilityReportId,deliveryWeeks,version' && receipt.version === 1,
  'Invalid specialist commission receipt.');
  const model = typeof brief.targetId === 'string' ? state.slices.models.versions[brief.targetId] : undefined;
  check(model && model.companyId === state.playerCompanyId && !model.scenarioStart && (model.createdWeek ?? 0) < brief.startedWeek
    && !specialistModelRequirements(model, brief.id) && inheritedModelRights(state, model.id, CONTENT).hosted, 'The specialist commission model does not meet the signed requirements.');
  const capability = state.slices.models.reports[receipt.capabilityReportId];
  check(isPaidBriefReport(state, capability, model.id, 'expanded-capabilities-1') && capability.week < brief.startedWeek,
    'A specialist commission needs the selected model’s prior paid capability report.');
  const advancedRequired = Object.keys(SPECIALIST_BRIEF_RULES[brief.id].minimumScores).some(domain => ['reasoning', 'longContext', 'multimodal'].includes(domain));
  if (advancedRequired) {
    const advanced = typeof receipt.advancedReportId === 'string' ? state.slices.models.reports[receipt.advancedReportId] : undefined;
    check(isPaidBriefReport(state, advanced, model.id, 'advanced-capabilities-1') && advanced.week < brief.startedWeek,
      'This specialist commission needs the selected model’s prior paid advanced report.');
  } else check(receipt.advancedReportId === null, 'This specialist commission has an unexpected advanced report.');
  check(Array.isArray(receipt.deliveryWeeks) && receipt.deliveryWeeks.length === brief.qualifyingWeeks
    && receipt.deliveryWeeks.every((week, index) => Number.isSafeInteger(week) && week >= brief.startedWeek && week <= (brief.finishedWeek ?? state.week)
      && (index === 0 || week === receipt.deliveryWeeks[index - 1] + 1)), 'Specialist client delivery weeks must be consecutive and match progress.');
  if (receipt.deliveryWeeks.length) check(receipt.deliveryWeeks.at(-1) === (brief.finishedWeek ?? state.week), 'Specialist delivery progress must belong to its latest settled week.');
  const proof = (week?: number) => {
    const id = specialistBriefProofId(state, brief, week);
    check(state.slices.company.postedFacts[id] === true, 'Specialist client work is missing its immutable delivery proof.');
    const fact = state.slices.company.ledger.find(item => item.id === id);
    if (fact) check(fact.companyId === state.playerCompanyId && fact.sourceId === 'customer-brief:' + brief.id
      && fact.week === (week ?? brief.startedWeek) && fact.kind === 'expense' && fact.category === 'operating'
      && fact.amountCents === 0 && fact.paidCents === 0 && fact.unpaidCents === 0, 'Invalid specialist client work receipt.');
  };
  proof();
  for (const week of receipt.deliveryWeeks) proof(week);
}
