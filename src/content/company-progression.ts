import type { CompanyAmbitionId, CompanyWorldId, ResearchProgramId } from '../contracts/company-progression';
import type { ChapterId } from '../contracts/strategic-variety';

export const COMPANY_WORLDS: Record<CompanyWorldId, { id: CompanyWorldId; name: string; description: string;
  favoredWorkload: 'responsive' | 'local' | 'continuity' | 'verified'; acquisitionBps: number; favoredProgram: ResearchProgramId }> = {
  'responsive-market': { id: 'responsive-market', name: 'The response-time race', description: 'Customers are comparing useful, responsive services. Efficient experiments receive a 15% entry-fee grant; responsive offers attract 12% more interest within the existing market.', favoredWorkload: 'responsive', acquisitionBps: 11200, favoredProgram: 'efficient-systems' },
  'local-market': { id: 'local-market', name: 'A market for local AI', description: 'Customers favor systems that fit close to their data. Efficient experiments receive a 15% entry-fee grant; local offers attract 12% more interest within the existing market.', favoredWorkload: 'local', acquisitionBps: 11200, favoredProgram: 'efficient-systems' },
  'continuity-market': { id: 'continuity-market', name: 'Long-running customer work', description: 'Customers need services that retain changing information. Persistent-systems experiments receive a 15% entry-fee grant; continuity offers attract 12% more interest within the existing market.', favoredWorkload: 'continuity', acquisitionBps: 11200, favoredProgram: 'persistent-systems' },
  'verification-market': { id: 'verification-market', name: 'Demand for checked outcomes', description: 'Customers are paying attention to independently checked work. Verified-systems experiments receive a 15% entry-fee grant; verified offers attract 12% more interest within the existing market.', favoredWorkload: 'verified', acquisitionBps: 11200, favoredProgram: 'verified-systems' },
};
export const COMPANY_WORLD_IDS = Object.keys(COMPANY_WORLDS) as CompanyWorldId[];
export const RESEARCH_PROGRAMS: Record<ResearchProgramId, { name: string; description: string; reward: string }> = {
  'efficient-systems': { name: 'Efficient systems', description: 'Deliver useful answers as compute, latency and memory limits tighten. Compact models, experts, and deployment engineering can all qualify.', reward: 'Each passed stage earns 2% more interest for responsive and local offers, up to 8%.' },
  'persistent-systems': { name: 'Persistent systems', description: 'Retain changing facts for larger concurrent workloads, while meeting a bounded memory budget and response time.', reward: 'Each passed stage earns 2% more interest for continuity offers, up to 8%.' },
  'verified-systems': { name: 'Verified systems', description: 'Complete harder checked tasks within a response deadline and compute budget. Compare capability, repeated inference and independent verification.', reward: 'Each passed stage earns 2% more interest for verified offers, up to 8%.' },
};
export const RESEARCH_PROGRAM_IDS = Object.keys(RESEARCH_PROGRAMS) as ResearchProgramId[];
export const RESEARCH_PROGRAM_STAGES = ['Pilot', 'Production', 'Fleet', 'Frontier'] as const;
export const RESEARCH_EXPERIMENT_LIMIT = 96;
export const COMPANY_AMBITION_HISTORY_LIMIT = 12;
export const CHAPTER_REWARDS: Record<ChapterId, { name: string; description: string }> = {
  'first-product': { name: 'Applied research access', description: 'Fund systems experiments with exact models and earn accreditation for matching products.' },
  'efficient-portfolio': { name: 'Reusable engineering methods', description: 'Future systems experiments need 15% less research compute.' },
  'advanced-specialist': { name: 'Shared research library', description: 'Future systems experiments need 20% fewer Research points.' },
  'frontier-lab': { name: 'Frontier testbed', description: 'Unlock the fourth stage of every systems research program.' },
};
export const COMPANY_ORIGIN_LEGACIES = {
  garage: { name: 'Lean experimentation', description: 'Your low-overhead research practice keeps systems-experiment entry fees 10% lower.' },
  university: { name: 'Academic methods', description: 'Your founding research methods reduce Research-point requirements for systems experiments by 15%.' },
  consultancy: { name: 'Client relationships', description: 'Matching repeat or partner customers bring 3% more interest to your specialized offers.' },
} as const;
export const COMPANY_AMBITIONS: Record<CompanyAmbitionId, { name: string; description: string; weeks: number }> = {
  'efficient-provider': { name: 'Efficient intelligence provider', description: 'Build a profitable service whose paid customers benefit from measured efficiency, supported by independent systems research.', weeks: 4 },
  'private-provider': { name: 'Private AI supplier', description: 'Maintain dependable, profitable private deployments or customer-hosted licenses with real delivered revenue.', weeks: 4 },
  'verified-provider': { name: 'Verified work company', description: 'Earn dependable revenue from checked model work, supported by paid verification research.', weeks: 4 },
  'silicon-supplier': { name: 'Silicon supplier', description: 'Deliver a profitable accelerator or appliance order from a qualified design, and retain the cash to operate the company.', weeks: 4 },
};
export const COMPANY_AMBITION_IDS = Object.keys(COMPANY_AMBITIONS) as CompanyAmbitionId[];
