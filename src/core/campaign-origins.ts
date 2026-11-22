import { CAMPAIGN_ORIGINS, originStaffId } from '../content/campaign-origins';
import { RESOURCE_SCALE, type GameState } from '../contracts/types';
import type { CampaignOrigin } from '../contracts/wave4-campaign';
import { initializeConsultancyBrief } from '../modules/customer-briefs';

/** Apply opening assets only during new-game creation, after the rival market exists. */
export function initializeOrigin(state: GameState, origin: CampaignOrigin): void {
  if (origin === 'garage') return;
  if (state.slices.campaign.rules !== 'release' || !Object.hasOwn(CAMPAIGN_ORIGINS, origin)) throw new Error('Choose an available release campaign origin.');
  const definition = CAMPAIGN_ORIGINS[origin];
  const { company, compute, research, markets, campaign } = state.slices;
  const owner = state.playerCompanyId;
  campaign.origin = origin;
  state.seed += ':' + origin;
  company.companies[owner].cashCents = definition.cashCents;
  company.companies[owner].activeStaff = definition.crew.length;
  for (const role of definition.crew) {
    const id = originStaffId(origin, role);
    company.staff[id] = { id, companyId: owner, role, hiredWeek: 0, readyWeek: 0, assignedFte: RESOURCE_SCALE, scenarioStart: true };
  }
  research.completed = [...definition.knowledge];
  research.completedByCompany[owner] = [...definition.knowledge];
  const fleet = compute.fleets[owner];
  const researchCU = origin === 'university' ? Math.floor(fleet.cloudCU / 2 / RESOURCE_SCALE) * RESOURCE_SCALE : 0;
  fleet.allocation = { development: fleet.cloudCU - researchCU, research: researchCU, serving: 0 };

  const cohortId = origin === 'university' ? 'rival-atlas-cohort-casual' : 'rival-harbor-cohort-business';
  const incumbent = markets.cohorts.find(cohort => cohort.id === cohortId)!;
  incumbent.count += origin === 'university' ? 60 : 4;
  if (origin === 'consultancy') initializeConsultancyBrief(state);
  state.journal[0].message = definition.openingNotice;
}
