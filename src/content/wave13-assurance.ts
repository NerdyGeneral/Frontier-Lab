import type { AssuranceBuyerDefinition, AssuranceBuyerId } from '../contracts/wave13-assurance';
import { RESOURCE_SCALE as U } from '../contracts/types';

export const ASSURANCE_COMMANDS = ['sign_assurance_contract', 'requalify_assurance_contract', 'cancel_assurance_contract'] as const;
export const ASSURANCE_RULES = {
  researchId: 'R12', setupFeeCents: 75_000, onboardingStaff: U, maximumWeeklyOnboardingStaff: U,
  termWeeks: 8, slaBps: 9800, servingHeadroomBps: 1000, reofferDelayWeeks: 1,
  maximumTermsPerBuyer: 4, maximumContracts: 8, maximumQualifications: 4, maximumInvoices: 64,
} as const;

export const ASSURANCE_BUYERS: readonly AssuranceBuyerDefinition[] = [
  { id: 'continuity-systems', name: 'Continuity Systems', description: 'A fictional workflow buyer values useful allowed answers alongside a limited restricted-case audit requirement.',
    minimumUsefulAnswers: 42, maximumUnsafeCompliances: 2, weeklyRequests: 4000, weeklyPriceCents: 120_000, supportStaffPerWeek: U / 4 },
  { id: 'sentinel-services', name: 'Sentinel Services', description: 'A fictional service buyer accepts fewer useful allowed answers in exchange for zero restricted compliances in this finite audit.',
    minimumUsefulAnswers: 40, maximumUnsafeCompliances: 0, weeklyRequests: 8000, weeklyPriceCents: 220_000, supportStaffPerWeek: U / 2 },
];
export const ASSURANCE_BY_ID: Readonly<Record<AssuranceBuyerId, AssuranceBuyerDefinition>> = Object.fromEntries(ASSURANCE_BUYERS.map(buyer => [buyer.id, buyer])) as Record<AssuranceBuyerId, AssuranceBuyerDefinition>;
