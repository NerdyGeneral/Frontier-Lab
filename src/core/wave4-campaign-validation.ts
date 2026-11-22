import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from './model-customization-version';
import { STRATEGY_CONTENT_VERSION } from './strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { assertCustomerBriefState } from './customer-brief-validation';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import type { CampaignWeek, GameContent, GameState } from '../contracts/types';
import { SILICON_CONTENT_VERSION } from '../content/silicon-market';
import { SYNTHETIC_CONTENT_VERSION } from '../content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { RELEASE_CAMPAIGN_VERSION } from '../contracts/wave4-campaign';
import { CAMPAIGN_HISTORY_LIMIT, ENDING_IDS, ENDING_RULES } from '../content/wave4-campaign';
import { qualifiesForEnding } from '../modules/campaign-progress';

const rowFields = ['week','revenueCents','operatingExpenseCents','cashCents','baseCostCents','arrearsCents','consumerAccounts','developerAccounts','businessOrganizations','paidProductKinds','serviceBps','trustBps','agentPenaltyCents','frontierModelId','frontierScoreBps','frontierReliabilityBps','frontierBehaviorTested','specialistModelId','specialistScoreBps','specialistReliabilityBps','sustainedContracts'];
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function assertWave4CampaignState(state: GameState, content: GameContent): void {
  assertCustomerBriefState(state);
  const campaign = state.slices.campaign;
  check(!Object.hasOwn(campaign, 'rules') || (campaign.rules === 'release' && [RELEASE_CAMPAIGN_VERSION, SILICON_CONTENT_VERSION, SYNTHETIC_CONTENT_VERSION, STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version)), 'The campaign rules do not belong to this build.');
  check(Array.isArray(campaign.history) && campaign.history.length <= CAMPAIGN_HISTORY_LIMIT, 'Campaign evidence is missing or unbounded.');
  check(record(campaign.endings) && Object.keys(campaign.endings).every(id => ENDING_IDS.includes(id as typeof ENDING_IDS[number])), 'Campaign endings are invalid.');
  const validateRow = (row: CampaignWeek) => {
    check(record(row) && Object.keys(row).sort().join() === [...rowFields].sort().join(), 'Campaign week has unknown or missing fields.');
    for (const key of rowFields.filter(key => !['frontierModelId','specialistModelId','frontierBehaviorTested'].includes(key))) {
      const value = row[key as keyof CampaignWeek];
      check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'Campaign metric is outside its range.');
    }
    check(row.week > 0 && row.week <= state.week, 'Campaign evidence must describe a settled week.');
    check(row.consumerAccounts <= 4000 && row.developerAccounts <= 400 && row.businessOrganizations <= 80 && row.paidProductKinds <= 3 && row.sustainedContracts <= 4, 'Campaign demand exceeds its finite population.');
    for (const key of ['serviceBps','trustBps','frontierScoreBps','frontierReliabilityBps','specialistScoreBps','specialistReliabilityBps'] as const) check(row[key] <= 10000, 'Campaign score exceeds its scale.');
    check(typeof row.frontierBehaviorTested === 'boolean', 'Campaign behavior evidence is invalid.');
    for (const key of ['frontierModelId','specialistModelId'] as const) {
      const modelId = row[key];
      check(modelId === null || (typeof modelId === 'string' && state.slices.models.versions[modelId]?.companyId === state.playerCompanyId), 'Campaign model evidence belongs to an unknown company.');
    }
    if (row.frontierModelId === null) check(row.frontierScoreBps === 0 && row.frontierReliabilityBps === 0 && !row.frontierBehaviorTested, 'Frontier scores have no model evidence.');
    if (row.specialistModelId === null) check(row.specialistScoreBps === 0 && row.specialistReliabilityBps === 0, 'Specialist scores have no model evidence.');
  };
  campaign.history.forEach(validateRow);
  for (let i = 1; i < campaign.history.length; i++) check(campaign.history[i].week > campaign.history[i-1].week, 'Campaign weeks must be unique and increasing.');
  for (const id of ENDING_IDS) {
    let expected = 0;
    for (let index = campaign.history.length - 1; index >= 0 && expected < ENDING_RULES[id].weeks; index--) {
      const row = campaign.history[index], next = campaign.history[index + 1];
      if ((next && row.week + 1 !== next.week) || !qualifiesForEnding(row, id, campaign.rules)) break;
      expected++;
    }
    check(campaign.endingStreaks[id] === expected, 'Campaign streak does not match its consecutive evidence.');
    const ending = campaign.endings[id];
    if (!ending) { check(!campaign.milestones.includes('ending-' + id), 'An ending milestone has no completion proof.'); continue; }
    check(record(ending) && Object.keys(ending).sort().join() === ['id','achievedWeek','proof'].sort().join() && ending.id === id, 'Ending identity is invalid.');
    check(Array.isArray(ending.proof) && ending.proof.length === ENDING_RULES[id].weeks, 'An ending needs its complete qualifying streak.');
    ending.proof.forEach(validateRow);
    check(ending.achievedWeek === ending.proof.at(-1)?.week && ending.achievedWeek <= state.week, 'Ending date does not match its proof.');
    ending.proof.forEach((row,index) => check(qualifiesForEnding(row, id, campaign.rules) && (!index || row.week === ending.proof[index-1].week + 1), 'An ending proof contains a missed condition or nonconsecutive week.'));
    check(campaign.milestones.includes('ending-' + id), 'A completed ending has no milestone.');
  }
}
