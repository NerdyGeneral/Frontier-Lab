export const RELEASE_CAMPAIGN_VERSION = '0.22.0';
export type CampaignOrigin = 'garage' | 'university' | 'consultancy';
export type CampaignRules = 'classic' | 'release';

export type EndingId = 'frontier' | 'platform' | 'specialist';

/** Settled, bounded evidence. A route must meet every condition in the same week. */
export interface CampaignWeek {
  week: number;
  revenueCents: number; operatingExpenseCents: number; cashCents: number; baseCostCents: number; arrearsCents: number;
  consumerAccounts: number; developerAccounts: number; businessOrganizations: number; paidProductKinds: number;
  serviceBps: number; trustBps: number; agentPenaltyCents: number;
  frontierModelId: string | null; frontierScoreBps: number; frontierReliabilityBps: number; frontierBehaviorTested: boolean;
  specialistModelId: string | null; specialistScoreBps: number; specialistReliabilityBps: number;
  sustainedContracts: number;
}

export interface CampaignEnding {
  id: EndingId;
  achievedWeek: number;
  proof: CampaignWeek[];
}

export interface Wave4CampaignFields {
  /** Added at the 0.38 boundary; historical paid work and ending proofs stay unchanged. */
  progression?: import('./company-progression').CompanyProgression;
  chapters?: import('./strategic-variety').ChapterProgress;
  customerBriefs?: Partial<Record<import('./customer-briefs').BriefId, import('./customer-briefs').CustomerBrief>>;
  systemsBriefs?: Record<string, import('./systems-briefs').SystemsBriefOrder>;
  rules?: CampaignRules;
  origin?: CampaignOrigin;
  history: CampaignWeek[];
  endings: Partial<Record<EndingId, CampaignEnding>>;
}

export interface CampaignCriterion {
  id: string; label: string; current: string; target: string; met: boolean; detail: string;
}
export interface CampaignRouteView {
  id: EndingId; name: string; description: string;
  requiredWeeks: number; streak: number; achievedWeek: number | null;
  criteria: CampaignCriterion[];
}
export interface CampaignView { routes: CampaignRouteView[]; completedCount: number }
